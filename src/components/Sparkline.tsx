interface SparklineProps {
  values: number[];
  tone?: 'ok' | 'warn' | 'bad' | 'info';
  height?: number;
  max?: number;
  label?: string;
}

const TONE_COLORS: Record<NonNullable<SparklineProps['tone']>, string> = {
  ok: '#38d39f',
  warn: '#f5b74e',
  bad: '#f87171',
  info: '#5aa9ff',
};

/**
 * Dependency-free sparkline. The ops page keeps the last 60 samples (2 min at
 * the 2 s polling interval), which is enough to see a spike without shipping a
 * charting library.
 */
export const Sparkline = ({ values, tone = 'info', height = 44, max, label }: SparklineProps) => {
  const width = 240;
  const pad = 3;
  const peak = Math.max(max ?? 0, ...values, 1);
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const points = values
    .map((value, index) => {
      const x = pad + index * step;
      const y = height - pad - (Math.max(0, value) / peak) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const color = TONE_COLORS[tone];

  return (
    <div className="spark">
      {label ? <span className="spark-label">{label}</span> : null}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={label ?? 'minigráfico'}
        preserveAspectRatio="none"
      >
        <line
          x1={pad}
          y1={height - pad}
          x2={width - pad}
          y2={height - pad}
          stroke="rgba(148, 163, 184, 0.2)"
          strokeWidth="1"
        />
        {values.length > 1 ? (
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
      </svg>
      <span className="spark-peak">pico {Math.round(peak)}</span>
    </div>
  );
};
