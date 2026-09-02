'use client';

import { useEffect, useRef, useState } from 'react';

import {
  coerceValue,
  formatCellValue,
  fromDateInput,
  toDateInput,
  type ColumnLike,
} from '@/lib/utils/table-columns';

/**
 * One cell of a table, edited where it sits.
 *
 * Editing used to be a mode over a whole row: an Edit button flipped every
 * column into an input and a tick flipped them back. Two things were wrong with
 * that. The small one is that changing a single value cost three clicks and put
 * five other cells into a state where a stray keystroke lands somewhere it was
 * not meant to. The large one is that the row's inputs wrote straight through
 * `onChange` — so every keystroke fired a PATCH, and `updateTableRow` deletes
 * the row's embeddings and calls OpenAI for new ones. Typing "апоквель" into a
 * cell was eight round-trips, eight embedding calls, and eight chances for the
 * last one to lose a race with the seventh and leave the row saying "апоквел".
 *
 * So a cell is opened, edited as a draft nothing else can see, and committed
 * once — on Enter, on Tab, or on leaving it. Escape closes it having written
 * nothing, which is the whole reason the draft is held here rather than in the
 * table's own state: a cancel has to be able to give the old value back, and it
 * cannot if the old value was overwritten on the first keystroke.
 *
 * The parent decides whether the commit is worth a write. It has the value that
 * was there before; opening a cell and leaving it must cost nothing, because
 * "nothing" is what the user did.
 */
export function EditableCell({
  column,
  value,
  editing,
  saving,
  onOpen,
  onCommit,
  onCancel,
}: {
  column: ColumnLike & { required?: boolean };
  value: unknown;
  editing: boolean;
  /** The last commit is still in flight; the cell shows it rather than pretending. */
  saving?: boolean;
  onOpen: () => void;
  /** `move` asks the parent to open the neighbouring cell once this one is written. */
  onCommit: (next: unknown, move?: 'next' | 'prev') => void;
  onCancel: () => void;
}) {
  const date = column.type === 'date' ? toDateInput(value) : null;
  const [draft, setDraft] = useState('');
  // Enter, Tab and Escape all end the edit themselves. Without this the blur
  // that follows would decide its fate a second time — committing a cancelled
  // cell, or writing the same value twice.
  const settled = useRef(false);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => {
    if (!editing) return;
    settled.current = false;
    setDraft(
      column.type === 'date'
        ? toDateInput(value).value
        : value === null || value === undefined
          ? ''
          : String(value)
    );
    // Seeded from the value the cell was showing when it opened. It is not a
    // dependency: a write landing while the cell is open must not reach in and
    // retype what the user is in the middle of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function read(written: string): unknown {
    if (column.type === 'date') return fromDateInput(date?.type ?? 'date', written, date?.zoned);
    return coerceValue(written, column.type);
  }

  function commit(written: string, move?: 'next' | 'prev') {
    if (settled.current) return;
    settled.current = true;
    onCommit(read(written), move);
  }

  function cancel() {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  }

  if (!editing) {
    const shown = formatCellValue(value, column.type);
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`${column.name}: ${shown || 'empty'}`}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
        className={`-mx-1 cursor-text rounded px-1 py-1 hover:bg-base-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
          saving ? 'opacity-50' : ''
        }`}
      >
        {shown === '' ? (
          // An empty cell is still a target, and has to be as tall as a full
          // one or the only way into it is a one-pixel line.
          <span className="text-base-content/30">—</span>
        ) : (
          shown
        )}
      </div>
    );
  }

  const keys = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(e.currentTarget.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commit(e.currentTarget.value, e.shiftKey ? 'prev' : 'next');
    }
  };

  // Three states rather than a checkbox, because the column really does hold
  // three: yes, no, and nobody has said. A checkbox renders "not recorded" as
  // "no" and gives the user no way back to it — the same reason `RoutineOffer`
  // drops a cleared column instead of writing a blank into it every press.
  if (column.type === 'boolean') {
    return (
      <select
        ref={inputRef as React.RefObject<HTMLSelectElement>}
        className="select select-bordered select-sm w-full"
        value={draft === '' ? '' : coerceValue(draft, 'boolean') ? 'true' : 'false'}
        onChange={(e) => commit(e.target.value)}
        onKeyDown={keys}
        onBlur={cancel}
      >
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      className="input input-bordered input-sm w-full"
      type={
        column.type === 'number'
          ? 'number'
          : column.type === 'email'
            ? 'email'
            : column.type === 'url'
              ? 'url'
              : date
                ? date.type
                : 'text'
      }
      step={column.type === 'number' ? 'any' : undefined}
      inputMode={column.type === 'number' ? 'decimal' : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={keys}
      onBlur={(e) => commit(e.target.value)}
    />
  );
}
