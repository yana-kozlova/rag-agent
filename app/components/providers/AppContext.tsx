'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

type AppState = {
  showAllDayEvents: boolean;
  setShowAllDayEvents: (value: boolean) => void;
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
};

const AppContext = createContext<AppState | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [showAllDayEvents, setShowAllDayEvents] = useState<boolean>(true);
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // hydrate from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('app.prefs');
      if (raw) {
        const parsed = JSON.parse(raw) as { showAllDayEvents?: boolean; selectedDate?: string };
        if (typeof parsed.showAllDayEvents === 'boolean') setShowAllDayEvents(parsed.showAllDayEvents);
        if (parsed.selectedDate) {
          const d = new Date(parsed.selectedDate);
          if (!Number.isNaN(d.getTime())) setSelectedDate(d);
        }
      }
    } catch {}
  }, []);

  // persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('app.prefs', JSON.stringify({ showAllDayEvents, selectedDate: selectedDate.toISOString() }));
    } catch {}
  }, [showAllDayEvents, selectedDate]);

  const value = useMemo<AppState>(
    () => ({ showAllDayEvents, setShowAllDayEvents, selectedDate, setSelectedDate }),
    [showAllDayEvents, selectedDate]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within an AppProvider');
  return ctx;
}


