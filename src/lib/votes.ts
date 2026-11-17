export const CANDIDATES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'] as const;
export const SPECIAL_VOTES = ['BLANCO', 'NULO', 'NO_MARCADO'] as const;
export const VOTE_CODES = [...CANDIDATES, ...SPECIAL_VOTES];

export const voteLabel = (code: string): string => {
  switch (code) {
    case 'BLANCO':
      return 'Votos en blanco';
    case 'NULO':
      return 'Votos nulos';
    case 'NO_MARCADO':
      return 'Votos no marcados';
    default:
      return `Candidato ${code}`;
  }
};

export const shortVoteLabel = (code: string): string => {
  switch (code) {
    case 'BLANCO':
      return 'Blanco';
    case 'NULO':
      return 'Nulo';
    case 'NO_MARCADO':
      return 'No marcado';
    default:
      return code;
  }
};

export const emptyVotes = (): Record<string, number> =>
  Object.fromEntries(VOTE_CODES.map((code) => [code, 0]));

export const sumVotes = (votes: Record<string, number>): number =>
  VOTE_CODES.reduce((total, code) => total + Number(votes[code] ?? 0), 0);

export const topicLabel = (topic: string): string => {
  if (topic === 'dept') return 'Todo el departamento';
  const [prefix, value] = topic.split(':');
  if (prefix === 'mun') return `Municipio ${value}`;
  if (prefix === 'puesto') return `Puesto ${value}`;
  return topic;
};
