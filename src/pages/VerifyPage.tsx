import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pill, toneForStream } from '../components/Pill';
import { AUDITOR_TOKEN, SOCKET_URL } from '../lib/config';
import { formatClock, formatDuration, formatNumber, timeAgo } from '../lib/format';
import { useReconnectingSocket } from '../lib/socket';
import type {
  RosterEntry,
  VerificationCase,
  VerificationCounts,
  VerificationSnapshot,
} from '../lib/types';
import { sumVotes } from '../lib/votes';

const AUDITOR_STORAGE_KEY = 'preconteo.auditorId';

interface VerificationMessage {
  type?: string;
  instanceId?: string;
  auditorId?: string;
  action?: string;
  actaId?: string;
  previousOwner?: string | null;
  token?: string;
  ok?: boolean;
  reason?: string;
  message?: string;
  leaseMs?: number;
  heartbeatMs?: number;
  cases?: VerificationCase[];
  roster?: RosterEntry[];
  counts?: VerificationCounts;
  stats?: { resolved: number } | null;
  lost?: string[];
  renewed?: string[];
  resolution?: string;
}

interface LogEntry {
  at: number;
  tone: 'info' | 'warn' | 'bad';
  text: string;
}

const storedAuditor = (): string => {
  try {
    return (window.localStorage.getItem(AUDITOR_STORAGE_KEY) ?? 'AUD-001').toUpperCase();
  } catch {
    return 'AUD-001';
  }
};

const priorityLabel = (priority: number): string => `P${Math.min(3, Math.max(1, priority))}`;

