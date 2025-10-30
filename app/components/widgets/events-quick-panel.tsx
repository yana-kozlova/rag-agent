'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCalendar } from '@/app/components/providers/CalendarContext';

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

export default function EventsQuickPanel() {
  const { events } = useCalendar();
  const [selected, setSelected] = useState<Date>(() => { const d = new Date(); d.setHours(0,0,0,0); return d; });
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
    // choose first upcoming or first
    const upcoming = dayEvents.find(ev => new Date(ev.start).getTime() >= now.getTime()) || dayEvents[0];
    return { dayEvents, featured: upcoming };
  }, [events, selected, showAllDay]);

  const featured = filtered.featured;

  const minutesBetween = (startStr?: string, endStr?: string) => {
    if (!startStr || !endStr) return undefined;
    const isAllDay = !startStr.includes('T') && !endStr.includes('T');
    if (isAllDay) return undefined;
    const ms = new Date(endStr).getTime() - new Date(startStr).getTime();
    if (ms <= 0) return 0;
    return Math.round(ms / 60000);
  };

  const duration = minutesBetween(featured?.start as string | undefined, featured?.end as string | undefined);

  // countdown (to start if in future, otherwise to end if ongoing)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, []);
  const nowMs = Date.now();
  const startMs = featured?.start ? new Date(featured.start).getTime() : undefined;
  const endMs = featured?.end ? new Date(featured.end).getTime() : undefined;
  let targetMs: number | undefined = undefined;
  if (startMs && startMs > nowMs) targetMs = startMs;
  else if (endMs && endMs > nowMs) targetMs = endMs;
  let h = 0, m = 0, s = 0;
  if (targetMs) {
    const delta = Math.max(0, targetMs - nowMs);
    h = Math.floor(delta / 3600000);
    m = Math.floor((delta % 3600000) / 60000);
    s = Math.floor((delta % 60000) / 1000);
  }

  const dayLetters = ['S','M','T','W','T','F','S'];

  return (
    <div className="card bg-base-100 card-border border-base-300 card-sm overflow-hidden shadow rounded-box">
      <div className="card-body gap-4 p-4">
        <div className="border-b-base-300 grid grid-cols-7 border-b border-dashed pb-3">
          {weekDays.map((d) => {
            const isSel = sameLocalDay(d, selected);
            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => setSelected(new Date(d))}
                disabled={isBeforeLocalDay(d, new Date())}
                className={`rounded-field flex flex-col items-center px-2 py-1 ${isSel ? 'bg-success text-success-content' : ''} ${isBeforeLocalDay(d, new Date()) ? 'opacity-50' : ''}`}
              >
                <span className="text-sm font-semibold">{d.getDate()}</span>
                <span className="text-[10px] font-semibold opacity-50">{dayLetters[d.getDay()]}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" className="toggle toggle-sm toggle-primary" checked={showAllDay} onChange={(e) => setShowAllDay(e.currentTarget.checked)} />
            <span className="text-xs">Show all day events</span>
          </label>
        </div>
      </div>
      <div className="bg-base-300">
        {featured && !showAllDay ? (
          <div className="flex items-center gap-2 p-4">
            <div className="grow min-w-0">
              <div className="text-sm font-medium truncate">{featured.title}</div>
              <div className="text-xs opacity-60 truncate">
                {new Date(featured.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {' – '}
                {new Date(featured.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {featured.location ? ` · ${featured.location}` : ''}
              </div>
            </div>
            <div className="shrink-0">
              <span className="countdown font-mono text-2xl">
                <span style={{ ['--value' as any]: h }} aria-live="polite" aria-label={String(h)}></span>
                {' '}h{' '}
                <span style={{ ['--value' as any]: m }} aria-live="polite" aria-label={String(m)}></span>
                {' '}m{' '}
              </span>
            </div>
          </div>
        )
        : showAllDay ? 
          filtered.dayEvents.map((ev) => {
            return (
                <div className="flex items-center gap-2 py-2 px-4">
                <div className="grow min-w-0">
                  <div className="text-sm font-medium truncate">{ev.title}</div>
                  <div className="text-xs opacity-60 truncate">
                    {new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {' – '}
                    {new Date(ev.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {ev.location ? ` · ${ev.location}` : ''}
                  </div>
                </div>
              </div>
            );
          })
         : (
          <div className="p-4 text-xs opacity-60">No events for this day</div>
        )}
      </div>
    </div>
  );
}


