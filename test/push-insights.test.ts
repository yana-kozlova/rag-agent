import { describe, it, expect } from 'vitest';
import {
  findConflicts,
  findNoBreakRuns,
  collectPeople,
  buildPersonInsight,
  rankInsights,
  isDeclined,
  type DayEvent,
} from '@/lib/push/insights';

const TZ = 'Europe/Kyiv';
/** Fixed scan instant: 2026-07-21 06:00 UTC = 09:00 Kyiv. */
const NOW = new Date('2026-07-21T06:00:00Z');

/** Builds an event from Kyiv wall-clock times, which is how the cases read. */
function ev(
  id: string,
  startLocal: string,
  endLocal: string,
  extra: Partial<DayEvent> = {}
): DayEvent {
  return {
    id,
    calendarId: 'primary',
    title: id,
    start: `2026-07-21T${startLocal}:00+03:00`,
    end: `2026-07-21T${endLocal}:00+03:00`,
    allDay: false,
    ...extra,
  };
}

describe('findConflicts', () => {
  it('finds overlapping events and measures the overlap', () => {
    const conflicts = findConflicts(
      [ev('a', '10:00', '11:00'), ev('b', '10:30', '11:30')],
      NOW,
      TZ
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].overlapMinutes).toBe(30);
    expect(conflicts[0].notifyAt).toEqual(NOW);
  });

  it('ignores events that merely touch', () => {
    expect(
      findConflicts([ev('a', '10:00', '11:00'), ev('b', '11:00', '12:00')], NOW, TZ)
    ).toEqual([]);
  });

  it('ignores all-day events', () => {
    const allDay: DayEvent = {
      id: 'holiday',
      calendarId: 'primary',
      title: 'Holiday',
      start: '2026-07-21',
      end: '2026-07-22',
      allDay: true,
    };

    expect(findConflicts([allDay, ev('a', '10:00', '11:00')], NOW, TZ)).toEqual([]);
  });

  it('ignores events the user declined', () => {
    const declined = ev('b', '10:30', '11:30', {
      attendees: [{ self: true, responseStatus: 'declined' }],
    });

    expect(findConflicts([ev('a', '10:00', '11:00'), declined], NOW, TZ)).toEqual([]);
  });

  it('does not flag the same event synced across two calendars', () => {
    const onPrimary = ev('shared', '10:00', '11:00');
    const onFollowed = { ...onPrimary, calendarId: 'team@example.com' };

    expect(findConflicts([onPrimary, onFollowed], NOW, TZ)).toEqual([]);
  });

  it('produces a dedupe key that does not depend on input order', () => {
    const [forward] = findConflicts(
      [ev('a', '10:00', '11:00'), ev('b', '10:30', '11:30')],
      NOW,
      TZ
    );
    const [reversed] = findConflicts(
      [ev('b', '10:30', '11:30'), ev('a', '10:00', '11:00')],
      NOW,
      TZ
    );

    expect(forward.dedupeKey).toBe(reversed.dedupeKey);
  });

  it('catches a long event swallowing a later short one', () => {
    const conflicts = findConflicts(
      [ev('long', '09:00', '17:00'), ev('short', '14:00', '14:30')],
      NOW,
      TZ
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].overlapMinutes).toBe(30);
  });
});

