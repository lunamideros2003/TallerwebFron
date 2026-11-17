import { useCallback, useEffect, useRef, useState } from 'react';
import { getJson } from './http';

export interface PollResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
  refresh: () => void;
}

/**
 * Small polling helper for the HTTP side of the app (ops dashboard, topic
 * catalogue). Polling pauses while the tab is hidden, so a forgotten ops tab
 * does not keep hitting the backend from a laptop in a bag.
 */
export const usePolling = <T,>(path: string, intervalMs: number): PollResult<T> => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const body = await getJson<T>(path);
      if (!mounted.current) return;
      setData(body);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (requestError) {
      if (!mounted.current) return;
      setError(requestError instanceof Error ? requestError.message : 'Request failed');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, intervalMs]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return { data, error, loading, updatedAt, refresh };
};
