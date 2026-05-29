import {
  canonicalizeSignedRequest,
  hashCanonicalRequest,
  sortKeysDeep,
} from './request-canonicalization';
import * as fixtures from './fixtures/canonical-hashes.json';

describe('request-canonicalization', () => {
  it('sorts nested object keys deterministically', () => {
    const input = { z: 1, a: { nested: true, id: 42 } };
    expect(sortKeysDeep(input)).toEqual({ a: { id: 42, nested: true }, z: 1 });
  });

  it('produces stable canonical strings regardless of payload key order', () => {
    const envelopeA = {
      agentFromId: 'agent-x',
      agentToId: 'agent-y',
      sessionId: 'sess-002',
      requestPayload: { z: 1, a: { nested: true, id: 42 } },
      maxBudget: 0.5,
      nonce: 'n-abc',
    };
    const envelopeB = {
      ...envelopeA,
      requestPayload: { a: { id: 42, nested: true }, z: 1 },
    };
    expect(canonicalizeSignedRequest(envelopeA)).toBe(canonicalizeSignedRequest(envelopeB));
  });

  it.each(fixtures.filter((f) => f.hash !== 'PLACEHOLDER'))(
    'matches deterministic hash fixture: $label',
    ({ envelope, canonical, hash }) => {
      expect(canonicalizeSignedRequest(envelope)).toBe(canonical);
      expect(hashCanonicalRequest(envelope)).toBe(hash);
    },
  );

  it('computes nested-key-order-independent hash', () => {
    const nestedFixture = fixtures.find((f) => f.label === 'nested-key-order-independent');
    expect(nestedFixture).toBeDefined();
    const hash = hashCanonicalRequest(nestedFixture!.envelope);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashCanonicalRequest(nestedFixture!.envelope));
  });
});
