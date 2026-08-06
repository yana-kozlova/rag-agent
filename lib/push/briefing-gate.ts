import { getLocalHour, isValidTimezone } from './timezone';

/** The scheduling fields the dispatcher needs to decide who to wake. */
export type BriefingCandidate = {
  timezone: string | null;
  briefingHour: number | null;
  briefingEnabled: boolean;
};

/**
 * Cheap pre-gate, run in the dispatcher for every subscribed user each hour.
 *
 * It must touch nothing but memory — no token refresh, no Google, no per-user
 * query — because its whole job is to keep the expensive work off the ~95% of
 * users who are not in their briefing window right now.
 *
 * A user with no cached timezone can't be gated here (we'd have to call Google
 * to learn their local hour), so they're treated as due: the worker resolves
 * and caches their zone, then re-gates authoritatively. That self-heals after
 * one run, so the "unknown tz" cost is a one-time thing per new user.
 */
export function isBriefingDue(candidate: BriefingCandidate, now: Date): boolean {
  if (!candidate.briefingEnabled) return false;
  if (!isValidTimezone(candidate.timezone)) return true;
  return getLocalHour(now, candidate.timezone) === candidate.briefingHour;
}
