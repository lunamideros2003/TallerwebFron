import type { ActaPayload } from './types';

export type OutboxStatus =
  | 'queued'
  | 'sending'
  | 'accepted'
  | 'duplicate'
  | 'superseded'
  | 'rejected'
  | 'conflict'
  | 'error';

export interface OutboxEntry {
  requestId: string;
  acta: ActaPayload;
  status: OutboxStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  nextAttemptAt: number;
  channel: 'ws' | 'http' | null;
  message: string;
}

const STORAGE_KEY = 'preconteo.outbox.v1';
const MAX_ENTRIES = 60;

const STATUSES: OutboxStatus[] = [
  'queued',
  'sending',
  'accepted',
  'duplicate',
  'superseded',
  'rejected',
  'conflict',
  'error',
];

export const TERMINAL_STATUSES: OutboxStatus[] = [
  'accepted',
  'duplicate',
  'superseded',
  'rejected',
  'conflict',
];

export const isRetryable = (status: OutboxStatus): boolean =>
  status === 'queued' || status === 'sending' || status === 'error';

export const newIdem = (): string => {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  return `idem-${Date.now().toString(36)}-${suffix}`;
};

export const newRequestId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

export const loadOutbox = (): OutboxEntry[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is OutboxEntry => {
        if (typeof item !== 'object' || item === null) return false;
        const entry = item as Partial<OutboxEntry>;
        return (
          typeof entry.requestId === 'string'
          && typeof entry.acta === 'object'
          && entry.acta !== null
          && typeof entry.status === 'string'
          && STATUSES.includes(entry.status as OutboxStatus)
        );
      })
      .map((entry) => ({
        ...entry,
        // A reload can interrupt an in-flight send. The entry goes back to the
        // queue; the same idempotency key makes the retry safe.
        status: entry.status === 'sending' ? 'queued' : entry.status,
        channel: entry.channel ?? null,
        message: entry.message ?? '',
        nextAttemptAt: Number(entry.nextAttemptAt ?? 0),
        attempts: Number(entry.attempts ?? 0),
      }))
      .slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
};

export const saveOutbox = (entries: OutboxEntry[]): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Private mode or quota exceeded: the in-memory outbox still works.
  }
};
