'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, Pen, Trash2, Undo2 } from 'lucide-react';

import {
  EXPORT_INK,
  EXPORT_PAPER,
  acceptsPointer,
  drawStrokes,
  inkBounds,
  normalizePressure,
  parseDraft,
  strokeHit,
  type InkPoint,
  type InkStroke,
} from '@/lib/utils/ink';

/**
 * A page to write on with a stylus.
 *
 * What is written is saved as a picture through the same door as every other
 * image — read once by the vision model, stored as text — so a handwritten note
 * is searchable the moment it lands and nothing downstream learns that ink
 * exists. The pad's own job is narrower: feel like paper while writing, and
 * hand over an image a model can read.
 */

const DRAFT_KEY = 'ink-pad:draft';

/** Saved at twice the drawn size: handwriting is thin lines, and thin lines blur. */
const EXPORT_SCALE = 2;

/** `buttons` bit and `button` value a stylus reports for its eraser end. */
const ERASER_BUTTONS = 32;
const ERASER_BUTTON = 5;

type Tool = 'pen' | 'eraser';

type Saved = { resourceId: string; description: string; stored: boolean };

function readDraft(): InkStroke[] {
  try {
    return parseDraft(window.localStorage.getItem(DRAFT_KEY));
  } catch {
    return [];
  }
}

function writeDraft(strokes: InkStroke[]) {
  try {
    if (strokes.length === 0) window.localStorage.removeItem(DRAFT_KEY);
    else window.localStorage.setItem(DRAFT_KEY, JSON.stringify(strokes));
  } catch {
    // Private mode or a full quota: the pad still works, it just forgets.
  }
}

/** The strokes as a PNG, dark on white and cropped to what was written. */
function renderPng(strokes: InkStroke[]): Promise<Blob | null> {
  const bounds = inkBounds(strokes);
  if (!bounds) return Promise.resolve(null);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(bounds.width * EXPORT_SCALE);
  canvas.height = Math.ceil(bounds.height * EXPORT_SCALE);

  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);

  ctx.fillStyle = EXPORT_PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
  drawStrokes(ctx, strokes, EXPORT_INK, bounds.x, bounds.y);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function fileName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `ink-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.png`;
}

