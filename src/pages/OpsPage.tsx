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
          <p className="eyebrow">Operations · HTTP polling every 2 s</p>
          <h1>Cluster instrumentation</h1>
          <p className="muted">
            Eight stateless instances publish their own telemetry to Redis. This page reads the
            shared view; no instance talks to another one.
          </p>
        </div>
        <div className="hero-side">
          <Pill tone={ops.error ? 'bad' : data ? 'live' : 'warn'}>
            {ops.error ? 'Metrics unavailable' : data ? `Source: ${data.source}` : 'Loading'}
          </Pill>
          <span className="tiny muted">
            {ops.updatedAt ? `sampled ${timeAgo(ops.updatedAt)}` : 'waiting for the first sample'}
          </span>
          <span className="mono tiny">{API_URL.replace(/^https?:\/\//, '')}</span>
        </div>
      </section>

      {ops.error ? (
        <div className="banner banner-bad">
          <strong>{ops.error}</strong>
          <p className="tiny">
            The endpoint needs <span className="mono">METRICS_PUBLIC=true</span>, or an{' '}
            <span className="mono">x-admin-token</span> header when it is false. Check that the
            backend is reachable at <span className="mono">{API_URL}</span>.
          </p>
        </div>
      ) : null}

      {aggregate && aggregate.instances !== 8 ? (
        <div className="banner banner-warn">
          {aggregate.instances} instance(s) reported in the last 20 s, not 8. During a deploy this is
          expected; on a steady cluster it means an instance is not publishing telemetry.
        </div>
      ) : null}

      {!data ? (
        <section className="card empty">
          <span className="spinner" aria-hidden="true" />
          <h2>Reading cluster telemetry</h2>
          <p className="muted">The dashboard polls /api/ops/metrics every two seconds.</p>
        </section>
      ) : (
        <>
          <section className="grid grid-4">
            <article className="card stat">
              <span className="stat-label">Instances</span>
              <strong className="stat-value">
                {formatNumber(aggregate?.instances)}
                <small> / 8</small>
              </strong>
              <span className="stat-hint">
                {formatNumber(aggregate?.degradedInstances)} in degraded mode
              </span>
            </article>

            <article className="card stat">
              <span className="stat-label">Open connections</span>
              <strong className="stat-value">{formatNumber(aggregate?.totalConnections)}</strong>
              <span className="stat-hint">
                {formatNumber(aggregate?.sseConnections)} SSE · {formatNumber(aggregate?.juryConnections)} jury ·{' '}
                {formatNumber(aggregate?.verificationConnections)} verification
              </span>
            </article>

            <article className="card stat">
              <span className="stat-label">Event loop p99</span>
              <strong className={`stat-value tone-${loopTone(aggregate?.eventLoopP99Ms ?? 0)}`}>
                {formatMs(aggregate?.eventLoopP99Ms)}
              </strong>
              <span className="stat-hint">max {formatMs(aggregate?.eventLoopMaxMs)} across instances</span>
            </article>

            <article className="card stat">
              <span className="stat-label">Heap used</span>
              <strong className="stat-value">
                {formatDecimal(aggregate?.heapUsedMb, 1)}
                <small> MB</small>
              </strong>
              <span className="stat-hint">
                {formatNumber(aggregate?.deliveredEvents)} client deliveries so far
              </span>
            </article>

            <article className="card stat">
              <span className="stat-label">Actas / minute</span>
              <strong className="stat-value">{formatNumber(aggregate?.actasPerMinute)}</strong>
              <span className="stat-hint">
                {formatNumber(aggregate?.actasAccepted)} accepted · {formatNumber(aggregate?.actasDoubtful)} doubtful
              </span>
            </article>

            <article className="card stat">
              <span className="stat-label">Topic messages / s</span>
              <strong className="stat-value">{formatDecimal(aggregate?.messagesPerSecond, 2)}</strong>
              <span className="stat-hint">
                {formatNumber(global?.backplane.published)} published vs {formatNumber(global?.backplane.naive)} naive
              </span>
            </article>

            <article className="card stat">
              <span className="stat-label">Backplane reduction</span>
              <strong className="stat-value">{formatPct(global?.backplane.reductionPct)}</strong>
              <span className="stat-hint">
                actas × 8 instances would publish {formatNumber(global?.backplane.naive)} messages
              </span>
            </article>

            <article className="card stat">
              <span className="stat-label">Delivery reduction</span>
              <strong className="stat-value">{formatPct(global?.deliveryReductionPct)}</strong>
              <span className="stat-hint">
                {formatNumber(global?.naiveDeliveries)} naive per-acta fan-out deliveries
              </span>
            </article>
          </section>

          <section className="grid grid-3">
            <article className="card">
              <header className="card-head">
                <h2 className="card-title">Connections</h2>
                <span className="tiny muted">{history.length} samples</span>
              </header>
              <Sparkline values={history.map((sample) => sample.connections)} tone="info" label="total sockets" />
            </article>
            <article className="card">
              <header className="card-head">
                <h2 className="card-title">Event loop p99</h2>
                <span className={`tiny tone-${loopTone(aggregate?.eventLoopP99Ms ?? 0)}`}>
                  {formatMs(aggregate?.eventLoopP99Ms)}
                </span>
              </header>
              <Sparkline values={history.map((sample) => sample.p99)} tone={loopTone(aggregate?.eventLoopP99Ms ?? 0)} label="ms" />
            </article>
            <article className="card">
              <header className="card-head">
                <h2 className="card-title">Topic messages / s</h2>
                <span className="tiny muted">aggregated windows</span>
              </header>
              <Sparkline values={history.map((sample) => sample.messages)} tone="ok" label="messages per second" />
            </article>
          </section>

          <div className="grid grid-ops">
            <section className="card">
              <header className="card-head">
                <div>
                  <h2 className="card-title">Per-instance view</h2>
                  <p className="tiny muted">
                    Each row is an independent process behind the load balancer, with no sticky
                    sessions.
                  </p>
                </div>
                <span className="tiny muted mono">
                  {aggregate?.instances === 8 ? 'all eight online' : 'partial cluster'}
                </span>
              </header>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Instance</th>
                      <th>Redis</th>
                      <th className="num">SSE</th>
                      <th className="num">Jury</th>
                      <th className="num">Verify</th>
                      <th className="num">Msg/s</th>
                      <th className="num">p99</th>
                      <th className="num">Max</th>
                      <th className="num">Heap</th>
                      <th className="num">KB/conn</th>
                      <th className="num">Actas/min</th>
                      <th className="num">Uptime</th>
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
                              {instance.redisStatus}
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
                  <h2 className="card-title">INP (real users)</h2>
                  <span className="tiny muted">{formatNumber(data.inp.samples)} samples</span>
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
                    <dt>Worst</dt>
                    <dd>{formatMs(data.inp.worst)}</dd>
                  </div>
                </dl>
                <p className="tiny muted">
                  Reported by the public page through <span className="mono">/api/telemetry/inp</span>.
                </p>
              </section>

              <section className="card">
                <header className="card-head">
                  <h2 className="card-title">Durable audit</h2>
                  <Pill tone={data.supabase.enabled ? 'live' : 'idle'}>
                    {data.supabase.enabled ? 'enabled' : 'disabled'}
                  </Pill>
                </header>
                <dl className="kv">
                  <div className="kv-row">
                    <dt>Write-behind queue</dt>
                    <dd>{formatNumber(data.supabase.queued)} rows</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Persisted</dt>
                    <dd>{formatNumber(data.supabase.persisted)} actas</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Dropped</dt>
                    <dd>{formatNumber(data.supabase.dropped)}</dd>
                  </div>
                </dl>
                <p className="tiny muted">
                  Supabase never sits on the acknowledgement path: the ack means Redis committed the
                  acta.
                </p>
              </section>

              <section className="card">
                <header className="card-head">
                  <h2 className="card-title">Snapshot</h2>
                </header>
                <dl className="kv">
                  <div className="kv-row">
                    <dt>Generated</dt>
                    <dd>{timeAgo(Date.parse(data.generatedAt))}</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Source</dt>
                    <dd className="mono">{data.source}</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Instances reporting</dt>
                    <dd>{formatNumber(aggregate?.instances)}</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Slow SSE clients closed</dt>
                    <dd>
                      {formatNumber(
                        data.instances.reduce((total, item) => total + item.totals.slowClientsClosed, 0),
                      )}
                    </dd>
                  </div>
                  <div className="kv-row">
                    <dt>SSE events skipped</dt>
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
            <summary>Raw /api/ops/metrics snapshot</summary>
            <pre className="raw">{JSON.stringify(data, null, 2)}</pre>
          </details>
        </>
      )}
    </>
  );
};
