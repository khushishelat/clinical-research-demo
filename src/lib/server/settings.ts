// Server-only. Reads and validates configuration once. Live mode is opt-in:
// a credential alone never switches it on (DEMO_MODE=live does).

export type DemoMode = 'fixture' | 'live';

export class SettingsError extends Error {}

export type ServerSettings = {
  readonly mode: DemoMode;
  readonly parallelApiKey: string;
  readonly parallelApiBaseUrl: string;
  readonly requestTimeoutMs: number;
  readonly webhookSecret: string;
  readonly blobToken: string;
  readonly redisUrl: string;
  readonly redisToken: string;
  readonly cronSecret: string;
  readonly publicBaseUrl: string;
  /** Largest estimated cost one research run may start (USD). */
  readonly maxRunCostUsd: number;
  /** Daily spend caps (USD). Viewers never see prices; these protect our key. */
  readonly budgets: { research: number; ask: number; followup: number; refresh: number };
  readonly perIpPerDay: { research: number; ask: number };
  readonly refreshMinViews: number;
  readonly maxRefreshedCompanies: number;
};

function num(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new SettingsError(`${name} must be a non-negative number (got "${raw}").`);
  return value;
}

export function serverSettings(env: NodeJS.ProcessEnv = process.env): ServerSettings {
  const rawMode = (env.DEMO_MODE ?? 'fixture').trim().toLowerCase();
  if (rawMode !== 'fixture' && rawMode !== 'live') throw new SettingsError(`DEMO_MODE must be "fixture" or "live" (got "${env.DEMO_MODE}").`);
  const mode: DemoMode = rawMode;

  const parallelApiKey = (env.PARALLEL_API_KEY ?? '').trim();
  if (mode === 'live' && !parallelApiKey) {
    throw new SettingsError('DEMO_MODE is "live" but PARALLEL_API_KEY is not set. Add it to .env.local or the Vercel project settings, or set DEMO_MODE=fixture.');
  }
  const parallelApiBaseUrl = (env.PARALLEL_API_BASE_URL ?? 'https://api.parallel.ai').trim();
  if (!parallelApiBaseUrl.startsWith('https://')) throw new SettingsError('PARALLEL_API_BASE_URL must be an absolute https:// URL.');

  return {
    mode,
    parallelApiKey,
    parallelApiBaseUrl,
    requestTimeoutMs: num(env, 'PARALLEL_REQUEST_TIMEOUT_MS', 120_000),
    webhookSecret: (env.PARALLEL_WEBHOOK_SECRET ?? '').trim(),
    blobToken: (env.BLOB_READ_WRITE_TOKEN ?? '').trim(),
    redisUrl: (env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL ?? '').trim(),
    redisToken: (env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN ?? '').trim(),
    cronSecret: (env.CRON_SECRET ?? '').trim(),
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? '').trim().replace(/\/$/, ''),
    maxRunCostUsd: num(env, 'MAX_RUN_COST_USD', 8),
    budgets: {
      research: num(env, 'RESEARCH_DAILY_BUDGET_USD', 15),
      ask: num(env, 'ASK_DAILY_BUDGET_USD', 5),
      followup: num(env, 'FOLLOWUP_DAILY_BUDGET_USD', 2),
      refresh: num(env, 'REFRESH_BUDGET_USD', 25),
    },
    perIpPerDay: { research: num(env, 'RESEARCH_PER_IP_PER_DAY', 2), ask: num(env, 'ASK_PER_IP_PER_DAY', 20) },
    refreshMinViews: num(env, 'REFRESH_MIN_VIEWS', 3),
    maxRefreshedCompanies: num(env, 'MAX_REFRESHED_COMPANIES', 12),
  };
}
