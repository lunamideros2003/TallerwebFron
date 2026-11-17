const pick = (value: string | undefined, fallback: string): string => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
};

/**
 * The backend is a different origin (Render) than the static site (Vercel), so
 * every call uses an absolute URL. No Vite proxy in production, no surprises.
 */
export const API_URL = pick(import.meta.env.VITE_API_URL, 'http://127.0.0.1:3000').replace(/\/+$/, '');

/** http(s) -> ws(s), preserving host, port and any path prefix. */
export const SOCKET_URL = API_URL.replace(/^http/i, 'ws');

/** Must match JURY_TOKEN / AUDITOR_TOKEN in the backend environment. */
export const JURY_TOKEN = pick(import.meta.env.VITE_JURY_TOKEN, 'demo-jury-token');
export const AUDITOR_TOKEN = pick(import.meta.env.VITE_AUDITOR_TOKEN, 'demo-auditor-token');

export const DEFAULT_TOPIC = pick(import.meta.env.VITE_DEFAULT_TOPIC, 'dept');

/** Full URL for the public SSE stream, optionally resuming from a stream id. */
export const sseUrl = (topic: string, lastEventId?: string | null): string => {
  const url = new URL(`${API_URL}/events`);
  url.searchParams.set('topic', topic);
  if (lastEventId) url.searchParams.set('lastEventId', lastEventId);
  return url.toString();
};
