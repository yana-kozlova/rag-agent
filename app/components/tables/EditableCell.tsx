'use client';

import { useEffect, useRef, useState } from 'react';

import { Paperclip, X } from 'lucide-react';

import {
  coerceValue,
  formatCellValue,
  fromDateInput,
  isTableFile,
  toDateInput,
  type ColumnLike,
} from '@/lib/utils/table-columns';
import {
  MAX_UPLOAD_SIZE_MB,
  UPLOAD_ACCEPT_ATTRIBUTE,
  isUploadable,
} from '@/lib/utils/uploadable';

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

  // A file cell is not a draft anything can be typed into, so it never enters
  // the text-editing mode the rest of this component is: it picks, uploads and
  // commits on its own, and `editing`/`onOpen`/`onCancel` pass it by.
  if (column.type === 'file') {
    return <FileCell column={column} value={value} saving={saving} onCommit={onCommit} />;
  }

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

/**
 * An attachment, uploaded where it belongs and read where it was filed.
 *
 * The upload goes through `/api/resources/upload` — the same door as every
 * other file in this app — so a scan attached to a row is extracted to text,
 * embedded and searchable before the cell has finished rendering, and there is
 * still exactly one path that puts bytes into storage. The cell keeps the
 * resource's id and its name; the link opens the resource, which is where the
 * text, the description and (for a photo) the picture already live. Building a
 * viewer here would be a second one.
 *
 * Failures are shown in the cell rather than raised to the table's toast: the
 * write never happened, so there is nothing for the parent to roll back, and
 * "10 MB max" belongs beside the cell that refused it. The size and extension
 * are checked here as a courtesy — the route checks independently, since a
 * hand-made POST sees none of this.
 */
function FileCell({
  column,
  value,
  saving,
  onCommit,
}: {
  column: ColumnLike;
  value: unknown;
  saving?: boolean;
  onCommit: (next: unknown) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = isTableFile(value) ? value : null;

  async function upload(picked: File) {
    setError(null);

    if (!isUploadable(picked.name)) {
      setError('Unsupported file type');
      return;
    }
    if (picked.size > MAX_UPLOAD_SIZE_MB * 1024 * 1024) {
      setError(`Larger than ${MAX_UPLOAD_SIZE_MB} MB`);
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', picked);
      const res = await fetch('/api/resources/upload', { method: 'POST', body });
      const data = await res.json().catch(() => null);

      if (!data?.ok || !data.resourceId) {
        setError(data?.message || 'Upload failed');
        return;
      }

      onCommit({ resourceId: data.resourceId, name: picked.name });
    } catch {
      setError('Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex items-center gap-1 ${saving ? 'opacity-50' : ''}`}>
      <input
        ref={input}
        type="file"
        accept={UPLOAD_ACCEPT_ATTRIBUTE}
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          // Cleared so picking the same file twice after a failure still fires.
          e.target.value = '';
          if (picked) upload(picked);
        }}
      />

      {file ? (
        <>
          <a
            href={`/resources/${file.resourceId}`}
            className="link inline-flex max-w-[12rem] items-center gap-1 truncate text-sm"
            title={file.name}
          >
            <Paperclip size={12} className="shrink-0" />
            <span className="truncate">{file.name}</span>
          </a>
          <button
            className="btn btn-ghost btn-xs text-base-content/40 hover:text-error"
            onClick={() => onCommit(null)}
            disabled={busy || saving}
            // Detaching leaves the resource in the Knowledge Base: it was
            // uploaded, read and embedded, and the row no longer pointing at it
            // is not a reason to destroy it.
            title="Detach from this row"
            aria-label={`Detach ${file.name}`}
          >
            <X size={12} />
          </button>
        </>
      ) : (
        <button
          className="btn btn-ghost btn-xs gap-1 font-normal text-base-content/50"
          onClick={() => input.current?.click()}
          disabled={busy}
          aria-label={`Attach a file to ${column.name}`}
        >
          <Paperclip size={12} />
          {busy ? 'Uploading…' : 'Attach'}
        </button>
      )}

      {error && (
        <span className="text-xs text-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
