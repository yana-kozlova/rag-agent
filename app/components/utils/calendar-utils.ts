import type { CalendarEvent } from '@/types/calendar';

export function groupEventsByDay(events: CalendarEvent[]) {
  return events.reduce<Record<string, CalendarEvent[]>>((acc, ev) => {
    const d = new Date(ev.start);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(ev);
    return acc;
  }, {});
}

export function isInRange(ev: CalendarEvent, range: 'day' | 'week'): boolean {
  const now = new Date();
  const start = new Date(ev.start);
  const end = new Date(ev.end);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  if (range === 'week') {
    const endOfWeek = new Date();
    endOfWeek.setDate(endOfWeek.getDate() + 7);
    endOfWeek.setHours(23, 59, 59, 999);
    return end.getTime() >= now.getTime() && start.getTime() <= endOfWeek.getTime();
  }
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  return end.getTime() >= now.getTime() && start.getTime() <= endOfDay.getTime() && end.getTime() >= startOfDay.getTime();
}


