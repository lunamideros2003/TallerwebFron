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
  label: `Municipality ${index + 1}`,
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
          <p className="eyebrow">Realtime preconteo</p>
          <h1>{topicLabel(topic)}</h1>
          <p className="muted">
            Live, aggregated numbers while the polling stations report. The official count is manual
            and happens on the physical actas.
          </p>
        </div>
        <div className="hero-side">
          <Pill tone={toneForStream(stream.status)} title={stream.error ?? undefined}>
            {stream.status === 'live'
              ? 'Live'
              : stream.status === 'degraded'
                ? 'Degraded'
                : stream.status === 'reconnecting'
                  ? 'Reconnecting'
                  : 'Connecting'}
          </Pill>
          {state ? (
            <span className="tiny muted">
              Updated {formatClock(state.receivedAt ?? undefined)} · {timeAgo(state.receivedAt)}
            </span>
          ) : null}
        </div>
      </section>

      <section className="card topic-bar">
        <label className="field compact">
          <span className="field-label">Topic</span>
          <select
            value={selected === 'custom' ? 'custom' : selected}
            onChange={(event) => {
              if (event.target.value !== 'custom') goToTopic(event.target.value);
            }}
          >
            <option value="dept">Whole department</option>
            {municipalities.map((municipality) => (
              <option key={municipality.topic} value={municipality.topic}>
                {municipality.label}
                {municipality.mesas ? ` · ${formatNumber(municipality.mesas)} tables` : ''}
              </option>
            ))}
            <option value="custom">Single polling station…</option>
          </select>
        </label>

        <form className="field compact" onSubmit={submitStation}>
          <span className="field-label">
            Polling station {catalogue.data ? `(1 – ${catalogue.data.puestos.to})` : ''}
          </span>
          <div className="inline">
            <input
              type="number"
              min={1}
              max={catalogue.data?.puestos.to ?? 1842}
              value={station}
              onChange={(event) => setStation(event.target.value)}
              aria-label="Polling station number"
            />
            <button type="submit" className="btn btn-ghost">
              Watch
            </button>
          </div>
        </form>

        <div className="topic-meta">
          <span className="tiny muted">Current subscription</span>
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
          Showing the last consistent snapshot while the live registry recovers. Numbers will resume
          without going backwards.
        </div>
      ) : null}

      {!state ? (
        <section className="card empty">
          <span className="spinner" aria-hidden="true" />
          <h2>Waiting for the first snapshot</h2>
          <p className="muted">
            The public stream opens one SSE connection per viewer and resumes from the last Redis
            Stream entry after a disconnect.
          </p>
        </section>
      ) : (
        <>
          <section className="grid grid-4">
            <article className="card stat">
              <span className="stat-label">Reported tables</span>
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
              <span className="stat-hint">{formatPct(state.reported.pct)} of the territory</span>
            </article>

            <article className="card stat">
              <span className="stat-label">Votes counted</span>
              <strong className="stat-value">{formatNumber(totalVotes)}</strong>
              <span className="stat-hint">Candidates plus blank, null and unmarked ballots</span>
            </article>

            <article className="card stat">
              <span className="stat-label">Leading candidate</span>
              <strong className="stat-value">
                {leader ? leader.code : '—'}
                <small>{leader ? ` · ${formatPct(share(leader.votes))}` : ''}</small>
              </strong>
              <span className="stat-hint">
                {leader ? `${formatNumber(leader.votes)} votes` : 'No votes yet'}
              </span>
            </article>

            <article className="card stat">
              <span className="stat-label">Last window</span>
              <strong className="stat-value">
                {stream.windowMs ? `${stream.windowMs / 1000}s` : '2s'}
              </strong>
              <span className="stat-hint">
                {stream.actasInWindow > 0
                  ? `${formatNumber(stream.actasInWindow)} actas in this update`
                  : 'Aggregated updates, one per topic per window'}
              </span>
            </article>
          </section>

          <div className="grid grid-main">
            <section className="card">
              <header className="card-head">
                <div>
                  <h2 className="card-title">Candidate results</h2>
                  <p className="tiny muted">
                    Share of the {formatNumber(totalVotes)} positions counted in this topic.
                  </p>
                </div>
                <span className="tiny muted mono">{state.topic}</span>
              </header>

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Candidate</th>
                      <th className="num">Votes</th>
                      <th className="num">Share</th>
                      <th className="bar-col">Distribution</th>
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
                            <span className="candidate-name">Candidate {code.replace('C', '')}</span>
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
                  <h2 className="card-title">Standing</h2>
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
                  <h2 className="card-title">Special votes</h2>
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
                  <h2 className="card-title">Stream</h2>
                </header>
                <dl className="kv">
                  <div className="kv-row">
                    <dt>Transport</dt>
                    <dd>SSE · Last-Event-ID resume</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Serving instance</dt>
                    <dd className="mono">{stream.instanceId ?? '—'}</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Cursor</dt>
                    <dd className="mono">{stream.lastSeq ?? '—'}</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Resumed</dt>
                    <dd>{stream.resumed ? 'yes, from last event id' : 'initial snapshot'}</dd>
                  </div>
                  <div className="kv-row">
                    <dt>Updates / snapshots</dt>
                    <dd>
                      {formatNumber(stream.updates)} / {formatNumber(stream.snapshots)}
                    </dd>
                  </div>
                  <div className="kv-row">
                    <dt>Events sent</dt>
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
