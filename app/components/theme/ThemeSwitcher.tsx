'use client';

import { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import {
  DEFAULT_PREFERENCE,
  THEME_LABELS,
  THEME_STORAGE_KEY,
  applyTheme,
  readThemePreference,
  type ThemePreference,
} from './theme';

const OPTIONS: { value: ThemePreference; icon: typeof Sun }[] = [
  { value: 'silk', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const [preference, setPreference] = useState<ThemePreference>(DEFAULT_PREFERENCE);
  const ddRef = useRef<HTMLDetailsElement | null>(null);

  // The inline <head> script already painted the right theme; this only syncs
  // React state to what the user stored.
  useEffect(() => setPreference(readThemePreference()), []);

  // While on `system`, follow the OS if it flips mid-session.
  useEffect(() => {
    if (preference !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [preference]);

  const select = (next: ThemePreference) => {
    setPreference(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
    if (ddRef.current) ddRef.current.open = false;
  };

  const ActiveIcon = OPTIONS.find((o) => o.value === preference)?.icon ?? Sun;

  return (
    <details className="dropdown dropdown-top w-full" ref={ddRef}>
      <summary
        className={`btn btn-ghost btn-sm ${compact ? 'btn-square mx-auto flex' : 'w-full justify-between'}`}
        title="Theme"
      >
        <span className="flex items-center gap-2">
          <ActiveIcon className={compact ? 'h-5 w-5' : 'h-4 w-4'} />
          {!compact && <span className="truncate">{THEME_LABELS[preference]}</span>}
        </span>
        {!compact && (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4 opacity-70">
            <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </svg>
        )}
      </summary>
      <ul className={`menu menu-sm dropdown-content mb-2 z-50 p-2 shadow bg-base-100 rounded-box border border-base-300 ${compact ? 'w-36' : 'w-full'}`}>
        {OPTIONS.map(({ value, icon: Icon }) => (
          <li key={value}>
            <button
              type="button"
              onClick={() => select(value)}
              className={preference === value ? 'active' : undefined}
              aria-current={preference === value}
            >
              <Icon className="h-4 w-4" />
              {THEME_LABELS[value]}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
