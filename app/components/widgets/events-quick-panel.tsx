'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCalendar } from '@/app/components/providers/CalendarContext';
import { MeetingLink } from '@/app/components/utils/linkify';
import { tagColor } from '@/app/components/utils/tag-color';

function getStartOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0 ? -6 : 1) - day; // move to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function sameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isBeforeLocalDay(a: Date, b: Date) {
  const ay = a.getFullYear(), am = a.getMonth(), ad = a.getDate();
  const by = b.getFullYear(), bm = b.getMonth(), bd = b.getDate();
  if (ay !== by) return ay < by;
  if (am !== bm) return am < bm;
  return ad < bd;
}

const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function fmt(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function EventsQuickPanel() {
  const { events } = useCalendar();
  const [selected, setSelected] = useState<Date>(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [showAllDay, setShowAllDay] = useState(true);

  const weekDays = useMemo(() => {
    const start = getStartOfWeek(new Date());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, []);

  const filtered = useMemo(() => {
    const now = new Date();
    const dayEvents = events.filter(ev => {
      const startStr = ev.start as string | undefined;
      const endStr = ev.end as string | undefined;
      const start = startStr ? new Date(startStr) : null;
      const isAllDay = (!!startStr && !startStr.includes('T')) && (!!endStr && !endStr.includes('T'));
      if (!showAllDay && isAllDay) return false;
      if (!start || !sameLocalDay(start, selected)) return false;
      return true;
    }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    const upcoming = dayEvents.find(ev => new Date(ev.start).getTime() >= now.getTime()) || dayEvents[0];
    return { dayEvents, featured: upcoming };
  }, [events, selected, showAllDay]);

  const featured = filtered.featured;

  // countdown: to start if in the future, otherwise to end if ongoing
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, []);
  const nowMs = Date.now();
  const startMs = featured?.start ? new Date(featured.start).getTime() : undefined;
  const endMs = featured?.end ? new Date(featured.end).getTime() : undefined;
  let targetMs: number | undefined;
  let countLabel = 'starts in';
  if (startMs && startMs > nowMs) { targetMs = startMs; countLabel = 'starts in'; }
  else if (endMs && endMs > nowMs) { targetMs = endMs; countLabel = 'ends in'; }
  let h = 0, m = 0;
  if (targetMs) {
    const delta = Math.max(0, targetMs - nowMs);
    h = Math.floor(delta / 3600000);
    m = Math.floor((delta % 3600000) / 60000);
  }

  return (
    <section className="w-full">
      <h2 className="mb-3 text-[15px] font-semibold text-base-content">This week</h2>

      <div className="mb-4 grid grid-cols-7 gap-1">
        {weekDays.map((d) => {
          const isSel = sameLocalDay(d, selected);
          const isPast = isBeforeLocalDay(d, new Date());
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => setSelected(new Date(d))}
              disabled={isPast}
              className={`flex flex-col items-center gap-0.5 rounded-md py-2 transition-colors ${
                isSel ? 'bg-primary/10' : 'hover:bg-base-200/60'
              } ${isPast ? 'opacity-40' : ''}`}
            >
              <span className={`font-mono text-[13px] ${isSel ? 'font-medium text-primary' : 'text-base-content'}`}>
                {d.getDate()}
              </span>
              <span className="font-mono text-[9px] tracking-wide text-base-content/50">{DAY_LABELS[d.getDay()]}</span>
            </button>
          );
        })}
      </div>

      <label className="mb-3 flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          className="toggle toggle-xs toggle-primary"
          checked={showAllDay}
          onChange={(e) => setShowAllDay(e.currentTarget.checked)}
        />
        <span className="text-xs text-base-content/60">Show all-day events</span>
      </label>

      {featured && !showAllDay ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-base-content">{featured.title}</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-xs text-base-content/50">
              <span className="truncate">
                {fmt(featured.start)} – {fmt(featured.end)}{featured.location ? ` · ${featured.location}` : ''}
              </span>
              {featured.meetingLink ? (
                <>
                  <span className="shrink-0 opacity-50">·</span>
                  <MeetingLink value={featured.meetingLink} />
                </>
              ) : null}
            </div>
          </div>
          {targetMs ? (
            <div className="flex shrink-0 flex-col items-end">
              <span className="font-mono text-[10px] text-base-content/50">{countLabel}</span>
              <span className="font-mono text-xl font-medium tabular-nums text-base-content">{h}h {m}m</span>
            </div>
          ) : null}
        </div>
      ) : showAllDay && filtered.dayEvents.length > 0 ? (
        <ul className="flex flex-col">
          {filtered.dayEvents.map((ev) => {
            const dot = tagColor(ev.calendarId as string | undefined);
            return (
              <li key={ev.id} className="-mx-2 grid grid-cols-[46px_1fr] items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-base-200/60">
                <time className="pt-0.5 font-mono text-xs text-base-content/50">{fmt(ev.start)}</time>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-base-content">{ev.title}</div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-xs text-base-content/50">
                    {dot && <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: dot }} />}
                    <span className="truncate">
                      {fmt(ev.start)} – {fmt(ev.end)}{ev.location ? ` · ${ev.location}` : ''}
                    </span>
                    {ev.meetingLink ? (
                      <>
                        <span className="shrink-0 opacity-50">·</span>
                        <MeetingLink value={ev.meetingLink} />
                      </>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-base-content/50">No events for this day.</p>
      )}
    </section>
  );
}
