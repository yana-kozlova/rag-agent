/**
 * The rules a to-do list gets wrong quietly.
 *
 * Recurrence rolling and bucketing are both places where a plausible-looking
 * implementation produces a list that is subtly useless — a vitamin due
 * yesterday forever, a task shown in two sections so the counts disagree — and
 * neither failure announces itself. These pin the decisions.
 */
import { describe, it, expect } from 'vitest';

import {
  bucketTasks,
  daysLate,
  isOverdue,
  matchTaskByTitle,
  needKey,
  nextDueDate,
  withinHorizon,
  type BucketableTask,
} from '@/lib/tasks/tasks';

const task = (over: Partial<BucketableTask> = {}): BucketableTask => ({
  status: 'open',
  dueOn: null,
  scheduledFor: null,
  ...over,
});

describe('nextDueDate', () => {
  it('returns null for a task that does not recur', () => {
    expect(nextDueDate('2026-08-18', 'none', 1, '2026-08-18')).toBeNull();
  });

  describe('daily', () => {
    it('moves to tomorrow when completed on the day it was due', () => {
      expect(nextDueDate('2026-08-18', 'daily', 1, '2026-08-18')).toBe('2026-08-19');
    });

    // The rule that keeps a missed streak from being permanently accusing.
    it('lands on tomorrow after three missed days, not on the day after the miss', () => {
      expect(nextDueDate('2026-08-15', 'daily', 1, '2026-08-18')).toBe('2026-08-19');
    });

    it('still advances a full step when completed early', () => {
      // Due tomorrow, done today: the next one is a day past the old due date,
      // never a date already gone.
      expect(nextDueDate('2026-08-19', 'daily', 1, '2026-08-18')).toBe('2026-08-20');
    });

    it('honours an interval greater than one', () => {
      expect(nextDueDate('2026-08-18', 'daily', 3, '2026-08-18')).toBe('2026-08-21');
      // Anchored to the original date, so the rhythm survives a miss: 18 → 21 →
      // 24, and completing late on the 22nd lands on the 24th.
      expect(nextDueDate('2026-08-18', 'daily', 3, '2026-08-22')).toBe('2026-08-24');
    });

    it('crosses a month boundary', () => {
      expect(nextDueDate('2026-08-31', 'daily', 1, '2026-08-31')).toBe('2026-09-01');
    });
  });

  describe('weekly', () => {
    it('adds seven days', () => {
      expect(nextDueDate('2026-08-18', 'weekly', 1, '2026-08-18')).toBe('2026-08-25');
    });

    it('keeps the weekday after a long gap', () => {
      // 2026-08-18 is a Tuesday; three weeks missed must still land on a Tuesday.
      const next = nextDueDate('2026-08-18', 'weekly', 1, '2026-09-05')!;
      expect(next).toBe('2026-09-08');
      expect(new Date(`${next}T00:00:00Z`).getUTCDay()).toBe(2);
    });

    it('honours a fortnightly interval', () => {
      expect(nextDueDate('2026-08-18', 'weekly', 2, '2026-08-18')).toBe('2026-09-01');
    });
  });

  describe('monthly', () => {
    it('keeps the day of month', () => {
      expect(nextDueDate('2026-08-15', 'monthly', 1, '2026-08-15')).toBe('2026-09-15');
    });

    it('clamps into a short month', () => {
      expect(nextDueDate('2026-01-31', 'monthly', 1, '2026-01-31')).toBe('2026-02-28');
    });

    // The bug this guards: stepping from the last answer instead of from the
    // original turns a 31st-of-the-month task into a 28th one forever.
    it('recovers the 31st after passing through February', () => {
      expect(nextDueDate('2026-01-31', 'monthly', 1, '2026-02-28')).toBe('2026-03-31');
    });

    it('rolls forward across several missed months', () => {
      expect(nextDueDate('2026-01-15', 'monthly', 1, '2026-05-20')).toBe('2026-06-15');
    });
  });

  describe('annual', () => {
    it('adds a year', () => {
      expect(nextDueDate('2026-08-18', 'annual', 1, '2026-08-18')).toBe('2027-08-18');
    });

    it('clamps 29 February onto the 28th in a common year', () => {
      expect(nextDueDate('2024-02-29', 'annual', 1, '2024-02-29')).toBe('2025-02-28');
    });
  });

  it('treats a zero or negative interval as one rather than looping forever', () => {
    expect(nextDueDate('2026-08-18', 'daily', 0, '2026-08-18')).toBe('2026-08-19');
    expect(nextDueDate('2026-08-18', 'daily', -5, '2026-08-18')).toBe('2026-08-19');
  });

  it('always returns a date strictly after today', () => {
    for (const recurrence of ['daily', 'weekly', 'monthly', 'annual'] as const) {
      const next = nextDueDate('2020-03-01', recurrence, 1, '2026-08-18')!;
      expect(next > '2026-08-18').toBe(true);
    }
  });
});

