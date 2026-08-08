/**
 * What a calendar looks like once it has been read off the account.
 *
 * Lives in `lib/utils` and imports nothing, because the settings panel is a
 * client component and pulling this from `lib/services/calendar.ts` would drag
 * `googleapis` into the browser bundle (same reason as `lib/utils/uploadable.ts`).
 */

/** One calendar as Google's `calendarList` describes it, plus our own state. */
export type AccountCalendar = {
  id: string;
  /** What Google shows it as — the user's own rename wins over the owner's name. */
  summary: string;
  description: string | null;
  /** The account's own calendar. Always read, never stored as a subscription. */
  primary: boolean;
  /** `owner` | `writer` | `reader` | `freeBusyReader`. */
  accessRole: string;
  /** Google's colour for it, so the panel can show the dot the user recognises. */
  color: string | null;
  /** Whether this deployment reads it. Always true for the primary. */
  followed: boolean;
};

/** What is stored on `users.followed_calendars`. */
export type FollowedCalendar = {
  calendarId: string;
  summary: string | null;
};

/**
 * The account's own calendar is identified by the account's email address.
 *
 * Google answers `primary` for it *and* lists it under that address, so a user
 * who followed themselves by typing their own email had it fetched twice on
 * every read — once as `primary`, once by id. Events dedupe by id so nothing
 * looked wrong; it was one wasted round-trip per read, forever, and a settings
 * screen that listed the user's own calendar as if it were someone else's.
 *
 * Matched on the email rather than on `calendarList.primary` because the callers
 * that need this run on cron paths with no session and no reason to spend an API
 * call finding out which calendar is the user's own.
 */
export function isOwnPrimary(calendarId: string, email: string | null | undefined): boolean {
  if (!email) return false;
  return calendarId.trim().toLowerCase() === email.trim().toLowerCase();
}

/**
 * The calendars to read for a user: their own, then the ones they follow.
 *
 * `primary` leads because `fetchEventsBetween` keeps the first copy of a
 * duplicated event, and the copy on the user's own calendar is the one carrying
 * their `responseStatus`.
 */
export function calendarIdsFor(
  followed: readonly FollowedCalendar[],
  email: string | null | undefined
): string[] {
  const ids = ['primary'];

  for (const entry of followed) {
    const id = entry?.calendarId?.trim();
    if (!id || isOwnPrimary(id, email)) continue;
    if (!ids.includes(id)) ids.push(id);
  }

  return ids;
}

/**
 * The account's calendars with this deployment's state folded in, ordered the
 * way the panel reads: the user's own first, then what they follow, then the
 * rest alphabetically.
 *
 * A followed calendar that is no longer on the account is kept and marked —
 * dropping it would silently unfollow something the user chose, and the reason
 * it vanished (unsubscribed in Google, access revoked, calendar deleted) is
 * theirs to act on, not ours to guess.
 */
export function mergeCalendarState(
  available: readonly Omit<AccountCalendar, 'followed'>[],
  followed: readonly FollowedCalendar[],
  email: string | null | undefined
): AccountCalendar[] {
  const followedIds = new Set(
    followed.map((f) => f?.calendarId).filter((id): id is string => !!id)
  );

  const rows: AccountCalendar[] = available.map((calendar) => ({
    ...calendar,
    // The primary is read whether or not anyone subscribed to it, so showing it
    // as switchable would be a lie about what the assistant can see.
    followed: calendar.primary || followedIds.has(calendar.id),
  }));

  const known = new Set(rows.map((row) => row.id));

  for (const entry of followed) {
    const id = entry?.calendarId;
    if (!id || known.has(id) || isOwnPrimary(id, email)) continue;
    rows.push({
      id,
      summary: entry.summary || id,
      description: null,
      primary: false,
      accessRole: 'unknown',
      color: null,
      followed: true,
    });
  }

  return rows.sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    if (a.followed !== b.followed) return a.followed ? -1 : 1;
    return a.summary.localeCompare(b.summary);
  });
}
