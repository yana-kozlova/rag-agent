import { describe, it, expect, vi } from 'vitest';

/**
 * No key, so `generateBriefing` takes its deterministic path. That is the half
 * worth pinning: the schedule is built here rather than asked of the model
 * precisely so it cannot come out wrong, and these assertions are what says so.
 */
// Hoisted, because `lib/db` reads `env` while it is still being imported —
// a plain const would not exist yet when the mocked getter is first called.
const envMock = vi.hoisted(() => ({}) as Record<string, string | undefined>);

vi.mock('@/lib/env.mjs', () => ({
  get env() {
    return envMock;
  },
}));

import { generateBriefing, cleanHeadline, type BriefingEvent } from '@/lib/push/briefing';
import { renderNotification, splitNotification } from '@/lib/push/deliver';

const TZ = 'Europe/Kyiv';

function ev(title: string, startLocal: string, extra: Partial<BriefingEvent> = {}) {
  return {
    id: title,
    calendarId: 'primary',
    title,
    start: `2026-07-21T${startLocal}:00+03:00`,
    end: `2026-07-21T${startLocal}:00+03:00`,
    allDay: false,
    ...extra,
  } as BriefingEvent;
}

describe('an empty day', () => {
  it('says so, in the chosen language', async () => {
    const uk = await generateBriefing([], TZ, [], 'uk');
    const en = await generateBriefing([], TZ, [], 'en');

    expect(uk.title).toBe('☀️ Доброго ранку');
    expect(uk.body).toBe('На сьогодні нічого не заплановано — календар вільний.');
    expect(en.title).toBe('☀️ Good morning');
    expect(en.body).toContain('Nothing scheduled');
    expect(uk.eventCount).toBe(0);
  });
});

/**
 * `[]` is a claim about the day; `null` is the absence of one. Collapsing them
 * is what sent "nothing scheduled — your calendar is clear" every morning for
 * five days while the account's Google token was dead.
 */
describe('a calendar that could not be read', () => {
  it('says so instead of claiming the day is free', async () => {
    const uk = await generateBriefing(null, TZ, [], 'uk');
    const en = await generateBriefing(null, TZ, [], 'en');

    expect(uk.body).toContain('Не вдалося прочитати календар');
    expect(uk.body).not.toContain('нічого не заплановано');
    expect(en.body).toContain('Could not read your calendar');
    expect(en.body).not.toContain('Nothing scheduled');
  });

  it('still delivers the week’s saved dates, which do not come from Google', async () => {
    const briefing = await generateBriefing(null, TZ, [], 'uk', [
      { title: 'Андрій', kind: 'birth', daysAway: 0, years: 41 },
    ]);

    expect(briefing.body).toContain('Не вдалося прочитати календар');
    expect(briefing.body).toContain('🎂 Андрій — сьогодні');
  });

  it('is not the same briefing as a genuinely empty day', async () => {
    const unreadable = await generateBriefing(null, TZ, [], 'uk');
    const empty = await generateBriefing([], TZ, [], 'uk');

    expect(unreadable.body).not.toBe(empty.body);
    expect(empty.body).toContain('нічого не заплановано');
  });
});

describe('the schedule', () => {
  it('gets one line per event, in order, with local times', async () => {
    const briefing = await generateBriefing(
      [ev('Standup', '09:00'), ev('Design sync', '10:30'), ev('Demo', '15:00')],
      TZ,
      [],
      'uk'
    );

    expect(briefing.title).toBe('☀️ 3 справи сьогодні');
    expect(briefing.body).toBe('09:00 Standup\n10:30 Design sync\n15:00 Demo');
  });

  it('collapses the tail past eight events into a count', async () => {
    const events = Array.from({ length: 11 }, (_, i) =>
      ev(`Event ${i}`, `${String(8 + i).padStart(2, '0')}:00`)
    );

    const briefing = await generateBriefing(events, TZ, [], 'uk');
    const lines = briefing.body.split('\n');

    expect(lines).toHaveLength(9);
    expect(lines[8]).toBe('+ще 3');
    expect(briefing.title).toBe('☀️ 11 справ сьогодні');
  });

  it('labels an all-day entry in the chosen language', async () => {
    const allDay = ev('Holiday', '00:00', { allDay: true });

    expect((await generateBriefing([allDay], TZ, [], 'uk')).body).toBe('увесь день Holiday');
    expect((await generateBriefing([allDay], TZ, [], 'en')).body).toBe('all day Holiday');
  });
});

