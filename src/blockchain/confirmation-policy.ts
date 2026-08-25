import { activeNetwork } from '../config/networks';

// An identity registration is only final once it has the network's confirmation
// depth AND still sits on the canonical chain (guards against a reorg dropping it).
export async function awaitFinal(
  txHash: string,
  getReceipt: (h: string) => Promise<{ blockNumber: number; status: number } | null>,
  getBlockNumber: () => Promise<number>,
): Promise<void> {
  const need = activeNetwork().confirmations;
  for (;;) {
    const r = await getReceipt(txHash);
    if (r && r.status === 1) {
      const head = await getBlockNumber();
      if (head - r.blockNumber >= need) {
        const recheck = await getReceipt(txHash);
        if (recheck && recheck.blockNumber === r.blockNumber) return; // still canonical
      }
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
}
