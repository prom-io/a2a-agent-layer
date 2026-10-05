import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export const METRICS_PREFIX = 'agent_layer_';

const KNOWN_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/**
 * Owns the Prometheus registry for this process.
 *
 * A dedicated registry rather than prom-client's global one: every Nest
 * testing module builds its own instance, and registering the same metric name
 * twice on the global registry throws.
 */
@Injectable()
export class MetricsService implements OnModuleDestroy {
  readonly registry = new Registry();

  readonly httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests completed, by method and response status',
    labelNames: ['method', 'status'] as const,
    registers: [this.registry],
  });

  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds, measured from first byte in to response finished',
    labelNames: ['method', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  readonly httpInFlight = new Gauge({
    name: 'http_requests_in_flight',
    help: 'HTTP requests currently being served',
    registers: [this.registry],
  });

  constructor() {
    this.registry.setDefaultLabels({ service: 'a2a-agent-layer' });
    // Process and Node.js runtime series: CPU, memory, event loop lag, GC,
    // open handles. Prefixed so they do not collide with the other PROM
    // services when scraped into one Prometheus.
    collectDefaultMetrics({ register: this.registry, prefix: METRICS_PREFIX });
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  async scrape(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Records one finished HTTP request.
   *
   * The labels are deliberately low-cardinality: no path here, because this is
   * fed by a middleware that also sees unrouted URLs (scanners, typos), and a
   * label per distinct URL would grow without bound. Per-route latency comes
   * from the controller-level histogram instead.
   */
  observeHttpRequest(method: string, statusCode: number, durationSeconds: number): void {
    const labels = { method: normalizeMethod(method), status: String(statusCode) };
    this.httpRequests.inc(labels);
    this.httpDuration.observe(labels, durationSeconds);
  }

  onModuleDestroy(): void {
    this.registry.clear();
  }
}

export function normalizeMethod(method: string | undefined): string {
  const upper = (method ?? '').toUpperCase();
  return KNOWN_METHODS.has(upper) ? upper : 'OTHER';
}
