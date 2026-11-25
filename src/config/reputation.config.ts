import { registerAs } from '@nestjs/config';

function intFromEnv(raw: string | undefined, fallback: number, min: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

/**
 * Where agent reputation comes from. The verification network owns the
 * scores; this service keeps snapshots of them so catalog ranking does not
 * depend on the network being reachable at query time.
 */
export const reputationConfig = registerAs('reputation', () => ({
  // Empty disables syncing; the catalog then ranks without reputation.
  baseUrl: (process.env.VERIFICATION_NETWORK_URL ?? '').replace(/\/+$/, ''),
  // Service API key issued by the verification network (its API_KEYS).
  apiKey: process.env.VERIFICATION_NETWORK_API_KEY ?? '',
  apiKeyHeader: process.env.VERIFICATION_NETWORK_API_KEY_HEADER ?? 'x-api-key',
  timeoutMs: intFromEnv(process.env.REPUTATION_FETCH_TIMEOUT_MS, 5_000, 100),
  // 0 turns the periodic sync off; POST /reputation/sync still works.
  syncIntervalMs: intFromEnv(process.env.REPUTATION_SYNC_INTERVAL_MS, 900_000, 0),
  // Agents fetched per database page during a sync.
  batchSize: intFromEnv(process.env.REPUTATION_SYNC_BATCH_SIZE, 100, 1),
}));
