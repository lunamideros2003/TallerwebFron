/**
 * Backend contract, mirrored by hand from Backend/src.
 * Keeping it in one file makes every page consume exactly the same shapes the
 * server emits on SSE, WebSocket and HTTP.
 */

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'degraded';

export interface RankEntry {
  code: string;
  votes: number;
}

export interface Reported {
  mesas: number;
  total: number;
  pct: number;
}

export interface TopicState {
  topic: string;
  level: string;
  id: string | number;
  tally: Record<string, number>;
  totalVotes: number;
  reported: Reported;
  rank: RankEntry[];
  updatedAt?: string;
  seq?: string | null;
  stale?: boolean;
  reason?: string;
  /** Local receive time, added by the SSE hook. */
  receivedAt?: number;
}

export interface UpdatePayload extends TopicState {
  type: 'update';
  changes: Record<string, number>;
  actas: number;
  windowMs: number;
  serverTime: number;
  seq: string;
}

export interface TopicCatalogue {
  department: { topic: string; mesas: number; puestos: number };
  municipalities: Array<{
    id: number;
    label: string;
    topic: string;
    mesas: number;
    puestos: number;
  }>;
  puestos: { from: number; to: number };
}

export interface ActaPayload {
  acta: string;
  mesa: number;
  puesto: number;
  municipio: number;
  version: number;
  jurado: string;
  ts_cierre: number;
  votos: Record<string, number>;
  sufragantes: number;
  hash_foto?: string | null;
  idem: string;
}

export type ActaStatus =
  | 'accepted'
  | 'duplicate'
  | 'superseded'
  | 'rejected'
  | 'conflict'
  | 'rate_limited'
  | 'unavailable';

export interface ActaResult {
  ok?: boolean;
  status: ActaStatus | 'error';
  requestId?: string;
  actaId?: string;
  version?: number;
  registeredVersion?: number;
  doubtful?: boolean;
  reason?: string;
  message?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  instanceId?: string;
}

export interface VerificationCase {
  actaId: string;
  version: number;
  mesa: number;
  puesto: number;
  municipio: number;
  sufragantes: number;
  totalVotes: number;
  reason: string;
  priority: number;
  status: string;
  votes: Record<string, number> | null;
  owner: string | null;
  claimedAt: number;
  updatedAt: number;
  lockExpiresInMs: number;
}

export interface RosterEntry {
  auditorId: string;
  instanceId: string;
  currentActa: string | null;
  connectedAt: number;
  lastSeen: number;
  busyForMs: number;
  onlineForMs: number;
}

export interface VerificationCounts {
  pending: number;
  active: number;
  open: number;
  auditorsOnline: number;
}

export interface VerificationSnapshot {
  cases: VerificationCase[];
  roster: RosterEntry[];
  counts: VerificationCounts;
  stats?: { resolved: number } | null;
  leaseMs?: number;
  heartbeatMs?: number;
  instanceId?: string;
}

export interface LatencySummary {
  count: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface OpsInstance {
  instanceId: string;
  uptimeSeconds: number;
  redisStatus: string;
  connections: { sse: number; jury: number; verification: number; total: number };
  eventLoop: {
    meanMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
    peakMs: number;
  };
  rates: {
    actasPerMinute: number;
    messagesPerSecond: number;
    sseEventsPerSecond: number;
    connectionsPerSecond: number;
    reconnectsPerSecond: number;
    qualifiedActasPerMinute: number;
  };
  totals: {
    actasReceived: number;
    actasAccepted: number;
    actasDuplicate: number;
    actasStale: number;
    actasRejected: number;
    actasDoubtful: number;
    actasCorrected: number;
    messagesPublished: number;
    naiveMessages: number;
    sseEventsSent: number;
    sseEventsSkipped: number;
    slowClientsClosed: number;
    supabaseDropped: number;
    redisErrors: number;
  };
  latency: {
    publish: LatencySummary;
    actaToPublic: LatencySummary;
  };
  memory: { rssMb: number; heapUsedMb: number; perConnectionKb: number };
  timestamp: string;
}

export interface OpsSnapshot {
  source: string;
  generatedAt: string;
  instances: OpsInstance[];
  global: {
    published: number;
    naive: number;
    deliveredEvents: number;
    naiveDeliveries: number;
    deliveryReductionPct: number;
    backplane: { published: number; naive: number; reductionPct: number };
  };
  aggregate: {
    instances: number;
    sseConnections: number;
    juryConnections: number;
    verificationConnections: number;
    totalConnections: number;
    actasPerMinute: number;
    messagesPerSecond: number;
    actasAccepted: number;
    actasDoubtful: number;
    deliveredEvents: number;
    heapUsedMb: number;
    eventLoopP99Ms: number;
    eventLoopMaxMs: number;
    degradedInstances: number;
  };
  inp: { samples: number; p75: number; p95: number; worst: number };
  supabase: { enabled: boolean; queued: number; persisted: number; dropped: number };
}

export interface BackendConfig {
  instanceId: string;
  environment: string;
  election: { mesas: number; puestos: number; municipios: number };
  candidates: string[];
  voteCodes: string[];
  windowMs: number;
  sseRetryMs: number;
  verification: { leaseMs: number; heartbeatMs: number };
  jury: { heartbeatMs: number };
  features: { supabase: boolean; demoEndpoints: boolean };
}
