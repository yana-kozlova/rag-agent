'use client';

import { useEffect, useRef, useState } from 'react';
import { SettingsSection } from './ui';

type Followed = { calendarId: string; summary: string | null };

export function CalendarsPanel() {
  const [items, setItems] = useState<Followed[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [inputId, setInputId] = useState('');
  const [inputSummary, setInputSummary] = useState('');
  const [query, setQuery] = useState('');
  const addDialogRef = useRef<HTMLDialogElement | null>(null);
  const openAdd = () => addDialogRef.current?.showModal();
  const closeAdd = () => addDialogRef.current?.close();

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/calendars');
      const data = await res.json();
      setItems(Array.isArray(data.calendars) ? data.calendars : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    const calendarId = inputId.trim();
    if (!calendarId) return;
    setAdding(true);
    try {
      const res = await fetch('/api/calendars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarId, summary: inputSummary.trim() || null }),
      });
      if (res.ok) {
        setInputId('');
        setInputSummary('');
        await load();
        closeAdd();
      }
    } finally {
      setAdding(false);
    }
  };

  const remove = async (calendarId: string) => {
    await fetch(`/api/calendars?calendarId=${encodeURIComponent(calendarId)}`, { method: 'DELETE' });
    await load();
  };

  const filtered = items.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      (c.summary || '').toLowerCase().includes(q) ||
      c.calendarId.toLowerCase().includes(q)
    );
  });

  return (
      <SettingsSection
        id="calendars"
        title="Followed Calendars"
        description="Events from these show up in briefings and in what the assistant can read."
        aside={
          <span className="rounded-full bg-base-200 px-2 py-0.5 font-mono text-xs text-base-content/60">
            {items.length}
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          {/* Only worth a filter once the list is longer than the eye can take
              in — below that it is an empty input box padding out the panel. */}
          {items.length > 4 && (
            <input
              className="input input-bordered input-sm w-full"
              placeholder="Filter by label or ID"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
          )}
          {loading ? (
            <div className="text-sm opacity-70">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-base-content/50">
              {items.length === 0 ? 'None followed yet.' : 'No calendars match.'}
            </div>
          ) : (
            <ul className="divide-y divide-base-300/70 overflow-hidden rounded-md border border-base-300">
              {filtered.map((c) => (
                <li key={c.calendarId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.summary || c.calendarId}</div>
                    {c.summary && <div className="truncate text-xs opacity-60">{c.calendarId}</div>}
                  </div>
                  <button className="btn btn-ghost btn-xs shrink-0" onClick={() => remove(c.calendarId)}>Remove</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <button className="btn btn-primary btn-sm" onClick={openAdd}>Add calendar</button>
          </div>
        </div>
        <dialog ref={addDialogRef} className="modal">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Add calendar</h3>
            <div className="py-2 flex flex-col gap-3">
              <input
                className="input input-bordered w-full"
                placeholder="Calendar ID (e.g., someone@example.com)"
                value={inputId}
                onChange={(e) => setInputId(e.currentTarget.value)}
                disabled={adding}
              />
              <input
                className="input input-bordered w-full"
                placeholder="Optional label"
                value={inputSummary}
                onChange={(e) => setInputSummary(e.currentTarget.value)}
                disabled={adding}
              />
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={closeAdd} disabled={adding}>Cancel</button>
              <button className={`btn btn-primary ${adding ? 'loading' : ''}`} onClick={add} disabled={adding || !inputId.trim()}>
                {adding ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button>close</button>
          </form>
        </dialog>
      </SettingsSection>
  );
}


