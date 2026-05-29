import { Injectable, Logger, ConflictException, OnModuleDestroy } from '@nestjs/common';

interface NonceEntry {
  seenAt: number;
}

export interface NonceStoreOptions {
  windowMs?: number;
  evictionIntervalMs?: number;
}

@Injectable()
export class NonceStoreService implements OnModuleDestroy {
  private readonly logger = new Logger(NonceStoreService.name);
  private readonly entries = new Map<string, NonceEntry>();
  private readonly windowMs: number;
  private evictionTimer?: ReturnType<typeof setInterval>;

  constructor(options: NonceStoreOptions = {}) {
    this.windowMs = options.windowMs ?? 5 * 60 * 1000;
    const evictionIntervalMs = options.evictionIntervalMs ?? 60 * 1000;
    this.evictionTimer = setInterval(() => this.evictExpired(), evictionIntervalMs);
  }

  /**
   * Register a nonce scoped to an agent. Rejects duplicates within the replay window.
   */
  assertFresh(agentId: string, nonce: string): void {
    this.evictExpired();
    const key = `${agentId}:${nonce}`;
    if (this.entries.has(key)) {
      this.logger.warn(`Replay rejected: agent=${agentId}, nonce=${nonce}`);
      throw new ConflictException('Request nonce already used within replay window');
    }
    this.entries.set(key, { seenAt: Date.now() });
  }

  /** Visible for tests — count of tracked nonces after eviction. */
  size(): number {
    this.evictExpired();
    return this.entries.size;
  }

  onModuleDestroy(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
    }
  }

  private evictExpired(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, entry] of this.entries) {
      if (entry.seenAt < cutoff) {
        this.entries.delete(key);
      }
    }
  }
}