describe('isOverdue and daysLate', () => {
  it('does not call a task due today late', () => {
    expect(isOverdue('2026-08-18', '2026-08-18')).toBe(false);
    expect(daysLate('2026-08-18', '2026-08-18')).toBe(0);
  });

  it('counts whole days past the deadline', () => {
    expect(isOverdue('2026-08-15', '2026-08-18')).toBe(true);
    expect(daysLate('2026-08-15', '2026-08-18')).toBe(3);
  });

  it('a task with no deadline is never overdue', () => {
    expect(isOverdue(null, '2026-08-18')).toBe(false);
    expect(daysLate(null, '2026-08-18')).toBe(0);
  });
});

describe('bucketTasks', () => {
  const today = '2026-08-18';

  it('puts each task in exactly one bucket', () => {
    const tasks = [
      task({ dueOn: '2026-08-15' }),
      task({ scheduledFor: today }),
      task({ dueOn: '2026-08-25' }),
      task({}),
    ];

    const buckets = bucketTasks(tasks, today);
    const total =
      buckets.overdue.length + buckets.today.length + buckets.upcoming.length + buckets.someday.length;

    expect(total).toBe(tasks.length);
    expect(buckets.overdue).toHaveLength(1);
    expect(buckets.today).toHaveLength(1);
    expect(buckets.upcoming).toHaveLength(1);
    expect(buckets.someday).toHaveLength(1);
  });

  // Deadline-first precedence: what the user needs to know is that it is late.
  it('calls an overdue task overdue even when it is scheduled for today', () => {
    const buckets = bucketTasks([task({ dueOn: '2026-08-15', scheduledFor: today })], today);

    expect(buckets.overdue).toHaveLength(1);
    expect(buckets.today).toHaveLength(0);
  });

  it('keeps a task scheduled for a future day out of today', () => {
    const buckets = bucketTasks([task({ scheduledFor: '2026-08-20' })], today);

    expect(buckets.today).toHaveLength(0);
    expect(buckets.upcoming).toHaveLength(1);
  });

  it('treats a deadline of today as upcoming, not overdue', () => {
    const buckets = bucketTasks([task({ dueOn: today })], today);

    expect(buckets.overdue).toHaveLength(0);
    expect(buckets.upcoming).toHaveLength(1);
  });

  it('drops tasks that are not open', () => {
    const buckets = bucketTasks(
      [task({ status: 'done', dueOn: '2026-08-15' }), task({ status: 'dropped' })],
      today
    );

    expect(buckets.overdue).toHaveLength(0);
    expect(buckets.someday).toHaveLength(0);
  });

  it('sorts the most imminent first', () => {
    const buckets = bucketTasks(
      [task({ dueOn: '2026-09-01' }), task({ dueOn: '2026-08-20' }), task({ dueOn: '2026-08-25' })],
      today
    );

    expect(buckets.upcoming.map((t) => t.dueOn)).toEqual([
      '2026-08-20',
      '2026-08-25',
      '2026-09-01',
    ]);
  });

  it('sorts the most late first among overdue', () => {
    const buckets = bucketTasks(
      [task({ dueOn: '2026-08-17' }), task({ dueOn: '2026-08-01' })],
      today
    );

    expect(buckets.overdue.map((t) => t.dueOn)).toEqual(['2026-08-01', '2026-08-17']);
  });

  it('orders an undated-but-scheduled task by the day it is planned for', () => {
    const buckets = bucketTasks(
      [task({ dueOn: '2026-08-25' }), task({ scheduledFor: '2026-08-20' })],
      today
    );

    expect(buckets.upcoming[0].scheduledFor).toBe('2026-08-20');
  });
});

