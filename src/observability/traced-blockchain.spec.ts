import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { tracing } from '@opentelemetry/sdk-node';
import { requestContext } from '../common/logging/request-context';
import { PinoLoggerService } from '../common/logging/pino-logger.service';
import { activeTraceIds, traceContextHeaders, tracedCall } from './traced-blockchain';
import { startTracing, stopTracing, tracingConfigFromEnv } from './tracing';

describe('traced blockchain calls', () => {
  let exporter: tracing.InMemorySpanExporter;
  let processor: tracing.SimpleSpanProcessor;

  const finished = async () => {
    await processor.forceFlush();
    return exporter.getFinishedSpans();
  };

  beforeEach(() => {
    exporter = new tracing.InMemorySpanExporter();
    processor = new tracing.SimpleSpanProcessor(exporter);
    startTracing(tracingConfigFromEnv({ OTEL_ENABLED: 'true' }), {
      spanProcessors: [processor],
      instrumentations: [],
    });
  });

  afterEach(async () => {
    await stopTracing();
    trace.disable();
    context.disable();
  });

  it('creates a client span that is a child of the active request span', async () => {
    const tracer = trace.getTracer('spec');

    await tracer.startActiveSpan('POST /agents', async (requestSpan) => {
      await tracedCall('blockchain.AgentRegistry.registerAgent', { 'agent.did': 'did:prom:a' }, async () => 'ok');
      requestSpan.end();
    });

    const spans = await finished();
    const parent = spans.find((s) => s.name === 'POST /agents');
    const child = spans.find((s) => s.name === 'blockchain.AgentRegistry.registerAgent');
    expect(child?.kind).toBe(SpanKind.CLIENT);
    expect(child?.spanContext().traceId).toBe(parent?.spanContext().traceId);
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
    expect(child?.attributes).toMatchObject({ 'rpc.system': 'jsonrpc', 'agent.did': 'did:prom:a' });
  });

  it('makes its span the active one for the wrapped call, across awaits', async () => {
    let inside: string | undefined;
    let header: string | undefined;

    await tracedCall('blockchain.signMessage', {}, async (span) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      inside = activeTraceIds()?.spanId;
      header = traceContextHeaders().traceparent;
      expect(span.spanContext().spanId).toBe(inside);
    });

    const [span] = await finished();
    expect(inside).toBe(span.spanContext().spanId);
    // traceparent: version-traceId-spanId-flags
    expect(header).toBe(`00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`);
  });

  it('records the transaction hash and block of a receipt', async () => {
    await tracedCall('blockchain.AgentRegistry.updateAgent', {}, async () => ({
      hash: '0xabc',
      blockNumber: 1207,
      status: 1,
    }));

    const [span] = await finished();
    expect(span.attributes).toMatchObject({
      'blockchain.tx_hash': '0xabc',
      'blockchain.block_number': 1207,
    });
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('marks the span failed and rethrows when the call rejects', async () => {
    await expect(
      tracedCall('blockchain.AgentRegistry.registerAgent', {}, async () => {
        throw new Error('nonce too low');
      }),
    ).rejects.toThrow('nonce too low');

    const [span] = await finished();
    expect(span.status).toEqual({ code: SpanStatusCode.ERROR, message: 'nonce too low' });
    expect(span.events.map((e) => e.name)).toContain('exception');
  });

  it('flags a reverted receipt as an error', async () => {
    await tracedCall('blockchain.AgentRegistry.deactivateAgent', {}, async () => ({
      hash: '0xdead',
      status: 0,
    }));

    const [span] = await finished();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('tags the span with the request id and the log line with the trace id', async () => {
    const lines: Record<string, unknown>[] = [];
    const logger = new PinoLoggerService({ write: (chunk: string) => lines.push(JSON.parse(chunk)) });

    await requestContext.run({ requestId: 'req-trace-1' }, () =>
      tracedCall('blockchain.signMessage', {}, async () => {
        logger.log('Receipt created', 'MeteringService');
      }),
    );

    const [span] = await finished();
    expect(span.attributes['request.id']).toBe('req-trace-1');
    expect(lines[0]).toMatchObject({
      requestId: 'req-trace-1',
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
    });
  });
});

describe('trace helpers without an active span', () => {
  it('return nothing instead of throwing', () => {
    expect(traceContextHeaders()).toEqual({});
    expect(activeTraceIds()).toBeUndefined();
  });

  it('still run the wrapped call when tracing is disabled', async () => {
    await expect(tracedCall('blockchain.signMessage', {}, async () => 42)).resolves.toBe(42);
  });
});
