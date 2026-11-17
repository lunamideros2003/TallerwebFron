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
          appendEvent('info', `Conectado como ${payload.auditorId ?? auditorId} en ${payload.instanceId ?? 'una instancia'}`);
          break;

        case 'state':
          applySnapshot(payload);
          break;

        case 'presence.updated':
          appendEvent('info', `${payload.auditorId ?? 'Un auditor'} ${payload.action ?? 'actualizó su presencia'}`);
          requestRefresh();
          break;

        case 'case.claimed':
          appendEvent('info', `${payload.auditorId ?? 'Un auditor'} tomó ${payload.actaId ?? 'un caso'}`);
          requestRefresh();
          break;

        case 'case.requeued':
          appendEvent('warn', `${payload.actaId ?? 'Un caso'} volvió a la cola`);
          requestRefresh();
          break;

        case 'case.resolved':
          appendEvent('info', `${payload.auditorId ?? 'Un auditor'} completó ${payload.actaId ?? 'un caso'}`);
          if (payload.auditorId === auditorId && payload.actaId) dropToken(payload.actaId);
          requestRefresh();
          break;

        case 'case.expired':
          appendEvent('warn', `El arriendo expiró para ${payload.actaId ?? 'un caso'}; reencolada`);
          if (payload.previousOwner === auditorId && payload.actaId) dropToken(payload.actaId);
          requestRefresh();
          break;

        case 'case.lost':
          if (payload.actaId) dropToken(payload.actaId);
          appendEvent('bad', `Arriendo perdido para ${payload.actaId ?? 'un caso'}`);
          requestRefresh();
          break;

        case 'auditor.released':
          appendEvent('warn', `${payload.auditorId ?? 'Un auditor'} se desconectó; casos reencolados`);
          requestRefresh();
          break;

        case 'claim.result':
          setClaiming(null);
          if (payload.ok && payload.actaId && payload.token) {
            setTokens((previous) => ({ ...previous, [payload.actaId!]: payload.token! }));
            appendEvent('info', `Tomaste ${payload.actaId}`);
          } else {
            appendEvent(
              'warn',
              `No se pudo tomar ${payload.actaId ?? 'el caso'}: ${payload.reason ?? 'no disponible'}`,
            );
          }
          requestRefresh();
          break;

        case 'release.result':
          if (payload.ok) {
            if (payload.actaId) dropToken(payload.actaId);
            appendEvent('info', `Liberaste ${payload.actaId ?? 'el caso'} de vuelta a la cola`);
          } else {
            appendEvent('warn', `Liberación rechazada: ${payload.reason ?? 'no es el propietario'}`);
          }
          requestRefresh();
          break;

        case 'complete.result':
          if (payload.ok) {
            if (payload.actaId) dropToken(payload.actaId);
            appendEvent('info', `Completaste ${payload.actaId ?? 'el caso'}`);
          } else {
            appendEvent('warn', `Finalización rechazada: ${payload.reason ?? 'no es el propietario'}`);
          }
          requestRefresh();
          break;

        case 'heartbeat.ack':
          setLastHeartbeat(Date.now());
          if (payload.lost && payload.lost.length > 0) {
            for (const actaId of payload.lost) dropToken(actaId);
            appendEvent('bad', `Arriendo expirado: ${payload.lost.join(', ')}`);
          }
          break;

        case 'lock.renewed':
          setLastHeartbeat(Date.now());
          break;

        case 'degraded':
          setDegraded(true);
          appendEvent('bad', payload.message ?? 'El servicio de verificación está degradado');
          break;

        case 'error':
          appendEvent('bad', payload.message ?? 'El servidor reportó un error');
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
      appendEvent('bad', 'El id del auditor debe tener entre 3 y 40 caracteres.');
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
      appendEvent('bad', 'La conexión no está activa. No se envió la toma.');
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
          <p className="eyebrow">Canal de verificación · WebSocket</p>
          <h1>Consola del auditor</h1>
          <p className="muted">
            Las actas dudosas se toman de forma atómica con un arriendo de 60 s. La presencia, la cola
            y la propiedad viven en Redis, así que la consola se comporta igual en cualquiera de las
            ocho instancias.
          </p>
        </div>
        <div className="hero-side">
          <Pill tone={toneForStream(socket.status)} title={socket.detail}>
            {socket.status === 'open' ? 'Conexión abierta' : socket.status === 'connecting' ? 'Conectando' : 'Reconectando'}
          </Pill>
          {degraded ? <Pill tone="bad">Degradado</Pill> : null}
          <span className="tiny muted">latido {timeAgo(lastHeartbeat)}</span>
        </div>
      </section>

      <section className="card auditor-bar">
        <label className="field compact">
          <span className="field-label">Id del auditor</span>
          <input
            value={auditorDraft}
            onChange={(event) => setAuditorDraft(event.target.value)}
            placeholder="AUD-001"
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={applyAuditor}>
          Conectar con este auditor
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            const sent = socket.send({ type: 'queue.refresh' });
            appendEvent(sent ? 'info' : 'bad', sent ? 'Actualización de cola solicitada' : 'La conexión no está activa');
          }}
        >
          Actualizar cola
        </button>
        <div className="topic-meta">
          <span className="tiny muted">Instancia</span>
          <span className="mono">{instanceId ?? '—'}</span>
        </div>
        <div className="topic-meta">
          <span className="tiny muted">Arriendo / latido</span>
          <span className="mono">
            {formatDuration(leaseMs)} / {formatDuration(heartbeatMs)}
          </span>
        </div>
      </section>

      {degraded ? (
        <div className="banner banner-bad">
          La verificación funciona en modo degradado. Las tomas fallan de forma controlada y la
          consola reintenta; ningún caso se pierde en silencio.
        </div>
      ) : null}

      <section className="grid grid-4">
        <article className="card stat">
          <span className="stat-label">Casos pendientes</span>
          <strong className="stat-value">{formatNumber(counts.pending)}</strong>
          <span className="stat-hint">Cola de prioridad ordenada por tamaño del descuadre</span>
        </article>
        <article className="card stat">
          <span className="stat-label">En progreso</span>
          <strong className="stat-value">{formatNumber(counts.active)}</strong>
          <span className="stat-hint">Tomados con arriendo verificado por propietario</span>
        </article>
        <article className="card stat">
          <span className="stat-label">Auditores en línea</span>
          <strong className="stat-value">{formatNumber(counts.auditorsOnline)}</strong>
          <span className="stat-hint">TTL de presencia 45 s, barrido cada 5 s</span>
        </article>
        <article className="card stat">
          <span className="stat-label">Resueltos por ti</span>
          <strong className="stat-value">{formatNumber(snapshot?.stats?.resolved ?? 0)}</strong>
          <span className="stat-hint">{myCases.length} caso(s) retenido(s) ahora</span>
        </article>
      </section>

      <div className="grid grid-verify">
        <section className="card">
          <header className="card-head">
            <div>
              <h2 className="card-title">Cola de verificación</h2>
              <p className="tiny muted">
                Dos auditores en dos instancias nunca pueden recibir el mismo caso: la toma es un
                único script Lua atómico.
              </p>
            </div>
            <span className="tiny muted mono">{cases.length} cargados</span>
          </header>

          {cases.length === 0 ? (
            <div className="empty-text">
              <p>No hay casos en la cola.</p>
              <p className="tiny muted">
                Abre la página de Jurados y envía un «Acta aleatoria dudosa»: su descuadre contable la
                coloca aquí con una prioridad derivada de la diferencia.
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
                    <th className="num">Votos vs sufragantes</th>
                    <th>Motivo</th>
                    <th>Propietario</th>
                    <th className="num">Acciones</th>
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
                        <td className="tiny">{item.reason || 'descuadre contable'}</td>
                        <td className="tiny">{item.owner ?? <span className="muted">libre</span>}</td>
                        <td className="num">
                          {item.owner === null ? (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              disabled={claiming === item.actaId || socket.status !== 'open'}
                              onClick={() => claim(item.actaId)}
                            >
                              {claiming === item.actaId ? 'Tomando…' : 'Tomar'}
                            </button>
                          ) : mine ? (
                            <span className="inline">
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                onClick={() => complete(item.actaId)}
                              >
                                Completar
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-ghost"
                                onClick={() => release(item.actaId)}
                              >
                                Liberar
                              </button>
                            </span>
                          ) : (
                            <span className="tiny muted">ocupado</span>
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
              <h2 className="card-title">Tus casos activos</h2>
              <span className="tiny muted">{myCases.length}</span>
            </header>
            {myCases.length === 0 ? (
              <p className="empty-text">Nada tomado. Toma un caso para empezar a revisar.</p>
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
                            {sumVotes(item.votes ?? {})} votos
                          </span>
                        ) : null}
                      </span>
                      <span className="inline">
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => complete(actaId)}
                        >
                          Completar
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => release(actaId)}
                        >
                          Liberar
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
              <h2 className="card-title">Nómina</h2>
              <span className="tiny muted">{roster.length} en línea</span>
            </header>
            {roster.length === 0 ? (
              <p className="empty-text">No hay auditores conectados.</p>
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
                        {auditor.auditorId === auditorId ? ' (tú)' : ''}
                      </span>
                      <span className="tiny muted">
                        {auditor.instanceId} · {auditor.currentActa ?? 'inactivo'}
                      </span>
                    </span>
                    <span className="list-meta">
                      <span className="tiny muted">ocupado {formatDuration(auditor.busyForMs)}</span>
                      <span className="tiny muted">en línea {formatDuration(auditor.onlineForMs)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <header className="card-head">
              <h2 className="card-title">Registro de eventos</h2>
              <span className="tiny muted">últimos {events.length}</span>
            </header>
            {events.length === 0 ? (
              <p className="empty-text">Esperando el primer evento del servidor.</p>
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
