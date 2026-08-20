'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';

import { WIDGET_HORIZON_DAYS, withinHorizon } from '@/lib/tasks/tasks';

type WidgetTask = {
  id: string;
  title: string;
  dueOn: string | null;
  scheduledFor: string | null;
};

type TasksResponse = {
  today: string;
  counts: { open: number; overdue: number; today: number };
  buckets: {
    overdue: WidgetTask[];
    today: WidgetTask[];
    upcoming: WidgetTask[];
    someday: WidgetTask[];
  };
};

/**
 * What needs doing, reaching past today.
 *
 * The horizon is the point. A widget showing only today's tasks can only ever
 * report what is already urgent, and the tasks worth seeing early are exactly
 * the ones with a deadline a few days out — while there is still a choice of
 * which day to do them on. So this shows what is late, what is committed to
 * today, and the deadlines landing within `WIDGET_HORIZON_DAYS`.
 */
export default function TasksWidget() {
  const [data, setData] = useState<TasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      if (res.ok) setData(await res.json());
    } catch {
      // A widget that cannot load is a quiet widget, not a broken dashboard.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // The refresh convention the other widgets use.
    const onChange = () => load();
    window.addEventListener('dashboard:resources-changed', onChange);
    return () => window.removeEventListener('dashboard:resources-changed', onChange);
  }, [load]);

  async function complete(id: string) {
    setBusy(id);
    try {
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', id }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="skeleton h-24 w-full" />;
  if (!data) return null;

  const shown = [
    ...data.buckets.overdue.map((t) => ({ task: t, tag: 'прострочено' as const })),
    ...data.buckets.today.map((t) => ({ task: t, tag: 'сьогодні' as const })),
    // The shared rule, not a second copy of it: an inline filter here had
    // already drifted, admitting a dateless task because '' sorts before every
    // horizon.
    ...withinHorizon(data.buckets.upcoming, data.today, WIDGET_HORIZON_DAYS).map((t) => ({
      task: t,
      tag: 'скоро' as const,
    })),
  ].slice(0, 6);

  const TAG_CLASS = {
    прострочено: 'badge-error',
    сьогодні: 'badge-primary',
    скоро: 'badge-ghost',
  };

  return (
    <div className="space-y-2">
      {shown.length === 0 ? (
        <p className="text-sm opacity-60">
          {data.counts.open === 0 ? 'Нічого не висить.' : 'На найближчі дні нічого.'}
        </p>
      ) : (
        <ul className="space-y-1">
          {shown.map(({ task, tag }) => (
            <li key={task.id} className="flex items-center gap-2">
              <button
                onClick={() => complete(task.id)}
                disabled={busy === task.id}
                className="btn btn-ghost btn-xs btn-circle shrink-0"
                aria-label={`Виконано: ${task.title}`}
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
              <span className={`badge badge-sm shrink-0 ${TAG_CLASS[tag]}`}>{tag}</span>
            </li>
          ))}
        </ul>
      )}

      <Link href="/tasks" className="link link-hover text-xs opacity-70">
        Усі завдання{data.counts.open > shown.length ? ` (${data.counts.open})` : ''} →
      </Link>
    </div>
  );
}
