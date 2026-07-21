import { getLocalHour } from './timezone';

export type QuietHours = {
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
};

/**
 * Whether `hour` falls inside the quiet window [start, end).
 *
 * The window wraps past midnight when start > end — 22→8 means "22:00 through
 * 07:59", which is the case people actually configure. A start equal to end is
 * treated as no window rather than as "all day", since silencing everything is
 * never what someone means by setting both to the same value.
 */
export function isQuietHour(
  hour: number,
  start: number | null | undefined,
  end: number | null | undefined
): boolean {
  if (start == null || end == null) return false;
  if (start === end) return false;

  return start < end
    ? hour >= start && hour < end
    : hour >= start || hour < end;
}

/** Convenience wrapper: is it currently quiet for this user? */
export function isQuietNow(now: Date, tz: string, prefs: QuietHours): boolean {
  return isQuietHour(getLocalHour(now, tz), prefs.quietHoursStart, prefs.quietHoursEnd);
}
