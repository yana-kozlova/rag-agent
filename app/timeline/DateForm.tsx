'use client';

import { useState } from 'react';

import { Select } from '@/app/components/ui/Select';
import {
  MAX_TIMELINE_NOTE,
  MAX_TIMELINE_TITLE,
  TIMELINE_KINDS,
  TIMELINE_KIND_ICON,
  splitDateSpec,
  timelineKindLabel,
  toDateSpec,
  type DatePrecision,
} from '@/lib/timeline/timeline';

/**
 * The fields a date is typed into, shared by adding one and correcting one.
 *
 * One component rather than two because the awkward part is not the markup, it
 * is the rules: which combinations of day, month and year mean anything, and
 * which of them may recur. A second form with its own copy of those would be a
 * second answer to "what does a year with no month mean", and the whole of
 * `precision` exists because that question has exactly one right answer. The
 * pure half lives in `lib/timeline/timeline.ts` and is tested there; what is
 * left here is the arrangement of inputs and the one line that disables the
 * recurrence checkbox.
 *
 * `onSubmit` throws to report a failure, so the caller writes a fetch and
 * nothing else — the spinner, the error line and the disabled button are the
 * same on both surfaces and belong here.
 */

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

export type DateDraft = {
  title: string;
  year: string;
  month: string;
  day: string;
  kind: string;
  subject: string;
  note: string;
  recurring: boolean;
};

/** The body both `/api/timeline` verbs take. */
export type DateSubmission = {
  title: string;
  date: string;
  kind: string;
  subject?: string;
  note?: string;
  recurrence: 'annual' | 'none';
};

export const EMPTY_DRAFT: DateDraft = {
  title: '',
  year: '',
  month: '',
  day: '',
  kind: 'milestone',
  subject: '',
  note: '',
  recurring: false,
};

/**
 * A stored row opened back up as a draft.
 *
 * The date comes apart through `splitDateSpec`, which reads `precision` rather
 * than the stored day — so a year-only row opens with its month and day empty
 * and saving it untouched cannot promote the padding 1 January into a day
 * somebody named.
 */
export function draftFrom(event: {
  title: string;
  occurredOn: string;
  precision: DatePrecision;
  kind: string;
  subject: string | null;
  note: string | null;
  recurring: boolean;
}): DateDraft {
  return {
    title: event.title,
    ...splitDateSpec(event.occurredOn, event.precision),
    kind: event.kind || 'other',
    subject: event.subject ?? '',
    note: event.note ?? '',
    recurring: event.recurring,
  };
}

export default function DateForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: DateDraft;
  submitLabel: string;
  onSubmit: (payload: DateSubmission) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<DateDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof DateDraft>(key: K, value: DateDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const spec = toDateSpec(draft.year, draft.month, draft.day);
  const noYear = !draft.year.trim() && !!spec;
  // Only a date with a real month and a real day has anything to come round on.
  // Left offered, "every year" on a year-only date stores an anniversary the
  // page then shows back as 1 January — the exact component `precision` exists
  // to keep unprinted.
  const canRecur = !!draft.month.trim() && !!draft.day.trim();
  const recurs = canRecur && (draft.recurring || noYear);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!draft.title.trim()) return setError('Give it a name.');
    if (!spec) return setError('Give at least a year, or a day and a month together.');

    setSaving(true);
    try {
      await onSubmit({
        title: draft.title.trim(),
        date: spec,
        kind: draft.kind,
        subject: draft.subject.trim() || undefined,
        note: draft.note.trim() || undefined,
        recurrence: recurs ? 'annual' : 'none',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        value={draft.title}
        onChange={(e) => set('title', e.target.value)}
        maxLength={MAX_TIMELINE_TITLE}
        placeholder="What happened — “Артем народився”"
        aria-label="What happened"
        className="input input-bordered w-full"
      />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <input
          value={draft.day}
          onChange={(e) => set('day', e.target.value.replace(/\D/g, '').slice(0, 2))}
          inputMode="numeric"
          placeholder="Day"
          aria-label="Day"
          className="input input-bordered w-full"
        />
        <Select
          value={draft.month}
          options={MONTH_OPTIONS}
          onChange={(value) => set('month', value)}
          ariaLabel="Month"
          className="col-span-2 md:col-span-1"
        />
        <input
          value={draft.year}
          onChange={(e) => set('year', e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          placeholder="Year"
          aria-label="Year"
          className="input input-bordered w-full"
        />
        <Select
          value={draft.kind}
          options={KIND_OPTIONS}
          onChange={(value) => set('kind', value)}
          ariaLabel="Kind"
        />
      </div>

      <p className="text-xs text-base-content/50">
        Leave what you do not know empty. A day and month with no year is a birthday and repeats
        every year; a year on its own is stored as a year, and is never shown as 1 January.
      </p>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <input
          value={draft.subject}
          onChange={(e) => set('subject', e.target.value)}
          placeholder="Who it is about (optional)"
          aria-label="Who it is about"
          className="input input-bordered w-full"
        />
        <input
          value={draft.note}
          onChange={(e) => set('note', e.target.value)}
          maxLength={MAX_TIMELINE_NOTE}
          placeholder="One line of detail (optional)"
          aria-label="Detail"
          className="input input-bordered w-full"
        />
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={recurs}
          disabled={noYear || !canRecur}
          onChange={(e) => set('recurring', e.target.checked)}
          className="checkbox checkbox-sm"
        />
        <span className={noYear || !canRecur ? 'text-base-content/50' : ''}>
          Comes round every year
          {noYear
            ? ' — a date with no year always does'
            : !canRecur
              ? ' — needs a day and a month'
              : ''}
        </span>
      </label>

      {error && <p className="text-sm text-error">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="btn btn-sm btn-primary">
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-sm btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  );
}
