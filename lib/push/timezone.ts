/**
 * Timezone helpers for scheduled notifications.
 *
 * Cron expressions on Vercel are evaluated in UTC and that is not configurable.
 * So instead of trying to schedule "9am" globally, the cron fires every hour and
 * each user is filtered on whether it is currently their local briefing hour.
 * Everything here works off an explicit IANA zone — never the server's local time.
 */

export const DEFAULT_TIMEZONE = 'Europe/Kyiv';

/** True if `tz` is a zone this runtime's ICU data actually knows. */
export function isValidTimezone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wall-clock parts for `date` as observed in `tz`.
 * Uses formatToParts rather than string parsing so DST is handled by ICU.
 */
export function getLocalParts(
  date: Date,
  tz: string
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

/** Local hour (0-23) in `tz` at `date`. */
export function getLocalHour(date: Date, tz: string): number {
  return getLocalParts(date, tz).hour;
}

/** Local calendar date as YYYY-MM-DD in `tz`. Used to build dedupe keys. */
export function getLocalDateKey(date: Date, tz: string): string {
  const { year, month, day } = getLocalParts(date, tz);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Local day of week in `tz`: 0 = Sunday … 6 = Saturday.
 *
 * Derived from the local Y-M-D rather than from a formatted weekday string, so
 * it never depends on locale output, and never on the server's own zone.
 */
export function getLocalDayOfWeek(date: Date, tz: string): number {
  const { year, month, day } = getLocalParts(date, tz);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The local calendar date `days` away from `date`, as YYYY-MM-DD.
 *
 * Counts calendar days, not 24-hour spans: shifting across a DST boundary still
 * lands on the intended date, which naive millisecond arithmetic gets wrong for
 * hours near midnight. `Date.UTC` normalises out-of-range days for us.
 */
export function addLocalDays(date: Date, tz: string, days: number): string {
  const { year, month, day } = getLocalParts(date, tz);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));

  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * UTC offset of `tz` at `date`, in minutes. Positive east of Greenwich.
 * Derived by asking ICU for the same instant in both zones and diffing.
 */
export function getUtcOffsetMinutes(date: Date, tz: string): number {
  const asUtc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const asLocal = new Date(date.toLocaleString('en-US', { timeZone: tz }));
  return Math.round((asLocal.getTime() - asUtc.getTime()) / 60000);
}

/**
 * UTC offset of `tz` at `date` as an RFC-3339 suffix, e.g. "+03:00".
 *
 * Google Calendar queries need the offset spelled out; appending "Z" instead
 * would silently shift every boundary by the offset.
 */
export function formatUtcOffset(date: Date, tz: string): string {
  const minutes = getUtcOffsetMinutes(date, tz);
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);

  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');

  return `${sign}${hh}:${mm}`;
}

/**
 * The next instant at which it is `hour`:00 local time in `tz`.
 *
 * Computed by probing forward hour by hour from `from` rather than by
 * constructing a local Date, which would silently use the server's zone.
 * A 48-hour horizon covers every real DST transition.
 */
export function getNextLocalHour(from: Date, tz: string, hour: number): Date {
  const start = new Date(from.getTime());
  start.setUTCSeconds(0, 0);

  for (let i = 1; i <= 48; i++) {
    const candidate = new Date(start.getTime() + i * 60 * 60 * 1000);
    if (getLocalHour(candidate, tz) === hour) {
      // Snap to the top of that local hour.
      const snapped = new Date(candidate.getTime());
      snapped.setUTCMinutes(snapped.getUTCMinutes() - getLocalParts(candidate, tz).minute);
      return snapped;
    }
  }

  // Unreachable for valid zones; fall back to +24h so callers never get null.
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

/** Human-readable time in the user's own zone, for UI copy. */
export function formatInTimezone(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}
