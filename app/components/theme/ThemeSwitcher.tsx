'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { SidebarFlyout } from '../nav/SidebarFlyout';
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
  };

  const ActiveIcon = OPTIONS.find((o) => o.value === preference)?.icon ?? Sun;

  return (
    <SidebarFlyout
      label="Theme"
      buttonClassName={`btn btn-ghost btn-sm ${compact ? 'btn-square mx-auto flex' : 'w-full justify-between'}`}
      // Fixed rather than the sidebar's width: the panel no longer lives inside
      // the sidebar, so matching its width would only look like a coincidence.
      panelClassName="w-44"
      button={
        <>
          <span className="flex items-center gap-2">
            <ActiveIcon className={compact ? 'h-5 w-5' : 'h-4 w-4'} />
            {!compact && <span className="truncate">{THEME_LABELS[preference]}</span>}
          </span>
          {!compact && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4 opacity-70">
              <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
            </svg>
          )}
        </>
      }
    >
      {(close) => (
        <ul className="menu menu-sm w-full p-2">
          {OPTIONS.map(({ value, icon: Icon }) => (
            <li key={value}>
              <button
                type="button"
                onClick={() => {
                  select(value);
                  close();
                }}
                className={preference === value ? 'active' : undefined}
                aria-current={preference === value}
              >
                <Icon className="h-4 w-4" />
                {THEME_LABELS[value]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </SidebarFlyout>
  );
}
