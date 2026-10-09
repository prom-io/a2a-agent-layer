import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK, NodeSDKConfiguration, tracing } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export const DEFAULT_SERVICE_NAME = 'a2a-agent-layer';
export const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318';

const UNTRACED_PATHS = new Set(['/health', '/health/detail', '/ready', '/metrics']);

export interface TracingConfig {
  enabled: boolean;
  serviceName: string;
  serviceVersion: string;
  environment: string;
  /** Full URL of the OTLP/HTTP traces endpoint. */
  tracesUrl: string;
  /** Fraction of root traces that are sampled, 0..1. */
  sampleRatio: number;
}

export interface TracingOverrides {
  /** Replaces the OTLP exporter; used by tests to capture spans in memory. */
  spanProcessors?: tracing.SpanProcessor[];
  instrumentations?: NodeSDKConfiguration['instrumentations'];
}

let sdk: NodeSDK | undefined;

/**
 * Reads the tracing settings from the environment.
 *
 * Tracing is off unless it is asked for: either OTEL_ENABLED=true or an OTLP
 * endpoint is configured. A service that exports by default spends its time
 * retrying against a collector that does not exist in most dev setups.
 */
export function tracingConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TracingConfig {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const tracesEndpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  const requested = env.OTEL_ENABLED
    ? env.OTEL_ENABLED === 'true'
    : Boolean(endpoint || tracesEndpoint);

  return {
    // OTEL_SDK_DISABLED is the standard kill switch and always wins.
    enabled: requested && env.OTEL_SDK_DISABLED !== 'true',
    serviceName: env.OTEL_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME,
    serviceVersion: env.npm_package_version ?? '0.1.0',
    environment: env.NODE_ENV ?? 'development',
    // The signal-specific variable is a complete URL; the generic one is a
    // base to which the signal path is appended (OTLP exporter convention).
    tracesUrl:
      tracesEndpoint ||
      `${(endpoint || DEFAULT_OTLP_ENDPOINT).replace(/\/+$/, '')}/v1/traces`,
    sampleRatio: parseRatio(env.OTEL_TRACES_SAMPLER_ARG),
  };
}

/**
 * Starts the OpenTelemetry SDK. Returns false when tracing is disabled or
 * already running.
 *
 * Has to run before `http`, `express` and `pg` are first required, because the
 * instrumentations work by patching those modules at load time. That is why
 * `main.ts` imports `tracing.bootstrap` as its very first statement.
 */
export function startTracing(
  config: TracingConfig = tracingConfigFromEnv(),
  overrides: TracingOverrides = {},
): boolean {
  if (!config.enabled || sdk) return false;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      'deployment.environment.name': config.environment,
    }),
    // Follow the caller's sampling decision when there is one, so a trace
    // started by another PROM service is never cut in half here.
    sampler: new tracing.ParentBasedSampler({
      root: new tracing.TraceIdRatioBasedSampler(config.sampleRatio),
    }),
    spanProcessors: overrides.spanProcessors ?? [
      new tracing.BatchSpanProcessor(new OTLPTraceExporter({ url: config.tracesUrl })),
    ],
    instrumentations: overrides.instrumentations ?? [
      new HttpInstrumentation({
        // Probes and scrapes arrive every few seconds and carry no signal.
        ignoreIncomingRequestHook: (req) =>
          UNTRACED_PATHS.has((req.url ?? '').split('?')[0]),
      }),
      new ExpressInstrumentation(),
      new PgInstrumentation(),
    ],
  });
  sdk.start();
  return true;
}

/** Flushes buffered spans and shuts the SDK down. Safe to call when not started. */
export async function stopTracing(): Promise<void> {
  const running = sdk;
  sdk = undefined;
  await running?.shutdown();
}

export function isTracingStarted(): boolean {
  return sdk !== undefined;
}

function parseRatio(raw: string | undefined): number {
  const parsed = Number.parseFloat(raw ?? '');
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(1, Math.max(0, parsed));
}
