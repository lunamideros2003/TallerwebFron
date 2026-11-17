import { useEffect, useState } from 'react';
import { Pill } from '../components/Pill';
import { Sparkline } from '../components/Sparkline';
import { API_URL } from '../lib/config';
import { formatDecimal, formatDuration, formatMs, formatNumber, formatPct, timeAgo } from '../lib/format';
import type { OpsSnapshot } from '../lib/types';
import { usePolling } from '../lib/usePolling';

interface Sample {
  connections: number;
  p99: number;
  messages: number;
}

const loopTone = (p99: number): 'ok' | 'warn' | 'bad' => {
  if (p99 > 200) return 'bad';
  if (p99 > 50) return 'warn';
  return 'ok';
};

export const OpsPage = () => {
  const ops = usePolling<OpsSnapshot>('/api/ops/metrics', 2000);
  const [history, setHistory] = useState<Sample[]>([]);

  useEffect(() => {
    if (!ops.data) return;
    const point: Sample = {
      connections: ops.data.aggregate.totalConnections,
      p99: ops.data.aggregate.eventLoopP99Ms,
      messages: ops.data.aggregate.messagesPerSecond,
    };
    setHistory((previous) => [...previous, point].slice(-60));
  }, [ops.data]);

  const data = ops.data;
  const aggregate = data?.aggregate;
  const global = data?.global;

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Operaciones · Consulta HTTP cada 2 s</p>
          <h1>Instrumentación del clúster</h1>
          <p className="muted">
            Ocho instancias sin estado publican su propia telemetría en Redis. Esta página lee la
            vista compartida; ninguna instancia habla con otra.
          </p>
        </div>
        <div className="hero-side">
          <Pill tone={ops.error ? 'bad' : data ? 'live' : 'warn'}>
            {ops.error ? 'Métricas no disponibles' : data ? `Fuente: ${data.source}` : 'Cargando'}
          </Pill>
          <span className="tiny muted">
            {ops.updatedAt ? `muestreado ${timeAgo(ops.updatedAt)}` : 'esperando la primera muestra'}
          </span>
          <span className="mono tiny">{API_URL.replace(/^https?:\/\//, '')}</span>
        </div>
      </section>

      {ops.error ? (
        <div className="banner banner-bad">
          <strong>{ops.error}</strong>
          <p className="tiny">
            El endpoint necesita <span className="mono">METRICS_PUBLIC=true</span>, o un encabezado{' '}
            <span className="mono">x-admin-token</span> cuando es false. Verifica que el backend sea
            accesible en <span className="mono">{API_URL}</span>.
          </p>
        </div>
      ) : null}

      {aggregate && aggregate.instances !== 8 ? (
        <div className="banner banner-warn">
          {aggregate.instances} instancia(s) reportadas en los últimos 20 s, no 8. Durante un
          despliegue es esperable; en un clúster estable significa que una instancia no publica
          telemetría.
        </div>
      ) : null}

      {!data ? (
        <section className="card empty">
          <span className="spinner" aria-hidden="true" />
          <h2>Leyendo la telemetría del clúster</h2>
          <p className="muted">El panel consulta /api/ops/metrics cada dos segundos.</p>
        </section>
      ) : (
        <>
          <section className="grid grid-4">
            <article className="card stat">
              <span className="stat-label">Instancias</span>
              <strong className="stat-value">
                {formatNumber(aggregate?.instances)}
                <small> / 8</small>
              </strong>
              <span className="stat-hint">
                {formatNumber(aggregate?.degradedInstances)} en modo degradado
              </span>
            </article>

            <article className="card stat">
              <span className="stat-label">Conexiones abiertas</span>
              <strong className="stat-value">{formatNumber(aggregate?.totalConnections)}</strong>
              <span className="stat-hint">
                {formatNumber(aggregate?.sseConnections)} SSE · {formatNumber(aggregate?.juryConnections)} jurados ·{' '}
                {formatNumber(aggregate?.verificationConnections)} verificación
              </span>
            </article>

            <article className="card stat">
              <span className="stat-label">p99 del bucle de eventos</span>
              <strong className={`stat-value tone-${loopTone(aggregate?.eventLoopP99Ms ?? 0)}`}>
                {formatMs(aggregate?.eventLoopP99Ms)}
              </strong>
              <span className="stat-hint">máx {formatMs(aggregate?.eventLoopMaxMs)} entre instancias</span>
            </article>

            <article className="card stat">
              <span className="stat-label">Heap en uso</span>
              <strong className="stat-value">
                {formatDecimal(aggregate?.heapUsedMb, 1)}
                <small> MB</small>
              </strong>
              <span className="stat-hint">
                {formatNumber(aggregate?.deliveredEvents)} entregas a clientes hasta ahora
              </span>
            </article>

            <article className="card stat">
              <span className="stat-label">Actas / minuto</span>
              <strong className="stat-value">{formatNumber(aggregate?.actasPerMinute)}</strong>
              <span className="stat-hint">
                {formatNumber(aggregate?.actasAccepted)} aceptadas · {formatNumber(aggregate?.actasDoubtful)} dudosas
              </span>
            </article>

            <article className="card stat">
              <span className="stat-label">Mensajes de tema / s</span>
              <strong className="stat-value">{formatDecimal(aggregate?.messagesPerSecond, 2)}</strong>
              <span className="stat-hint">
                {formatNumber(global?.backplane.published)} publicados vs {formatNumber(global?.backplane.naive)} ingenuos
              </span>
            </article>

            <article className="card stat">
              <span className="stat-label">Reducción del backplane</span>
              <strong className="stat-value">{formatPct(global?.backplane.reductionPct)}</strong>
              <span className="stat-hint">
                actas × 8 instancias publicarían {formatNumber(global?.backplane.naive)} mensajes
              </span>
            </article>

            <article className="card stat">
              <span className="stat-label">Reducción de entregas</span>
              <strong className="stat-value">{formatPct(global?.deliveryReductionPct)}</strong>
              <span className="stat-hint">
                {formatNumber(global?.naiveDeliveries)} entregas ingenuas (una por acta)
              </span>
            </article>
          </section>

          <section className="grid grid-3">
            <article className="card">
              <header className="card-head">
                <h2 className="card-title">Conexiones</h2>
                <span className="tiny muted">{history.length} muestras</span>
              </header>
              <Sparkline values={history.map((sample) => sample.connections)} tone="info" label="sockets totales" />
            </article>
            <article className="card">
              <header className="card-head">
                <h2 className="card-title">p99 del bucle de eventos</h2>
                <span className={`tiny tone-${loopTone(aggregate?.eventLoopP99Ms ?? 0)}`}>
                  {formatMs(aggregate?.eventLoopP99Ms)}
                </span>
              </header>
              <Sparkline values={history.map((sample) => sample.p99)} tone={loopTone(aggregate?.eventLoopP99Ms ?? 0)} label="ms" />
            </article>
            <article className="card">
              <header className="card-head">
                <h2 className="card-title">Mensajes de tema / s</h2>
                <span className="tiny muted">ventanas agregadas</span>
              </header>
              <Sparkline values={history.map((sample) => sample.messages)} tone="ok" label="mensajes por segundo" />
            </article>
          </section>

          <div className="grid grid-ops">
            <section className="card">
              <header className="card-head">
                <div>
                  <h2 className="card-title">Vista por instancia</h2>
                  <p className="tiny muted">
                    Cada fila es un proceso independiente detrás del balanceador de carga, sin sesiones
                    pegajosas.
                  </p>
                </div>
                <span className="tiny muted mono">
                  {aggregate?.instances === 8 ? 'las ocho en línea' : 'clúster parcial'}
                </span>
              </header>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Instancia</th>
                      <th>Redis</th>
                      <th className="num">SSE</th>
                      <th className="num">Jurados</th>
                      <th className="num">Verif.</th>
                      <th className="num">Msg/s</th>
                      <th className="num">p99</th>
                      <th className="num">Máx</th>
                      <th className="num">Heap</th>
                      <th className="num">KB/conex</th>
                      <th className="num">Actas/min</th>
                      <th className="num">Tiempo activo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.instances
                      .slice()
                      .sort((left, right) => left.instanceId.localeCompare(right.instanceId))
                      .map((instance) => (
                        <tr key={instance.instanceId}>
                          <td className="mono">{instance.instanceId}</td>
                          <td>
                            <Pill tone={instance.redisStatus === 'ready' ? 'live' : 'bad'}>
                              {instance.redisStatus === 'ready' ? 'listo' : instance.redisStatus}
                            </Pill>
                          </td>
                          <td className="num">{formatNumber(instance.connections.sse)}</td>
                          <td className="num">{formatNumber(instance.connections.jury)}</td>
                          <td className="num">{formatNumber(instance.connections.verification)}</td>
                          <td className="num">{formatDecimal(instance.rates.messagesPerSecond, 2)}</td>
                          <td className={`num tone-${loopTone(instance.eventLoop.p99Ms)}`}>
                            {formatMs(instance.eventLoop.p99Ms)}
                          </td>
                          <td className="num">{formatMs(instance.eventLoop.maxMs)}</td>
                          <td className="num">{formatDecimal(instance.memory.heapUsedMb, 1)} MB</td>
                          <td className="num">{formatDecimal(instance.memory.perConnectionKb, 1)}</td>
                          <td className="num">{formatNumber(instance.rates.actasPerMinute)}</td>
                          <td className="num">{formatDuration(instance.uptimeSeconds * 1000)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="stack">
              <section className="card">
                <header className="card-head">
                  <h2 className="card-title">INP (usuarios reales)</h2>
                  <span className="tiny muted">{formatNumber(data.inp.samples)} muestras</span>
                </header>
                <dl className="kv">
                  <div className="kv-row">
                    <dt>p75</dt>
                    <dd>{formatMs(data.inp.p75)}</dd>
                  </div>
                  <div className="kv-row">
                    <dt>p95</dt>
                    <dd>{formatMs(data.inp.p95)}</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Peor</dt>
                    <dd>{formatMs(data.inp.worst)}</dd>
                  </div>
                </dl>
                <p className="tiny muted">
                  Reportado por la página pública a través de <span className="mono">/api/telemetry/inp</span>.
                </p>
              </section>

              <section className="card">
                <header className="card-head">
                  <h2 className="card-title">Auditoría duradera</h2>
                  <Pill tone={data.supabase.enabled ? 'live' : 'idle'}>
                    {data.supabase.enabled ? 'habilitada' : 'deshabilitada'}
                  </Pill>
                </header>
                <dl className="kv">
                  <div className="kv-row">
                    <dt>Cola de escritura diferida</dt>
                    <dd>{formatNumber(data.supabase.queued)} filas</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Persistidas</dt>
                    <dd>{formatNumber(data.supabase.persisted)} actas</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Descartadas</dt>
                    <dd>{formatNumber(data.supabase.dropped)}</dd>
                  </div>
                </dl>
                <p className="tiny muted">
                  Supabase nunca está en la ruta del acuse de recibo: el acuse significa que Redis
                  confirmó el acta.
                </p>
              </section>

              <section className="card">
                <header className="card-head">
                  <h2 className="card-title">Instantánea</h2>
                </header>
                <dl className="kv">
                  <div className="kv-row">
                    <dt>Generada</dt>
                    <dd>{timeAgo(Date.parse(data.generatedAt))}</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Fuente</dt>
                    <dd className="mono">{data.source}</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Instancias reportando</dt>
                    <dd>{formatNumber(aggregate?.instances)}</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Clientes SSE lentos cerrados</dt>
                    <dd>
                      {formatNumber(
                        data.instances.reduce((total, item) => total + item.totals.slowClientsClosed, 0),
                      )}
                    </dd>
                  </div>
                  <div className="kv-row">
                    <dt>Eventos SSE omitidos</dt>
                    <dd>
                      {formatNumber(
                        data.instances.reduce((total, item) => total + item.totals.sseEventsSkipped, 0),
                      )}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
          </div>

          <details className="card raw-card">
            <summary>Instantánea sin procesar de /api/ops/metrics</summary>
            <pre className="raw">{JSON.stringify(data, null, 2)}</pre>
          </details>
        </>
      )}
    </>
  );
};
