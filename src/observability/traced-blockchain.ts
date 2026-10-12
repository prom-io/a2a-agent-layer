import {
  Attributes,
  context,
  propagation,
  Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { requestContext } from '../common/logging/request-context';

const TRACER_NAME = 'a2a-agent-layer.blockchain';

/**
 * Runs a blockchain call inside a client span that is a child of whatever span
 * is active (normally the HTTP request span).
 *
 * On-chain calls dominate the latency of the write endpoints and are retried
 * with backoff, so without their own span a slow registration shows up in the
 * trace as one opaque block of controller time.
 *
 * The callback receives the span so callers can attach what they learn along
 * the way. A result that looks like a transaction receipt has its hash and
 * block number recorded automatically.
 */
export async function tracedCall<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  const requestId = requestContext.requestId();
  const span = tracer.startSpan(name, {
    kind: SpanKind.CLIENT,
    attributes: {
      'rpc.system': 'jsonrpc',
      // Joins the trace to the log lines of the same request.
      ...(requestId ? { 'request.id': requestId } : {}),
      ...attributes,
    },
  });

  try {
    // Run inside the span's context so the JSON-RPC HTTP requests made by
    // ethers become children of this span and carry its traceparent.
    const result = await context.with(trace.setSpan(context.active(), span), () => fn(span));
    recordReceipt(span, result);
    return result;
  } catch (error) {
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    span.end();
  }
}

/**
 * W3C trace context headers (`traceparent`, `tracestate`) for the active span.
 *
 * Empty when tracing is disabled or no span is active, so callers can spread
 * the result into outgoing headers unconditionally.
 */
export function traceContextHeaders(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

/** Ids of the active span, for stamping onto log lines. */
export function activeTraceIds(): { traceId: string; spanId: string } | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !trace.isSpanContextValid(spanContext)) return undefined;
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}

function recordReceipt(span: Span, result: unknown): void {
  if (typeof result !== 'object' || result === null) return;
  const receipt = result as { hash?: unknown; blockNumber?: unknown; status?: unknown };
  if (typeof receipt.hash === 'string') span.setAttribute('blockchain.tx_hash', receipt.hash);
  if (typeof receipt.blockNumber === 'number') {
    span.setAttribute('blockchain.block_number', receipt.blockNumber);
  }
  // A mined-but-reverted transaction resolves normally in ethers when the
  // receipt is fetched directly; it is still a failed call.
  if (receipt.status === 0) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'transaction reverted' });
  }
}