describe('the whole message', () => {
  /**
   * The briefing is now multi-line, and `splitNotification` cuts a snoozed
   * message back apart on the first blank line — so the schedule must survive
   * a round trip intact rather than being mistaken for a second notification.
   */
  it('survives being rendered and read back', async () => {
    const briefing = await generateBriefing(
      [ev('Standup', '09:00'), ev('Demo', '15:00')],
      TZ,
      [],
      'uk'
    );

    const rendered = renderNotification({ title: briefing.title, body: briefing.body });
    const back = splitNotification(rendered);

    expect(back.title).toBe(briefing.title);
    expect(back.body).toBe(briefing.body);
  });

  it('truncates a title too long to belong in a list', async () => {
    const briefing = await generateBriefing(
      [ev('x'.repeat(500), '09:00'), ev('Short one', '10:00')],
      TZ,
      [],
      'uk'
    );

    const [first, second] = briefing.body.split('\n');

    expect(first).toMatch(/^09:00 x+…$/);
    expect(first.length).toBeLessThan(100);
    expect(second).toBe('10:00 Short one');
  });

  /**
   * Past 4096 characters `sendMessage` splits the notification, and a keyboard
   * can only ride on the last piece — so "Save" would file half a briefing.
   * Calendar titles are user data, so the guard has to hold against hostile
   * ones, not merely verbose ones.
   */
  it('stays inside a single Telegram message even with absurd titles', async () => {
    const events = Array.from({ length: 20 }, () => ev('т'.repeat(1000), '09:00'));

    const briefing = await generateBriefing(events, TZ, [], 'uk');
    const rendered = renderNotification({ title: briefing.title, body: briefing.body });

    expect(rendered.length).toBeLessThan(4096);
  });
});

/**
 * The model is told that a day with nothing to add gets no sentence at all —
 * a briefing that is only the schedule is a good briefing. A model asked for an
 * empty string rarely sends one, and every near-miss it sends instead would be
 * printed above the schedule as a line of noise that reads like a bug.
 */
describe('the model’s sentence', () => {
  it('is dropped when it carries no words', () => {
    for (const reply of ['', '  ', '—', '-', '.', '...', '""', '(  )']) {
      expect(cleanHeadline(reply)).toBe('');
    }
  });

  it('is dropped when it is a way of saying nothing', () => {
    for (const reply of ['none', 'None.', 'N/A', 'n/a', '(none)', 'nothing', 'null']) {
      expect(cleanHeadline(reply)).toBe('');
    }
  });

  it('keeps a real sentence, unquoted', () => {
    expect(cleanHeadline('  "Між 14:00 і 15:00 лише 20 хвилин на дорогу."  ')).toBe(
      'Між 14:00 і 15:00 лише 20 хвилин на дорогу.'
    );
  });

  it('caps a runaway generation', () => {
    expect(cleanHeadline('т'.repeat(2000))).toHaveLength(300);
  });
});

/**
 * Saved dates ride the same rail as the schedule: built here, never asked of
 * the model. A briefing that says a birthday is in three days when it is in two
 * is worse than one that never mentions it.
 */
describe('the week’s saved dates', () => {
  const birthday = { title: 'Андрій', kind: 'birth', daysAway: 2, years: 41 };

  it('lists them under the schedule, with the age only when it is known', async () => {
    const briefing = await generateBriefing(
      [ev('Standup', '09:00')],
      TZ,
      [],
      'uk',
      [birthday, { title: 'річниця', kind: 'anniversary', daysAway: 0, years: null }]
    );

    expect(briefing.body).toBe(
      '09:00 Standup\n\nДати:\n🎂 Андрій — через 2 дні, виповнюється 41\n💞 річниця — сьогодні'
    );
  });

  it('still sends on a day with nothing scheduled', async () => {
    const briefing = await generateBriefing([], TZ, [], 'uk', [birthday]);

    expect(briefing.eventCount).toBe(0);
    expect(briefing.body).toContain('нічого не заплановано');
    expect(briefing.body).toContain('🎂 Андрій — через 2 дні');
  });

  it('says nothing extra when there are none', async () => {
    const briefing = await generateBriefing([ev('Standup', '09:00')], TZ, [], 'uk', []);
    expect(briefing.body).toBe('09:00 Standup');
  });

  it('counts Ukrainian days in all three plural forms', async () => {
    const body = async (daysAway: number) =>
      (await generateBriefing([], TZ, [], 'uk', [{ title: 'x', kind: 'other', daysAway, years: null }]))
        .body;

    expect(await body(3)).toContain('через 3 дні');
    expect(await body(5)).toContain('через 5 днів');
    expect(await body(1)).toContain('завтра');
  });
});
