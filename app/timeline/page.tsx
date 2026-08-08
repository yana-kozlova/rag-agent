import { redirect } from 'next/navigation';

import { auth } from '@/app/api/auth/auth';
import { getTimelineView } from '@/lib/actions/timeline';
import { GoogleCalendarService } from '@/lib/services/calendar';
import { fetchEventsBetween, formatEventTime } from '@/lib/push/calendar-window';
import { addLocalDays, formatUtcOffset } from '@/lib/push/timezone';
import {
  UPCOMING_HORIZON_DAYS,
  formatTimelineDate,
  groupByYear,
  nextAnnualOccurrence,
  timelineKindIcon,
  type DatePrecision,
} from '@/lib/timeline/timeline';
import AddDateForm from './AddDateForm';
import TimelineAxis, { type AxisGroup } from './TimelineAxis';

/** One line in "Coming up" — a projected saved date, or a meeting from Google. */
type UpcomingItem = {
  key: string;
  source: 'timeline' | 'calendar';
  date: string;
  title: string;
  icon: string;
  detail?: string | null;
  /** Years being completed, when the original year is known. Never on calendar rows. */
  years?: number | null;
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * How far ahead the calendar is folded in.
 *
 * Much shorter than the timeline's own horizon, and the asymmetry is the point:
 * the axis is for dates that will still matter in ten years, the calendar is for
 * the ones that stop mattering the moment they pass. Two months of meetings
 * poured into this page would bury the four things on it worth reading.
 */
const CALENDAR_HORIZON_DAYS = 14;
const MAX_CALENDAR_ITEMS = 12;

/**
 * The next fortnight's calendar, or nothing at all.
 *
 * Degrades on its own, deliberately: an expired token or a Google outage costs
 * the meetings and never the saved dates, which are the half of this page that
 * cannot be rebuilt from somewhere else.
 */
async function calendarItems(
  userId: string,
  accessToken: string | undefined,
  today: string,
  timezone: string
): Promise<UpcomingItem[]> {
  if (!accessToken) return [];

  try {
    const now = new Date();
    const until = addLocalDays(now, timezone, CALENDAR_HORIZON_DAYS);
    // The user's own offset, not UTC: bracketing the window in Z drops this
    // morning's early meetings for anyone east of Greenwich.
    const offset = formatUtcOffset(now, timezone);

    const events = await fetchEventsBetween(
      new GoogleCalendarService(accessToken, userId),
      userId,
      `${today}T00:00:00${offset}`,
      `${until}T23:59:59${offset}`,
      MAX_CALENDAR_ITEMS
    );

    return events.slice(0, MAX_CALENDAR_ITEMS).map((event) => ({
      key: `calendar:${event.calendarId}:${event.id}`,
      source: 'calendar' as const,
      date: event.start.slice(0, 10),
      title: event.title,
      icon: '🗓️',
      detail: event.allDay ? 'all day' : formatEventTime(event, timezone),
    }));
  } catch (error) {
    console.error('[timeline] Calendar fold-in failed (non-fatal):', error);
    return [];
  }
}

function dayLabel(date: string, today: string): string {
  const days = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return `in ${days} days`;
  if (days < 14) return 'next week';
  return `in ${Math.round(days / 7)} weeks`;
}

export default async function TimelinePage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/api/auth/signin');

  const view = await getTimelineView(userId, UPCOMING_HORIZON_DAYS);
  const { today, timezone } = view;

  const saved: UpcomingItem[] = view.upcoming.map((occurrence) => ({
    key: `timeline:${occurrence.event.id}:${occurrence.date}`,
    source: 'timeline',
    date: occurrence.date,
    title: occurrence.event.title,
    icon: timelineKindIcon(occurrence.event.kind),
    detail: occurrence.event.subject,
    // Only ever set when the original year is known — "turns 7" must not be
    // printed for a birthday whose year nobody ever said.
    years: occurrence.years,
  }));

  const calendar = await calendarItems(
    userId,
    session?.user?.accessToken as string | undefined,
    today,
    timezone
  );

  const upcoming = [...saved, ...calendar]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((item) => ({ ...item, when: dayLabel(item.date, today) }));

  const groups: AxisGroup[] = groupByYear(
    view.events.map((event) => ({ ...event, precision: event.precision as DatePrecision }))
  ).map((group) => ({
    year: group.year,
    items: group.items.map((event) => ({
      id: event.id,
      date: formatTimelineDate(event.occurredOn, event.precision as DatePrecision),
      sortKey: event.occurredOn,
      title: event.title,
      subject: event.subject,
      note: event.note,
      kind: event.kind,
      icon: timelineKindIcon(event.kind),
      recurring: event.recurrence === 'annual',
      source: event.source,
      entityId: event.entityId,
      resource: event.resourceId ? (view.sources[event.resourceId] ?? null) : null,
    })),
  }));

  // Annual dates get a section of their own because most of them are nowhere
  // else: a birthday recorded as --MM-DD has no year to be filed under, so the
  // axis cannot show it and "coming up" only does for a few weeks a year.
  const annual = view.events
    .filter((event) => event.recurrence === 'annual')
    .map((event) => ({
      id: event.id,
      title: event.title,
      subject: event.subject,
      icon: timelineKindIcon(event.kind),
      date: formatTimelineDate(
        event.occurredOn,
        event.precision === 'day' ? 'day-month' : (event.precision as DatePrecision)
      ),
      next: nextAnnualOccurrence(event.occurredOn, today),
    }))
    .sort((a, b) => a.next.localeCompare(b.next));

  return (
    <div className="container mx-auto max-w-4xl p-4 md:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Timeline</h1>
        <p className="mt-1 text-sm text-base-content/60">
          The dates worth finding years from now. Picked up from the notes you save, or told to the
          assistant directly — &ldquo;у Андрія день народження 14 березня&rdquo;.
        </p>
      </header>

      {upcoming.length > 0 && (
        <section className="mb-6 rounded-box border border-base-300 bg-base-100 p-4">
          <h2 className="mb-3 text-[15px] font-semibold">Coming up</h2>
          <ul className="flex flex-col gap-2">
            {upcoming.map((item) => (
              <li key={item.key} className="flex items-baseline gap-3">
                <span className="w-24 shrink-0 font-mono text-[11px] uppercase tracking-wide text-base-content/40">
                  {item.when}
                </span>
                <span className="shrink-0">{item.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-sm">{item.title}</span>
                  {item.years !== null && item.years !== undefined && item.years > 0 && (
                    <span className="ml-2 text-xs text-base-content/50">
                      turns {item.years}
                    </span>
                  )}
                  {item.detail && (
                    <span className="ml-2 text-xs text-base-content/50">{item.detail}</span>
                  )}
                </span>
                {item.source === 'calendar' && (
                  <span className="badge badge-ghost badge-xs shrink-0">calendar</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {annual.length > 0 && (
        <section className="mb-6 rounded-box border border-base-300 bg-base-100 p-4">
          <h2 className="mb-3 text-[15px] font-semibold">Every year</h2>
          <ul className="flex flex-wrap gap-2">
            {annual.map((item) => (
              <li
                key={item.id}
                className="flex items-baseline gap-2 rounded-full bg-base-200 px-3 py-1 text-xs"
              >
                <span>{item.icon}</span>
                <span className="font-medium">{item.title}</span>
                <span className="font-mono text-base-content/50">{item.date}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AddDateForm />

      {groups.length === 0 ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-6 text-center">
          <p className="text-sm text-base-content/60">
            Nothing on the timeline yet. Dates are read out of the notes you save — or tell the
            assistant one directly. Notes saved before this page existed can be swept with{' '}
            <code className="rounded bg-base-200 px-1">pnpm timeline:backfill</code>.
          </p>
        </div>
      ) : (
        <TimelineAxis groups={groups} />
      )}
    </div>
  );
}
