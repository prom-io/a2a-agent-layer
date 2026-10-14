import { Injectable } from '@nestjs/common';
import { Counter, Gauge } from 'prom-client';
import { METRICS_PREFIX, MetricsService } from './metrics.service';

export type PolicyDecision = 'allow' | 'deny';
export type RollupResult = 'success' | 'failure';

/**
 * Event counters for things that happen inside the domain services and cannot
 * be derived from the database afterwards: policy decisions and metering
 * rollup runs. These are what the alert rules in `monitoring/alerts.yml` are
 * written against.
 *
 * The services call the `record*` methods and never touch prom-client, so the
 * metric names and label sets live in one place.
 */
@Injectable()
export class BusinessMetricsService {
  private readonly policyDecisions: Counter<'decision' | 'reason'>;
  private readonly rollupRuns: Counter<'result'>;
  private readonly rollupLastSuccess: Gauge<string>;
  private readonly rollupBuckets: Gauge<string>;

  constructor(metrics: MetricsService) {
    const registers = [metrics.registry];
    this.policyDecisions = new Counter({
      name: `${METRICS_PREFIX}policy_decisions_total`,
      help: 'Policy evaluations for A2A requests, by decision and reason',
      labelNames: ['decision', 'reason'] as const,
      registers,
    });
    this.rollupRuns = new Counter({
      name: `${METRICS_PREFIX}metering_rollup_runs_total`,
      help: 'Hourly metering rollup runs, by result',
      labelNames: ['result'] as const,
      registers,
    });
    this.rollupLastSuccess = new Gauge({
      name: `${METRICS_PREFIX}metering_rollup_last_success_timestamp_seconds`,
      help: 'Unix time of the last metering rollup run that completed without error',
      registers,
    });
    this.rollupBuckets = new Gauge({
      name: `${METRICS_PREFIX}metering_rollup_last_buckets`,
      help: 'Agent-hour buckets written by the last successful metering rollup run',
      registers,
    });

    // Start the series at zero so rate() and increase() have a baseline from
    // the first scrape instead of from the first denial or failure.
    this.policyDecisions.inc({ decision: 'deny', reason: 'none' }, 0);
    this.rollupRuns.inc({ result: 'success' }, 0);
    this.rollupRuns.inc({ result: 'failure' }, 0);
  }

  /**
   * `reason` is the evaluator's own reason text. It comes from a fixed set of
   * strings, never from request data, so it is safe as a label once slugified.
   */
  recordPolicyDecision(decision: PolicyDecision, reason: string): void {
    this.policyDecisions.inc({ decision, reason: reasonLabel(reason) });
  }

  recordRollupRun(result: RollupResult, buckets = 0, now: number = Date.now()): void {
    this.rollupRuns.inc({ result });
    if (result === 'success') {
      this.rollupLastSuccess.set(Math.floor(now / 1000));
      this.rollupBuckets.set(buckets);
    }
  }
}

export function reasonLabel(reason: string): string {
  const slug = reason
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug.slice(0, 48) || 'unspecified';
}
