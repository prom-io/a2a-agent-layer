import { readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { DataSource } from 'typeorm';
import { BusinessMetricsService, reasonLabel } from './business-metrics.service';
import { ControllerMetricsInterceptor } from './controller-metrics.interceptor';
import { DomainGaugesService } from './domain-gauges.service';
import { MetricsService } from './metrics.service';

interface AlertRule {
  alert: string;
  expr: string;
  for?: string;
  labels?: { severity?: string };
  annotations?: Record<string, string>;
}

const RULES_FILE = join(__dirname, '..', '..', 'monitoring', 'alerts.yml');

// Series Prometheus generates itself rather than scraping from the service.
const BUILT_IN = new Set(['up']);

describe('alert rules', () => {
  const groups = (load(readFileSync(RULES_FILE, 'utf8')) as {
    groups: Array<{ name: string; rules: AlertRule[] }>;
  }).groups;
  const rules = groups.flatMap((group) => group.rules);

  const metricNamesIn = (expr: string) =>
    Array.from(new Set(expr.match(/\b(?:agent_layer|http)_[a-z0-9_]+|\bup\b/g) ?? []));

  let registered: Set<string>;

  beforeAll(async () => {
    const metrics = new MetricsService();
    new ControllerMetricsInterceptor(metrics);
    new BusinessMetricsService(metrics);
    new DomainGaugesService(metrics, {} as DataSource);
    registered = new Set((await metrics.registry.getMetricsAsJSON()).map((m) => m.name));
    metrics.onModuleDestroy();
  });

  it('covers metering lag and policy denials', () => {
    const names = rules.map((rule) => rule.alert);

    expect(names).toEqual(expect.arrayContaining(['MeteringLagHigh', 'PolicyDenialRateHigh']));
    expect(new Set(names).size).toBe(names.length);
  });

  it('only references series the service actually exposes', () => {
    for (const rule of rules) {
      const names = metricNamesIn(rule.expr);
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        expect({ alert: rule.alert, name, known: BUILT_IN.has(name) || registered.has(name) }).toEqual({
          alert: rule.alert,
          name,
          known: true,
        });
      }
    }
  });

  it('gives every rule a severity, a summary and a runbook link', () => {
    for (const rule of rules) {
      expect(['warning', 'critical']).toContain(rule.labels?.severity);
      expect(rule.annotations?.summary).toBeTruthy();
      expect(rule.annotations?.runbook).toMatch(/^docs\/OBSERVABILITY\.md#[a-z]+$/);
    }
  });

  it('filters on label values the code can produce', () => {
    const exprs = rules.map((rule) => rule.expr).join('\n');
    const decisions = Array.from(exprs.matchAll(/decision="([a-z_]+)"/g), (m) => m[1]);
    const results = Array.from(exprs.matchAll(/result="([a-z_]+)"/g), (m) => m[1]);

    expect(decisions.every((d) => ['allow', 'deny'].includes(d))).toBe(true);
    expect(results.every((r) => ['success', 'failure'].includes(r))).toBe(true);
  });
});

describe('BusinessMetricsService', () => {
  let metrics: MetricsService;
  let business: BusinessMetricsService;

  beforeEach(() => {
    metrics = new MetricsService();
    business = new BusinessMetricsService(metrics);
  });

  afterEach(() => metrics.onModuleDestroy());

  it('exposes the alerting series at zero before anything happens', async () => {
    const body = await metrics.scrape();

    expect(body).toMatch(/agent_layer_policy_decisions_total\{decision="deny",reason="none"[^}]*\} 0/);
    expect(body).toMatch(/agent_layer_metering_rollup_runs_total\{result="failure"[^}]*\} 0/);
  });

  it('counts policy decisions by decision and reason slug', async () => {
    business.recordPolicyDecision('deny', 'subject on denylist');
    business.recordPolicyDecision('deny', 'subject on denylist');
    business.recordPolicyDecision('allow', 'matched allow access rule');

    const body = await metrics.scrape();
    expect(body).toMatch(
      /agent_layer_policy_decisions_total\{decision="deny",reason="subject_on_denylist"[^}]*\} 2/,
    );
    expect(body).toMatch(
      /agent_layer_policy_decisions_total\{decision="allow",reason="matched_allow_access_rule"[^}]*\} 1/,
    );
  });

  it('stamps the last success only for successful rollup runs', async () => {
    business.recordRollupRun('success', 4, 1_760_000_000_000);
    business.recordRollupRun('failure', 0, 1_760_003_600_000);

    const body = await metrics.scrape();
    expect(body).toMatch(/agent_layer_metering_rollup_last_success_timestamp_seconds\{[^}]*\} 1760000000/);
    expect(body).toMatch(/agent_layer_metering_rollup_last_buckets\{[^}]*\} 4/);
    expect(body).toMatch(/agent_layer_metering_rollup_runs_total\{result="failure"[^}]*\} 1/);
  });

  it('keeps reason labels bounded', () => {
    expect(reasonLabel('No matching allow rule')).toBe('no_matching_allow_rule');
    expect(reasonLabel('')).toBe('unspecified');
    expect(reasonLabel('x'.repeat(200))).toHaveLength(48);
  });
});
