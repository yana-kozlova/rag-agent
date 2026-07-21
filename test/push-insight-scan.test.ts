import { describe, it, expect } from 'vitest';
import { scanDay, findNoteFor } from '@/lib/push/insight-scan';
import type { DayEvent } from '@/lib/push/insights';

const TZ = 'Europe/Kyiv';
/** 2026-07-21 06:00 UTC = 09:00 Kyiv, a plausible briefing hour. */
const NOW = new Date('2026-07-21T06:00:00Z');

const NO_QUIET = { quietHoursStart: null, quietHoursEnd: null };

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

function withPerson(id: string, start: string, end: string, name: string): DayEvent {
  return ev(id, start, end, {
    title: 'Sync',
    attendees: [
      { email: 'me@example.com', self: true },
      { email: `${name.toLowerCase()}@example.com`, displayName: name },
    ],
  });
}

describe('findNoteFor', () => {
  const person = { key: 'olena@example.com', name: 'Olena Kovalenko' };

  it('matches on a first name alone', () => {
    const note = findNoteFor([{ text: 'Olena is blocked on the billing migration' }], person);
    expect(note).toContain('billing migration');
  });

  it('matches on the full name', () => {
    expect(
      findNoteFor([{ text: 'Ping Olena Kovalenko about Q3' }], person)
    ).not.toBeNull();
  });

  it('returns null when no note mentions them', () => {
    expect(findNoteFor([{ text: 'Buy milk' }], person)).toBeNull();
  });

  it('ignores tokens too short to be distinctive', () => {
    // "Al" would otherwise match "already", "also", "alarm"...
    const shortName = { key: 'al@example.com', name: 'Al' };
    expect(findNoteFor([{ text: 'already done' }], shortName)).toBeNull();
  });
});

describe('scanDay', () => {
  it('produces nothing for a quiet, uneventful day', () => {
    expect(
      scanDay({
        events: [ev('a', '11:00', '11:30')],
        notes: [],
        now: NOW,
        tz: TZ,
        quietHours: NO_QUIET,
      })
    ).toEqual([]);
  });

  it('reports a conflict with its overlap spelled out', () => {
    const [insight] = scanDay({
      events: [ev('Standup', '10:00', '11:00'), ev('Review', '10:30', '11:30')],
      notes: [],
      now: NOW,
      tz: TZ,
      quietHours: NO_QUIET,
    });

    expect(insight.kind).toBe('insight-conflict');
    expect(insight.payload.body).toContain('30m');
    expect(insight.payload.body).toContain('10:30');
    // Conflicts need acting on, so they go out at scan time.
    expect(insight.notifyAt).toEqual(NOW);
  });

  it('reports a back-to-back stretch ten minutes before it starts', () => {
    const [insight] = scanDay({
      events: [
        ev('a', '14:00', '16:00'),
        ev('b', '16:00', '17:00'),
        ev('c', '17:00', '18:00'),
      ],
      notes: [],
      now: NOW,
      tz: TZ,
      quietHours: NO_QUIET,
    });

    expect(insight.kind).toBe('insight-no-break');
    expect(insight.payload.body).toContain('4h');
    expect(insight.notifyAt.toISOString()).toBe('2026-07-21T10:50:00.000Z');
  });

  it('surfaces a note about someone on today calendar', () => {
    const [insight] = scanDay({
      events: [withPerson('m1', '14:00', '15:00', 'Olena')],
      notes: [{ text: 'Olena is blocked on the billing migration' }],
      now: NOW,
      tz: TZ,
      quietHours: NO_QUIET,
    });

    expect(insight.kind).toBe('insight-person-context');
    expect(insight.payload.title).toContain('Olena');
    expect(insight.payload.title).toContain('14:00');
    expect(insight.payload.body).toContain('billing migration');
  });

  it('stays silent about people with no saved notes', () => {
    expect(
      scanDay({
        events: [withPerson('m1', '14:00', '15:00', 'Olena')],
        notes: [{ text: 'Unrelated thought' }],
        now: NOW,
        tz: TZ,
        quietHours: NO_QUIET,
      })
    ).toEqual([]);
  });

  it('mentions a person once, at their earliest meeting', () => {
    const insights = scanDay({
      events: [
        withPerson('m1', '11:00', '11:30', 'Olena'),
        withPerson('m2', '16:00', '16:30', 'Olena'),
      ],
      notes: [{ text: 'Olena is blocked on billing' }],
      now: NOW,
      tz: TZ,
      quietHours: NO_QUIET,
    });

    expect(insights).toHaveLength(1);
    expect(insights[0].payload.title).toContain('11:00');
  });

  it('drops insights that would land inside quiet hours', () => {
    // Scanning at an early briefing hour, for a run that has not started yet:
    // it begins 08:00 local, so the nudge falls at 07:50 — still inside a
    // 22→08 quiet window, and a warning moved to 08:00 would already be stale.
    const earlyNow = new Date('2026-07-21T04:00:00Z'); // 07:00 Kyiv
    const events = [ev('a', '08:00', '10:00'), ev('b', '10:00', '11:30')];

    const loud = scanDay({
      events,
      notes: [],
      now: earlyNow,
      tz: TZ,
      quietHours: NO_QUIET,
    });
    const quiet = scanDay({
      events,
      notes: [],
      now: earlyNow,
      tz: TZ,
      quietHours: { quietHoursStart: 22, quietHoursEnd: 8 },
    });

    expect(loud).toHaveLength(1);
    expect(loud[0].notifyAt.toISOString()).toBe('2026-07-21T04:50:00.000Z');
    expect(quiet).toEqual([]);
  });

  it('caps the day and puts the conflict first', () => {
    const insights = scanDay({
      events: [
        ev('Standup', '10:00', '11:00'),
        ev('Review', '10:30', '11:30'),
        ev('c', '11:30', '13:00'),
        ev('d', '13:00', '15:00'),
        withPerson('m1', '16:00', '16:30', 'Olena'),
      ],
      notes: [{ text: 'Olena is blocked on billing' }],
      now: NOW,
      tz: TZ,
      quietHours: NO_QUIET,
      cap: 2,
    });

    expect(insights).toHaveLength(2);
    expect(insights[0].kind).toBe('insight-conflict');
  });

  it('gives every insight a distinct dedupe key', () => {
    const insights = scanDay({
      events: [
        ev('Standup', '10:00', '11:00'),
        ev('Review', '10:30', '11:30'),
        withPerson('m1', '16:00', '16:30', 'Olena'),
      ],
      notes: [{ text: 'Olena is blocked on billing' }],
      now: NOW,
      tz: TZ,
      quietHours: NO_QUIET,
    });

    const keys = insights.map((i) => i.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
    // Keys carry the local day, so tomorrow's scan re-notifies.
    expect(keys.every((k) => k.includes('2026-07-21'))).toBe(true);
  });
});
