// Concurrent catalog updates from the same signer raced on the account nonce and
// produced "nonce too low" reverts. Serialize nonce allocation behind a promise
// chain so each tx gets a distinct, monotonically increasing nonce.
export class NonceManager {
  private next: number | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly fetchNonce: () => Promise<number>) {}

  reserve<T>(fn: (nonce: number) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      if (this.next === undefined) this.next = await this.fetchNonce();
      const nonce = this.next;
      this.next = nonce + 1;
      return fn(nonce);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