describe('withinHorizon', () => {
  const today = '2026-08-18';

  // The user asked for the widget to reach past tomorrow: a deadline on Thursday
  // is exactly the thing you want to see on Tuesday, while there is still room
  // to choose which day to do it.
  it('includes the day after tomorrow at a three-day horizon', () => {
    const tasks = [task({ dueOn: '2026-08-20' }), task({ dueOn: '2026-08-21' })];
    expect(withinHorizon(tasks, today, 3)).toHaveLength(2);
  });

  it('excludes what falls past the horizon', () => {
    expect(withinHorizon([task({ dueOn: '2026-08-25' })], today, 3)).toHaveLength(0);
  });

  it('includes the horizon day itself', () => {
    expect(withinHorizon([task({ dueOn: '2026-08-21' })], today, 3)).toHaveLength(1);
  });

  it('keeps overdue tasks, which are always within any horizon', () => {
    expect(withinHorizon([task({ dueOn: '2026-08-01' })], today, 1)).toHaveLength(1);
  });

  it('drops undated tasks, which no horizon can reach', () => {
    expect(withinHorizon([task({})], today, 30)).toHaveLength(0);
  });
});

describe('matchTaskByTitle', () => {
  const list = [
    { title: 'купити форму' },
    { title: 'подати заяву в садок' },
    { title: 'Довідка від педіатра' },
  ];

  it('finds an exact title regardless of case and punctuation', () => {
    expect(matchTaskByTitle(list, 'довідка від педіатра!')).toEqual({
      status: 'match',
      task: list[2],
    });
  });

  it('finds a task by a fragment of its title', () => {
    expect(matchTaskByTitle(list, 'форму')).toEqual({ status: 'match', task: list[0] });
  });

  it('finds a task when the user said more than the title', () => {
    expect(matchTaskByTitle(list, 'купити форму нарешті')).toEqual({
      status: 'match',
      task: list[0],
    });
  });

  // The whole reason this refuses: closing the wrong task makes something that
  // still needs doing vanish from the only list tracking it.
  it('refuses rather than guessing when two tasks could be meant', () => {
    const ambiguous = [{ title: 'купити форму' }, { title: 'купити форму для Артема' }];
    const result = matchTaskByTitle(ambiguous, 'купити форму для');

    expect(result.status).toBe('ambiguous');
    expect(result.status === 'ambiguous' && result.tasks).toHaveLength(2);
  });

  it('prefers an exact match over a longer title containing it', () => {
    const both = [{ title: 'купити форму' }, { title: 'купити форму для Артема' }];
    expect(matchTaskByTitle(both, 'купити форму')).toEqual({ status: 'match', task: both[0] });
  });

  it('reports none when nothing resembles the query', () => {
    expect(matchTaskByTitle(list, 'полити квіти')).toEqual({ status: 'none' });
  });

  it('reports none for a query made only of punctuation', () => {
    expect(matchTaskByTitle(list, '???')).toEqual({ status: 'none' });
  });

  it('does not match everything on an empty list', () => {
    expect(matchTaskByTitle([], 'купити форму')).toEqual({ status: 'none' });
  });
});

describe('needKey', () => {
  it('folds case and punctuation so one need is recognised twice', () => {
    expect(needKey('Купити форму до 31.08!')).toBe(needKey('купити форму до 31 08'));
  });

  it('collapses whitespace', () => {
    expect(needKey('  клопотатися   про   довідку ')).toBe('клопотатися про довідку');
  });

  it('keeps genuinely different needs apart', () => {
    expect(needKey('купити форму')).not.toBe(needKey('купити зошити'));
  });

  it('survives a need made only of punctuation', () => {
    expect(needKey('!!!')).toBe('');
  });
});
