'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type CalendarEvent = { id: string; title: string; start: string; end: string; location?: string };

type CalendarState = {
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  range: 'day' | 'week';
  setRange: (r: 'day' | 'week') => void;
  refresh: () => Promise<void>;
};

const CalendarContext = createContext<CalendarState | undefined>(undefined);

export function CalendarProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<'day' | 'week'>('day');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/calendar/live-events`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to fetch calendar events');
      }
      const data = await res.json();
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch (e: any) {
      setError(e.message || 'Error fetching calendar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const value = useMemo<CalendarState>(
    () => ({ events, loading, error, range, setRange, refresh: fetchData }),
    [events, loading, error, range, fetchData]
  );

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendar() {
  const ctx = useContext(CalendarContext);
  if (!ctx) throw new Error('useCalendar must be used within a CalendarProvider');
  return ctx;
}