export default function InkPad() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Strokes live in a ref because they change on every pointer event and the
  // canvas is painted by hand; `count` is what the buttons re-render on.
  const strokesRef = useRef<InkStroke[]>([]);
  const currentRef = useRef<InkStroke | null>(null);
  const activePointer = useRef<number | null>(null);
  const erasing = useRef(false);
  const penSeen = useRef(false);
  const frame = useRef<number | null>(null);

  const [count, setCount] = useState(0);
  const [tool, setTool] = useState<Tool>('pen');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [error, setError] = useState<string | null>(null);

  const paint = useCallback(() => {
    frame.current = null;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    // The card's own text colour, so the ink follows the theme on screen.
    const color = getComputedStyle(canvas).color || '#000';
    const all = currentRef.current ? [...strokesRef.current, currentRef.current] : strokesRef.current;
    drawStrokes(ctx, all, color);
  }, []);

  const schedule = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  const commit = useCallback(
    (next: InkStroke[]) => {
      strokesRef.current = next;
      setCount(next.length);
      writeDraft(next);
      schedule();
    },
    [schedule]
  );

  // Size the backing store to the element, and restore a draft on first mount.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    strokesRef.current = readDraft();
    setCount(strokesRef.current.length);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = wrap.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      paint();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    return () => {
      observer.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [paint]);

  const pointOf = (e: PointerEvent | React.PointerEvent): InkPoint => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top, normalizePressure(e.pressure, e.pointerType)];
  };

  const eraseAt = (x: number, y: number) => {
    const kept = strokesRef.current.filter((stroke) => !strokeHit(stroke, x, y));
    if (kept.length !== strokesRef.current.length) commit(kept);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen') penSeen.current = true;
    if (!acceptsPointer(e.pointerType, penSeen.current)) return;
    if (activePointer.current !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointer.current = e.pointerId;
    setSaved(null);
    setError(null);

    // The stylus's own eraser end overrides the selected tool for this stroke.
    erasing.current =
      tool === 'eraser' || e.button === ERASER_BUTTON || (e.buttons & ERASER_BUTTONS) !== 0;

    const point = pointOf(e);
    if (erasing.current) {
      eraseAt(point[0], point[1]);
    } else {
      currentRef.current = { points: [point] };
      schedule();
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== activePointer.current) return;
    e.preventDefault();

    // A stylus samples faster than frames are delivered; the coalesced events
    // are the samples in between, and without them fast writing turns angular.
    const native = e.nativeEvent;
    const samples = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const events = samples.length > 0 ? samples : [native];

    for (const sample of events) {
      const point = pointOf(sample);
      if (erasing.current) eraseAt(point[0], point[1]);
      else currentRef.current?.points.push(point);
    }

    if (!erasing.current) schedule();
  };

  const finish = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== activePointer.current) return;
    activePointer.current = null;

    const stroke = currentRef.current;
    currentRef.current = null;
    if (!erasing.current && stroke && stroke.points.length > 0) {
      commit([...strokesRef.current, stroke]);
    }
    erasing.current = false;
  };

  const undo = () => commit(strokesRef.current.slice(0, -1));

  const clear = () => {
    commit([]);
    setSaved(null);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const blob = await renderPng(strokesRef.current);
      if (!blob) {
        setError('Nothing to save yet.');
        return;
      }

      const body = new FormData();
      body.append('file', new File([blob], fileName(), { type: 'image/png' }));
      body.append('origin', 'ink');

      const res = await fetch('/api/resources/upload', { method: 'POST', body });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        // The strokes stay on the pad: a note that failed to save is still
        // the only copy of what was written.
        setError(data?.message || data?.error || 'Could not save the note.');
        return;
      }

      setSaved({
        resourceId: data.resourceId,
        description: data.description ?? '',
        stored: Boolean(data.imageUrl),
      });
      commit([]);
      window.dispatchEvent(new CustomEvent('dashboard:resources-changed'));
    } catch {
      setError('Could not save the note.');
    } finally {
      setSaving(false);
    }
  };

  const toolButton = (value: Tool, label: string, Icon: typeof Pen) => (
    <button
      type="button"
      onClick={() => setTool(value)}
      aria-pressed={tool === value}
      aria-label={label}
      title={label}
      className={`btn btn-sm btn-square ${tool === value ? 'btn-primary' : 'btn-ghost'}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        {toolButton('pen', 'Pen', Pen)}
        {toolButton('eraser', 'Eraser', Eraser)}
        <span className="mx-1 h-5 w-px bg-base-300" />
        <button
          type="button"
          onClick={undo}
          disabled={count === 0}
          aria-label="Undo last stroke"
          title="Undo"
          className="btn btn-ghost btn-sm btn-square"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={count === 0}
          aria-label="Clear the page"
          title="Clear"
          className="btn btn-ghost btn-sm btn-square"
        >
          <Trash2 className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={save}
          disabled={count === 0 || saving}
          className="btn btn-primary btn-sm ml-auto"
        >
          {saving ? 'Reading…' : 'Save note'}
        </button>
      </div>

      <div
        ref={wrapRef}
        className="relative h-72 w-full overflow-hidden rounded-box border border-base-300 bg-base-200/30 md:h-96"
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          onContextMenu={(e) => e.preventDefault()}
          // The page must not scroll or zoom under the pen. This is also why
          // the pad sits behind a tab: on a phone a canvas that eats every
          // touch in the middle of the dashboard is a trap for the thumb.
          style={{ touchAction: 'none' }}
          className={`absolute inset-0 h-full w-full select-none text-base-content ${
            tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair'
          }`}
          aria-label="Handwriting area"
        />
        {count === 0 && !saved && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-base-content/30">
            Write here
          </p>
        )}
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {saved && (
        <div className="rounded-box border border-base-300 bg-base-200/40 p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-base-content/40">
              Saved — read as
            </span>
            <a
              href={`/resources/${saved.resourceId}`}
              className="text-[13px] font-medium text-base-content/50 transition-colors hover:text-primary"
            >
              Open note →
            </a>
          </div>
          {/* Shown back because the reading is the one thing here that cannot be
              checked later: a misread word has to be caught while the writer
              still remembers what they wrote. */}
          <p className="whitespace-pre-wrap text-sm text-base-content">{saved.description}</p>
          {!saved.stored && (
            <p className="mt-2 text-xs text-base-content/50">
              The text is saved and searchable; the picture itself could not be stored.
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-base-content/40">
        The picture is kept at an unguessable public link — do not write anything here that would hurt
        if it leaked.
      </p>
    </div>
  );
}
