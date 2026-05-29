import { NonceStoreService } from './nonce-store.service';

describe('NonceStoreService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('accepts a fresh nonce and rejects duplicates within the window', () => {
    const store = new NonceStoreService({ windowMs: 60_000, evictionIntervalMs: 3600_000 });
    store.assertFresh('agent-a', 'nonce-1');
    expect(() => store.assertFresh('agent-a', 'nonce-1')).toThrow('Request nonce already used');
    store.onModuleDestroy();
  });

  it('allows the same nonce for different agents', () => {
    const store = new NonceStoreService({ windowMs: 60_000, evictionIntervalMs: 3600_000 });
    store.assertFresh('agent-a', 'shared-nonce');
    store.assertFresh('agent-b', 'shared-nonce');
    expect(store.size()).toBe(2);
    store.onModuleDestroy();
  });

  it('evicts expired nonces after the replay window', () => {
    jest.useFakeTimers();
    const store = new NonceStoreService({ windowMs: 1000, evictionIntervalMs: 500 });
    store.assertFresh('agent-a', 'nonce-ttl');
    jest.advanceTimersByTime(1500);
    store.assertFresh('agent-a', 'nonce-ttl');
    expect(store.size()).toBe(1);
    store.onModuleDestroy();
  });
});
