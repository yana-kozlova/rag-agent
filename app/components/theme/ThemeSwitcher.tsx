'use client';

import { useEffect, useState } from 'react';

const THEMES = ['silk', 'bumblebee', 'light', 'dark'] as const;
type ThemeName = typeof THEMES[number] | 'system';

function resolveSystemTheme(): ThemeName {
  if (typeof window === 'undefined') return 'light';
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeName>('silk');

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
  };

  return (
    <div className="form-control">
      <label className="label"><span className="label-text">Theme</span></label>
      <select
        className="select select-bordered"
        value={theme}
        onChange={(e) => applyTheme(e.currentTarget.value as ThemeName)}
      >
        <option value="system">system</option>
        {THEMES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <span className="label-text-alt mt-2">Changes apply immediately</span>
    </div>
  );
}


