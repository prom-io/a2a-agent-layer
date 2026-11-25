import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReputationService } from './reputation.service';
import { VerificationNetworkClient } from './verification-network.client';

/**
 * Periodic pull of agent reputation. Off when the verification network is
 * not configured or REPUTATION_SYNC_INTERVAL_MS is 0. The timer is unref'd so
 * it never keeps a test run or a shutting-down process alive.
 */
@Injectable()
export class ReputationSyncJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReputationSyncJob.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly reputation: ReputationService,
    private readonly client: VerificationNetworkClient,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>('reputation.syncIntervalMs', 900_000);
    if (!this.client.configured || intervalMs <= 0) {
      this.logger.log('Reputation sync is off (no VERIFICATION_NETWORK_URL or interval 0)');
      return;
    }
    this.timer = setInterval(() => {
      this.reputation
        .syncAll()
        .catch((error: Error) => this.logger.error(`Reputation sync failed: ${error.message}`));
    }, intervalMs);
    this.timer.unref();
    this.logger.log(`Reputation sync scheduled every ${intervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
