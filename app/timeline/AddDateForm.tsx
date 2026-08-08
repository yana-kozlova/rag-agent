'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Select } from '@/app/components/ui/Select';
import {
  MAX_TIMELINE_NOTE,
  MAX_TIMELINE_TITLE,
  TIMELINE_KINDS,
  TIMELINE_KIND_ICON,
  timelineKindLabel,
} from '@/lib/timeline/timeline';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTH_OPTIONS = [
  { value: '', label: 'Month unknown' },
  ...MONTHS.map((label, index) => ({ value: String(index + 1), label })),
];

const KIND_OPTIONS = TIMELINE_KINDS.map((kind) => ({
  value: kind,
  label: timelineKindLabel(kind),
  icon: TIMELINE_KIND_ICON[kind],
}));

/**
 * Three fields for a date, any of which may be left empty.
 *
 * A single date picker cannot express this data. "Ми переїхали у 2022" has no
 * month, a birthday often has no year, and a picker that demands all three would
 * silently invent the missing parts — which is the precise failure the
 * `precision` column exists to prevent, reintroduced at the one place a human is
 * typing. Leaving a field blank is how you say you do not know it.
 */
function toDateSpec(year: string, month: string, day: string): string | null {
  const y = year.trim();
  const m = month.trim();
  const d = day.trim();

  const mm = m ? m.padStart(2, '0') : '';
  const dd = d ? d.padStart(2, '0') : '';

  if (y && mm && dd) return `${y}-${mm}-${dd}`;
  if (y && mm) return `${y}-${mm}`;
  if (y) return y;
  // No year: only a day and month together mean anything — that is a birthday.
  if (mm && dd) return `--${mm}-${dd}`;
  return null;
}

export default function AddDateForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [kind, setKind] = useState('milestone');
  const [subject, setSubject] = useState('');
  const [note, setNote] = useState('');
  const [recurring, setRecurring] = useState(false);

  const spec = toDateSpec(year, month, day);
  const noYear = !year.trim() && !!spec;

  function reset() {
    setTitle('');
    setYear('');
    setMonth('');
    setDay('');
    setKind('milestone');
    setSubject('');
    setNote('');
    setRecurring(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!title.trim()) return setError('Give it a name.');
    if (!spec) return setError('Give at least a year, or a day and a month together.');

    setSaving(true);
    try {
      const res = await fetch('/api/timeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          date: spec,
          kind,
          subject: subject.trim() || undefined,
          note: note.trim() || undefined,
          // A date with no year of its own can only mean one that comes round.
          recurrence: recurring || noYear ? 'annual' : 'none',
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Save failed (${res.status})`);

      reset();
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="mb-6">
        <button type="button" onClick={() => setOpen(true)} className="btn btn-sm btn-outline">
          Add a date
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mb-6 rounded-box border border-base-300 bg-base-100 p-4">
      <h2 className="mb-3 text-[15px] font-semibold">Add a date</h2>

      <div className="flex flex-col gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MAX_TIMELINE_TITLE}
          placeholder="What happened — “Артем народився”"
          aria-label="What happened"
          className="input input-bordered w-full"
        />

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <input
            value={day}
            onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
            inputMode="numeric"
            placeholder="Day"
            aria-label="Day"
            className="input input-bordered w-full"
          />
          <Select
            value={month}
            options={MONTH_OPTIONS}
            onChange={setMonth}
            ariaLabel="Month"
            className="col-span-2 md:col-span-1"
          />
          <input
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            placeholder="Year"
            aria-label="Year"
            className="input input-bordered w-full"
          />
          <Select value={kind} options={KIND_OPTIONS} onChange={setKind} ariaLabel="Kind" />
        </div>

        <p className="text-xs text-base-content/50">
          Leave what you do not know empty. A day and month with no year is a birthday and repeats
          every year; a year on its own is stored as a year, and is never shown as 1 January.
        </p>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Who it is about (optional)"
            aria-label="Who it is about"
            className="input input-bordered w-full"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={MAX_TIMELINE_NOTE}
            placeholder="One line of detail (optional)"
            aria-label="Detail"
            className="input input-bordered w-full"
          />
        </div>

        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={recurring || noYear}
            disabled={noYear}
            onChange={(e) => setRecurring(e.target.checked)}
            className="checkbox checkbox-sm"
          />
          <span className={noYear ? 'text-base-content/50' : ''}>
            Comes round every year{noYear ? ' — a date with no year always does' : ''}
          </span>
        </label>

        {error && <p className="text-sm text-error">{error}</p>}

        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="btn btn-sm btn-primary">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
            className="btn btn-sm btn-ghost"
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
