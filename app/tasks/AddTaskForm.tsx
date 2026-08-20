'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { MAX_TASK_TITLE, TASK_RECURRENCES } from '@/lib/tasks/tasks';

const RECURRENCE_LABEL: Record<string, string> = {
  none: 'один раз',
  daily: 'щодня',
  weekly: 'щотижня',
  monthly: 'щомісяця',
  annual: 'щороку',
};

/**
 * Adding a task by hand.
 *
 * Deliberately asks for the deadline and not the day of work: scheduling writes
 * a calendar event, and a form that offers both side by side invites filling in
 * both out of tidiness. Committing to a day is one click on the task afterwards,
 * once it exists and there is something to weigh it against.
 */
export default function AddTaskForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [area, setArea] = useState('');
  const [recurrence, setRecurrence] = useState('none');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          dueOn: dueOn || undefined,
          area: area.trim() || undefined,
          recurrence: recurrence === 'none' ? undefined : recurrence,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? 'Не вдалося зберегти');
        return;
      }

      setTitle('');
      setDueOn('');
      setArea('');
      setRecurrence('none');
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-outline btn-sm">
        Додати завдання
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-base-300 p-4">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={MAX_TASK_TITLE}
        placeholder="Що треба зробити"
        className="input input-bordered w-full"
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="form-control">
          <span className="label-text text-xs opacity-70">Дедлайн</span>
          <input
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            className="input input-bordered input-sm"
          />
        </label>

        <label className="form-control">
          <span className="label-text text-xs opacity-70">Сфера</span>
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="дім, робота…"
            className="input input-bordered input-sm"
          />
        </label>

        <label className="form-control">
          <span className="label-text text-xs opacity-70">Повтор</span>
          <select
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value)}
            className="select select-bordered select-sm"
          >
            {TASK_RECURRENCES.map((value) => (
              <option key={value} value={value}>
                {RECURRENCE_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={saving || !title.trim()} className="btn btn-primary btn-sm">
          {saving ? 'Зберігаю…' : 'Зберегти'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
          Скасувати
        </button>
      </div>
    </form>
  );
}
