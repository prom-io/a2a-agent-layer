export interface Receipt { blockNumber: number; status: number; }

// Polls for a receipt with exponential backoff and an overall timeout instead of
// hammering the RPC at a fixed interval.
export async function pollReceipt(
  txHash: string,
  getReceipt: (h: string) => Promise<Receipt | null>,
  opts: { timeoutMs?: number; baseMs?: number; maxMs?: number } = {},
): Promise<Receipt> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const base = opts.baseMs ?? 500;
  const max = opts.maxMs ?? 8_000;
  const started = Date.now();
  let delay = base;
  for (;;) {
    const r = await getReceipt(txHash);
    if (r) return r;
    if (Date.now() - started > timeoutMs) throw new Error(`Receipt timeout for ${txHash}`);
    await new Promise((res) => setTimeout(res, delay));
    delay = Math.min(max, delay * 2);
  }
}
