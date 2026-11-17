import type { ReactNode } from 'react';

export type PillTone = 'live' | 'warn' | 'bad' | 'idle' | 'info';

interface PillProps {
  tone: PillTone;
  children: ReactNode;
  title?: string;
}

export const Pill = ({ tone, children, title }: PillProps) => (
  <span className={`pill pill-${tone}`} title={title}>
    <span className="dot" aria-hidden="true" />
    {children}
  </span>
);

export const toneForStream = (status: string): PillTone => {
  switch (status) {
    case 'live':
    case 'open':
      return 'live';
    case 'reconnecting':
    case 'connecting':
      return 'warn';
    case 'degraded':
    case 'closed':
      return 'bad';
    default:
      return 'idle';
  }
};
