'use client';

import { useEffect, useRef, useState } from 'react';
import { getLocalDateKey } from '@/app/components/utils/date-time';

export function useAutoGreeting(params: {
  history: Array<{ createdAt?: string | Date; role: 'user' | 'assistant' | 'system' }>;
  historyLoaded: boolean;
  sendMessage: (opts: { text: string }) => void;
}): string | null {
  const { history, historyLoaded, sendMessage } = params;
  const [autoPrompt, setAutoPrompt] = useState<string | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!historyLoaded || firedRef.current) return;
    const todayKey = getLocalDateKey(new Date());
    const hasToday = history.some((m) => {
      const c = m.createdAt ? new Date(m.createdAt as any) : undefined;
      if (!c || isNaN(c.getTime())) return false;
      return getLocalDateKey(c) === todayKey;
    });
    if (hasToday) return;

    firedRef.current = true;
    const todayLabel = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    const prompt = `Greet the user briefly and summarize today's (${todayLabel}) schedule. Provide life-affirming phrase on the basis of busyness of the day.`;
    setAutoPrompt(prompt);
    sendMessage({ text: prompt });
  }, [historyLoaded, history, sendMessage]);

  return autoPrompt;
}


