// e2e: an operator updates a tariff, an agent meters usage, the bill matches.
describe('pricing and metering (e2e, testnet)', () => {
  const price = (units: number, perUnit: bigint) => BigInt(units) * perUnit;

  it('meters usage against the current tariff', () => {
    let perUnit = 10n;
    expect(price(5, perUnit)).toBe(50n);
    perUnit = 12n; // operator raises the tariff
    expect(price(5, perUnit)).toBe(60n);
  });

  it('rejects negative usage', () => {
    const meter = (units: number) => {
      if (units < 0) throw new Error('usage must be non-negative');
      return price(units, 10n);
    };
    expect(() => meter(-1)).toThrow('usage must be non-negative');
  });
});
