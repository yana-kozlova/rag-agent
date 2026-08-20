'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CalendarPlus, CalendarX2, Check, Repeat, Trash2 } from 'lucide-react';

/** One task as the page renders it — serialisable, so a server component can pass it. */
export type TaskView = {
  id: string;
  title: string;
  note: string | null;
  dueOn: string | null;
  scheduledFor: string | null;
  scheduledStart: string | null;
  priority: string | null;
  area: string | null;
  recurrence: string;
  /** Computed on the server, never here — the same rule the tools follow. */
  daysLate: number;
  hasEvent: boolean;
};

const RECURRENCE_LABEL: Record<string, string> = {
  daily: 'щодня',
  weekly: 'щотижня',
  monthly: 'щомісяця',
  annual: 'щороку',
};

const PRIORITY_CLASS: Record<string, string> = {
  high: 'badge-error',
  medium: 'badge-warning',
  low: 'badge-ghost',
};

/** "18.08" — short, because the year is almost always this one. */
function shortDate(day: string): string {
  const [, month, date] = day.split('-');
  return `${date}.${month}`;
}

export default function TaskList({
  label,
  tasks,
  today,
}: {
  label: string;
  tasks: TaskView[];
  today: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, body: Record<string, unknown>) {
    setBusy(id);
    try {
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/tasks?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
        {label} <span className="opacity-60">({tasks.length})</span>
      </h2>

      <ul className="divide-y divide-base-300 rounded-lg border border-base-300">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-start gap-3 p-3">
            <button
              onClick={() => act(task.id, { action: 'complete' })}
              disabled={busy === task.id}
              className="btn btn-ghost btn-xs btn-circle mt-0.5 shrink-0"
              aria-label={`Виконано: ${task.title}`}
              title="Виконано"
            >
              <Check className="h-4 w-4" />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-medium">{task.title}</span>

                {task.daysLate > 0 && (
                  <span className="badge badge-error badge-sm">
                    {task.daysLate === 1 ? 'на день пізніше' : `на ${task.daysLate} дн. пізніше`}
                  </span>
                )}

                {task.priority && (
                  <span className={`badge badge-sm ${PRIORITY_CLASS[task.priority] ?? 'badge-ghost'}`}>
                    {task.priority}
                  </span>
                )}

                {task.recurrence !== 'none' && (
                  <span className="badge badge-ghost badge-sm gap-1">
                    <Repeat className="h-3 w-3" />
                    {RECURRENCE_LABEL[task.recurrence] ?? task.recurrence}
                  </span>
                )}

                {task.area && <span className="badge badge-outline badge-sm">{task.area}</span>}
              </div>

              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs opacity-70">
                {/* Both dates are shown whenever both exist: the whole point is
                    that "must be done by" and "will be done on" are different. */}
                {task.dueOn && <span>дедлайн {shortDate(task.dueOn)}</span>}
                {task.scheduledFor && (
                  <span>
                    роблю {task.scheduledFor === today ? 'сьогодні' : shortDate(task.scheduledFor)}
                    {task.scheduledStart ? ` о ${task.scheduledStart.slice(11, 16)}` : ''}
                  </span>
                )}
                {task.note && <span className="truncate">{task.note}</span>}
              </div>
            </div>

            <div className="flex shrink-0 gap-1">
              {task.scheduledFor ? (
                <button
                  onClick={() => act(task.id, { action: 'unschedule' })}
                  disabled={busy === task.id}
                  className="btn btn-ghost btn-xs btn-square"
                  aria-label="Прибрати з графіка"
                  title={task.hasEvent ? 'Прибрати з графіка й видалити подію' : 'Прибрати з графіка'}
                >
                  <CalendarX2 className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={() => act(task.id, { action: 'schedule', day: today })}
                  disabled={busy === task.id}
                  className="btn btn-ghost btn-xs btn-square"
                  aria-label="Зробити сьогодні"
                  title="Зробити сьогодні — створить подію в календарі"
                >
                  <CalendarPlus className="h-4 w-4" />
                </button>
              )}

              <button
                onClick={() => remove(task.id)}
                disabled={busy === task.id}
                className="btn btn-ghost btn-xs btn-square text-error"
                aria-label="Видалити"
                title="Видалити"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
