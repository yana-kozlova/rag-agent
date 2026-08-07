import type { ReactNode } from 'react';

/**
 * The two shapes every settings panel is built from.
 *
 * They exist so the page reads as one screen rather than six cards that each
 * invented their own spacing: before this, one panel put its hint under the
 * control, another beside it, and a third used daisyUI's `label-text-alt` —
 * which is what made a column of settings look like a pile of unrelated forms.
 *
 * Deliberately not `'use client'`: the page is server-rendered and the panels
 * are not, so this has to be importable from both. It holds no state to make
 * that a problem.
 */

export function SettingsSection({
  id,
  title,
  description,
  aside,
  children,
}: {
  /** Anchor target — must match an entry in `SETTINGS_SECTIONS`. */
  id: string;
  title: string;
  description?: ReactNode;
  /** Top-right slot: a counter, a spinner, a badge. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      // scroll-mt keeps the heading off the very top edge when the in-page nav
      // jumps here.
      className="scroll-mt-6 overflow-hidden rounded-box border border-base-300 bg-base-100"
    >
      <header className="flex items-start justify-between gap-3 border-b border-base-300 bg-base-200/30 px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
          {description && (
            <p className="mt-1 text-sm leading-snug text-base-content/60">{description}</p>
          )}
        </div>
        {aside && <div className="shrink-0 pt-0.5">{aside}</div>}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/**
 * A list of settings, hairlines between them.
 *
 * The dividers are what let a row drop its own bottom margin, so a section with
 * one setting and a section with six are spaced identically.
 */
export function SettingsRows({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-base-300/70">{children}</div>;
}

/**
 * One setting: what it is on the left, the control that changes it on the right.
 *
 * `htmlFor` is worth passing wherever there is a single control — it makes the
 * name and the explanation under it a click target for the toggle, which the
 * old markup only managed for rows whose entire body was a `<label>`.
 */
export function SettingsRow({
  label,
  description,
  hint,
  htmlFor,
  children,
}: {
  label: ReactNode;
  /** Why you would want this. Sits under the name, beside the control. */
  description?: ReactNode;
  /** Consequence of the current value — the resolved timezone, the next run. */
  hint?: ReactNode;
  htmlFor?: string;
  children?: ReactNode;
}) {
  const Label = htmlFor ? 'label' : 'div';

  return (
    <div className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <Label htmlFor={htmlFor} className={`min-w-0 flex-1 ${htmlFor ? 'cursor-pointer' : ''}`}>
          <span className="block text-sm font-medium leading-tight">{label}</span>
          {description && (
            <span className="mt-1 block text-xs leading-snug text-base-content/55">
              {description}
            </span>
          )}
        </Label>
        {children && <div className="shrink-0">{children}</div>}
      </div>
      {/* Full width rather than tucked under the control: a resolved timezone
          plus a next-run timestamp is longer than the dropdown above it, and
          right-aligning it there wraps it into a ragged little stack. */}
      {hint && <p className="mt-1.5 text-xs leading-snug text-base-content/45">{hint}</p>}
    </div>
  );
}

/** Width shared by every dropdown on the page, so the right edge is a line. */
export const CONTROL_WIDTH = 'w-full sm:w-44';
