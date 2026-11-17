import { useEffect, useRef, useState } from 'react';
import { describeDelay, fullJitter } from './backoff';
import { sseUrl } from './config';
import type { StreamStatus, TopicState, UpdatePayload } from './types';

export interface TopicStream {
  topic: string;
  state: TopicState | null;
  status: StreamStatus;
  instanceId: string | null;
  resumed: boolean;
  snapshots: number;
  updates: number;
  lastEventAt: number | null;
  lastSeq: string | null;
  error: string | null;
  changes: Record<string, number>;
  actasInWindow: number;
  windowMs: number | null;
  retryMs: number | null;
  nextRetryMs: number | null;
}

const initial = (topic: string): TopicStream => ({
  topic,
  state: null,
  status: 'connecting',
  instanceId: null,
  resumed: false,
  snapshots: 0,
  updates: 0,
  lastEventAt: null,
  lastSeq: null,
  error: null,
  changes: {},
  actasInWindow: 0,
  windowMs: null,
  retryMs: null,
  nextRetryMs: null,
});

const diff = (previous: Record<string, number> | undefined, next: Record<string, number>): Record<string, number> => {
  if (!previous) return {};
  const changes: Record<string, number> = {};
  for (const [code, value] of Object.entries(next)) {
    const before = previous[code] ?? 0;
    if (before !== value) changes[code] = value - before;
  }
  return changes;
};

/**
 * Public results stream.
 *
 * `Last-Event-ID` is sent as the `lastEventId` query parameter on every
 * reconnection, which the backend accepts exactly like the header. The stream
 * therefore resumes from the last applied Redis Stream entry (or receives one
 * full snapshot when the cursor fell outside the retention window), so a
 * reconnecting viewer converges to the same state as one that never left.
 */
export const useSseTopic = (topic: string): TopicStream => {
  const [model, setModel] = useState<TopicStream>(() => initial(topic));
  const cursorRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    cursorRef.current = null;
    setModel(initial(topic));

    const scheduleReconnect = (reason: string) => {
      if (cancelled) return;
      attempt = Math.min(attempt + 1, 10);
      const delay = fullJitter(attempt - 1);
      setModel((prev) => ({
        ...prev,
        status: 'reconnecting',
        error: `${reason}. Reintentando en ${describeDelay(delay)}.`,
        nextRetryMs: delay,
      }));
      reconnectTimer = window.setTimeout(open, delay);
    };

    const open = () => {
      if (cancelled) return;
      reconnectTimer = null;
      setModel((prev) => ({
        ...prev,
        status: prev.lastEventAt ? 'reconnecting' : 'connecting',
        nextRetryMs: null,
      }));

      const es = new EventSource(sseUrl(topic, cursorRef.current));
      source = es;

      const remember = (event: MessageEvent) => {
        if (event.lastEventId) cursorRef.current = event.lastEventId;
      };

      es.addEventListener('snapshot', (raw) => {
        const event = raw as MessageEvent<string>;
        const payload = JSON.parse(event.data) as TopicState & { reason?: string };
        remember(event);
        if (cancelled) return;
        attempt = 0;
        setModel((prev) => ({
          ...prev,
          state: { ...payload, receivedAt: Date.now() },
          status: 'live',
          snapshots: prev.snapshots + 1,
          lastEventAt: Date.now(),
          lastSeq: payload.seq ?? cursorRef.current,
          error: null,
          changes: diff(prev.state?.tally, payload.tally),
          actasInWindow: 0,
          nextRetryMs: null,
        }));
      });

      es.addEventListener('update', (raw) => {
        const event = raw as MessageEvent<string>;
        const payload = JSON.parse(event.data) as UpdatePayload;
        remember(event);
        if (cancelled) return;
        attempt = 0;
        if (cursorRef.current) payload.seq = cursorRef.current;
        setModel((prev) => ({
          ...prev,
          state: { ...payload, receivedAt: Date.now() },
          status: 'live',
          updates: prev.updates + 1,
          lastEventAt: Date.now(),
          lastSeq: payload.seq,
          error: null,
          changes: payload.changes ?? {},
          actasInWindow: payload.actas ?? 0,
          windowMs: payload.windowMs ?? null,
          nextRetryMs: null,
        }));
      });

      es.addEventListener('ready', (raw) => {
        const event = raw as MessageEvent<string>;
        const payload = JSON.parse(event.data) as {
          instanceId: string;
          resumed: boolean;
          retryMs: number;
        };
        remember(event);
        if (cancelled) return;
        attempt = 0;
        setModel((prev) => ({
          ...prev,
          status: 'live',
          instanceId: payload.instanceId,
          resumed: payload.resumed,
          retryMs: payload.retryMs,
          error: null,
          nextRetryMs: null,
        }));
      });

      es.addEventListener('degraded', (raw) => {
        const event = raw as MessageEvent<string>;
        const payload = JSON.parse(event.data) as { message?: string; reason?: string };
        if (cancelled) return;
        setModel((prev) => ({
          ...prev,
          status: 'degraded',
          error: payload.message ?? `Modo degradado (${payload.reason ?? 'redis_unavailable'}).`,
        }));
      });

      es.onerror = () => {
        es.close();
        if (source === es) source = null;
        scheduleReconnect('La transmisión en vivo se interrumpió');
      };
    };

    open();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [topic]);

  return model;
};
