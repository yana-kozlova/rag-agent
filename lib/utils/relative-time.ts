/**
 * How long ago, in the length a glance needs.
 *
 * A list of saved things is read to answer "is this the one, and is it still
 * alive" — and "August 27, 2026 at 10:06 AM" answers that only after the reader
 * has worked out what today is. Past a week the day itself is the useful part
 * again ("12 Aug"), because by then "9d ago" is arithmetic in the other
 * direction.
 *
 * Written in the browser's own locale for the date form and in English for the
 * relative one, which is the web UI's language everywhere else — notifications
 * are the surface that speaks the user's, and they have `lib/push/copy.ts`.
 */
export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return '';

  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';

  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(value).toLocaleDateString([], { day: 'numeric', month: 'short' });
}