export const VerifyPage = () => {
  const [auditorDraft, setAuditorDraft] = useState(storedAuditor);
  const [auditorId, setAuditorId] = useState(storedAuditor);
  const [snapshot, setSnapshot] = useState<VerificationSnapshot | null>(null);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<LogEntry[]>([]);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [leaseMs, setLeaseMs] = useState(60_000);
  const [heartbeatMs, setHeartbeatMs] = useState(15_000);
  const [lastHeartbeat, setLastHeartbeat] = useState<number | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);

  const sendRef = useRef<(payload: unknown) => boolean>(() => false);
  const refreshTimer = useRef<number | null>(null);

  const appendEvent = useCallback((tone: LogEntry['tone'], text: string) => {
    setEvents((previous) => [{ at: Date.now(), tone, text }, ...previous].slice(0, 24));
  }, []);

  const requestRefresh = useCallback(() => {
    if (refreshTimer.current !== null) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      sendRef.current({ type: 'queue.refresh' });
    }, 250);
  }, []);

  const handleMessage = useCallback(
    (message: unknown) => {
      const payload = message as VerificationMessage;
      const applySnapshot = (body: VerificationMessage) => {
        setSnapshot({
          cases: body.cases ?? [],
          roster: body.roster ?? [],
          counts:
            body.counts ?? { pending: 0, active: 0, open: 0, auditorsOnline: 0 },
          stats: body.stats ?? null,
          instanceId: body.instanceId,
        });
        if (body.instanceId) setInstanceId(body.instanceId);
        if (Number(body.leaseMs) > 0) setLeaseMs(Number(body.leaseMs));
        if (Number(body.heartbeatMs) > 0) setHeartbeatMs(Number(body.heartbeatMs));
      };

      switch (payload.type) {
        case 'init':
          applySnapshot(payload);
          setDegraded(false);
          appendEvent('info', `Connected as ${payload.auditorId ?? auditorId} on ${payload.instanceId ?? 'an instance'}`);
          break;

        case 'state':
          applySnapshot(payload);
          break;

        case 'presence.updated':
          appendEvent('info', `${payload.auditorId ?? 'An auditor'} ${payload.action ?? 'updated presence'}`);
          requestRefresh();
          break;

        case 'case.claimed':
          appendEvent('info', `${payload.auditorId ?? 'An auditor'} claimed ${payload.actaId ?? 'a case'}`);
          requestRefresh();
          break;

        case 'case.requeued':
          appendEvent('warn', `${payload.actaId ?? 'A case'} returned to the queue`);
          requestRefresh();
          break;

        case 'case.resolved':
          appendEvent('info', `${payload.auditorId ?? 'An auditor'} completed ${payload.actaId ?? 'a case'}`);
          if (payload.auditorId === auditorId && payload.actaId) dropToken(payload.actaId);
          requestRefresh();
          break;

        case 'case.expired':
          appendEvent('warn', `Lease expired for ${payload.actaId ?? 'a case'}; requeued`);
          if (payload.previousOwner === auditorId && payload.actaId) dropToken(payload.actaId);
          requestRefresh();
          break;

        case 'case.lost':
          if (payload.actaId) dropToken(payload.actaId);
          appendEvent('bad', `Lease lost for ${payload.actaId ?? 'a case'}`);
          requestRefresh();
          break;

        case 'auditor.released':
          appendEvent('warn', `${payload.auditorId ?? 'An auditor'} disconnected; cases requeued`);
          requestRefresh();
          break;

        case 'claim.result':
          setClaiming(null);
          if (payload.ok && payload.actaId && payload.token) {
            setTokens((previous) => ({ ...previous, [payload.actaId!]: payload.token! }));
            appendEvent('info', `You claimed ${payload.actaId}`);
          } else {
            appendEvent(
              'warn',
              `Could not claim ${payload.actaId ?? 'the case'}: ${payload.reason ?? 'not available'}`,
            );
          }
          requestRefresh();
          break;

        case 'release.result':
          if (payload.ok) {
            if (payload.actaId) dropToken(payload.actaId);
            appendEvent('info', `Released ${payload.actaId ?? 'the case'} back to the queue`);
          } else {
            appendEvent('warn', `Release refused: ${payload.reason ?? 'not owner'}`);
          }
          requestRefresh();
          break;

        case 'complete.result':
          if (payload.ok) {
            if (payload.actaId) dropToken(payload.actaId);
            appendEvent('info', `Completed ${payload.actaId ?? 'the case'}`);
          } else {
            appendEvent('warn', `Complete refused: ${payload.reason ?? 'not owner'}`);
          }
          requestRefresh();
          break;

        case 'heartbeat.ack':
          setLastHeartbeat(Date.now());
          if (payload.lost && payload.lost.length > 0) {
            for (const actaId of payload.lost) dropToken(actaId);
            appendEvent('bad', `Lease expired: ${payload.lost.join(', ')}`);
          }
          break;

        case 'lock.renewed':
          setLastHeartbeat(Date.now());
          break;

        case 'degraded':
          setDegraded(true);
          appendEvent('bad', payload.message ?? 'Verification service is degraded');
          break;

        case 'error':
          appendEvent('bad', payload.message ?? 'The server reported an error');
          break;

        case 'pong':
          break;

        default:
          break;
      }
    },
    [appendEvent, auditorId, requestRefresh],
  );

  const socketUrl = useMemo(
    () =>
      `${SOCKET_URL}/ws/verification?token=${encodeURIComponent(AUDITOR_TOKEN)}&auditorId=${encodeURIComponent(auditorId)}`,
    [auditorId],
  );

  const socket = useReconnectingSocket(socketUrl, handleMessage);
  sendRef.current = socket.send;

  useEffect(() => {
    if (socket.status !== 'open') return;
    const beat = () => {
      sendRef.current({ type: 'heartbeat' });
    };
    beat();
    const timer = window.setInterval(beat, Math.max(5000, heartbeatMs));
    return () => window.clearInterval(timer);
  }, [socket.status, heartbeatMs, auditorId]);

  useEffect(() => {
    if (socket.status === 'open') setDegraded(false);
  }, [socket.status]);

  useEffect(
    () => () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    },
    [],
  );

  function dropToken(actaId: string) {
    setTokens((previous) => {
      if (!(actaId in previous)) return previous;
      const next = { ...previous };
      delete next[actaId];
      return next;
    });
  }

  const applyAuditor = () => {
    const value = auditorDraft.trim().toUpperCase();
    if (value.length < 3 || value.length > 40) {
      appendEvent('bad', 'The auditor id must be between 3 and 40 characters.');
      return;
    }
    try {
      window.localStorage.setItem(AUDITOR_STORAGE_KEY, value);
    } catch {
      // Ignore storage failures.
    }
    setAuditorDraft(value);
    setTokens({});
    setAuditorId(value);
  };

  const claim = (actaId: string) => {
    setClaiming(actaId);
    const sent = socket.send({ type: 'case.claim', actaId });
    if (!sent) {
      setClaiming(null);
      appendEvent('bad', 'The socket is not connected. Claim not sent.');
    }
  };

  const complete = (actaId: string) => {
    const token = tokens[actaId];
    if (!token) return;
    socket.send({ type: 'case.complete', actaId, token, resolution: 'reviewed_and_confirmed' });
  };

  const release = (actaId: string) => {
    const token = tokens[actaId];
    if (!token) return;
    socket.send({ type: 'case.release', actaId, token });
  };

  const cases = snapshot?.cases ?? [];
  const roster = snapshot?.roster ?? [];
  const counts = snapshot?.counts ?? { pending: 0, active: 0, open: 0, auditorsOnline: 0 };
  const myCases = Object.keys(tokens);

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Verification channel · WebSocket</p>
          <h1>Auditor console</h1>
          <p className="muted">
            Doubtful actas are claimed atomically with a 60 s lease. Presence, queue and ownership
            live in Redis, so the console behaves the same on any of the eight instances.
          </p>
        </div>
        <div className="hero-side">
          <Pill tone={toneForStream(socket.status)} title={socket.detail}>
            {socket.status === 'open' ? 'Socket open' : socket.status === 'connecting' ? 'Connecting' : 'Reconnecting'}
          </Pill>
          {degraded ? <Pill tone="bad">Degraded</Pill> : null}
          <span className="tiny muted">heartbeat {timeAgo(lastHeartbeat)}</span>
        </div>
      </section>

      <section className="card auditor-bar">
        <label className="field compact">
          <span className="field-label">Auditor id</span>
          <input
            value={auditorDraft}
            onChange={(event) => setAuditorDraft(event.target.value)}
            placeholder="AUD-001"
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={applyAuditor}>
          Connect as this auditor
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            const sent = socket.send({ type: 'queue.refresh' });
            appendEvent(sent ? 'info' : 'bad', sent ? 'Queue refresh requested' : 'Socket is not connected');
          }}
        >
          Refresh queue
        </button>
        <div className="topic-meta">
          <span className="tiny muted">Instance</span>
          <span className="mono">{instanceId ?? '—'}</span>
        </div>
        <div className="topic-meta">
          <span className="tiny muted">Lease / heartbeat</span>
          <span className="mono">
            {formatDuration(leaseMs)} / {formatDuration(heartbeatMs)}
          </span>
        </div>
      </section>

      {degraded ? (
        <div className="banner banner-bad">
          Verification is running in degraded mode. Claims fail cleanly and the console retries; no
          case is silently lost.
        </div>
      ) : null}

      <section className="grid grid-4">
        <article className="card stat">
          <span className="stat-label">Pending cases</span>
          <strong className="stat-value">{formatNumber(counts.pending)}</strong>
          <span className="stat-hint">Priority queue ordered by mismatch size</span>
        </article>
        <article className="card stat">
          <span className="stat-label">In progress</span>
          <strong className="stat-value">{formatNumber(counts.active)}</strong>
          <span className="stat-hint">Claimed with an owner-checked lease</span>
        </article>
        <article className="card stat">
          <span className="stat-label">Auditors online</span>
          <strong className="stat-value">{formatNumber(counts.auditorsOnline)}</strong>
          <span className="stat-hint">Presence TTL 45 s, swept every 5 s</span>
        </article>
        <article className="card stat">
          <span className="stat-label">Resolved by you</span>
          <strong className="stat-value">{formatNumber(snapshot?.stats?.resolved ?? 0)}</strong>
          <span className="stat-hint">{myCases.length} case(s) currently held</span>
        </article>
      </section>

      <div className="grid grid-verify">
        <section className="card">
          <header className="card-head">
            <div>
              <h2 className="card-title">Verification queue</h2>
              <p className="tiny muted">
                Two auditors on two instances can never receive the same case: the claim is one
                atomic Lua script.
              </p>
            </div>
            <span className="tiny muted mono">{cases.length} loaded</span>
          </header>

          {cases.length === 0 ? (
            <div className="empty-text">
              <p>No cases in the queue.</p>
              <p className="tiny muted">
                Open the Jury page and submit a “Random doubtful acta”: its accounting mismatch puts
                it here with a priority derived from the difference.
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>P</th>
                    <th>Acta</th>
                    <th className="num">Mesa</th>
                    <th className="num">Puesto</th>
                    <th className="num">Votes vs sufragantes</th>
                    <th>Reason</th>
                    <th>Owner</th>
                    <th className="num">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((item) => {
                    const difference = item.sufragantes - item.totalVotes;
                    const mine = Boolean(tokens[item.actaId]);
                    return (
                      <tr key={item.actaId} className={mine ? 'row-mine' : undefined}>
                        <td>
                          <span className={`tag prio-${priorityLabel(item.priority)}`}>
                            {priorityLabel(item.priority)}
                          </span>
                        </td>
                        <td className="mono">{item.actaId}</td>
                        <td className="num">{formatNumber(item.mesa)}</td>
                        <td className="num">{formatNumber(item.puesto)}</td>
                        <td className="num">
                          {formatNumber(item.totalVotes)} / {formatNumber(item.sufragantes)}
                          <span className={`delta ${difference === 0 ? '' : 'down'}`}>
                            {difference === 0 ? ' · ok' : ` · ${difference > 0 ? '+' : ''}${difference}`}
                          </span>
                        </td>
                        <td className="tiny">{item.reason || 'accounting mismatch'}</td>
                        <td className="tiny">{item.owner ?? <span className="muted">free</span>}</td>
                        <td className="num">
                          {item.owner === null ? (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              disabled={claiming === item.actaId || socket.status !== 'open'}
                              onClick={() => claim(item.actaId)}
                            >
                              {claiming === item.actaId ? 'Claiming…' : 'Claim'}
                            </button>
                          ) : mine ? (
                            <span className="inline">
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                onClick={() => complete(item.actaId)}
                              >
                                Complete
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-ghost"
                                onClick={() => release(item.actaId)}
                              >
                                Release
                              </button>
                            </span>
                          ) : (
                            <span className="tiny muted">held</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="stack">
          <section className="card">
            <header className="card-head">
              <h2 className="card-title">Your active cases</h2>
              <span className="tiny muted">{myCases.length}</span>
            </header>
            {myCases.length === 0 ? (
              <p className="empty-text">Nothing claimed. Claim a case to start reviewing.</p>
            ) : (
              <ul className="list">
                {myCases.map((actaId) => {
                  const item = cases.find((entry) => entry.actaId === actaId);
                  return (
                    <li key={actaId} className="list-row">
                      <span className="list-main">
                        <span className="mono">{actaId}</span>
                        {item ? (
                          <span className="tiny muted">
                            {formatNumber(item.mesa)} / {formatNumber(item.puesto)} ·{' '}
                            {sumVotes(item.votes ?? {})} votes
                          </span>
                        ) : null}
                      </span>
                      <span className="inline">
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => complete(actaId)}
                        >
                          Complete
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => release(actaId)}
                        >
                          Release
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card">
            <header className="card-head">
              <h2 className="card-title">Roster</h2>
              <span className="tiny muted">{roster.length} online</span>
            </header>
            {roster.length === 0 ? (
              <p className="empty-text">No auditors connected.</p>
            ) : (
              <ul className="list roster">
                {roster.map((auditor) => (
                  <li
                    key={auditor.auditorId}
                    className={`list-row ${auditor.auditorId === auditorId ? 'row-mine' : ''}`}
                  >
                    <span className="list-main">
                      <span className="mono">
                        {auditor.auditorId}
                        {auditor.auditorId === auditorId ? ' (you)' : ''}
                      </span>
                      <span className="tiny muted">
                        {auditor.instanceId} · {auditor.currentActa ?? 'idle'}
                      </span>
                    </span>
                    <span className="list-meta">
                      <span className="tiny muted">busy {formatDuration(auditor.busyForMs)}</span>
                      <span className="tiny muted">online {formatDuration(auditor.onlineForMs)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <header className="card-head">
              <h2 className="card-title">Event log</h2>
              <span className="tiny muted">last {events.length}</span>
            </header>
            {events.length === 0 ? (
              <p className="empty-text">Waiting for the first server event.</p>
            ) : (
              <ul className="log">
                {events.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className={`log-entry log-${entry.tone}`}>
                    <span className="log-time">{formatClock(entry.at)}</span>
                    <span>{entry.text}</span>
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
