'use client';

import { useEffect, useRef, useState } from 'react';

const THEMES = ['silk', 'bumblebee', 'autumn', 'light', 'dark'] as const;
type ThemeName = typeof THEMES[number] | 'system';

function resolveSystemTheme(): ThemeName {
  if (typeof window === 'undefined') return 'light';
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

export function ThemeSwitcher() {
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
    // close dropdown
    if (ddRef.current) ddRef.current.open = false;
  };

  return (
    <div className="form-control">
      <label className="label"><span className="label-text">Theme</span></label>
      <details className="dropdown" ref={ddRef}>
        <summary className="btn btn-outline w-full justify-between">
          <span className="truncate">{theme}</span>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4 opacity-70"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6"/></svg>
        </summary>
        <ul className="menu dropdown-content bg-base-100 rounded-box z-10 w-52 p-2 shadow-sm mt-2">
          <li><button type="button" onClick={() => applyTheme('system')}>system</button></li>
          {THEMES.map((t) => (
            <li key={t}><button type="button" onClick={() => applyTheme(t)}>{t}</button></li>
          ))}
        </ul>
      </details>
      <span className="label-text-alt mt-2">Changes apply immediately</span>
    </div>
  );
}


