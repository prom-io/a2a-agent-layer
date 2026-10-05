import { METRICS_PREFIX, MetricsService, normalizeMethod } from './metrics.service';
import { MetricsController } from './metrics.controller';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('exposes prefixed process and runtime metrics', async () => {
    const body = await service.scrape();

    expect(body).toContain(`${METRICS_PREFIX}process_cpu_user_seconds_total`);
    expect(body).toContain(`${METRICS_PREFIX}nodejs_eventloop_lag_seconds`);
    expect(body).toContain(`${METRICS_PREFIX}process_resident_memory_bytes`);
  });

  it('counts requests and records their duration by method and status', async () => {
    service.observeHttpRequest('GET', 200, 0.02);
    service.observeHttpRequest('GET', 200, 0.3);
    service.observeHttpRequest('post', 403, 0.004);

    const body = await service.scrape();

    expect(body).toMatch(/http_requests_total\{method="GET",status="200",[^}]*\} 2/);
    expect(body).toMatch(/http_requests_total\{method="POST",status="403",[^}]*\} 1/);
    expect(body).toMatch(
      /http_request_duration_seconds_bucket\{le="0\.025",[^}]*method="GET",status="200"\} 1/,
    );
    expect(body).toMatch(/http_request_duration_seconds_count\{[^}]*method="GET",status="200"\} 2/);
    expect(body).toContain('service="a2a-agent-layer"');
  });

  it('collapses unknown methods so a client cannot mint label values', () => {
    expect(normalizeMethod('get')).toBe('GET');
    expect(normalizeMethod('PROPFIND')).toBe('OTHER');
    expect(normalizeMethod(undefined)).toBe('OTHER');
  });

  it('keeps separate registries per instance', async () => {
    const other = new MetricsService();
    other.observeHttpRequest('GET', 200, 0.01);

    expect(await service.scrape()).not.toMatch(/http_requests_total\{/);
    other.onModuleDestroy();
  });
});

describe('MetricsController', () => {
  it('serves the exposition format with the Prometheus content type', async () => {
    const service = new MetricsService();
    const controller = new MetricsController(service);
    const res = { setHeader: jest.fn(), send: jest.fn() };

    await controller.scrape(res as unknown as Parameters<MetricsController['scrape']>[0]);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      expect.stringContaining('text/plain; version=0.0.4'),
    );
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('# TYPE http_requests_total counter'));
    service.onModuleDestroy();
  });
});
