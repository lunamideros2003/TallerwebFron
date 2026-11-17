import { useEffect } from 'react';
import { postJson } from './http';

type Rating = 'good' | 'needs-improvement' | 'poor';

const rate = (value: number): Rating => {
  if (value <= 200) return 'good';
  if (value <= 500) return 'needs-improvement';
  return 'poor';
};

/**
 * INP (Interaction to Next Paint) reporter for RT-9.
 *
 * The public page reports the worst interaction it saw, so the ops dashboard
 * can show p75/p95 of real users while the load test is running. Reporting is
 * fire-and-forget: a failed telemetry call never affects the page.
 */
export const startInpReporter = (page: string): (() => void) => {
  if (typeof window === 'undefined' || !('PerformanceObserver' in window)) {
    return () => {};
  }

  let worst = 0;
  let lastReported = 0;
  let observer: PerformanceObserver | null = null;

  const flush = (reason: string) => {
    if (worst <= 0 || Math.abs(worst - lastReported) < 1) return;
    const value = Math.round(worst * 10) / 10;
    lastReported = value;
    void postJson('/api/telemetry/inp', {
      value,
      rating: rate(value),
      page: `${page}:${reason}`.slice(0, 40),
    }).catch(() => {
      // Telemetry is best effort by design.
    });
  };

  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const duration = (entry as PerformanceEntry).duration;
        if (Number.isFinite(duration) && duration > worst) worst = duration;
      }
    });
    observer.observe({
      type: 'event',
      buffered: true,
      durationThreshold: 40,
    } as PerformanceObserverInit);
  } catch {
    observer = null;
  }

  const interval = window.setInterval(() => flush('interval'), 20_000);

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush('hidden');
  };
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    window.clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisibility);
    observer?.disconnect();
    flush('unmount');
  };
};

export const useInpReporter = (page: string): void => {
  useEffect(() => startInpReporter(page), [page]);
};
