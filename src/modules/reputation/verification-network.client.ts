import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** The figures the agent layer keeps from a verification network reputation view. */
export interface RemoteReputation {
  entityId: string;
  score: number;
  accuracy: number | null;
  uptime: number | null;
  disputeLossRate: number | null;
  totalJobs: number;
  updatedAt: Date | null;
}

export class VerificationNetworkError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'VerificationNetworkError';
  }
}

/** Accepts 0..1 as a number or a numeric string (Postgres decimals arrive as strings). */
function fraction(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return null;
  return parsed >= 0 && parsed <= 1 ? parsed : null;
}

/**
 * Reads `GET /reputation/:entityId` of the verification network and validates
 * the answer. The score used is `effectiveScore` (time-decayed), falling back
 * to `rawScore` for older deployments that do not decay.
 */
export function parseReputation(entityId: string, body: unknown): RemoteReputation {
  if (!body || typeof body !== 'object') {
    throw new VerificationNetworkError(`Reputation for ${entityId} is not an object`);
  }
  const view = body as Record<string, unknown>;
  const score = fraction(view.effectiveScore) ?? fraction(view.rawScore);
  if (score === null) {
    throw new VerificationNetworkError(`Reputation for ${entityId} has no score in 0..1`);
  }
  const totalJobs = Number(view.totalJobs ?? 0);
  const updated = typeof view.lastUpdated === 'string' ? new Date(view.lastUpdated) : null;
  return {
    entityId,
    score,
    accuracy: fraction(view.accuracy),
    uptime: fraction(view.uptime),
    disputeLossRate: fraction(view.disputeLossRate),
    totalJobs: Number.isInteger(totalJobs) && totalJobs >= 0 ? totalJobs : 0,
    updatedAt: updated && !Number.isNaN(updated.getTime()) ? updated : null,
  };
}

@Injectable()
export class VerificationNetworkClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiKeyHeader: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('reputation.baseUrl', '');
    this.apiKey = config.get<string>('reputation.apiKey', '');
    this.apiKeyHeader = config.get<string>('reputation.apiKeyHeader', 'x-api-key');
    this.timeoutMs = config.get<number>('reputation.timeoutMs', 5_000);
  }

  get configured(): boolean {
    return this.baseUrl.length > 0;
  }

  /** null when the network has no reputation for the agent yet (404). */
  async fetchReputation(agentDid: string): Promise<RemoteReputation | null> {
    if (!this.configured) {
      throw new VerificationNetworkError('VERIFICATION_NETWORK_URL is not configured');
    }
    const url = `${this.baseUrl}/reputation/${encodeURIComponent(agentDid)}`;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.apiKey) headers[this.apiKeyHeader] = this.apiKey;

    let response: Response;
    try {
      response = await fetch(url, {
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new VerificationNetworkError(
        `Reputation request for ${agentDid} failed: ${(error as Error).message}`,
      );
    }

    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new VerificationNetworkError(
        `Verification network answered ${response.status} for ${agentDid}`,
        response.status,
      );
    }
    return parseReputation(agentDid, await response.json());
  }
}
