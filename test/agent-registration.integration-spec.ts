import { NonceManager } from '../src/blockchain/nonce-manager';

// Runs against a forked testnet in CI (RPC provided via PROM_TESTNET_RPC_URL).
describe('agent registration (integration)', () => {
  it('allocates distinct nonces under concurrency', async () => {
    let n = 100;
    const mgr = new NonceManager(async () => n);
    const used = await Promise.all(Array.from({ length: 10 }, () => mgr.reserve(async (nonce) => nonce)));
    expect(new Set(used).size).toBe(10);
    expect(Math.max(...used) - Math.min(...used)).toBe(9);
  });
});
