'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';

import { useCalendar } from '@/app/components/providers/CalendarContext';
import { MeetingLink } from '@/app/components/utils/linkify';
import { tagColor } from '@/app/components/utils/tag-color';
import { buildAgenda, type AgendaEntry, type AgendaTaskInput } from '@/lib/utils/agenda';
import { daysLate } from '@/lib/tasks/tasks';
import { daysBetween } from '@/lib/timeline/timeline';

/**
 * The day, in one list.
 *
 * Replaces the separate "Today" calendar card and the tasks card, which between
 * them showed a timed task twice. What is late comes first because it is the
 * part that changes what to do next; the day follows in time order; the
 * deadlines of the next few days close the list, while there is still a choice
 * of which day to spend on them.
 */

type TasksResponse = {
  today: string;
  counts: { open: number; overdue: number; today: number };
  buckets: {
    overdue: AgendaTaskInput[];
    today: AgendaTaskInput[];
    upcoming: AgendaTaskInput[];
  };
};

const pad = (n: number) => String(n).padStart(2, '0');

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "tomorrow", "Thu" — read off the date string, never through a UTC parse. */
function dayLabel(date: string, today: string): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function SectionLabel({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div
      className={`mb-1 font-mono text-[10px] uppercase tracking-wide ${
        tone === 'error' ? 'text-error' : 'text-base-content/40'
      }`}
    >
      {children}
    </div>
  );
}

function Row({
  entry,
  meta,
  busy,
  onComplete,
}: {
  entry: AgendaEntry;
  meta?: React.ReactNode;
  busy: boolean;
  onComplete: (taskId: string) => void;
}) {
  const dot = tagColor(entry.calendarId);

  return (
    <li
      className={`-mx-2 grid grid-cols-[46px_1fr_auto] items-start gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-base-200/60 ${
        entry.past ? 'opacity-50' : ''
      }`}
    >
      <time className="pt-0.5 font-mono text-xs text-base-content/50">
        {entry.start ? formatTime(entry.start) : entry.taskId ? '' : 'all-day'}
      </time>

      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-base-content">{entry.title}</div>
        {(meta || entry.end || entry.location || entry.meetingLink) && (
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-xs text-base-content/50">
            {dot && <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: dot }} />}
            {entry.start && entry.end && (
              <span className="shrink-0">
                {formatTime(entry.start)} – {formatTime(entry.end)}
              </span>
            )}
            {entry.location && <span className="truncate">· {entry.location}</span>}
            {entry.meetingLink && (
              <>
                <span className="shrink-0 opacity-50">·</span>
                <MeetingLink value={entry.meetingLink} />
              </>
            )}
            {meta}
          </div>
        )}
      </div>

      {entry.taskId ? (
        <button
          type="button"
          onClick={() => onComplete(entry.taskId!)}
          disabled={busy}
          className="btn btn-ghost btn-xs btn-circle"
          aria-label={`Done: ${entry.title}`}
          title="Mark done"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span />
      )}
    </li>
  );
}

export default function Today() {
  const { events, loading: calendarLoading, error: calendarError, refresh } = useCalendar();
  const [tasks, setTasks] = useState<TasksResponse | null>(null);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      if (res.ok) setTasks(await res.json());
    } catch {
      // Without tasks the card still shows the calendar.
    } finally {
      setTasksLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
    const onChange = () => loadTasks();
    window.addEventListener('dashboard:resources-changed', onChange);
    return () => window.removeEventListener('dashboard:resources-changed', onChange);
  }, [loadTasks]);

  async function complete(id: string) {
    setBusy(id);
    try {
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', id }),
      });
      await loadTasks();
    } finally {
      setBusy(null);
    }
  }

  const agenda = useMemo(() => {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayStart.getDate() + 1);

    return buildAgenda({
      events,
      tasks: tasks?.buckets ?? { overdue: [], today: [], upcoming: [] },
      // The server's today is the user's own zone; the browser's is the fallback
      // until tasks arrive.
      today: tasks?.today ?? localDateKey(now),
      dayStart,
      dayEnd,
      now,
    });
  }, [events, tasks]);

  const today = tasks?.today ?? localDateKey(new Date());
  const loading = (calendarLoading && events.length === 0) || tasksLoading;
  const dayCount = agenda.day.length;
  const openCount = tasks?.counts.open ?? 0;

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-base-content">Today</h2>
          <span className="rounded-full bg-base-200 px-1.5 py-0.5 font-mono text-[11px] text-base-content/60">
            {dayCount}
          </span>
          {agenda.overdue.length > 0 && (
            <span className="rounded-full bg-error/15 px-1.5 py-0.5 font-mono text-[11px] text-error">
              {agenda.overdue.length} overdue
            </span>
          )}
        </div>
        <button
          onClick={() => {
            refresh();
            loadTasks();
          }}
          disabled={calendarLoading}
          className="text-[13px] font-medium text-base-content/50 transition-colors hover:text-primary disabled:opacity-50"
        >
          {calendarLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-md bg-base-200" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {agenda.overdue.length > 0 && (
            <div>
              <SectionLabel tone="error">Overdue</SectionLabel>
              <ul className="flex flex-col">
                {agenda.overdue.map((entry) => {
                  const late = daysLate(entry.dueOn, today);
                  return (
                    <Row
                      key={entry.key}
                      entry={entry}
                      busy={busy === entry.taskId}
                      onComplete={complete}
                      meta={<span className="text-error">{late === 1 ? '1 day late' : `${late} days late`}</span>}
                    />
                  );
                })}
              </ul>
            </div>
          )}

          <div>
            {(agenda.overdue.length > 0 || agenda.soon.length > 0) && <SectionLabel>Schedule</SectionLabel>}
            {calendarError && <p className="mb-1 text-sm text-error">{calendarError}</p>}
            {dayCount === 0 ? (
              <p className="text-sm text-base-content/50">Nothing planned for today.</p>
            ) : (
              <ul className="flex flex-col">
                {agenda.day.map((entry) => (
                  <Row
                    key={entry.key}
                    entry={entry}
                    busy={busy === entry.taskId}
                    onComplete={complete}
                    meta={entry.overdue ? <span className="text-error">overdue</span> : undefined}
                  />
                ))}
              </ul>
            )}
          </div>

          {agenda.soon.length > 0 && (
            <div>
              <SectionLabel>Coming up</SectionLabel>
              <ul className="flex flex-col">
                {agenda.soon.map((entry) => (
                  <Row
                    key={entry.key}
                    entry={entry}
                    busy={busy === entry.taskId}
                    onComplete={complete}
                    meta={
                      <span>
                        {entry.dueOn
                          ? `due ${dayLabel(entry.dueOn, today)}`
                          : entry.scheduledFor
                            ? `planned ${dayLabel(entry.scheduledFor, today)}`
                            : null}
                      </span>
                    }
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <Link
        href="/tasks"
        className="mt-3 inline-block text-[13px] font-medium text-base-content/50 transition-colors hover:text-primary"
      >
        All tasks{openCount > 0 ? ` (${openCount})` : ''} →
      </Link>
    </section>
  );
}
