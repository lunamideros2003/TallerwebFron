const numberFormat = new Intl.NumberFormat('en-US');

export const formatNumber = (value: number | null | undefined): string =>
  numberFormat.format(Math.round(Number(value ?? 0)));

export const formatDecimal = (value: number | null | undefined, digits = 1): string =>
  Number(value ?? 0).toFixed(digits);

export const formatPct = (value: number | null | undefined, digits = 1): string =>
  `${Number(value ?? 0).toFixed(digits)}%`;

export const formatMs = (value: number | null | undefined): string => {
  const ms = Number(value ?? 0);
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(1)} ms`;
};

export const formatDuration = (ms: number | null | undefined): string => {
  const total = Math.max(0, Math.round(Number(ms ?? 0) / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
};

export const formatClock = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return '--:--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('en-GB', { hour12: false });
};

export const timeAgo = (timestamp: number | null | undefined): string => {
  if (!timestamp) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 2) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
};

export const shortId = (value: string, length = 8): string =>
  value.length <= length ? value : `${value.slice(0, length)}…`;
