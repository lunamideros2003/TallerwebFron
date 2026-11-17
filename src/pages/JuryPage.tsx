import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Pill, toneForStream } from '../components/Pill';
import { JURY_TOKEN, SOCKET_URL } from '../lib/config';
import { formatDuration, formatNumber, timeAgo } from '../lib/format';
import { ApiError, postJson } from '../lib/http';
import {
  isRetryable,
  loadOutbox,
  newIdem,
  newRequestId,
  saveOutbox,
  type OutboxEntry,
  type OutboxStatus,
} from '../lib/outbox';
import { useReconnectingSocket } from '../lib/socket';
import type { ActaPayload, ActaResult } from '../lib/types';
import { VOTE_CODES, sumVotes, voteLabel } from '../lib/votes';

const DEFAULT_VOTES: Record<string, number> = {
  C1: 20,
  C2: 15,
  C3: 12,
  C4: 10,
  C5: 8,
  C6: 7,
  BLANCO: 8,
  NULO: 6,
  NO_MARCADO: 4,
};

const DEFAULT_SUFRAGANTES = Object.values(DEFAULT_VOTES).reduce((total, value) => total + value, 0);
const JUROR_STORAGE_KEY = 'preconteo.jurorId';

interface Draft {
  mesa: string;
  puesto: string;
  municipio: string;
  version: string;
  sufragantes: string;
  votes: Record<string, string>;
}

const freshDraft = (): Draft => ({
  mesa: '1',
  puesto: '1',
  municipio: '1',
  version: '1',
  sufragantes: String(DEFAULT_SUFRAGANTES),
  votes: Object.fromEntries(VOTE_CODES.map((code) => [code, String(DEFAULT_VOTES[code] ?? 0)])),
});

const describeResult = (result: ActaResult): string => {
  switch (result.status) {
    case 'accepted':
      return result.doubtful
        ? 'Registered. Flagged for verification because the accounting rule failed.'
        : 'Registered and counted.';
    case 'duplicate':
      return `Already registered at version ${result.registeredVersion ?? result.version ?? '?'}. Votes were not counted twice.`;
    case 'superseded':
      return `Version superseded by ${result.registeredVersion ?? 'a newer version'}. Totals did not move backwards.`;
    case 'rejected':
      return result.message ?? 'The registry rejected the acta.';
    case 'conflict':
      return 'This idempotency key belongs to another acta.';
    case 'rate_limited':
      return 'Rate limited. The outbox keeps the acta and retries with the same key.';
    case 'unavailable':
      return 'Registry unavailable. The acta was NOT stored; retrying with idempotency.';
    default:
      return result.message ?? 'Unknown result.';
  }
};

const statusTone = (status: OutboxStatus) => {
  if (status === 'accepted') return 'live';
  if (status === 'duplicate' || status === 'superseded') return 'info';
  if (status === 'rejected' || status === 'conflict' || status === 'error') return 'bad';
  return 'warn';
};

const storedJuror = (): string => {
  try {
    return window.localStorage.getItem(JUROR_STORAGE_KEY) ?? 'JUR-0001';
  } catch {
    return 'JUR-0001';
  }
};

