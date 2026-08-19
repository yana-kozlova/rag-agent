'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import {
  MAX_ANSWER_LENGTH,
  askFields,
  promptFor,
  usedToday,
  type QuickAction,
} from '@/lib/quick-actions/quick-actions';
import type { ColumnLike } from '@/lib/utils/table-columns';

/**
 * The buttons, wherever they are shown.
 *
 * One component for the dashboard and the table page, differing only in
 * `manage`: on the dashboard these are for pressing, and a delete control
 * beside a button you press daily is a mis-tap waiting to happen. On the
 * table page — where you have gone to look at the data — removing a stale
 * button is exactly the errand you are on.
 */

export type QuickActionView = QuickAction & { columns: ColumnLike[] };

type Toast = {
  text: string;
  tone: 'success' | 'error';
  /** Present only while the write is still undoable. */
  undo?: { actionId: string; rowId: string };
};

/** How long an undo stays on offer. Long enough to read the summary and react. */
const UNDO_WINDOW_MS = 8000;

export default function QuickActionsBar({
  tableId,
  manage = false,
  onWrote,
  emptyHint = true,
}: {
  /** Show only the buttons writing into this table. Omit for all of them. */
  tableId?: string;
  manage?: boolean;
  /** Called after a row lands, so a table view can reload. */
  onWrote?: () => void;
  /** Whether to render anything at all when the user has no quick actions. */
  emptyHint?: boolean;
}) {
  const [actions, setActions] = useState<QuickActionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const timeZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/quick-actions');
      const data = await res.json();
      if (data?.ok && Array.isArray(data.quickActions)) {
        setActions(
          tableId
            ? data.quickActions.filter((a: QuickActionView) => a.tableId === tableId)
            : data.quickActions
        );
      }
    } catch {
      /* leave the bar empty rather than showing an error where a button belongs */
    } finally {
      setLoading(false);
    }
  }, [tableId]);

  useEffect(() => {
    load();
    const onChange = () => load();
    // A button is usually created by asking the chat for one, and the rail
    // fires this when a turn ends. Without it the button the user just asked
    // for is described in the reply and absent from the screen until a reload,
    // which reads as the assistant having claimed something it did not do.
    window.addEventListener('dashboard:resources-changed', onChange);
    window.addEventListener('quick-actions:changed', onChange);
    return () => {
      window.removeEventListener('dashboard:resources-changed', onChange);
      window.removeEventListener('quick-actions:changed', onChange);
    };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.undo ? UNDO_WINDOW_MS : 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const run = async (action: QuickActionView, withAnswers: Record<string, string>) => {
    setBusyId(action.id);
    try {
      const res = await fetch(`/api/quick-actions/${action.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: withAnswers }),
      });
      const data = await res.json();

      if (!data?.ok) {
        setToast({ text: data?.error || 'Не вдалось записати', tone: 'error' });
        return;
      }

      setOpenId(null);
      setAnswers({});
      // Reflect the press without a round-trip: the button's own "вже сьогодні"
      // is the thing the user is looking at when they press it.
      setActions((prev) =>
        prev.map((a) =>
          a.id === action.id
            ? { ...a, lastUsedAt: new Date().toISOString(), useCount: a.useCount + 1 }
            : a
        )
      );
      setToast({
        text: data.summary ? `${action.label} · ${data.summary}` : `Записала: ${action.label}`,
        tone: 'success',
        undo: { actionId: action.id, rowId: data.rowId },
      });
      onWrote?.();
      window.dispatchEvent(new CustomEvent('dashboard:resources-changed'));
    } catch {
      setToast({ text: 'Не вдалось записати', tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const press = (action: QuickActionView) => {
    const asks = askFields(action.fields);
    if (asks.length === 0) {
      run(action, {});
      return;
    }
    setAnswers({});
    setOpenId((current) => (current === action.id ? null : action.id));
  };

  const undo = async (actionId: string, rowId: string) => {
    setToast(null);
    const res = await fetch(`/api/quick-actions/${actionId}/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowId }),
    });
    const data = await res.json();
    setToast(
      data?.ok
        ? { text: 'Скасувала', tone: 'success' }
        : { text: data?.error || 'Не вдалось скасувати', tone: 'error' }
    );
    if (data?.ok) {
      load();
      onWrote?.();
      window.dispatchEvent(new CustomEvent('dashboard:resources-changed'));
    }
  };

  const remove = async (action: QuickActionView) => {
    if (!confirm(`Прибрати кнопку «${action.label}»? Записи, які вона зробила, лишаться.`)) return;
    const res = await fetch(`/api/quick-actions/${action.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data?.ok) {
      setActions((prev) => prev.filter((a) => a.id !== action.id));
      setToast({ text: `Кнопку «${action.label}» прибрано`, tone: 'success' });
    } else {
      setToast({ text: data?.error || 'Не вдалось прибрати', tone: 'error' });
    }
  };

  if (loading) {
    return (
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 w-28 animate-pulse rounded-full bg-base-200" />
        ))}
      </div>
    );
  }

  if (actions.length === 0) {
    if (!emptyHint) return null;
    return (
      <p className="text-sm text-base-content/50">
        Швидких записів ще немає. Попроси в чаті — «зроби кнопку: Арчі щодня приймає ліки» — і вона
        зʼявиться тут.
      </p>
    );
  }

  const now = new Date();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const asks = askFields(action.fields);
          const done = usedToday(action.lastUsedAt, now, timeZone);
          const open = openId === action.id;

          return (
            <div key={action.id} className="relative">
              <button
                type="button"
                onClick={() => press(action)}
                disabled={busyId === action.id}
                title={`${action.tableTitle}${asks.length ? ` — спитає: ${asks.map((f) => promptFor(f, action.columns)).join(', ')}` : ''}`}
                className={`btn btn-sm h-auto min-h-9 gap-1.5 rounded-full py-1.5 normal-case ${
                  open ? 'btn-primary' : done ? 'btn-outline btn-success' : 'btn-outline'
                }`}
              >
                {action.icon && <span aria-hidden>{action.icon}</span>}
                <span>{action.label}</span>
                {asks.length > 0 && <span className="opacity-50">…</span>}
                {/* The question a person actually has in front of a daily
                    button: did I already do this today? */}
                {done && (
                  <span className="opacity-70" aria-label="вже сьогодні">
                    ✓
                  </span>
                )}
              </button>

              {manage && (
                <button
                  type="button"
                  onClick={() => remove(action)}
                  aria-label={`Прибрати ${action.label}`}
                  className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-base-300 text-[10px] leading-4 text-base-content/70 hover:bg-error hover:text-error-content"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* The form only exists for buttons that ask, and only while one is open. */}
      {actions
        .filter((a) => a.id === openId)
        .map((action) => {
          const asks = askFields(action.fields);
          return (
            <form
              key={action.id}
              onSubmit={(e) => {
                e.preventDefault();
                run(action, answers);
              }}
              className="flex flex-wrap items-end gap-2 rounded-box border border-base-300 bg-base-200/40 p-3"
            >
              {asks.map((field) => {
                const column = action.columns.find((c) => c.id === field.columnId);
                return (
                  <label key={field.columnId} className="flex flex-col gap-1">
                    <span className="text-xs text-base-content/60">
                      {promptFor(field, action.columns)}
                    </span>
                    <input
                      autoFocus={field === asks[0]}
                      className="input input-bordered input-sm w-40"
                      type={column?.type === 'number' ? 'number' : column?.type === 'date' ? 'date' : 'text'}
                      inputMode={column?.type === 'number' ? 'decimal' : undefined}
                      step={column?.type === 'number' ? 'any' : undefined}
                      maxLength={MAX_ANSWER_LENGTH}
                      value={answers[field.columnId] ?? ''}
                      onChange={(e) =>
                        setAnswers((prev) => ({ ...prev, [field.columnId]: e.target.value }))
                      }
                    />
                  </label>
                );
              })}
              <button type="submit" className="btn btn-primary btn-sm" disabled={busyId === action.id}>
                {busyId === action.id ? 'Записую…' : 'Записати'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenId(null)}>
                Скасувати
              </button>
            </form>
          );
        })}

      {toast && (
        <div
          className={`alert ${toast.tone === 'success' ? 'alert-success' : 'alert-error'} fixed bottom-4 left-1/2 z-50 w-[min(28rem,90vw)] -translate-x-1/2 shadow-lg`}
        >
          <span className="truncate text-sm">{toast.text}</span>
          {toast.undo && (
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => undo(toast.undo!.actionId, toast.undo!.rowId)}
            >
              Скасувати
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The dashboard panel: the bar plus somewhere to go when it is empty. */
export function QuickActionsPanel() {
  return (
    <section className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-base-content">Швидкі записи</h2>
        <Link
          href="/tables"
          className="text-[13px] font-medium text-base-content/50 transition-colors hover:text-primary"
        >
          Таблиці →
        </Link>
      </div>
      <QuickActionsBar />
    </section>
  );
}
