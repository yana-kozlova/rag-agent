'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type SelectOption = {
  value: string;
  label: string;
  /** Emoji shown before the label. Decorative — the label carries the meaning. */
  icon?: string;
  /** Secondary figure on the right, a count in practice. */
  badge?: string | number;
};

/**
 * A dropdown that looks like the rest of the app.
 *
 * A native `<select>` renders its list entirely by the OS: on macOS that is an
 * opaque dark popup with the system's own font, spacing and checkmark, which is
 * why the type filter looked like it belonged to a different program than the
 * inputs beside it. Nothing in CSS reaches inside that popup — `<option>` takes
 * a colour and little else — so matching the theme means not using it.
 *
 * What the native control gives away for free is the part worth being careful
 * about, so it is all reimplemented here rather than left out: arrow keys and
 * Home/End move a highlight, Enter and Space commit, Escape closes without
 * changing anything, and typing jumps to the option that starts with what you
 * typed. That last one is not decoration — this is used for a twelve-item list
 * of resource types, where reaching "Preference" by pressing `p` is how anyone
 * who has used a dropdown before expects it to work.
 *
 * Deliberately not a text input: there is no free-form value here, so it is a
 * button that owns a listbox, and the ARIA says exactly that.
 */
export function Select({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = 'Select…',
  className = '',
  disabled = false,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  /** Applied to the wrapper, which is what sizes the control. */
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  /** Which option the keyboard is on — not the selection until it is committed. */
  const [activeIndex, setActiveIndex] = useState(-1);

  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  // Type-ahead buffer. A ref rather than state: it must not paint, and a render
  // between two fast keystrokes would drop the second one.
  const search = useRef({ term: '', at: 0 });

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  // Pointerdown, not click: a click that starts inside the panel and ends
  // outside it would otherwise close the panel and swallow the selection.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // `nearest` so opening on an option already in view does not jolt the list.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const openList = (index = selectedIndex >= 0 ? selectedIndex : 0) => {
    if (disabled) return;
    setActiveIndex(index);
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    setActiveIndex(-1);
    if (refocus) buttonRef.current?.focus();
  };

  const commit = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    close();
  };

  const step = (delta: number) => {
    if (options.length === 0) return;
    const from = activeIndex >= 0 ? activeIndex : selectedIndex;
    const next = Math.min(options.length - 1, Math.max(0, from + delta));
    setActiveIndex(next);
  };

  const typeAhead = (char: string) => {
    const now = Date.now();
    // A pause resets the buffer, so "pe" finds Preference but a later "n"
    // starts again at Note rather than looking for "pen".
    search.current.term = now - search.current.at > 700 ? char : search.current.term + char;
    search.current.at = now;

    const term = search.current.term.toLowerCase();
    const match = options.findIndex((option) => option.label.toLowerCase().startsWith(term));
    if (match >= 0) {
      setActiveIndex(match);
      if (!open) onChange(options[match].value);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        open ? step(1) : openList();
        return;
      case 'ArrowUp':
        event.preventDefault();
        open ? step(-1) : openList();
        return;
      case 'Home':
        if (!open) return;
        event.preventDefault();
        setActiveIndex(0);
        return;
      case 'End':
        if (!open) return;
        event.preventDefault();
        setActiveIndex(options.length - 1);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        open ? commit(activeIndex) : openList();
        return;
      case 'Escape':
        if (!open) return;
        event.preventDefault();
        close();
        return;
      case 'Tab':
        // Leaves the field, so it must not also steal the key.
        if (open) close(false);
        return;
      default:
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          typeAhead(event.key);
        }
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onKeyDown}
        className="input input-bordered flex w-full cursor-pointer items-center gap-2 pr-3 text-left font-normal disabled:cursor-not-allowed"
      >
        {selected?.icon && (
          <span aria-hidden className="shrink-0 text-base leading-none">
            {selected.icon}
          </span>
        )}
        <span className={`flex-1 truncate ${selected ? '' : 'text-base-content/40'}`}>
          {selected ? selected.label : placeholder}
        </span>
        {selected?.badge != null && (
          <span className="shrink-0 font-mono text-xs text-base-content/45">{selected.badge}</span>
        )}
        <ChevronDown
          aria-hidden
          className={`h-4 w-4 shrink-0 text-base-content/40 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          className="absolute z-30 mt-1 max-h-72 w-full min-w-max overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value}
                role="option"
                aria-selected={isSelected}
                // Mouse and keyboard share one highlight, so moving the pointer
                // over the list does not leave a second one behind.
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => commit(index)}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm ${
                  index === activeIndex ? 'bg-base-200' : ''
                }`}
              >
                {option.icon && (
                  <span aria-hidden className="w-5 shrink-0 text-center text-base leading-none">
                    {option.icon}
                  </span>
                )}
                <span className="flex-1 truncate">{option.label}</span>
                {option.badge != null && (
                  <span className="shrink-0 font-mono text-xs text-base-content/45">
                    {option.badge}
                  </span>
                )}
                <Check
                  aria-hidden
                  className={`h-4 w-4 shrink-0 text-primary ${isSelected ? '' : 'invisible'}`}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
