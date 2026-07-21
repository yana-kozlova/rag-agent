export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  calendarId?: string;
  calendarLabel?: string | null;
};

/**
 * Structured event returned by the getEvents tool for the UI to render.
 * The model never sees this shape — the tool's toModelOutput hands the LLM the
 * same text lines it received before. Keep this in sync with the getEvents card.
 */
export type ToolCalendarEvent = {
  id: string;
  calendarId: string;
  title: string;
  /** ISO datetime for timed events, or YYYY-MM-DD for all-day. */
  start?: string;
  end?: string;
  allDay: boolean;
  location?: string;
  description?: string;
  htmlLink?: string;
};


