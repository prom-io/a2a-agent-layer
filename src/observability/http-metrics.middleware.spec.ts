import { EventEmitter } from 'events';
import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { MetricsService } from './metrics.service';

type Req = Parameters<HttpMetricsMiddleware['use']>[0];
type Res = Parameters<HttpMetricsMiddleware['use']>[1];

describe('HttpMetricsMiddleware', () => {
  let metrics: MetricsService;
  let middleware: HttpMetricsMiddleware;

  const response = (statusCode = 200) => {
    const res = new EventEmitter() as EventEmitter & { statusCode: number; writableEnded: boolean };
    res.statusCode = statusCode;
    res.writableEnded = false;
    return res;
  };

  const inFlight = async () => (await metrics.httpInFlight.get()).values[0]?.value ?? 0;

  beforeEach(() => {
    metrics = new MetricsService();
    middleware = new HttpMetricsMiddleware(metrics);
  });

  afterEach(() => {
    metrics.onModuleDestroy();
  });

  it('records the request when the response finishes', async () => {
    const res = response(201);
    const next = jest.fn();

    middleware.use({ method: 'POST', originalUrl: '/a2a/request' } as Req, res as unknown as Res, next);

    expect(next).toHaveBeenCalled();
    expect(await inFlight()).toBe(1);

    res.writableEnded = true;
    res.emit('finish');
    res.emit('close');

    expect(await inFlight()).toBe(0);
    const counter = await metrics.httpRequests.get();
    expect(counter.values).toEqual([
      expect.objectContaining({ labels: { method: 'POST', status: '201' }, value: 1 }),
    ]);
  });

  it('sees requests rejected before any controller runs', async () => {
    const res = response(429);

    middleware.use({ method: 'GET', originalUrl: '/services?limit=5' } as Req, res as unknown as Res, jest.fn());
    res.writableEnded = true;
    res.emit('finish');

    const body = await metrics.scrape();
    expect(body).toMatch(/http_requests_total\{method="GET",status="429",[^}]*\} 1/);
  });

  it('records an aborted request as 499 exactly once', async () => {
    const res = response(200);

    middleware.use({ method: 'GET', originalUrl: '/services' } as Req, res as unknown as Res, jest.fn());
    res.emit('close');
    res.emit('close');

    const counter = await metrics.httpRequests.get();
    expect(counter.values).toEqual([
      expect.objectContaining({ labels: { method: 'GET', status: '499' }, value: 1 }),
    ]);
    expect(await inFlight()).toBe(0);
  });

  it('does not count the scrape itself', async () => {
    const res = response(200);
    const next = jest.fn();

    middleware.use({ method: 'GET', originalUrl: '/metrics' } as Req, res as unknown as Res, next);
    res.emit('finish');

    expect(next).toHaveBeenCalled();
    expect((await metrics.httpRequests.get()).values).toHaveLength(0);
  });
});
