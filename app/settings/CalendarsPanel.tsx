'use client';

import { useEffect, useState } from 'react';

type Followed = { calendarId: string; summary: string | null };

export function CalendarsPanel() {
  const [items, setItems] = useState<Followed[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [inputId, setInputId] = useState('');
  const [inputSummary, setInputSummary] = useState('');
  const [query, setQuery] = useState('');

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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <section className="card bg-base-100 shadow">
        <div className="card-body gap-3">
          <h2 className="card-title">Add calendar to follow</h2>
          <input
            className="input input-bordered w-full"
            placeholder="Calendar ID (e.g., someone@example.com)"
            value={inputId}
            onChange={(e) => setInputId(e.currentTarget.value)}
          />
          <input
            className="input input-bordered w-full"
            placeholder="Optional label"
            value={inputSummary}
            onChange={(e) => setInputSummary(e.currentTarget.value)}
          />
          <div className="card-actions justify-end">
            <button className="btn btn-primary" onClick={add} disabled={adding || !inputId.trim()}>Add</button>
          </div>
        </div>
      </section>

      <section className="card bg-base-100 shadow">
        <div className="card-body gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="card-title">Followed Calendars</h2>
            <span className="badge badge-neutral">{items.length}</span>
          </div>
          <input
            className="input input-bordered w-full"
            placeholder="Filter by label or ID"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          {loading ? (
            <div className="text-sm opacity-70">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm opacity-70">No calendars match.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {filtered.map((c) => (
                <div key={c.calendarId} className="rounded-box bg-base-200 p-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{c.summary || c.calendarId}</div>
                    <div className="text-xs opacity-70 truncate">{c.calendarId}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm self-end md:self-auto" onClick={() => remove(c.calendarId)}>Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}


