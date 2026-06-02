import { isTransientError, withRetry } from './retry.util';

describe('retry.util', () => {
  it('detects transient blockchain errors', () => {
    expect(isTransientError(new Error('nonce too low'))).toBe(true);
    expect(isTransientError(new Error('validation failed'))).toBe(false);
  });

  it('retries transient failures then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls < 2) {
        throw new Error('ECONNRESET');
      }
      return 'ok';
    }, { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2, jitter: false });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });
});
