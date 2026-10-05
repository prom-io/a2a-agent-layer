import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from './metrics.service';

const METRICS_PATH = '/metrics';

/**
 * Counts and times every HTTP request.
 *
 * A middleware rather than an interceptor: requests rejected by the throttler
 * or the auth guards, and requests for unknown routes, never reach an
 * interceptor, and those are exactly the ones an operator needs to see when
 * the 401/429/404 rate moves.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // The scrape itself is excluded, otherwise the scraper's own polling
    // shows up as steady traffic on an idle service.
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (path === METRICS_PATH) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();
    let settled = false;
    this.metrics.httpInFlight.inc();

    const settle = (statusCode: number) => {
      // 'finish' and 'close' can both fire for one response.
      if (settled) return;
      settled = true;
      this.metrics.httpInFlight.dec();
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      this.metrics.observeHttpRequest(req.method, statusCode, seconds);
    };

    res.once('finish', () => settle(res.statusCode));
    // The client went away before the response was written. 499 is the
    // conventional status for that and keeps aborted requests out of the
    // success series.
    res.once('close', () => settle(res.writableEnded ? res.statusCode : 499));

    next();
  }
}
