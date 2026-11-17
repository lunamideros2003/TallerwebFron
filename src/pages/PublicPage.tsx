import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pill, toneForStream } from '../components/Pill';
import { DEFAULT_TOPIC } from '../lib/config';
import { formatClock, formatNumber, formatPct, timeAgo } from '../lib/format';
import { useInpReporter } from '../lib/inp';
import type { TopicCatalogue } from '../lib/types';
import { usePolling } from '../lib/usePolling';
import { useSseTopic } from '../lib/useSseTopic';
import { CANDIDATES, SPECIAL_VOTES, shortVoteLabel, topicLabel } from '../lib/votes';

const FALLBACK_MUNICIPALITIES = Array.from({ length: 11 }, (_, index) => ({
  id: index + 1,
  label: `Municipio ${index + 1}`,
  topic: `mun:${index + 1}`,
  mesas: 0,
  puestos: 0,
}));

export const PublicPage = () => {
  useInpReporter('public');

  const [params, setParams] = useSearchParams();
  const topic = params.get('topic') ?? DEFAULT_TOPIC;
  const stream = useSseTopic(topic);
  const catalogue = usePolling<TopicCatalogue>('/api/topics', 60_000);
  const [station, setStation] = useState(() =>
    topic.startsWith('puesto:') ? topic.slice('puesto:'.length) : '1',
  );

  const municipalities = catalogue.data?.municipalities ?? FALLBACK_MUNICIPALITIES;
  const selected = topic === 'dept' || topic.startsWith('mun:') ? topic : 'custom';

  const goToTopic = (next: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('topic', next);
    setParams(nextParams);
  };

  const submitStation = (event: FormEvent) => {
    event.preventDefault();
    const id = Number.parseInt(station, 10);
    if (!Number.isInteger(id) || id <= 0) return;
    goToTopic(`puesto:${id}`);
  };

  const state = stream.state;
  const ranked = useMemo(() => {
    if (!state) return [];
    const source = state.rank.length > 0
      ? state.rank
      : CANDIDATES.map((code) => ({ code, votes: Number(state.tally[code] ?? 0) })).sort(
          (left, right) => right.votes - left.votes,
        );
    return [...source].sort((left, right) => right.votes - left.votes);
  }, [state]);

  const totalVotes = state?.totalVotes ?? 0;
  const share = (votes: number) => (totalVotes > 0 ? (votes / totalVotes) * 100 : 0);
  const leader = ranked[0];
  const stale = Boolean(state?.stale) || stream.status === 'degraded';

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Preconteo en vivo</p>
          <h1>{topicLabel(topic)}</h1>
          <p className="muted">
            Números en vivo y agregados mientras los puestos reportan. El conteo oficial es manual y
            se realiza sobre las actas físicas.
          </p>
        </div>
        <div className="hero-side">
          <Pill tone={toneForStream(stream.status)} title={stream.error ?? undefined}>
            {stream.status === 'live'
              ? 'En vivo'
              : stream.status === 'degraded'
                ? 'Degradado'
                : stream.status === 'reconnecting'
                  ? 'Reconectando'
                  : 'Conectando'}
          </Pill>
          {state ? (
            <span className="tiny muted">
              Actualizado {formatClock(state.receivedAt ?? undefined)} · {timeAgo(state.receivedAt)}
            </span>
          ) : null}
        </div>
      </section>

      <section className="card topic-bar">
        <label className="field compact">
          <span className="field-label">Tema</span>
          <select
            value={selected === 'custom' ? 'custom' : selected}
            onChange={(event) => {
              if (event.target.value !== 'custom') goToTopic(event.target.value);
            }}
          >
            <option value="dept">Todo el departamento</option>
            {municipalities.map((municipality) => (
              <option key={municipality.topic} value={municipality.topic}>
                {municipality.label}
                {municipality.mesas ? ` · ${formatNumber(municipality.mesas)} mesas` : ''}
              </option>
            ))}
            <option value="custom">Un puesto específico…</option>
          </select>
        </label>

        <form className="field compact" onSubmit={submitStation}>
          <span className="field-label">
            Puesto de votación {catalogue.data ? `(1 – ${catalogue.data.puestos.to})` : ''}
          </span>
          <div className="inline">
            <input
              type="number"
              min={1}
              max={catalogue.data?.puestos.to ?? 1842}
              value={station}
              onChange={(event) => setStation(event.target.value)}
              aria-label="Número del puesto de votación"
            />
            <button type="submit" className="btn btn-ghost">
              Ver
            </button>
          </div>
        </form>

        <div className="topic-meta">
          <span className="tiny muted">Suscripción actual</span>
          <span className="mono">{topic}</span>
        </div>
      </section>

      {stream.error ? (
        <div className={`banner ${stream.status === 'degraded' ? 'banner-bad' : 'banner-warn'}`}>
          {stream.error}
        </div>
      ) : null}

      {stale && state ? (
        <div className="banner banner-warn">
          Mostrando la última instantánea consistente mientras se recupera el registro en vivo. Los
          números se reanudarán sin retroceder.
        </div>
      ) : null}

      {!state ? (
        <section className="card empty">
          <span className="spinner" aria-hidden="true" />
          <h2>Esperando la primera instantánea</h2>
          <p className="muted">
            La transmisión pública abre una conexión SSE por espectador y se reanuda desde la última
            entrada de Redis Stream tras una desconexión.
          </p>
        </section>
      ) : (
        <>
          <section className="grid grid-4">
            <article className="card stat">
              <span className="stat-label">Mesas reportadas</span>
              <strong className="stat-value">
                {formatNumber(state.reported.mesas)}
                <small> / {formatNumber(state.reported.total)}</small>
              </strong>
              <div className="bar" aria-hidden="true">
                <span
                  className="bar-fill"
                  style={{ width: `${Math.min(100, Math.max(0, state.reported.pct))}%` }}
                />
              </div>
              <span className="stat-hint">{formatPct(state.reported.pct)} del territorio</span>
            </article>

            <article className="card stat">
              <span className="stat-label">Votos contados</span>
              <strong className="stat-value">{formatNumber(totalVotes)}</strong>
              <span className="stat-hint">Candidatos más votos en blanco, nulos y no marcados</span>
            </article>

            <article className="card stat">
              <span className="stat-label">Candidato líder</span>
              <strong className="stat-value">
                {leader ? leader.code : '—'}
                <small>{leader ? ` · ${formatPct(share(leader.votes))}` : ''}</small>
              </strong>
              <span className="stat-hint">
                {leader ? `${formatNumber(leader.votes)} votos` : 'Aún no hay votos'}
              </span>
            </article>

            <article className="card stat">
              <span className="stat-label">Última ventana</span>
              <strong className="stat-value">
                {stream.windowMs ? `${stream.windowMs / 1000}s` : '2s'}
              </strong>
              <span className="stat-hint">
                {stream.actasInWindow > 0
                  ? `${formatNumber(stream.actasInWindow)} actas en esta actualización`
                  : 'Actualizaciones agregadas, una por tema por ventana'}
              </span>
            </article>
          </section>

          <div className="grid grid-main">
            <section className="card">
              <header className="card-head">
                <div>
                  <h2 className="card-title">Resultados por candidato</h2>
                  <p className="tiny muted">
                    Porcentaje de los {formatNumber(totalVotes)} votos contados en este tema.
                  </p>
                </div>
                <span className="tiny muted mono">{state.topic}</span>
              </header>

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Candidato</th>
                      <th className="num">Votos</th>
                      <th className="num">Porcentaje</th>
                      <th className="bar-col">Distribución</th>
                      <th className="num">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CANDIDATES.map((code) => {
                      const votes = Number(state.tally[code] ?? 0);
                      const delta = stream.changes[code] ?? 0;
                      return (
                        <tr
                          key={`${code}-${stream.lastEventAt ?? 0}`}
                          className={delta > 0 ? 'flash-up' : delta < 0 ? 'flash-down' : undefined}
                        >
                          <td>
                            <span className="code-pill">{code}</span>
                            <span className="candidate-name">Candidato {code.replace('C', '')}</span>
                          </td>
                          <td className="num">{formatNumber(votes)}</td>
                          <td className="num">{formatPct(share(votes))}</td>
                          <td className="bar-col">
                            <div className="bar thin">
                              <span className="bar-fill" style={{ width: `${share(votes)}%` }} />
                            </div>
                          </td>
                          <td className={`num delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`}>
                            {delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${formatNumber(delta)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="stack">
              <section className="card">
                <header className="card-head">
                  <h2 className="card-title">Posiciones</h2>
                </header>
                <ol className="ranking">
                  {ranked.slice(0, 6).map((entry, index) => (
                    <li key={entry.code} className="ranking-row">
                      <span className="ranking-pos">{index + 1}</span>
                      <span className="ranking-code">{entry.code}</span>
                      <span className="ranking-votes">{formatNumber(entry.votes)}</span>
                      <span className="ranking-pct">{formatPct(share(entry.votes))}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="card">
                <header className="card-head">
                  <h2 className="card-title">Votos especiales</h2>
                </header>
                <ul className="list">
                  {SPECIAL_VOTES.map((code) => (
                    <li key={code} className="list-row">
                      <span className="list-main">
                        <span className={`code-pill ${code.toLowerCase()}`}>{shortVoteLabel(code)}</span>
                      </span>
                      <span className="list-meta">
                        <strong>{formatNumber(state.tally[code] ?? 0)}</strong>
                        <span className="tiny muted">{formatPct(share(Number(state.tally[code] ?? 0)))}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="card">
                <header className="card-head">
                  <h2 className="card-title">Transmisión</h2>
                </header>
                <dl className="kv">
                  <div className="kv-row">
                    <dt>Transporte</dt>
                    <dd>SSE · Reanudación con Last-Event-ID</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Instancia que atiende</dt>
                    <dd className="mono">{stream.instanceId ?? '—'}</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Cursor</dt>
                    <dd className="mono">{stream.lastSeq ?? '—'}</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Reanudado</dt>
                    <dd>{stream.resumed ? 'sí, desde el último id de evento' : 'instantánea inicial'}</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Actualizaciones / instantáneas</dt>
                    <dd>
                      {formatNumber(stream.updates)} / {formatNumber(stream.snapshots)}
                    </dd>
                  </div>
                  <div className="kv-row">
                    <dt>Eventos enviados</dt>
                    <dd>{formatNumber(stream.updates + stream.snapshots)}</dd>
                  </div>
                </dl>
              </section>
            </div>
          </div>
        </>
      )}
    </>
  );
};
