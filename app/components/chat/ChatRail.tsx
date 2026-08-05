'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { X } from 'lucide-react';
import ChatSection from './ChatSection';

/**
 * Global companion rail that hosts the assistant chat.
 * - lg and up: a fixed panel docked to the right, always visible.
 * - below lg: an off-canvas drawer opened by a floating action button.
 * Rendered once by LayoutShell so chat state survives route navigation.
 */
export function ChatRail() {
  const [open, setOpen] = useState(false);

  // Close the mobile drawer on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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

      {/* Rail panel */}
      <aside
        className={`fixed right-0 top-0 z-40 flex h-screen w-[22rem] max-w-[90vw] flex-col border-l border-base-300 bg-base-100 transition-transform duration-200 lg:translate-x-0 ${
          open ? 'translate-x-0 shadow-2xl' : 'translate-x-full'
        }`}
      >
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
