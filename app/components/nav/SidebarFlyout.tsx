'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * A menu that slides out from under the sidebar's edge.
 *
 * The two controls at the bottom of the sidebar — theme and account — were
 * daisyUI `dropdown-top` menus at `z-50`, so they opened *upwards over the
 * sidebar itself*: the panel covered the nav links it was sitting under, and
 * being one layer above `AppSidebar`'s `z-40` it painted across the sidebar's
 * own edge rather than belonging to it. Both are anchored to the bottom of a
 * fixed left rail, which is the one place a vertical dropdown has nowhere to go.
 *
 * So it travels sideways instead, out of the sidebar's right edge. The part
 * that makes it read as *from underneath* rather than *on top* is the clip box:
 * an `overflow-hidden` wrapper whose left edge sits exactly on the sidebar's
 * border, with the panel translated fully out of it when closed. Nothing is
 * ever drawn over the sidebar, at any point in the animation — the panel is
 * simply not painted until it has cleared the edge.
 *
 * The clip box is padded on its three free sides (and pulled back by the same
 * amount below) so the panel's shadow has room to fall; only the left edge, the
 * one doing the hiding, clips tight.
 *
 * `visibility` rides in the transition rather than a mount/unmount, which is
 * what keeps the closing animation and still takes the menu out of the tab
 * order while it is shut: going visible it flips at the start of the transition,
 * going hidden it waits until the end.
 */
export function SidebarFlyout({
  label,
  button,
  buttonClassName,
  panelClassName = 'w-48',
  children,
}: {
  /** Accessible name for the trigger, and its tooltip while collapsed. */
  label: string;
  /** What the trigger shows. */
  button: ReactNode;
  buttonClassName?: string;
  /** Width of the panel — it no longer inherits the sidebar's. */
  panelClassName?: string;
  /** Receives a `close` so an item can dismiss the menu it was chosen from. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    // `pointerdown` rather than `click`: a menu that survives until mouseup
    // stays open under the finger on the way to whatever was tapped behind it.
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      // Escape that leaves focus inside a hidden panel strands a keyboard user.
      trigger.current?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        className={buttonClassName}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {button}
      </button>

      {/* The clip box. `ml-2` clears the bottom section's own padding so the
          left edge lands on the sidebar's border and not two pixels inside it. */}
      <div className="pointer-events-none absolute bottom-0 left-full z-10 -mb-4 ml-2 overflow-hidden pb-4 pr-4 pt-4">
        <div
          id={panelId}
          className={`pointer-events-auto rounded-box border border-base-300 bg-base-100 shadow-xl transition-[transform,visibility] duration-200 ease-out ${panelClassName} ${
            open ? 'visible translate-x-0' : 'invisible -translate-x-full'
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      </div>
    </div>
  );
}