describe('findNoBreakRuns', () => {
  it('flags four hours of back-to-back meetings', () => {
    const runs = findNoBreakRuns(
      [
        ev('a', '10:00', '11:00'),
        ev('b', '11:00', '12:30'),
        ev('c', '12:40', '14:00'),
      ],
      NOW,
      TZ
    );

    expect(runs).toHaveLength(1);
    expect(runs[0].totalMinutes).toBe(240);
    expect(runs[0].events).toHaveLength(3);
  });

  it('breaks the run when a real gap appears', () => {
    const runs = findNoBreakRuns(
      [
        ev('a', '10:00', '11:00'),
        ev('b', '11:00', '12:00'),
        // 90-minute lunch splits the day into two short runs.
        ev('c', '13:30', '14:30'),
        ev('d', '14:30', '15:30'),
      ],
      NOW,
      TZ
    );

    expect(runs).toEqual([]);
  });

  it('ignores a single long block', () => {
    expect(findNoBreakRuns([ev('workshop', '09:00', '17:00')], NOW, TZ)).toEqual([]);
  });

  it('fires ten minutes before the run starts', () => {
    const [run] = findNoBreakRuns(
      [ev('a', '14:00', '16:00'), ev('b', '16:00', '17:30')],
      NOW,
      TZ
    );

    // 14:00 Kyiv is 11:00 UTC; ten minutes earlier is 10:50 UTC.
    expect(run.notifyAt.toISOString()).toBe('2026-07-21T10:50:00.000Z');
  });

  it('never schedules into the past for a run already underway', () => {
    // Scan is 09:00 Kyiv; this run began at 08:00.
    const [run] = findNoBreakRuns(
      [ev('a', '08:00', '10:00'), ev('b', '10:00', '11:30')],
      NOW,
      TZ
    );

    expect(run.notifyAt).toEqual(NOW);
  });

  it('treats overlapping events as continuous rather than as a gap', () => {
    const runs = findNoBreakRuns(
      [
        ev('a', '10:00', '13:00'),
        ev('b', '11:00', '12:00'),
        ev('c', '13:00', '14:00'),
      ],
      NOW,
      TZ
    );

    expect(runs).toHaveLength(1);
    expect(runs[0].totalMinutes).toBe(240);
  });
});

describe('collectPeople', () => {
  it('dedupes attendees across events and skips the user', () => {
    const people = collectPeople([
      ev('a', '10:00', '11:00', {
        attendees: [
          { self: true, email: 'me@example.com' },
          { email: 'Olena@Example.com', displayName: 'Olena' },
        ],
      }),
      ev('b', '14:00', '15:00', {
        attendees: [{ email: 'olena@example.com', displayName: 'Olena K' }],
      }),
    ]);

    expect([...people.keys()]).toEqual(['olena@example.com']);
    expect(people.get('olena@example.com')?.name).toBe('Olena');
  });

  it('skips meeting rooms', () => {
    const people = collectPeople([
      ev('a', '10:00', '11:00', {
        attendees: [
          { email: 'room-3@resource.calendar.google.com', displayName: 'Room 3' },
        ],
      }),
    ]);

    expect(people.size).toBe(0);
  });
});

describe('buildPersonInsight', () => {
  const person = { key: 'olena@example.com', name: 'Olena', email: 'olena@example.com' };

  it('fires thirty minutes before the meeting', () => {
    const insight = buildPersonInsight(ev('a', '14:00', '15:00'), person, NOW, TZ);

    // 14:00 Kyiv is 11:00 UTC; thirty minutes earlier is 10:30 UTC.
    expect(insight?.notifyAt.toISOString()).toBe('2026-07-21T10:30:00.000Z');
  });

  it('returns nothing for a meeting that already started', () => {
    expect(buildPersonInsight(ev('a', '08:00', '09:00'), person, NOW, TZ)).toBeNull();
  });

  it('clamps to now when the lead time already passed', () => {
    // 09:15 Kyiv is 15 minutes out — inside the 30-minute lead.
    const insight = buildPersonInsight(ev('a', '09:15', '10:00'), person, NOW, TZ);

    expect(insight?.notifyAt).toEqual(NOW);
  });
});

describe('rankInsights', () => {
  it('caps the day and puts conflicts first', () => {
    const events = [
      ev('a', '10:00', '11:00'),
      ev('b', '10:30', '11:30'),
      ev('c', '11:30', '13:00'),
      ev('d', '13:00', '15:00'),
    ];

    const ranked = rankInsights(
      [...findConflicts(events, NOW, TZ), ...findNoBreakRuns(events, NOW, TZ)],
      2
    );

    expect(ranked).toHaveLength(2);
    expect(ranked[0].kind).toBe('conflict');
  });

  it('does not mutate the input', () => {
    const insights = findConflicts(
      [ev('a', '10:00', '11:00'), ev('b', '10:30', '11:30')],
      NOW,
      TZ
    );
    const before = [...insights];

    rankInsights(insights, 1);

    expect(insights).toEqual(before);
  });
});

describe('isDeclined', () => {
  it('only counts the user own response', () => {
    const someoneElseDeclined = ev('a', '10:00', '11:00', {
      attendees: [{ email: 'other@example.com', responseStatus: 'declined' }],
    });

    expect(isDeclined(someoneElseDeclined)).toBe(false);
  });
});
