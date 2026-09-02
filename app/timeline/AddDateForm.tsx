'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import DateForm, { EMPTY_DRAFT, type DateSubmission } from './DateForm';

/**
 * Adding a date by hand.
 *
 * All of the thinking is in `DateForm`, which the edit path on the axis uses
 * too. What is left here is the disclosure and one POST — the two things that
 * are actually different about adding rather than correcting.
 */
export default function AddDateForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function save(payload: DateSubmission) {
    const res = await fetch('/api/timeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Save failed (${res.status})`);

    setOpen(false);
    router.refresh();
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
    <div className="mb-6 rounded-box border border-base-300 bg-base-100 p-4">
      <h2 className="mb-3 text-[15px] font-semibold">Add a date</h2>
      <DateForm
        initial={EMPTY_DRAFT}
        submitLabel="Save"
        onSubmit={save}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}
