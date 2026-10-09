import { trace } from '@opentelemetry/api';
import { tracing } from '@opentelemetry/sdk-node';
import {
  DEFAULT_SERVICE_NAME,
  isTracingStarted,
  startTracing,
  stopTracing,
  tracingConfigFromEnv,
} from './tracing';
import { TracingLifecycle } from './tracing.module';

describe('tracingConfigFromEnv', () => {
  it('is disabled when nothing asks for it', () => {
    const config = tracingConfigFromEnv({});

    expect(config.enabled).toBe(false);
    expect(config.serviceName).toBe(DEFAULT_SERVICE_NAME);
    expect(config.tracesUrl).toBe('http://localhost:4318/v1/traces');
    expect(config.sampleRatio).toBe(1);
  });

  it('is enabled by an OTLP endpoint and appends the traces path', () => {
    const config = tracingConfigFromEnv({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4318/',
      OTEL_SERVICE_NAME: 'agent-layer-staging',
      NODE_ENV: 'staging',
    });

    expect(config).toMatchObject({
      enabled: true,
      serviceName: 'agent-layer-staging',
      environment: 'staging',
      tracesUrl: 'http://otel-collector:4318/v1/traces',
    });
  });

  it('uses the signal-specific endpoint verbatim', () => {
    const config = tracingConfigFromEnv({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://ignored:4318',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://tempo.example/otlp/v1/traces',
    });

    expect(config.tracesUrl).toBe('https://tempo.example/otlp/v1/traces');
  });

  it('lets OTEL_ENABLED=false and OTEL_SDK_DISABLED override an endpoint', () => {
    const endpoint = { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4318' };

    expect(tracingConfigFromEnv({ ...endpoint, OTEL_ENABLED: 'false' }).enabled).toBe(false);
    expect(tracingConfigFromEnv({ ...endpoint, OTEL_SDK_DISABLED: 'true' }).enabled).toBe(false);
    expect(tracingConfigFromEnv({ OTEL_ENABLED: 'true' }).enabled).toBe(true);
  });

  it('clamps the sample ratio into 0..1', () => {
    expect(tracingConfigFromEnv({ OTEL_TRACES_SAMPLER_ARG: '0.25' }).sampleRatio).toBe(0.25);
    expect(tracingConfigFromEnv({ OTEL_TRACES_SAMPLER_ARG: '7' }).sampleRatio).toBe(1);
    expect(tracingConfigFromEnv({ OTEL_TRACES_SAMPLER_ARG: '-1' }).sampleRatio).toBe(0);
    expect(tracingConfigFromEnv({ OTEL_TRACES_SAMPLER_ARG: 'lots' }).sampleRatio).toBe(1);
  });
});

describe('startTracing', () => {
  afterEach(async () => {
    await stopTracing();
    trace.disable();
  });

  it('does nothing when disabled', () => {
    expect(startTracing(tracingConfigFromEnv({}))).toBe(false);
    expect(isTracingStarted()).toBe(false);
  });

  it('exports spans tagged with the service resource', async () => {
    const exporter = new tracing.InMemorySpanExporter();
    const config = tracingConfigFromEnv({
      OTEL_ENABLED: 'true',
      OTEL_SERVICE_NAME: 'agent-layer-test',
      NODE_ENV: 'test',
    });

    const processor = new tracing.SimpleSpanProcessor(exporter);
    const started = startTracing(config, { spanProcessors: [processor], instrumentations: [] });
    trace.getTracer('spec').startSpan('catalog.search').end();
    // Export waits for the asynchronously detected host/process attributes.
    await processor.forceFlush();

    expect(started).toBe(true);
    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe('catalog.search');
    expect(span.resource.attributes).toMatchObject({
      'service.name': 'agent-layer-test',
      'deployment.environment.name': 'test',
    });
  });

  it('refuses to start twice and can be stopped repeatedly', async () => {
    const config = tracingConfigFromEnv({ OTEL_ENABLED: 'true' });
    const overrides = {
      spanProcessors: [new tracing.SimpleSpanProcessor(new tracing.InMemorySpanExporter())],
      instrumentations: [],
    };

    expect(startTracing(config, overrides)).toBe(true);
    expect(startTracing(config, overrides)).toBe(false);

    await stopTracing();
    await expect(stopTracing()).resolves.toBeUndefined();
    expect(isTracingStarted()).toBe(false);
  });

  it('drops root spans when the sample ratio is zero', async () => {
    const exporter = new tracing.InMemorySpanExporter();
    startTracing(tracingConfigFromEnv({ OTEL_ENABLED: 'true', OTEL_TRACES_SAMPLER_ARG: '0' }), {
      spanProcessors: [new tracing.SimpleSpanProcessor(exporter)],
      instrumentations: [],
    });

    trace.getTracer('spec').startSpan('unsampled').end();

    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
});

describe('TracingLifecycle', () => {
  it('flushes the SDK on application shutdown', async () => {
    startTracing(tracingConfigFromEnv({ OTEL_ENABLED: 'true' }), {
      spanProcessors: [new tracing.SimpleSpanProcessor(new tracing.InMemorySpanExporter())],
      instrumentations: [],
    });
    const lifecycle = new TracingLifecycle();

    lifecycle.onModuleInit();
    await lifecycle.onApplicationShutdown();

    expect(isTracingStarted()).toBe(false);
    trace.disable();
  });
});
