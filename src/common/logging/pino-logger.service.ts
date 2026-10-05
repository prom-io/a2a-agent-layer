import { Inject, Injectable, LoggerService, LogLevel, Optional } from '@nestjs/common';
import pino, { DestinationStream, Logger as PinoLogger, LoggerOptions } from 'pino';
import { requestContext } from './request-context';

export const PINO_DESTINATION = 'PINO_DESTINATION';

const SERVICE_NAME = 'a2a-agent-layer';

type NestLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal';

const LEVELS: Record<NestLevel, 'info' | 'error' | 'warn' | 'debug' | 'trace' | 'fatal'> = {
  log: 'info',
  error: 'error',
  warn: 'warn',
  debug: 'debug',
  verbose: 'trace',
  fatal: 'fatal',
};

/**
 * Builds the pino options from the environment.
 *
 * Exported so the defaults (level, pretty printing, redaction) can be asserted
 * without constructing a logger.
 */
export function buildLoggerOptions(env: NodeJS.ProcessEnv = process.env): LoggerOptions {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  // Pretty output is opt-in outside development: it costs a transport thread
  // and makes the output unparseable by the log pipeline.
  const pretty = env.LOG_PRETTY ? env.LOG_PRETTY === 'true' : nodeEnv === 'development';

  return {
    level: env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
    transport: pretty
      ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
      : undefined,
    base: { service: SERVICE_NAME, env: nodeEnv },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      // These reach the logger through error objects and request dumps. A
      // signing key or an API key in a log line is a compromised credential.
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'privateKey',
        '*.privateKey',
        'password',
        '*.password',
        'ownerSignature',
        '*.ownerSignature',
        'refreshToken',
        '*.refreshToken',
      ],
      censor: '[redacted]',
    },
  };
}

/**
 * Nest logger backed by pino, emitting one JSON object per line.
 *
 * Every line carries the current request id, pulled from async local storage
 * rather than passed in, so log lines written by services deep in the call
 * stack (metering, policy evaluation, on-chain calls) join back to the request
 * that caused them without each of them knowing about HTTP.
 */
@Injectable()
export class PinoLoggerService implements LoggerService {
  private readonly logger: PinoLogger;

  constructor(@Optional() @Inject(PINO_DESTINATION) destination?: DestinationStream) {
    // A destination is only supplied by tests; a transport and an explicit
    // destination are mutually exclusive in pino.
    this.logger = destination
      ? pino({ ...buildLoggerOptions(), transport: undefined }, destination)
      : pino(buildLoggerOptions());
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('log', message, this.contextOf(optionalParams));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    // Nest calls error(message, stack?, context?). With a single trailing
    // string it is the context, not a stack.
    const strings = optionalParams.filter((p): p is string => typeof p === 'string');
    const context = strings.length > 0 ? strings[strings.length - 1] : undefined;
    const stack = strings.length > 1 ? strings[0] : undefined;
    const cause = optionalParams.find((p): p is Error => p instanceof Error);
    this.write('error', message, context, {
      ...(stack ? { stack } : {}),
      ...(cause ? { err: this.serializeError(cause) } : {}),
    });
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, this.contextOf(optionalParams));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, this.contextOf(optionalParams));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('verbose', message, this.contextOf(optionalParams));
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('fatal', message, this.contextOf(optionalParams));
  }

  setLogLevels(_levels: LogLevel[]): void {
    // Level is controlled by LOG_LEVEL so it can be changed without a deploy.
  }

  private contextOf(optionalParams: unknown[]): string | undefined {
    const last = optionalParams[optionalParams.length - 1];
    return typeof last === 'string' ? last : undefined;
  }

  private serializeError(error: Error): Record<string, unknown> {
    return { name: error.name, message: error.message, stack: error.stack };
  }

  private write(
    level: NestLevel,
    message: unknown,
    context?: string,
    extra: Record<string, unknown> = {},
  ): void {
    const emit = this.logger[LEVELS[level]].bind(this.logger);
    const payload: Record<string, unknown> = {
      context,
      requestId: requestContext.requestId(),
      ...extra,
    };

    if (message instanceof Error) {
      emit({ ...payload, err: this.serializeError(message) }, message.message);
      return;
    }

    if (typeof message === 'string') {
      // The audit interceptor already logs JSON strings; keep them as fields
      // rather than nesting escaped JSON inside the message.
      const parsed = this.tryParse(message);
      if (parsed) {
        // payload last: a field supplied by the caller must not overwrite the
        // correlation id of the request that actually produced the line.
        emit({ ...parsed, ...this.defined(payload) });
        return;
      }
      emit(payload, message);
      return;
    }

    if (typeof message === 'object' && message !== null) {
      emit({ ...(message as Record<string, unknown>), ...this.defined(payload) });
      return;
    }

    emit(payload, String(message));
  }

  private defined(payload: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
  }

  private tryParse(message: string): Record<string, unknown> | null {
    if (!message.startsWith('{')) return null;
    try {
      const parsed = JSON.parse(message);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch {
      return null;
    }
  }
}
