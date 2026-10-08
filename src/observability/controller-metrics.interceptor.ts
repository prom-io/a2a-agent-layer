import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Histogram } from 'prom-client';
import { Observable, tap } from 'rxjs';
import { MetricsService, normalizeMethod } from './metrics.service';
import { MetricsController } from './metrics.controller';

export const UNMATCHED_ROUTE = 'unmatched';

/**
 * Bucket layout for handler latency.
 *
 * Wider than the transport-level histogram on purpose: catalog and tariff
 * reads answer in single-digit milliseconds, while agent registration waits
 * for an on-chain receipt and legitimately takes tens of seconds. One layout
 * has to resolve both ends.
 */
export const CONTROLLER_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60,
];

/**
 * Times every controller handler and labels the observation with the endpoint
 * it belongs to.
 *
 * The `route` label is the route template (`/services/:id`), never the
 * concrete URL, so the number of series is bounded by the number of handlers
 * and not by the number of agents or sessions.
 */
@Injectable()
export class ControllerMetricsInterceptor implements NestInterceptor {
  private readonly duration: Histogram<'controller' | 'handler' | 'method' | 'route' | 'status'>;

  constructor(metrics: MetricsService) {
    this.duration = new Histogram({
      name: 'http_controller_duration_seconds',
      help: 'Controller handler duration in seconds, by controller, handler and route template',
      labelNames: ['controller', 'handler', 'method', 'route', 'status'] as const,
      buckets: CONTROLLER_DURATION_BUCKETS,
      registers: [metrics.registry],
    });
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // The scrape handler is excluded for the same reason the middleware skips
    // it; non-HTTP contexts have no route to label.
    if (context.getType() !== 'http' || context.getClass() === MetricsController) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<{ method?: string; route?: { path?: string } }>();
    const labels = {
      controller: controllerLabel(context.getClass().name),
      handler: context.getHandler().name,
      method: normalizeMethod(req.method),
      route: req.route?.path ?? UNMATCHED_ROUTE,
    };
    const end = this.duration.startTimer(labels);

    return next.handle().pipe(
      tap({
        next: () => end({ status: String(http.getResponse<{ statusCode?: number }>().statusCode ?? 200) }),
        // The exception filter has not run yet at this point, so the response
        // status is still the default; take it from the exception instead.
        error: (error: unknown) => end({ status: String(statusOf(error)) }),
      }),
    );
  }
}

/** `CatalogController` -> `catalog`, so dashboards read like the URL space. */
export function controllerLabel(className: string): string {
  const base = className.replace(/Controller$/, '');
  return (base || className).toLowerCase();
}

function statusOf(error: unknown): number {
  const candidate = error as { getStatus?: () => number; status?: number } | null;
  if (typeof candidate?.getStatus === 'function') return candidate.getStatus();
  return typeof candidate?.status === 'number' ? candidate.status : 500;
}
