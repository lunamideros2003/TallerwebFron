export const CANDIDATES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'] as const;
export const SPECIAL_VOTES = ['BLANCO', 'NULO', 'NO_MARCADO'] as const;
export const VOTE_CODES = [...CANDIDATES, ...SPECIAL_VOTES];

export const voteLabel = (code: string): string => {
  switch (code) {
    case 'BLANCO':
      return 'Blank ballots';
    case 'NULO':
      return 'Null ballots';
    case 'NO_MARCADO':
      return 'Unmarked ballots';
    default:
      return `Candidate ${code}`;
  }
};

export const shortVoteLabel = (code: string): string => {
  switch (code) {
    case 'BLANCO':
      return 'Blank';
    case 'NULO':
      return 'Null';
    case 'NO_MARCADO':
      return 'Unmarked';
    default:
      return code;
  }
};

export const emptyVotes = (): Record<string, number> =>
  Object.fromEntries(VOTE_CODES.map((code) => [code, 0]));

export const sumVotes = (votes: Record<string, number>): number =>
  VOTE_CODES.reduce((total, code) => total + Number(votes[code] ?? 0), 0);

export const topicLabel = (topic: string): string => {
  if (topic === 'dept') return 'Whole department';
  const [prefix, value] = topic.split(':');
  if (prefix === 'mun') return `Municipality ${value}`;
  if (prefix === 'puesto') return `Polling station ${value}`;
  return topic;
};
