import { DataSource } from 'typeorm';
import { Agent } from '../modules/identity/entities/agent.entity';
import { Service } from '../modules/catalog/entities/service.entity';
import { UsageRecord } from '../modules/metering/entities/usage-record.entity';
import { DomainGaugesService } from './domain-gauges.service';
import { MetricsService } from './metrics.service';

describe('DomainGaugesService', () => {
  let metrics: MetricsService;
  let queries: number;
  let fail: boolean;
  let agentRows: Array<{ status: string; count: string }>;
  let serviceRows: Array<{ status: string; count: string }>;
  let usageRow: { pending: string | null; rolledUp: string | null; lagSeconds: string | null };

  const queryBuilder = (result: () => unknown) => {
    const qb: Record<string, jest.Mock> = {};
    for (const method of ['select', 'addSelect', 'groupBy', 'innerJoin', 'leftJoin', 'where']) {
      qb[method] = jest.fn().mockReturnValue(qb);
    }
    const run = async () => {
      queries += 1;
      if (fail) throw new Error('connection terminated');
      return result();
    };
    qb.getRawMany = jest.fn(run);
    qb.getRawOne = jest.fn(run);
    return qb;
  };

  const dataSource = {
    getRepository: (entity: unknown) => ({
      createQueryBuilder: () => {
        if (entity === Agent) return queryBuilder(() => agentRows);
        if (entity === Service) return queryBuilder(() => serviceRows);
        if (entity === UsageRecord) return queryBuilder(() => usageRow);
        throw new Error('unexpected entity');
      },
    }),
  } as unknown as DataSource;

  beforeEach(() => {
    metrics = new MetricsService();
    queries = 0;
    fail = false;
    agentRows = [
      { status: 'active', count: '7' },
      { status: 'inactive', count: '2' },
    ];
    serviceRows = [{ status: 'active', count: '11' }];
    usageRow = { pending: '5', rolledUp: '40', lagSeconds: '1800.5' };
  });

  afterEach(() => {
    metrics.onModuleDestroy();
    delete process.env.DOMAIN_METRICS_TTL_MS;
  });

  it('exposes agents, services and usage records by status on scrape', async () => {
    new DomainGaugesService(metrics, dataSource);

    const body = await metrics.scrape();

    expect(body).toMatch(/agent_layer_agents\{status="active"[^}]*\} 7/);
    expect(body).toMatch(/agent_layer_agents\{status="inactive"[^}]*\} 2/);
    expect(body).toMatch(/agent_layer_services\{status="active"[^}]*\} 11/);
    expect(body).toMatch(/agent_layer_usage_records\{status="pending"[^}]*\} 5/);
    expect(body).toMatch(/agent_layer_usage_records\{status="rolled_up"[^}]*\} 40/);
    expect(body).toMatch(/agent_layer_metering_lag_seconds\{[^}]*\} 1800\.5/);
  });

  it('reports a status with no rows as zero rather than omitting it', async () => {
    new DomainGaugesService(metrics, dataSource);

    const body = await metrics.scrape();

    expect(body).toMatch(/agent_layer_services\{status="inactive"[^}]*\} 0/);
  });

  it('resets a status that drops to zero between refreshes', async () => {
    const gauges = new DomainGaugesService(metrics, dataSource);
    await gauges.refresh(1_000);

    agentRows = [{ status: 'active', count: '9' }];
    await gauges.refresh(1_000 + 60_000);

    const body = await metrics.scrape();
    expect(body).toMatch(/agent_layer_agents\{status="active"[^}]*\} 9/);
    expect(body).toMatch(/agent_layer_agents\{status="inactive"[^}]*\} 0/);
  });

  it('reports zero lag when nothing is pending', async () => {
    usageRow = { pending: null, rolledUp: '0', lagSeconds: null };
    new DomainGaugesService(metrics, dataSource);

    const body = await metrics.scrape();

    expect(body).toMatch(/agent_layer_usage_records\{status="pending"[^}]*\} 0/);
    expect(body).toMatch(/agent_layer_metering_lag_seconds\{[^}]*\} 0/);
  });

  it('caches the database read for the TTL', async () => {
    process.env.DOMAIN_METRICS_TTL_MS = '10000';
    const gauges = new DomainGaugesService(metrics, dataSource);

    await gauges.refresh(50_000);
    await gauges.refresh(55_000);
    expect(queries).toBe(3);

    await gauges.refresh(61_000);
    expect(queries).toBe(6);
  });

  it('shares one round of queries between concurrent scrapes', async () => {
    const gauges = new DomainGaugesService(metrics, dataSource);

    await Promise.all([gauges.refresh(1), gauges.refresh(1), gauges.refresh(1)]);

    expect(queries).toBe(3);
  });

  it('keeps the scrape and the previous values alive when the database is down', async () => {
    const gauges = new DomainGaugesService(metrics, dataSource);
    await gauges.refresh(1_000);

    fail = true;
    await expect(gauges.refresh(100_000)).resolves.toBeUndefined();

    const body = await metrics.scrape();
    expect(body).toMatch(/agent_layer_agents\{status="active"[^}]*\} 7/);
    expect(body).toMatch(/agent_layer_domain_metrics_refresh_errors_total\{[^}]*\} [1-9]/);
    expect(body).toContain('agent_layer_process_cpu_user_seconds_total');
  });
});
