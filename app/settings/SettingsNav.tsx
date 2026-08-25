'use client';

import { useEffect, useState } from 'react';

/**
 * The sections of the settings page, in the order they are rendered.
 *
 * Single source of truth for both the nav and the anchors — a section whose id
 * is not in here is unreachable from the nav, and a nav entry pointing at a
 * missing id silently does nothing, so they are kept in one list.
 *
 * Module-level so its identity is stable across renders: the scroll listener
 * below depends on it.
 */
export const SETTINGS_SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'responses', label: 'Responses' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'google', label: 'Google' },
  { id: 'calendars', label: 'Calendars' },
  { id: 'data', label: 'Data' },
] as const;

/**
 * Where you are on the page, and a way to jump.
 *
 * Position is computed from `getBoundingClientRect` on a scroll frame rather
 * than an IntersectionObserver: sections here differ in height by an order of
 * magnitude (Notifications is taller than the viewport, Data is four lines), so
 * "which section is intersecting" has several right answers at once and the
 * highlight flickers between them. "The last section whose top has passed the
 * quarter mark" has exactly one.
 */
export function SettingsNav() {
  const [active, setActive] = useState<string>(SETTINGS_SECTIONS[0].id);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const marker = window.innerHeight * 0.25;
      let current: string = SETTINGS_SECTIONS[0].id;

      for (const section of SETTINGS_SECTIONS) {
        const el = document.getElementById(section.id);
        if (el && el.getBoundingClientRect().top <= marker) current = section.id;
      }

      // At the bottom of the page nothing further can scroll, so the last
      // section would never reach the marker and would never light up.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        current = SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1].id;
      }

      setActive(current);
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <nav aria-label="Settings sections" className="sticky top-6">
      <ul className="flex flex-col gap-0.5 border-l border-base-300">
        {SETTINGS_SECTIONS.map((section) => {
          const current = section.id === active;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={current ? 'true' : undefined}
                className={`-ml-px block border-l-2 py-1.5 pl-3 text-sm transition-colors ${
                  current
                    ? 'border-primary font-medium text-base-content'
                    : 'border-transparent text-base-content/50 hover:border-base-300 hover:text-base-content/80'
                }`}
              >
                {section.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
