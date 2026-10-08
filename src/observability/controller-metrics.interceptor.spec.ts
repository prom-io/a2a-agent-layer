import { CallHandler, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import {
  CONTROLLER_DURATION_BUCKETS,
  ControllerMetricsInterceptor,
  controllerLabel,
  UNMATCHED_ROUTE,
} from './controller-metrics.interceptor';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

class CatalogController {
  findOne() {
    return undefined;
  }
}

class ProtocolController {
  handleRequest() {
    return undefined;
  }
}

describe('ControllerMetricsInterceptor', () => {
  let metrics: MetricsService;
  let interceptor: ControllerMetricsInterceptor;

  const contextFor = (
    controller: { new (): object; prototype: object },
    handler: string,
    req: Record<string, unknown>,
    statusCode = 200,
    type = 'http',
  ) =>
    ({
      getType: () => type,
      getClass: () => controller,
      getHandler: () => (controller.prototype as Record<string, unknown>)[handler],
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({ statusCode }),
      }),
    }) as unknown as ExecutionContext;

  const handlerOf = (value: unknown): CallHandler => ({ handle: () => of(value) });

  beforeEach(() => {
    metrics = new MetricsService();
    interceptor = new ControllerMetricsInterceptor(metrics);
  });

  afterEach(() => {
    metrics.onModuleDestroy();
  });

  it('labels the observation with controller, handler and route template', async () => {
    const context = contextFor(CatalogController, 'findOne', {
      method: 'GET',
      url: '/services/3f0c9c6e-1111-2222-3333-444455556666',
      route: { path: '/services/:id' },
    });

    await lastValueFrom(interceptor.intercept(context, handlerOf({ id: 'x' })));

    const body = await metrics.scrape();
    expect(body).toMatch(
      /http_controller_duration_seconds_count\{[^}]*controller="catalog",handler="findOne",method="GET",route="\/services\/:id",status="200"[^}]*\} 1/,
    );
    // The concrete id must never become a label value.
    expect(body).not.toContain('3f0c9c6e');
  });

  it('takes the status from the exception when the handler fails', async () => {
    const context = contextFor(ProtocolController, 'handleRequest', {
      method: 'POST',
      route: { path: '/a2a/request' },
    });
    const failing: CallHandler = {
      handle: () => throwError(() => new ForbiddenException('Policy denied')),
    };

    await expect(lastValueFrom(interceptor.intercept(context, failing))).rejects.toThrow('Policy denied');

    expect(await metrics.scrape()).toMatch(
      /http_controller_duration_seconds_count\{[^}]*controller="protocol",handler="handleRequest",method="POST",route="\/a2a\/request",status="403"[^}]*\} 1/,
    );
  });

  it('reports non-HTTP errors as 500', async () => {
    const context = contextFor(ProtocolController, 'handleRequest', { method: 'POST' });
    const failing: CallHandler = { handle: () => throwError(() => new Error('rpc down')) };

    await expect(lastValueFrom(interceptor.intercept(context, failing))).rejects.toThrow('rpc down');

    expect(await metrics.scrape()).toMatch(
      new RegExp(`route="${UNMATCHED_ROUTE}",status="500"`),
    );
  });

  it('skips the scrape handler and non-HTTP contexts', async () => {
    await lastValueFrom(
      interceptor.intercept(
        contextFor(MetricsController as never, 'scrape', { method: 'GET' }),
        handlerOf('ok'),
      ),
    );
    await lastValueFrom(
      interceptor.intercept(
        contextFor(CatalogController, 'findOne', { method: 'GET' }, 200, 'rpc'),
        handlerOf('ok'),
      ),
    );

    expect(await metrics.scrape()).not.toMatch(/http_controller_duration_seconds_count\{/);
  });

  it('uses buckets that resolve both fast reads and on-chain writes', async () => {
    expect(CONTROLLER_DURATION_BUCKETS[0]).toBeLessThanOrEqual(0.005);
    expect(CONTROLLER_DURATION_BUCKETS[CONTROLLER_DURATION_BUCKETS.length - 1]).toBeGreaterThanOrEqual(30);
    expect([...CONTROLLER_DURATION_BUCKETS].sort((a, b) => a - b)).toEqual(CONTROLLER_DURATION_BUCKETS);
  });
});

describe('controllerLabel', () => {
  it('strips the Controller suffix and lowercases', () => {
    expect(controllerLabel('CatalogController')).toBe('catalog');
    expect(controllerLabel('PricingController')).toBe('pricing');
    expect(controllerLabel('Controller')).toBe('controller');
  });
});
