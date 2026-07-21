export const THEMES = ['silk', 'dark'] as const;

export type Theme = typeof THEMES[number];
/** What the user picked. `system` follows the OS and is never written to the DOM. */
export type ThemePreference = Theme | 'system';

export const THEME_STORAGE_KEY = 'theme';
/** Used when the OS expresses no preference, and as the light half of the pair. */
export const FALLBACK_THEME: Theme = 'silk';
/** With nothing stored we follow the OS rather than forcing light. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system';

export const THEME_LABELS: Record<ThemePreference, string> = {
  silk: 'Light',
  dark: 'Dark',
  system: 'System',
};

export function resolveTheme(preference: ThemePreference): Theme {
  if (preference !== 'system') return preference;
  if (typeof window === 'undefined') return FALLBACK_THEME;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : FALLBACK_THEME;
}

export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCE;
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'system' || (THEMES as readonly string[]).includes(stored ?? '')) {
    return stored as ThemePreference;
  }
  return DEFAULT_PREFERENCE;
}

export function applyTheme(preference: ThemePreference) {
  document.documentElement.setAttribute('data-theme', resolveTheme(preference));
}

/**
 * Runs synchronously in <head>, before first paint, so the resolved theme is on
 * <html> by the time anything renders. Must stay in sync with the helpers above
 * by hand — it cannot import them, being inlined as a raw string.
 */
export const THEME_INIT_SCRIPT = `
(function(){try{
  var s=localStorage.getItem('${THEME_STORAGE_KEY}');
  var follow=(s!=='dark'&&s!=='${FALLBACK_THEME}');
  var t=follow
    ?(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'${FALLBACK_THEME}')
    :s;
  document.documentElement.setAttribute('data-theme',t);
}catch(e){}})();
`.trim();
