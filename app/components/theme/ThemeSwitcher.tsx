'use client';

import { useEffect, useRef, useState } from 'react';
import { Sun } from 'lucide-react';

const THEMES = ['silk', 'bumblebee', 'autumn', 'soft', 'light', 'dark'] as const;
type ThemeName = typeof THEMES[number] | 'system';

function resolveSystemTheme(): ThemeName {
  if (typeof window === 'undefined') return 'light';
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<ThemeName>('silk');
  const ddRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = (localStorage.getItem('theme') as ThemeName | null) ?? null;
    const initial = stored ?? (document.documentElement.getAttribute('data-theme') as ThemeName | null) ?? 'silk';
    setTheme(initial);
    const effective = initial === 'system' ? resolveSystemTheme() : initial;
    document.documentElement.setAttribute('data-theme', effective);
  }, []);

  const applyTheme = (next: ThemeName) => {
    setTheme(next);
    if (typeof window === 'undefined') return;
    localStorage.setItem('theme', next);
    const effective = next === 'system' ? resolveSystemTheme() : next;
    document.documentElement.setAttribute('data-theme', effective);
    if (ddRef.current) ddRef.current.open = false;
  };

  if (compact) {
    return (
      <details className="dropdown dropdown-top w-full" ref={ddRef}>
        <summary className="btn btn-ghost btn-sm btn-square mx-auto flex" title="Theme">
          <Sun className="h-5 w-5" />
        </summary>
        <ul className="menu menu-sm dropdown-content mb-2 z-50 p-2 shadow bg-base-100 rounded-box w-36 border border-base-300">
          <li><button type="button" onClick={() => applyTheme('system')}>system</button></li>
          {THEMES.map((t) => (
            <li key={t}><button type="button" onClick={() => applyTheme(t)}>{t}</button></li>
          ))}
        </ul>
      </details>
    );
  }

  return (
    <details className="dropdown dropdown-top w-full" ref={ddRef}>
      <summary className="btn btn-ghost btn-sm w-full justify-between">
        <span className="flex items-center gap-2">
          <Sun className="h-4 w-4" />
          <span className="truncate capitalize">{theme}</span>
        </span>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4 opacity-70"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6"/></svg>
      </summary>
      <ul className="menu menu-sm dropdown-content mb-2 z-50 p-2 shadow bg-base-100 rounded-box w-48 border border-base-300">
        <li><button type="button" onClick={() => applyTheme('system')}>system</button></li>
        {THEMES.map((t) => (
          <li key={t}><button type="button" onClick={() => applyTheme(t)}>{t}</button></li>
        ))}
      </ul>
    </details>
  );
}
