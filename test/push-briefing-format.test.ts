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

import { generateBriefing, type BriefingEvent } from '@/lib/push/briefing';
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
    const uk = await generateBriefing([], TZ, 'uk');
    const en = await generateBriefing([], TZ, 'en');

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
    const uk = await generateBriefing(null, TZ, 'uk');
    const en = await generateBriefing(null, TZ, 'en');

    expect(uk.body).toContain('Не вдалося прочитати календар');
    expect(uk.body).not.toContain('нічого не заплановано');
    expect(en.body).toContain('Could not read your calendar');
    expect(en.body).not.toContain('Nothing scheduled');
  });

  it('still delivers the week’s saved dates, which do not come from Google', async () => {
    const briefing = await generateBriefing(null, TZ, 'uk', [
      { title: 'Андрій', kind: 'birth', daysAway: 0, years: 41 },
    ]);

    expect(briefing.body).toContain('Не вдалося прочитати календар');
    expect(briefing.body).toContain('🎂 Андрій — сьогодні');
  });

  it('is not the same briefing as a genuinely empty day', async () => {
    const unreadable = await generateBriefing(null, TZ, 'uk');
    const empty = await generateBriefing([], TZ, 'uk');

    expect(unreadable.body).not.toBe(empty.body);
    expect(empty.body).toContain('нічого не заплановано');
  });
});

describe('the schedule', () => {
  it('gets one line per event, in order, with local times', async () => {
    const briefing = await generateBriefing(
      [ev('Standup', '09:00'), ev('Design sync', '10:30'), ev('Demo', '15:00')],
      TZ,
      'uk'
    );

    expect(briefing.title).toBe('☀️ 3 справи сьогодні');
    expect(briefing.body).toBe('09:00 Standup\n10:30 Design sync\n15:00 Demo');
  });

  it('collapses the tail past eight events into a count', async () => {
    const events = Array.from({ length: 11 }, (_, i) =>
      ev(`Event ${i}`, `${String(8 + i).padStart(2, '0')}:00`)
    );

    const briefing = await generateBriefing(events, TZ, 'uk');
    const lines = briefing.body.split('\n');

    expect(lines).toHaveLength(9);
    expect(lines[8]).toBe('+ще 3');
    expect(briefing.title).toBe('☀️ 11 справ сьогодні');
  });

  it('labels an all-day entry in the chosen language', async () => {
    const allDay = ev('Holiday', '00:00', { allDay: true });

    expect((await generateBriefing([allDay], TZ, 'uk')).body).toBe('увесь день Holiday');
    expect((await generateBriefing([allDay], TZ, 'en')).body).toBe('all day Holiday');
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

    const briefing = await generateBriefing(events, TZ, 'uk');
    const rendered = renderNotification({ title: briefing.title, body: briefing.body });

    expect(rendered.length).toBeLessThan(4096);
  });
});
