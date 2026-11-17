import { API_URL } from './config';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

/**
 * fetch with a hard timeout and a typed error. A slow backend must never leave
 * a page spinning forever: the caller always gets either data or an ApiError.
 */
export const request = async <T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 12_000,
): Promise<T> => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');

  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const raw = await response.text();
    const body = raw.length > 0 ? parseJson(raw) : null;

    if (!response.ok) {
      const detail = (body as { error?: string; message?: string } | null)?.error
        ?? (body as { message?: string } | null)?.message
        ?? `HTTP ${response.status}`;
      throw new ApiError(detail, response.status, body);
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('La solicitud expiró. ¿El backend es accesible?', 0, null);
    }
    throw new ApiError(error instanceof Error ? error.message : 'Error de red', 0, null);
  } finally {
    window.clearTimeout(timer);
  }
};

export const getJson = <T>(path: string): Promise<T> => request<T>(path);

export const postJson = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });
