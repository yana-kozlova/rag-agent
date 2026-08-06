import { describe, it, expect } from 'vitest';
import { toLlmLine, eventsToModelOutput } from '@/lib/ai/tools/events/get-events-format';
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
  it('reproduces the exact legacy line format', () => {
    // This string is what the model saw before the structured-output refactor.
    expect(toLlmLine(timed)).toBe(
      '[Event] Standup. When: 2026-07-22T09:00:00+03:00 - 2026-07-22T09:15:00+03:00. Location: Zoom',
    );
  });

  it('omits optional segments when absent', () => {
    const minimal: ToolCalendarEvent = { id: '2', calendarId: 'primary', title: 'Focus', allDay: false };
    expect(toLlmLine(minimal)).toBe('[Event] Focus');
  });

  it('includes description after location, in order', () => {
    const full: ToolCalendarEvent = { ...timed, description: 'Daily sync' };
    expect(toLlmLine(full)).toBe(
      '[Event] Standup. When: 2026-07-22T09:00:00+03:00 - 2026-07-22T09:15:00+03:00. Location: Zoom. Description: Daily sync',
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
