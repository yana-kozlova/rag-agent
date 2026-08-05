'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { X } from 'lucide-react';
import ChatSection from './ChatSection';
import { MAX_RAIL_WIDTH, MIN_RAIL_WIDTH } from './use-rail-width';

/**
 * Global companion rail that hosts the assistant chat.
 * - lg and up: a fixed panel docked to the right, resizable by its left edge.
 * - below lg: an off-canvas drawer opened by a floating action button.
 * Rendered once by LayoutShell so chat state survives route navigation.
 */

type Props = {
  width: number;
  /** Fired continuously while dragging. */
  onResize: (width: number) => void;
  /** Fired once on release — this is what gets written to storage. */
  onResizeEnd: (width: number) => void;
  onDraggingChange: (dragging: boolean) => void;
  /** Only the docked rail can be resized; the drawer is full-height overlay. */
  resizable: boolean;
};

export function ChatRail({ width, onResize, onResizeEnd, onDraggingChange, resizable }: Props) {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Read on pointer-up: state would be a render behind the last move event.
  const latestWidth = useRef(width);

  useEffect(() => {
    latestWidth.current = width;
  }, [width]);

  // Close the mobile drawer on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!resizable) return;
      event.preventDefault();
      setDragging(true);
      onDraggingChange(true);

      // Pointer capture keeps the events coming even when the cursor outruns
      // the 5px handle, which it always does.
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);

      const onMove = (e: PointerEvent) => {
        const next = window.innerWidth - e.clientX;
        latestWidth.current = next;
        onResize(next);
      };

      const onUp = () => {
        handle.releasePointerCapture(event.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        setDragging(false);
        onDraggingChange(false);
        onResizeEnd(latestWidth.current);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    },
    [resizable, onResize, onResizeEnd, onDraggingChange]
  );

  /** Keyboard resizing, so the rail is not mouse-only. */
  const onHandleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 64 : 16;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onResizeEnd(width + step);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        onResizeEnd(width - step);
      }
    },
    [width, onResizeEnd]
  );

  return (
    <>
      {/* Floating button — mobile/tablet only */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open assistant"
        className={`fixed bottom-20 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-base-300 bg-base-100 shadow-lg transition-transform hover:scale-105 lg:hidden ${
          open ? 'scale-0' : 'scale-100'
        }`}
      >
        <Image src="/avatars/bot.svg" alt="" width={34} height={34} className="h-9 w-9" />
      </button>

      {/* Scrim — mobile only, when open */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* While dragging, a full-screen overlay keeps the resize cursor and stops
          the pointer from selecting text or hovering things underneath. */}
      {dragging && <div className="fixed inset-0 z-50 cursor-col-resize select-none" />}

      {/* Rail panel */}
      <aside
        className={`fixed right-0 top-0 z-40 flex h-screen max-w-[90vw] flex-col border-l border-base-300 bg-base-100 lg:translate-x-0 ${
          dragging ? '' : 'transition-transform duration-200'
        } ${open ? 'translate-x-0 shadow-2xl' : 'translate-x-full'}`}
        style={{ width: `${width}px` }}
      >
        {/* Resize handle — a hairline that thickens on hover, so it is findable
            without being a permanent visual seam. */}
        {resizable && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize assistant panel"
            aria-valuenow={width}
            aria-valuemin={MIN_RAIL_WIDTH}
            aria-valuemax={MAX_RAIL_WIDTH}
            tabIndex={0}
            onPointerDown={startDrag}
            onKeyDown={onHandleKeyDown}
            className="group absolute -left-1 top-0 z-10 hidden h-full w-2 cursor-col-resize touch-none lg:block"
          >
            <span
              className={`absolute left-1/2 top-0 h-full w-px -translate-x-1/2 transition-colors ${
                dragging ? 'bg-primary' : 'bg-transparent group-hover:bg-primary/40'
              }`}
            />
          </div>
        )}

        {/* Header */}
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-base-300 px-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10">
            <Image src="/avatars/bot.svg" alt="" width={28} height={28} className="h-7 w-7" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold leading-tight">Assistant</div>
            <div className="flex items-center gap-1.5 text-xs text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              online
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="btn btn-ghost btn-sm btn-square lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Chat body */}
        <div className="min-h-0 flex-1 px-3 pb-3 pt-2">
          <ChatSection />
        </div>
      </aside>
    </>
  );
}
