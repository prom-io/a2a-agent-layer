import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BlockchainService } from '../../common/blockchain/blockchain.service';

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
  checks: {
    database: { status: string; latencyMs?: number; error?: string };
  };
}

export type DependencyState = 'up' | 'down';

export interface DependencyHealth {
  name: string;
  status: DependencyState;
  latencyMs: number;
  /** Whether the service can still answer requests without this dependency. */
  critical: boolean;
  details?: Record<string, unknown>;
  error?: string;
}

export interface HealthDetail {
  status: 'ok' | 'degraded' | 'down';
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
  dependencies: DependencyHealth[];
}

const DEFAULT_CHECK_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();

  constructor(
    private readonly dataSource: DataSource,
    private readonly blockchainService: BlockchainService,
  ) {}

  async check(): Promise<HealthStatus> {
    const dbCheck = await this.checkDatabase();

    return {
      status: dbCheck.status === 'up' ? 'ok' : 'degraded',
      service: 'a2a-agent-layer',
      version: process.env.npm_package_version ?? '0.1.0',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      checks: {
        database: dbCheck,
      },
    };
  }

  /**
   * Probes every dependency in parallel and reports how long each took.
   *
   * `down` only when a critical dependency (the database) fails; a failing
   * RPC node leaves the service `degraded`, because catalog, pricing and
   * policy reads keep working and only on-chain registration is affected.
   */
  async detail(): Promise<HealthDetail> {
    const timeoutMs = checkTimeoutMs();
    const dependencies = await Promise.all([
      this.probe('database', true, timeoutMs, async () => {
        await this.dataSource.query('SELECT 1');
        return undefined;
      }),
      this.probe('blockchain', false, timeoutMs, async () => ({
        blockNumber: await this.blockchainService.getProvider().getBlockNumber(),
      })),
    ]);

    const failed = dependencies.filter((dep) => dep.status === 'down');
    const status = failed.some((dep) => dep.critical)
      ? 'down'
      : failed.length > 0
        ? 'degraded'
        : 'ok';

    return {
      status,
      service: 'a2a-agent-layer',
      version: process.env.npm_package_version ?? '0.1.0',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      dependencies,
    };
  }

  async readiness(): Promise<{ ready: boolean }> {
    try {
      await this.dataSource.query('SELECT 1');
      return { ready: true };
    } catch {
      return { ready: false };
    }
  }

  private async probe(
    name: string,
    critical: boolean,
    timeoutMs: number,
    check: () => Promise<Record<string, unknown> | undefined>,
  ): Promise<DependencyHealth> {
    const startedAt = process.hrtime.bigint();
    const elapsedMs = () => Math.round(Number(process.hrtime.bigint() - startedAt) / 1e4) / 100;
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      // A hung dependency must not hang the health endpoint with it: the
      // probe is abandoned after the timeout and reported as down.
      const details = await Promise.race([
        check(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
      return { name, status: 'up', latencyMs: elapsedMs(), critical, ...(details ? { details } : {}) };
    } catch (error) {
      const message = describeError(error);
      this.logger.warn(`Health probe "${name}" failed: ${message}`);
      return { name, status: 'down', latencyMs: elapsedMs(), critical, error: message };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async checkDatabase(): Promise<{ status: string; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'up', latencyMs: Date.now() - start };
    } catch (error) {
      this.logger.warn('Database health check failed', error);
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// A refused connection surfaces from Node as an AggregateError with an empty
// message; fall back to the error code so the probe never reports "".
function describeError(error: unknown): string {
  const candidate = error as { message?: unknown; code?: unknown; name?: unknown } | null;
  for (const value of [candidate?.message, candidate?.code, candidate?.name]) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return 'Unknown error';
}

function checkTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CHECK_TIMEOUT_MS;
}