export const JuryPage = () => {
  const [jurorDraft, setJurorDraft] = useState(storedJuror);
  const [jurorId, setJurorId] = useState(storedJuror);
  const [draft, setDraft] = useState<Draft>(freshDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [hello, setHello] = useState<{ instanceId: string; jurorId: string } | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);

  const [entries, setEntries] = useState<OutboxEntry[]>(loadOutbox);
  const entriesRef = useRef(entries);
  const pendingRef = useRef(new Map<string, number>());
  const flushingRef = useRef(false);
  const socketOpenRef = useRef(false);
  const sendRef = useRef<((payload: unknown) => boolean) | null>(null);

  const commit = useCallback((next: OutboxEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
  }, []);

  useEffect(() => {
    saveOutbox(entries);
  }, [entries]);

  const updateEntry = useCallback(
    (requestId: string, patch: Partial<OutboxEntry>) => {
      commit(
        entriesRef.current.map((entry) =>
          entry.requestId === requestId ? { ...entry, ...patch, updatedAt: Date.now() } : entry,
        ),
      );
    },
    [commit],
  );

  const clearPending = useCallback((requestId: string) => {
    const timer = pendingRef.current.get(requestId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      pendingRef.current.delete(requestId);
    }
  }, []);

  const applyResult = useCallback(
    (requestId: string, result: ActaResult, channel: 'ws' | 'http') => {
      clearPending(requestId);
      const terminal = ['accepted', 'duplicate', 'superseded', 'rejected', 'conflict'];
      if (terminal.includes(result.status)) {
        updateEntry(requestId, {
          status: result.status as OutboxStatus,
          channel,
          message: describeResult(result),
          nextAttemptAt: 0,
        });
        return;
      }
      const delay = Math.max(1500, Number(result.retryAfterMs ?? 5000));
      updateEntry(requestId, {
        status: 'queued',
        channel,
        message: describeResult(result),
        nextAttemptAt: Date.now() + delay,
      });
    },
    [clearPending, updateEntry],
  );

  const armAckTimeout = useCallback(
    (requestId: string) => {
      clearPending(requestId);
      const timer = window.setTimeout(() => {
        pendingRef.current.delete(requestId);
        const current = entriesRef.current.find((entry) => entry.requestId === requestId);
        if (!current || !isRetryable(current.status)) return;
        updateEntry(requestId, {
          status: 'queued',
          channel: current.channel,
          message:
            'No acknowledgement within 12 s. Will retry with the same idempotency key, so it cannot be counted twice.',
          nextAttemptAt: Date.now() + 1500,
        });
      }, 12_000);
      pendingRef.current.set(requestId, timer);
    },
    [clearPending, updateEntry],
  );

  const sendOverHttp = useCallback(
    async (entry: OutboxEntry) => {
      try {
        const result = await postJson<ActaResult>('/api/actas', entry.acta);
        applyResult(entry.requestId, result, 'http');
      } catch (error) {
        if (error instanceof ApiError && error.body && typeof error.body === 'object') {
          const body = error.body as ActaResult;
          if (typeof body.status === 'string') {
            applyResult(entry.requestId, body, 'http');
            return;
          }
        }
        const status = error instanceof ApiError ? error.status : 0;
        const message = error instanceof Error ? error.message : 'Network error';
        if (status === 0 || status >= 500 || status === 429) {
          updateEntry(entry.requestId, {
            status: 'queued',
            channel: 'http',
            message: `${message}. Retrying with the same idempotency key.`,
            nextAttemptAt: Date.now() + (status === 429 ? 5000 : 3000),
          });
          return;
        }
        updateEntry(entry.requestId, {
          status: 'error',
          channel: 'http',
          message,
          nextAttemptAt: 0,
        });
      }
    },
    [applyResult, updateEntry],
  );

  const flush = useCallback(async () => {
    if (flushingRef.current || !navigator.onLine) return;
    flushingRef.current = true;
    try {
      const candidates = entriesRef.current.filter(
        (entry) =>
          isRetryable(entry.status)
          && entry.status !== 'sending'
          && entry.nextAttemptAt <= Date.now(),
      );

      for (const entry of candidates) {
        if (!navigator.onLine) break;
        const viaSocket = socketOpenRef.current && sendRef.current !== null;
        updateEntry(entry.requestId, {
          status: 'sending',
          attempts: entry.attempts + 1,
          channel: viaSocket ? 'ws' : 'http',
        });

        if (viaSocket) {
          const sent = sendRef.current?.({ type: 'acta.submit', requestId: entry.requestId, acta: entry.acta });
          if (sent) {
            armAckTimeout(entry.requestId);
            continue;
          }
        }
        // eslint-disable-next-line no-await-in-loop
        await sendOverHttp(entry);
      }
    } finally {
      flushingRef.current = false;
    }
  }, [armAckTimeout, sendOverHttp, updateEntry]);

  const handleSocketMessage = useCallback(
    (message: unknown) => {
      const payload = message as {
        type?: string;
        requestId?: string;
        instanceId?: string;
        jurorId?: string;
        message?: string;
        status?: ActaResult['status'];
        doubtful?: boolean;
        version?: number;
        registeredVersion?: number;
        retryAfterMs?: number;
      };

      if (payload.type === 'hello') {
        setHello({
          instanceId: payload.instanceId ?? '—',
          jurorId: payload.jurorId ?? jurorId,
        });
        setSocketError(null);
        return;
      }
      if (payload.type === 'pong') return;
      if (payload.type === 'error') {
        setSocketError(payload.message ?? 'Unexpected socket error');
        return;
      }
      if (payload.type === 'ack' && payload.requestId) {
        applyResult(
          payload.requestId,
          {
            status: payload.status ?? 'error',
            message: payload.message,
            doubtful: payload.doubtful,
            version: payload.version,
            registeredVersion: payload.registeredVersion,
            retryAfterMs: payload.retryAfterMs,
          },
          'ws',
        );
      }
    },
    [applyResult, jurorId],
  );

  const socketUrl = useMemo(
    () =>
      `${SOCKET_URL}/ws/jury?token=${encodeURIComponent(JURY_TOKEN)}&jurorId=${encodeURIComponent(jurorId)}`,
    [jurorId],
  );

  const socket = useReconnectingSocket(socketUrl, handleSocketMessage, {
    pingMs: 25_000,
    onOpen: () => {
      void flush();
    },
  });

  socketOpenRef.current = socket.status === 'open';
  sendRef.current = socket.send;

  useEffect(() => {
    if (socket.status === 'open') void flush();
  }, [socket.status, flush]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void flush();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [flush]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      void flush();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [flush]);

  useEffect(() => {
    void flush();
  }, [flush]);

  useEffect(
    () => () => {
      for (const timer of pendingRef.current.values()) window.clearTimeout(timer);
      pendingRef.current.clear();
    },
    [],
  );

  const numericVotes = useMemo(
    () =>
      Object.fromEntries(
        VOTE_CODES.map((code) => [code, Number.parseInt(draft.votes[code] ?? '0', 10) || 0]),
      ),
    [draft.votes],
  );
  const votesTotal = sumVotes(numericVotes);
  const declared = Number.parseInt(draft.sufragantes, 10) || 0;
  const balanced = votesTotal === declared;

  const actaPreview = (() => {
    const mesa = Number.parseInt(draft.mesa, 10) || 0;
    const puesto = Number.parseInt(draft.puesto, 10) || 0;
    return `E14-${String(puesto).padStart(4, '0')}-${String(mesa).padStart(4, '0')}-03`;
  })();

  const buildActa = (): ActaPayload | null => {
    const mesa = Number.parseInt(draft.mesa, 10);
    const puesto = Number.parseInt(draft.puesto, 10);
    const municipio = Number.parseInt(draft.municipio, 10);
    const version = Number.parseInt(draft.version, 10);
    const sufragantes = Number.parseInt(draft.sufragantes, 10);

    if (!Number.isInteger(mesa) || mesa < 1) {
      setFormError('Mesa must be a positive integer.');
      return null;
    }
    if (!Number.isInteger(puesto) || puesto < 1) {
      setFormError('Puesto must be a positive integer.');
      return null;
    }
    if (!Number.isInteger(municipio) || municipio < 1) {
      setFormError('Municipality must be a positive integer.');
      return null;
    }
    if (!Number.isInteger(version) || version < 1) {
      setFormError('Version must be an integer greater than or equal to 1.');
      return null;
    }
    if (!Number.isInteger(sufragantes) || sufragantes < 0) {
      setFormError('Sufragantes must be a non-negative integer.');
      return null;
    }
    if (jurorId.trim().length < 3) {
      setFormError('The juror id must have at least 3 characters.');
      return null;
    }

    const votes: Record<string, number> = {};
    for (const code of VOTE_CODES) {
      const value = Number.parseInt(draft.votes[code] ?? '0', 10);
      if (!Number.isInteger(value) || value < 0) {
        setFormError(`Votes for ${voteLabel(code)} must be a non-negative integer.`);
        return null;
      }
      votes[code] = value;
    }

    return {
      acta: `E14-${String(puesto).padStart(4, '0')}-${String(mesa).padStart(4, '0')}-03`,
      mesa,
      puesto,
      municipio,
      version,
      jurado: jurorId,
      ts_cierre: Math.floor(Date.now() / 1000),
      votos: votes,
      sufragantes,
      hash_foto: 'demo-photo-hash',
      idem: newIdem(),
    };
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const acta = buildActa();
    if (!acta) return;

    const entry: OutboxEntry = {
      requestId: newRequestId(),
      acta,
      status: 'queued',
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nextAttemptAt: 0,
      channel: null,
      message: 'Queued in the local outbox',
    };
    commit([...entriesRef.current, entry]);
    void flush();
  };

  const applyJuror = () => {
    const value = jurorDraft.trim().toUpperCase();
    if (value.length < 3) {
      setFormError('The juror id must have at least 3 characters.');
      return;
    }
    try {
      window.localStorage.setItem(JUROR_STORAGE_KEY, value);
    } catch {
      // Storage may be unavailable; the session still works.
    }
    setJurorDraft(value);
    setJurorId(value);
    setFormError(null);
  };

  const randomize = (doubtful: boolean) => {
    const mesa = 1 + Math.floor(Math.random() * 6400);
    const puesto = 1 + Math.floor(Math.random() * 1842);
    const municipio = 1 + Math.floor(Math.random() * 11);
    const sufragantes = 80 + Math.floor(Math.random() * 121);
    const weights = [18, 15, 13, 11, 9, 8, 11, 8, 7];
    const values = weights.map((weight) => Math.floor((sufragantes * weight) / 100));
    let remainder = sufragantes - values.reduce((total, value) => total + value, 0);
    let index = 0;
    while (remainder > 0) {
      values[index % values.length] += 1;
      remainder -= 1;
      index += 1;
    }

    setDraft({
      mesa: String(mesa),
      puesto: String(puesto),
      municipio: String(municipio),
      version: '1',
      sufragantes: String(doubtful ? sufragantes + 15 : sufragantes),
      votes: Object.fromEntries(VOTE_CODES.map((code, position) => [code, String(values[position] ?? 0)])),
    });
    setFormError(null);
  };

  const retryEntry = (requestId: string) => {
    updateEntry(requestId, { status: 'queued', nextAttemptAt: 0, message: 'Retry requested' });
    void flush();
  };

  const dismissEntry = (requestId: string) => {
    clearPending(requestId);
    commit(entriesRef.current.filter((entry) => entry.requestId !== requestId));
  };

  const retryAll = () => {
    commit(
      entriesRef.current.map((entry) =>
        isRetryable(entry.status)
          ? { ...entry, status: 'queued', nextAttemptAt: 0, updatedAt: Date.now() }
          : entry,
      ),
    );
    void flush();
  };

  const clearFinished = () => {
    commit(
      entriesRef.current.filter(
        (entry) => entry.status === 'queued' || entry.status === 'sending' || entry.status === 'error',
      ),
    );
  };

  const queuedCount = entries.filter((entry) => entry.status === 'queued' || entry.status === 'sending').length;
  const deliveredCount = entries.filter(
    (entry) =>
      entry.status === 'accepted' || entry.status === 'duplicate' || entry.status === 'superseded',
  ).length;
  const failedCount = entries.filter(
    (entry) => entry.status === 'rejected' || entry.status === 'conflict' || entry.status === 'error',
  ).length;

  const newestFirst = [...entries].reverse();

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Jury channel · WebSocket</p>
          <h1>Submit an acta</h1>
          <p className="muted">
            One request, one explicit verdict. Every submission lives in a local outbox until the
            backend confirms it, and retries reuse the same idempotency key.
          </p>
        </div>
        <div className="hero-side">
          <Pill tone={toneForStream(socket.status)} title={socket.detail}>
            {socket.status === 'open' ? 'Socket open' : socket.status === 'connecting' ? 'Connecting' : 'Reconnecting'}
          </Pill>
          <Pill tone={online ? 'live' : 'bad'}>{online ? 'Network online' : 'Offline'}</Pill>
        </div>
      </section>

      {!online ? (
        <div className="banner banner-warn">
          You are offline. New actas stay in the outbox in <span className="mono">localStorage</span> and
          are flushed automatically when the connection returns.
        </div>
      ) : null}

      {formError ? <div className="banner banner-bad">{formError}</div> : null}
      {socketError ? <div className="banner banner-warn">{socketError}</div> : null}

      <div className="grid grid-jury">
        <section className="card">
          <header className="card-head">
            <div>
              <h2 className="card-title">Acta data entry</h2>
              <p className="tiny muted">
                The acta id is derived from puesto and mesa. Changing the version records a
                correction instead of a new table.
              </p>
            </div>
            <span className="mono tiny">{actaPreview}</span>
          </header>

          <form onSubmit={submit}>
            <div className="form-grid">
              <label className="field">
                <span className="field-label">Mesa</span>
                <input
                  type="number"
                  min={1}
                  max={6400}
                  value={draft.mesa}
                  onChange={(event) => setDraft({ ...draft, mesa: event.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">Puesto</span>
                <input
                  type="number"
                  min={1}
                  max={1842}
                  value={draft.puesto}
                  onChange={(event) => setDraft({ ...draft, puesto: event.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">Municipality</span>
                <input
                  type="number"
                  min={1}
                  max={11}
                  value={draft.municipio}
                  onChange={(event) => setDraft({ ...draft, municipio: event.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">Version</span>
                <input
                  type="number"
                  min={1}
                  value={draft.version}
                  onChange={(event) => setDraft({ ...draft, version: event.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">Sufragantes</span>
                <input
                  type="number"
                  min={0}
                  value={draft.sufragantes}
                  onChange={(event) => setDraft({ ...draft, sufragantes: event.target.value })}
                />
              </label>
            </div>

            <div className="votes-head">
              <h3>Votes</h3>
              <span className={`balance ${balanced ? 'ok' : 'warn'}`}>
                {formatNumber(votesTotal)} / {formatNumber(declared)} votes
                {balanced ? ' · accounting rule satisfied' : ' · mismatch, will need verification'}
              </span>
            </div>

            <div className="vote-grid">
              {VOTE_CODES.map((code) => (
                <label key={code} className="field vote-field">
                  <span className="field-label">{voteLabel(code)}</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.votes[code] ?? '0'}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        votes: { ...draft.votes, [code]: event.target.value },
                      })
                    }
                  />
                </label>
              ))}
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                Queue acta and send
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => randomize(false)}>
                Random valid acta
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => randomize(true)}>
                Random doubtful acta
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setDraft(freshDraft());
                  setFormError(null);
                }}
              >
                Reset form
              </button>
            </div>
          </form>
        </section>

        <div className="stack">
          <section className="card">
            <header className="card-head">
              <h2 className="card-title">Juror session</h2>
              <Pill tone={toneForStream(socket.status)}>{socket.status}</Pill>
            </header>

            <div className="inline">
              <input
                value={jurorDraft}
                onChange={(event) => setJurorDraft(event.target.value)}
                aria-label="Juror id"
                placeholder="JUR-0001"
              />
              <button type="button" className="btn btn-ghost" onClick={applyJuror}>
                Apply
              </button>
            </div>
            <p className="tiny muted">
              The id is sent on the upgrade request and used for the per-juror rate limit.
            </p>

            <dl className="kv">
              <div className="kv-row">
                <dt>Socket</dt>
                <dd>{socket.detail}</dd>
              </div>
              <div className="kv-row">
                <dt>Instance</dt>
                <dd className="mono">{hello?.instanceId ?? '—'}</dd>
              </div>
              <div className="kv-row">
                <dt>Registered as</dt>
                <dd className="mono">{hello?.jurorId ?? jurorId}</dd>
              </div>
              <div className="kv-row">
                <dt>Transport</dt>
                <dd>WebSocket · HTTP fallback</dd>
              </div>
            </dl>
          </section>

          <section className="card">
            <header className="card-head">
              <h2 className="card-title">Outbox</h2>
              <span className="tiny muted">
                {formatNumber(queuedCount)} queued · {formatNumber(deliveredCount)} confirmed ·{' '}
                {formatNumber(failedCount)} failed
              </span>
            </header>

            <div className="inline wrap">
              <button type="button" className="btn btn-sm btn-ghost" onClick={retryAll}>
                Retry queued
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={clearFinished}>
                Clear delivered
              </button>
            </div>

            {newestFirst.length === 0 ? (
              <p className="empty-text">
                Nothing queued yet. Submit an acta and watch the verdict arrive on the socket.
              </p>
            ) : (
              <ul className="list outbox">
                {newestFirst.map((entry) => (
                  <li key={entry.requestId} className="outbox-row">
                    <div className="outbox-main">
                      <div className="inline wrap">
                        <span className="mono">{entry.acta.acta}</span>
                        <span className="tag">v{entry.acta.version}</span>
                        <Pill tone={statusTone(entry.status)}>{entry.status}</Pill>
                        {entry.channel ? <span className="tag">{entry.channel}</span> : null}
                      </div>
                      <p className="tiny muted">{entry.message}</p>
                      <p className="tiny muted">
                        attempts {entry.attempts} · {timeAgo(entry.updatedAt)} ·{' '}
                        {formatDuration(Date.now() - entry.createdAt)} old
                      </p>
                    </div>
                    <div className="outbox-actions">
                      {isRetryable(entry.status) ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => retryEntry(entry.requestId)}
                        >
                          Retry
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => dismissEntry(entry.requestId)}
                      >
                        Dismiss
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
};
