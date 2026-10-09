import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Counter, Gauge } from 'prom-client';
import { DataSource } from 'typeorm';
import { Agent, AgentStatus } from '../modules/identity/entities/agent.entity';
import { Service } from '../modules/catalog/entities/service.entity';
import { UsageRecord } from '../modules/metering/entities/usage-record.entity';
import { UsageRollup } from '../modules/metering/entities/usage-rollup.entity';
import { METRICS_PREFIX, MetricsService } from './metrics.service';

export const USAGE_STATUSES = ['pending', 'rolled_up'] as const;

interface StatusCount {
  status: string;
  count: string;
}

interface UsageRow {
  pending: string | null;
  rolledUp: string | null;
  lagSeconds: string | null;
}

/**
 * Domain state as gauges: how many agents, catalog services and usage records
 * exist in each status.
 *
 * Read from the database on scrape instead of being incremented from the
 * services. A counter kept in memory drifts as soon as there is a second
 * replica or a restart, while a scrape-time read is correct by construction.
 * The read is cached for a short TTL so an aggressive scrape interval cannot
 * turn into query load.
 */
@Injectable()
export class DomainGaugesService {
  private readonly logger = new Logger(DomainGaugesService.name);
  private readonly ttlMs: number;
  private readonly usageWindowHours: number;
  private lastRefreshAt = 0;
  private inFlight?: Promise<void>;

  private readonly agents: Gauge<'status'>;
  private readonly services: Gauge<'status'>;
  private readonly usageRecords: Gauge<'status'>;
  private readonly meteringLag: Gauge<string>;
  private readonly refreshErrors: Counter<string>;

  constructor(
    metrics: MetricsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    this.ttlMs = positiveInt(process.env.DOMAIN_METRICS_TTL_MS, 15_000);
    this.usageWindowHours = positiveInt(process.env.DOMAIN_METRICS_USAGE_WINDOW_HOURS, 24);

    const registers = [metrics.registry];
    this.agents = new Gauge({
      name: `${METRICS_PREFIX}agents`,
      help: 'Registered agents by status',
      labelNames: ['status'] as const,
      registers,
    });
    this.services = new Gauge({
      name: `${METRICS_PREFIX}services`,
      help: 'Catalog services by status of the owning agent (inactive = delisted with its agent)',
      labelNames: ['status'] as const,
      registers,
    });
    this.usageRecords = new Gauge({
      name: `${METRICS_PREFIX}usage_records`,
      help: 'Usage records in the recent window by rollup status (pending = not yet in an hourly rollup)',
      labelNames: ['status'] as const,
      registers,
    });
    this.meteringLag = new Gauge({
      name: `${METRICS_PREFIX}metering_lag_seconds`,
      help: 'Age of the oldest usage record in the recent window that no hourly rollup covers',
      registers,
    });
    this.refreshErrors = new Counter({
      name: `${METRICS_PREFIX}domain_metrics_refresh_errors_total`,
      help: 'Failed attempts to refresh the domain gauges from the database',
      registers,
    });

    metrics.registerCollector(() => this.refresh());
  }

  /**
   * Reloads the gauges unless they were loaded within the TTL.
   *
   * Never rejects: when the database is unreachable the previous values stay
   * in place and the error counter moves, so the scrape (and with it every
   * other series) still succeeds.
   */
  async refresh(now: number = Date.now()): Promise<void> {
    if (this.lastRefreshAt !== 0 && now - this.lastRefreshAt < this.ttlMs) return;
    // Concurrent scrapes share one round of queries.
    if (!this.inFlight) {
      this.inFlight = this.load()
        .then(() => {
          this.lastRefreshAt = now;
        })
        .catch((error: unknown) => {
          this.refreshErrors.inc();
          this.logger.warn(
            `Domain gauges refresh failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        })
        .finally(() => {
          this.inFlight = undefined;
        });
    }
    await this.inFlight;
  }

  private async load(): Promise<void> {
    const [agentRows, serviceRows, usage] = await Promise.all([
      this.dataSource
        .getRepository(Agent)
        .createQueryBuilder('a')
        .select('a.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('a.status')
        .getRawMany<StatusCount>(),
      // Cast on both sides: the id is a uuid and the reference column is
      // declared as a plain string on the entity.
      this.dataSource
        .getRepository(Service)
        .createQueryBuilder('s')
        .innerJoin(Agent, 'a', 'CAST(a.id AS text) = CAST(s.agentId AS text)')
        .select('a.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('a.status')
        .getRawMany<StatusCount>(),
      // Bounded to a recent window so the join stays cheap however large the
      // usage table grows. All time arithmetic happens in the database, which
      // is also what stamped createdAt.
      this.dataSource
        .getRepository(UsageRecord)
        .createQueryBuilder('u')
        .leftJoin(
          UsageRollup,
          'r',
          "CAST(r.agentId AS text) = CAST(u.agentId AS text) AND r.hourBucket = date_trunc('hour', u.createdAt)",
        )
        .select('SUM(CASE WHEN r.id IS NULL THEN 1 ELSE 0 END)', 'pending')
        .addSelect('COUNT(r.id)', 'rolledUp')
        .addSelect(
          'EXTRACT(EPOCH FROM (now() - MIN(CASE WHEN r.id IS NULL THEN u.createdAt END)))',
          'lagSeconds',
        )
        .where('u.createdAt >= now() - make_interval(hours => :hours)', {
          hours: this.usageWindowHours,
        })
        .getRawOne<UsageRow>(),
    ]);

    this.setByStatus(this.agents, Object.values(AgentStatus), agentRows);
    this.setByStatus(this.services, Object.values(AgentStatus), serviceRows);

    this.usageRecords.set({ status: 'pending' }, Number(usage?.pending ?? 0));
    this.usageRecords.set({ status: 'rolled_up' }, Number(usage?.rolledUp ?? 0));
    this.meteringLag.set(Math.max(0, Number(usage?.lagSeconds ?? 0)));
  }

  private setByStatus(gauge: Gauge<'status'>, known: string[], rows: StatusCount[]): void {
    // Known statuses are always written, so a status that drops to zero is
    // reported as 0 instead of keeping its last non-zero value.
    const counts = new Map(known.map((status) => [status, 0]));
    for (const row of rows) counts.set(row.status, Number(row.count));
    for (const [status, count] of counts) gauge.set({ status }, count);
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
