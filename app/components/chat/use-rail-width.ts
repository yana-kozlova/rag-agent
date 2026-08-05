'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * How wide the companion rail is, remembered between visits.
 *
 * The rail and the page margin that makes room for it live in different
 * components, so the width is owned here and handed to both — otherwise the
 * two drift apart mid-drag and the content slides under the panel.
 */

const STORAGE_KEY = 'chat-rail-width';

/** Narrower than this and the chat stops being usable — messages wrap to noise. */
export const MIN_RAIL_WIDTH = 288;

/** Past this the rail stops being a companion and starts being the page. */
export const MAX_RAIL_WIDTH = 720;

export const DEFAULT_RAIL_WIDTH = 352;

function clamp(value: number): number {
  return Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, Math.round(value)));
}

export function useRailWidth() {
  // Starts at the default so server and first client render agree; the stored
  // value is applied in the effect below, after hydration.
  const [width, setWidthState] = useState(DEFAULT_RAIL_WIDTH);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = Number.parseInt(stored, 10);
        if (Number.isFinite(parsed)) setWidthState(clamp(parsed));
      }
    } catch {
      // Private browsing, disabled storage — the default is a fine answer.
    }
  }, []);

  /** Live update while dragging; persistence is deliberately separate. */
  const setWidth = useCallback((next: number) => {
    setWidthState(clamp(next));
  }, []);

  /** Called once on pointer-up, so a drag writes one entry instead of hundreds. */
  const persistWidth = useCallback((next: number) => {
    const value = clamp(next);
    setWidthState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Not being able to remember the width is not worth failing over.
    }
  }, []);

  return { width, setWidth, persistWidth };
}
