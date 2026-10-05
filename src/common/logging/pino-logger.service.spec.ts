import { buildLoggerOptions, PinoLoggerService } from './pino-logger.service';
import { requestContext } from './request-context';

describe('PinoLoggerService', () => {
  const capture = () => {
    const lines: Record<string, unknown>[] = [];
    const logger = new PinoLoggerService({
      write: (chunk: string) => {
        lines.push(JSON.parse(chunk));
      },
    });
    return { lines, logger };
  };

  it('emits one JSON object per line with service, level and context', () => {
    const { lines, logger } = capture();

    logger.log('Agent registered', 'IdentityService');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 30,
      service: 'a2a-agent-layer',
      context: 'IdentityService',
      msg: 'Agent registered',
    });
    expect(typeof lines[0].time).toBe('string');
  });

  it('attaches the request id of the surrounding request', () => {
    const { lines, logger } = capture();

    requestContext.run({ requestId: 'req-42' }, () =>
      logger.warn('Policy denied', 'PolicyEvaluatorService'),
    );
    logger.warn('outside any request', 'Bootstrap');

    expect(lines[0]).toMatchObject({ level: 40, requestId: 'req-42' });
    expect(lines[1].requestId).toBeUndefined();
  });

  it('keeps the request id across an await boundary', async () => {
    const { lines, logger } = capture();

    await requestContext.run({ requestId: 'req-async' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      logger.log('Receipt created', 'MeteringService');
    });

    expect(lines[0].requestId).toBe('req-async');
  });

  it('maps the Nest error signature to stack and context', () => {
    const { lines, logger } = capture();

    logger.error('On-chain registration failed', 'Error: boom\n    at x', 'IdentityService');
    logger.error('only a context', 'ExceptionFilter');

    expect(lines[0]).toMatchObject({
      level: 50,
      context: 'IdentityService',
      stack: 'Error: boom\n    at x',
    });
    expect(lines[1]).toMatchObject({ context: 'ExceptionFilter' });
    expect(lines[1].stack).toBeUndefined();
  });

  it('serializes an Error passed as an extra argument', () => {
    const { lines, logger } = capture();

    logger.error('Hourly metering rollup failed', new Error('deadlock detected'));

    expect(lines[0].err).toMatchObject({ name: 'Error', message: 'deadlock detected' });
  });

  it('flattens JSON string messages into fields instead of nesting them', () => {
    const { lines, logger } = capture();

    requestContext.run({ requestId: 'req-audit' }, () =>
      logger.log(
        JSON.stringify({ method: 'POST', path: '/agents', requestId: 'spoofed' }),
        'AuditLog',
      ),
    );

    expect(lines[0]).toMatchObject({ method: 'POST', path: '/agents', context: 'AuditLog' });
    // The id from the async context wins over one carried in the payload.
    expect(lines[0].requestId).toBe('req-audit');
  });

  it('redacts credentials', () => {
    const { lines, logger } = capture();

    logger.log(
      { privateKey: '0xabc', password: 'hunter2', agentDid: 'did:prom:a' },
      'IdentityService',
    );

    expect(lines[0]).toMatchObject({
      privateKey: '[redacted]',
      password: '[redacted]',
      agentDid: 'did:prom:a',
    });
  });
});

describe('buildLoggerOptions', () => {
  it('defaults to debug with pretty output in development', () => {
    const options = buildLoggerOptions({ NODE_ENV: 'development' });
    expect(options.level).toBe('debug');
    expect(options.transport).toBeDefined();
  });

  it('emits plain JSON at info level in production', () => {
    const options = buildLoggerOptions({ NODE_ENV: 'production' });
    expect(options.level).toBe('info');
    expect(options.transport).toBeUndefined();
  });

  it('honours LOG_LEVEL and LOG_PRETTY overrides', () => {
    const options = buildLoggerOptions({
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
      LOG_PRETTY: 'true',
    });
    expect(options.level).toBe('warn');
    expect(options.transport).toBeDefined();

    const plain = buildLoggerOptions({ NODE_ENV: 'development', LOG_PRETTY: 'false' });
    expect(plain.transport).toBeUndefined();
  });
});
