import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsageRecord } from './entities/usage-record.entity';
import { UsageRollup } from './entities/usage-rollup.entity';

function truncateToHour(date: Date): Date {
  const bucket = new Date(date);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket;
}

@Injectable()
export class MeteringRollupJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeteringRollupJob.name);
  private intervalHandle?: ReturnType<typeof setInterval>;

  constructor(
    @InjectRepository(UsageRecord)
    private readonly usageRepo: Repository<UsageRecord>,
    @InjectRepository(UsageRollup)
    private readonly rollupRepo: Repository<UsageRollup>,
  ) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.METERING_ROLLUP_INTERVAL_MS ?? 3_600_000);
    this.intervalHandle = setInterval(() => {
      void this.runHourlyRollup().catch((err) =>
        this.logger.error('Hourly metering rollup failed', err),
      );
    }, intervalMs);
    this.logger.log(`Metering rollup job scheduled every ${intervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }
  }

  /**
   * Aggregate usage_records into hourly rollups with ON CONFLICT upsert semantics.
   */
  async runHourlyRollup(referenceDate: Date = new Date()): Promise<number> {
    const hourBucket = truncateToHour(referenceDate);
    const hourEnd = new Date(hourBucket.getTime() + 3_600_000);

    const aggregates = await this.usageRepo
      .createQueryBuilder('u')
      .select('u.agentId', 'agentId')
      .addSelect('COUNT(*)', 'requestCount')
      .addSelect('COALESCE(SUM(u.tokensUsed), 0)', 'tokensUsed')
      .addSelect('COALESCE(SUM(u.bytesIn::bigint), 0)', 'bytesIn')
      .addSelect('COALESCE(SUM(u.bytesOut::bigint), 0)', 'bytesOut')
      .addSelect('COALESCE(SUM(u.cpuMs), 0)', 'cpuMs')
      .where('u.createdAt >= :hourBucket AND u.createdAt < :hourEnd', {
        hourBucket,
        hourEnd,
      })
      .groupBy('u.agentId')
      .getRawMany<{
        agentId: string;
        requestCount: string;
        tokensUsed: string;
        bytesIn: string;
        bytesOut: string;
        cpuMs: string;
      }>();

    if (aggregates.length === 0) {
      return 0;
    }

    for (const row of aggregates) {
      await this.rollupRepo
        .createQueryBuilder()
        .insert()
        .into(UsageRollup)
        .values({
          agentId: row.agentId,
          hourBucket,
          requestCount: Number(row.requestCount),
          tokensUsed: row.tokensUsed,
          bytesIn: row.bytesIn,
          bytesOut: row.bytesOut,
          cpuMs: Number(row.cpuMs),
        })
        .orUpdate(
          ['requestCount', 'tokensUsed', 'bytesIn', 'bytesOut', 'cpuMs', 'updatedAt'],
          ['agentId', 'hourBucket'],
        )
        .execute();
    }

    this.logger.log(
      `Metering rollup upserted ${aggregates.length} agent buckets for ${hourBucket.toISOString()}`,
    );
    return aggregates.length;
  }
}
