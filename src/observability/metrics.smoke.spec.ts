import { readFileSync } from 'fs';
import { join } from 'path';
import {
  Controller,
  ForbiddenException,
  Get,
  Global,
  INestApplication,
  Module,
  Param,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { BusinessMetricsService } from './business-metrics.service';
import { MetricsModule } from './metrics.module';

/**
 * Smoke test for the metrics pipeline as a whole: a real Nest application with
 * the real MetricsModule, real HTTP requests, and a real scrape of /metrics.
 * Only the database behind the domain gauges is faked.
 *
 * The unit specs next to each class cover the details; this one fails when the
 * pieces stop being wired together (a middleware not applied, an interceptor
 * not registered, a series renamed without updating the dashboard).
 */

@Controller('services')
class CatalogController {
  @Get()
  list() {
    return [];
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    if (id === 'forbidden') throw new ForbiddenException('Policy denied');
    return { id };
  }
}

const rowsByAlias: Record<string, unknown> = {
  a: [
    { status: 'active', count: '3' },
    { status: 'inactive', count: '1' },
  ],
  s: [{ status: 'active', count: '5' }],
  u: { pending: '2', rolledUp: '9', lagSeconds: '120' },
};

const fakeDataSource = {
  getRepository: () => ({
    createQueryBuilder: (alias: string) => {
      const qb: Record<string, unknown> = {};
      for (const method of ['select', 'addSelect', 'groupBy', 'innerJoin', 'leftJoin', 'where']) {
        qb[method] = () => qb;
      }
      qb.getRawMany = async () => rowsByAlias[alias];
      qb.getRawOne = async () => rowsByAlias[alias];
      return qb;
    },
  }),
};

@Global()
@Module({
  providers: [{ provide: getDataSourceToken(), useValue: fakeDataSource }],
  exports: [getDataSourceToken()],
})
class FakeDatabaseModule {}

describe('metrics smoke', () => {
  let app: INestApplication;
  let body: string;
  let contentType: string;

  const seriesNames = () =>
    new Set(
      body
        .split('\n')
        .filter((line) => line.startsWith('# TYPE '))
        .map((line) => line.split(' ')[2]),
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeDatabaseModule, MetricsModule],
      controllers: [CatalogController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    const server = app.getHttpServer();

    await request(server).get('/services').expect(200);
    await request(server).get('/services/3f0c9c6e-aaaa-bbbb-cccc-000000000001').expect(200);
    await request(server).get('/services/forbidden').expect(403);
    await request(server).get('/no-such-route').expect(404);

    const business = app.get(BusinessMetricsService);
    business.recordPolicyDecision('deny', 'subject on denylist');
    business.recordRollupRun('success', 2);

    // Scraped twice: the second response must not have counted the first.
    await request(server).get('/metrics').expect(200);
    const scrape = await request(server).get('/metrics').expect(200);
    body = scrape.text;
    contentType = scrape.headers['content-type'];
    // Boots a Nest application and makes real HTTP requests; the default 5s
    // hook timeout is too tight on a busy CI runner.
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('serves the Prometheus text exposition format', () => {
    expect(contentType).toContain('text/plain');
    expect(contentType).toContain('version=0.0.4');
    expect(body).toContain('# HELP http_requests_total');
  });

  it('exposes process and runtime series', () => {
    expect(body).toMatch(/^agent_layer_process_cpu_seconds_total\{/m);
    expect(body).toMatch(/^agent_layer_process_resident_memory_bytes\{/m);
    expect(body).toMatch(/^agent_layer_nodejs_eventloop_lag_seconds\{/m);
  });

  it('counts every request by method and status, including unrouted ones', () => {
    expect(body).toMatch(/^http_requests_total\{method="GET",status="200"[^}]*\} 2$/m);
    expect(body).toMatch(/^http_requests_total\{method="GET",status="403"[^}]*\} 1$/m);
    expect(body).toMatch(/^http_requests_total\{method="GET",status="404"[^}]*\} 1$/m);
    expect(body).toMatch(/^http_request_duration_seconds_bucket\{le="\+Inf"[^}]*status="200"\} 2$/m);
    expect(body).toMatch(/^http_requests_in_flight\{[^}]*\} 0$/m);
  });

  it('records handler latency per controller and route template', () => {
    expect(body).toMatch(
      /^http_controller_duration_seconds_count\{[^}]*controller="catalog",handler="list",method="GET",route="\/services",status="200"[^}]*\} 1$/m,
    );
    expect(body).toMatch(
      /^http_controller_duration_seconds_count\{[^}]*handler="findOne",method="GET",route="\/services\/:id",status="403"[^}]*\} 1$/m,
    );
    expect(body).not.toContain('3f0c9c6e');
    expect(body).not.toContain('no-such-route');
  });

  it('does not count the scrapes themselves', () => {
    expect(body).not.toContain('route="/metrics"');
    const total = Array.from(body.matchAll(/^http_requests_total\{[^}]*\} (\d+)$/gm)).reduce(
      (sum, match) => sum + Number(match[1]),
      0,
    );
    expect(total).toBe(4);
  });

  it('exposes the domain gauges by status', () => {
    expect(body).toMatch(/^agent_layer_agents\{status="active"[^}]*\} 3$/m);
    expect(body).toMatch(/^agent_layer_agents\{status="inactive"[^}]*\} 1$/m);
    expect(body).toMatch(/^agent_layer_services\{status="active"[^}]*\} 5$/m);
    expect(body).toMatch(/^agent_layer_usage_records\{status="pending"[^}]*\} 2$/m);
    expect(body).toMatch(/^agent_layer_usage_records\{status="rolled_up"[^}]*\} 9$/m);
    expect(body).toMatch(/^agent_layer_metering_lag_seconds\{[^}]*\} 120$/m);
  });

  it('exposes the series the alert rules are written against', () => {
    expect(body).toMatch(
      /^agent_layer_policy_decisions_total\{decision="deny",reason="subject_on_denylist"[^}]*\} 1$/m,
    );
    expect(body).toMatch(/^agent_layer_metering_rollup_runs_total\{result="success"[^}]*\} 1$/m);
    expect(body).toMatch(/^agent_layer_metering_rollup_last_success_timestamp_seconds\{[^}]*\} \d{10}$/m);
    expect(body).toMatch(/^agent_layer_domain_metrics_refresh_errors_total\{[^}]*\} 0$/m);
  });

  it('labels every series with the service name', () => {
    const samples = body.split('\n').filter((line) => line && !line.startsWith('#'));

    expect(samples.length).toBeGreaterThan(50);
    expect(samples.every((line) => line.includes('service="a2a-agent-layer"'))).toBe(true);
  });

  it('exposes every series the Grafana dashboard queries', () => {
    const dashboard = readFileSync(
      join(__dirname, '..', '..', 'grafana', 'agent-request-throughput.json'),
      'utf8',
    );
    const exposed = seriesNames();
    const queried = new Set(
      (dashboard.match(/\b(?:agent_layer|http)_[a-z0-9_]+/g) ?? []).map((name) =>
        name.replace(/_(bucket|count|sum)$/, ''),
      ),
    );

    expect(queried.size).toBeGreaterThan(10);
    expect(Array.from(queried).filter((name) => !exposed.has(name))).toEqual([]);
  });
});
