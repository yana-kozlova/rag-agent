// Shared display helpers for the in-chat tool cards. These only format for the
// human reader — the LLM sees the tool's own string output, never this.

const isAllDay = (iso?: string) => !!iso && !iso.includes('T');

function parse(iso?: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** "09:00" — omitted entirely for all-day values. */
export function formatTime(iso?: string): string {
  if (!iso || isAllDay(iso)) return '';
  const d = parse(iso);
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}

/** "Wed, Jul 22" in the viewer's locale. */
export function formatDay(iso?: string): string {
  const d = parse(iso);
  return d ? d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '';
}

/**
 * A compact human "when": collapses same-day ranges to one date, spells out
 * all-day, and spans multi-day. e.g. "Wed, Jul 22 · 09:00 – 10:00".
 */
export function formatWhen(startISO?: string, endISO?: string): string {
  const start = parse(startISO);
  if (!start) return '';
  if (isAllDay(startISO)) return `${formatDay(startISO)} · all day`;

  const end = parse(endISO);
  const startDay = formatDay(startISO);
  const startTime = formatTime(startISO);
  if (!end) return `${startDay} · ${startTime}`;

  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${startDay} · ${startTime} – ${formatTime(endISO)}`
    : `${startDay} ${startTime} → ${formatDay(endISO)} ${formatTime(endISO)}`;
}

/** Relevance 0–1 → whole-percent string for the mono meter label. */
export function formatRelevance(value: unknown): string | null {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : null;
}
