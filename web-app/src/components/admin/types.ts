export type Level = 'ok' | 'warn' | 'down' | 'off';
export interface Check { name: string; level: Level; detail: string; ms?: number }
export interface Day { d: string; v: number }
export interface Named { name: string; n: number }

export interface Stats {
  generatedAt: string; days: number;
  users: { total: number; new24h: number; new7d: number; new30d: number; signupsByDay: Day[] };
  active: { d1: number; d7: number; d30: number };
  notes: { total: number; window: number; byDay: Day[]; bySource: Named[] };
  ai: { total: number; window: number; byType: Named[]; byDay: Day[] };
  recordings: { total: number; failedTotal: number; last7d: number; failed7d: number; failedRate7d: number; hoursOfAudio: number; byDay: Day[] };
  subscriptions: { total: number; activePaid: number; activeTrials: number; expired: number; byPlatform: Named[]; startedLast30d: number };
  funnel: { label: string; n: number; pct: number | null }[];
}

export interface LlmCall { ts: string; source: string; ok: boolean; status: number | null; error_type: string | null; error_message: string | null; latency_ms: number | null; model: string | null }
export interface LlmHealth {
  hours: number; status: 'ok' | 'degraded' | 'down' | 'unknown'; statusReason: string;
  totals: { calls: number; ok: number; failed: number; successRate: number | null; live: number; probes: number };
  latency: { p50: number | null; p95: number | null; max: number | null };
  tokens: { input: number; output: number; estCostUsd: number };
  byModel: { model: string; calls: number; failed: number; p50: number | null; p95: number | null }[];
  errors: { status: number | null; error_type: string; count: number; lastTs: string }[];
  series: { ts: string; ok: number; failed: number }[];
  lastSuccess: LlmCall | null; lastFailure: LlmCall | null; lastProbe: LlmCall | null;
}

export interface Overview { checks: Check[]; stats: Stats | null; llm: LlmHealth | null; attention: { level: 'warn' | 'down'; text: string }[] }
