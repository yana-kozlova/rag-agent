// Calm, desaturated calendar-identity palette (Notion-style). A given calendar
// keeps a stable colour via the same hash the whole app shares. These read on
// both light and dark grounds, so a single value works in either theme — used
// as a small dot next to the title, never as a loud filled badge.
const TAG_DOTS = [
  '#9b9a97', // gray
  '#a87c5f', // brown
  '#d9822b', // orange
  '#cba53b', // yellow
  '#4f9d69', // green
  '#2e7cf6', // blue
  '#8b5c9e', // purple
  '#c6568f', // pink
] as const;

/** Stable dot colour for a calendar id. `primary` has no dot (returns null). */
export function tagColor(calendarId?: string | null): string | null {
  if (!calendarId || calendarId === 'primary') return null;
  const k = calendarId.toLowerCase();
  let idx = 0;
  for (let i = 0; i < k.length; i++) idx = (idx * 31 + k.charCodeAt(i)) % TAG_DOTS.length;
  return TAG_DOTS[idx];
}
