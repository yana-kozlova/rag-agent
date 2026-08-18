import { describe, it, expect } from 'vitest';
import { toLlmLine, eventsToModelOutput, weekdayOf } from '@/lib/ai/tools/events/get-events-format';
import type { ToolCalendarEvent } from '@/types/calendar';

const timed: ToolCalendarEvent = {
  id: '1',
  calendarId: 'primary',
  title: 'Standup',
  start: '2026-07-22T09:00:00+03:00',
  end: '2026-07-22T09:15:00+03:00',
  allDay: false,
  location: 'Zoom',
};

describe('getEvents model-output contract', () => {
  /*
   * The line was frozen byte-for-byte at the structured-output refactor, to
   * prove that change was invisible to the model. `Day:` breaks it on purpose:
   * the model was deriving the weekday itself and getting it wrong. The shape
   * is still pinned here, since everything else about it still has to stay put.
   */
  it('states the segments in order, with the weekday supplied', () => {
    expect(toLlmLine(timed)).toBe(
      '[Event] Standup. When: 2026-07-22T09:00:00+03:00 - 2026-07-22T09:15:00+03:00. Day: Wednesday. Location: Zoom',
    );
  });

  it('omits optional segments when absent', () => {
    const minimal: ToolCalendarEvent = { id: '2', calendarId: 'primary', title: 'Focus', allDay: false };
    expect(toLlmLine(minimal)).toBe('[Event] Focus');
  });

  it('includes description after location, in order', () => {
    const full: ToolCalendarEvent = { ...timed, description: 'Daily sync' };
    expect(toLlmLine(full)).toBe(
      '[Event] Standup. When: 2026-07-22T09:00:00+03:00 - 2026-07-22T09:15:00+03:00. Day: Wednesday. Location: Zoom. Description: Daily sync',
    );
  });

  it('hands the model a JSON array of lines (byte-identical to the old string[] return)', () => {
    const out = eventsToModelOutput({ events: [timed], count: 1 });
    expect(out).toEqual({ type: 'json', value: [toLlmLine(timed)] });
  });

  it('yields an empty array for no events, matching the old empty return', () => {
    expect(eventsToModelOutput({ events: [], count: 0 })).toEqual({ type: 'json', value: [] });
  });
});

/**
 * The week that came back two days out.
 *
 * Asked what was on, the assistant answered "Сьогодні, 18 серпня (четвер)" —
 * the 18th was a Tuesday — and shifted every day after it. The line carried a
 * bare ISO timestamp, so naming the weekday was arithmetic left to the model.
 */
describe('weekdayOf', () => {
  it('names the day the ISO date actually falls on', () => {
    expect(weekdayOf('2026-08-18T12:00:00+03:00')).toBe('Tuesday');
    expect(weekdayOf('2026-08-19T12:00:00+03:00')).toBe('Wednesday');
    expect(weekdayOf('2026-08-21T12:00:00+03:00')).toBe('Friday');
  });

  /** All-day events arrive as a bare date, and must work the same way. */
  it('handles a bare YYYY-MM-DD', () => {
    expect(weekdayOf('2026-08-18')).toBe('Tuesday');
  });

  /**
   * The date prefix is already local to the event's own offset. Parsing the
   * whole string and asking `Date` for a weekday answers in the server's zone,
   * which on a UTC host names the day before for anything before 03:00 in Kyiv.
   */
  it('reads the local date, not the server one', () => {
    expect(weekdayOf('2026-08-18T00:30:00+03:00')).toBe('Tuesday');
    expect(weekdayOf('2026-08-18T23:30:00-05:00')).toBe('Tuesday');
  });

  it('returns nothing for an unparseable value', () => {
    expect(weekdayOf('sometime next week')).toBeUndefined();
  });
});

describe('toLlmLine — day and standing blocks', () => {
  const base = { id: '1', calendarId: 'primary', title: 'Urtime daily', allDay: false };

  it('states the weekday so the model never derives it', () => {
    const line = toLlmLine({
      ...base,
      start: '2026-08-18T12:00:00+03:00',
      end: '2026-08-18T12:30:00+03:00',
    } as any);
    expect(line).toContain('Day: Tuesday');
  });

  it('marks a Free block as not a commitment', () => {
    const line = toLlmLine({
      ...base,
      title: 'Working hours',
      start: '2026-08-18T08:30:00+03:00',
      end: '2026-08-18T18:00:00+03:00',
      timeBlock: true,
    } as any);
    expect(line).toContain('marked Free');
  });

  it('says nothing extra for an ordinary meeting', () => {
    const line = toLlmLine({
      ...base,
      start: '2026-08-18T12:00:00+03:00',
      end: '2026-08-18T12:30:00+03:00',
    } as any);
    expect(line).not.toContain('marked Free');
  });
});
