'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Resource } from '@/app/resources/ResourcesClient';

/**
 * Fetches `/api/resources?<query>` for a dashboard widget and re-fetches
 * whenever the chat dispatches `dashboard:resources-changed` (e.g. after a
 * knowledge mutation), so saving in the rail refreshes the widgets live.
 */
export function useResourceList(query: string) {
  const [items, setItems] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/resources?${query}`);
      const data = await res.json();
      if (data?.ok && Array.isArray(data.resources)) setItems(data.resources);
    } catch {
      /* leave the widget empty on failure */
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener('dashboard:resources-changed', onChange);
    return () => window.removeEventListener('dashboard:resources-changed', onChange);
  }, [load]);

  return { items, loading, reload: load };
}
