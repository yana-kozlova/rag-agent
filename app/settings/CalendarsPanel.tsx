'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { AccountCalendar } from '@/lib/utils/calendars';
import { SettingsSection } from './ui';

/**
 * Which calendars the assistant reads, chosen from the ones the account has.
 *
 * This used to be a text field for a calendar id. That made a calendar
 * followable only if you already knew its address, which put the two most
 * useful ones on any personal account out of reach — Birthdays lives at
 * `addressbook#contacts@group.v.calendar.google.com`, and nobody types that. It
 * also took the id on trust: a typo was saved, produced no events forever, and
 * said nothing, because the fetch drops calendars it cannot read.
 *
 * Adding by address survives as a fallback, because `calendarList` only knows
 * what the user has subscribed to and a shared calendar they were sent a link
 * to is a real case. It is verified now, and the name comes back from Google.
 */
export function CalendarsPanel() {
  const [calendars, setCalendars] = useState<AccountCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [manualId, setManualId] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/calendars');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || 'Could not load your calendars.');
      setCalendars(Array.isArray(data.calendars) ? data.calendars : []);
      setError(null);
    } catch (e) {
      // Distinguished from "no calendars" on purpose: an empty list is a claim
      // about the account, and this is a claim about the request.
      setError(e instanceof Error ? e.message : 'Could not load your calendars.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (calendar: AccountCalendar) => {
    if (calendar.primary) return;
    setBusy(calendar.id);
    try {
      if (calendar.followed) {
        await fetch(`/api/calendars?calendarId=${encodeURIComponent(calendar.id)}`, {
          method: 'DELETE',
        });
      } else {
        await fetch('/api/calendars', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ calendarId: calendar.id }),
        });
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const addByAddress = async () => {
    const calendarId = manualId.trim();
    if (!calendarId) return;
    setAdding(true);
    setManualError(null);
    try {
      const res = await fetch('/api/calendars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || 'Could not add that calendar.');
      setManualId('');
      dialogRef.current?.close();
      await load();
    } catch (e) {
      setManualError(e instanceof Error ? e.message : 'Could not add that calendar.');
    } finally {
      setAdding(false);
    }
  };

  const followedCount = calendars.filter((c) => c.followed).length;

  const shown = calendars.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return c.summary.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
  });

  return (
    <SettingsSection
      id="calendars"
      title="Calendars"
      description="Events from the ones switched on show up in briefings and in what the assistant can read."
      aside={
        <span className="rounded-full bg-base-200 px-2 py-0.5 font-mono text-xs text-base-content/60">
          {followedCount}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Only worth a filter once the list is longer than the eye can take in. */}
        {calendars.length > 6 && (
          <input
            className="input input-bordered input-sm w-full"
            placeholder="Filter by name or address"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        )}

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-base-200" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-md border border-base-300 px-3 py-3 text-sm">
            <p className="text-base-content/70">{error}</p>
            <button type="button" onClick={load} className="link link-hover mt-1 text-[13px] font-medium">
              Try again
            </button>
          </div>
        ) : shown.length === 0 ? (
          <div className="text-sm text-base-content/50">
            {calendars.length === 0 ? 'No calendars on this account.' : 'Nothing matches.'}
          </div>
        ) : (
          <ul className="divide-y divide-base-300/70 overflow-hidden rounded-md border border-base-300">
            {shown.map((calendar) => (
              <li key={calendar.id} className="flex items-center gap-3 px-3 py-2">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-base-300"
                  style={calendar.color ? { backgroundColor: calendar.color } : undefined}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{calendar.summary}</span>
                    {calendar.primary && (
                      <span className="badge badge-ghost badge-xs shrink-0">yours</span>
                    )}
                    {calendar.accessRole === 'unknown' && (
                      <span className="badge badge-warning badge-xs shrink-0">not on account</span>
                    )}
                  </div>
                  <div className="truncate text-xs opacity-50">{calendar.id}</div>
                </div>

                {calendar.primary ? (
                  // Read whether or not anyone subscribed to it, so a switch here
                  // would be a lie about what the assistant can see.
                  <span className="shrink-0 text-xs text-base-content/40">always read</span>
                ) : (
                  <input
                    type="checkbox"
                    aria-label={`Follow ${calendar.summary}`}
                    className="toggle toggle-sm toggle-primary shrink-0"
                    checked={calendar.followed}
                    disabled={busy === calendar.id}
                    onChange={() => toggle(calendar)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setManualError(null);
              dialogRef.current?.showModal();
            }}
          >
            Add by address
          </button>
        </div>
      </div>

      <dialog ref={dialogRef} className="modal">
        <div className="modal-box">
          <h3 className="text-lg font-bold">Add a calendar by address</h3>
          <p className="mt-1 text-sm text-base-content/60">
            For a shared calendar that is not on this account. Everything already on it is in the
            list behind this dialog.
          </p>
          <div className="flex flex-col gap-2 py-3">
            <input
              className="input input-bordered w-full"
              placeholder="someone@example.com"
              value={manualId}
              onChange={(e) => setManualId(e.currentTarget.value)}
              disabled={adding}
            />
            {manualError && <p className="text-sm text-error">{manualError}</p>}
          </div>
          <div className="modal-action">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => dialogRef.current?.close()}
              disabled={adding}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`btn btn-primary ${adding ? 'loading' : ''}`}
              onClick={addByAddress}
              disabled={adding || !manualId.trim()}
            >
              {adding ? 'Checking…' : 'Add'}
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
