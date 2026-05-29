import { createHash } from 'crypto';

export interface SignedRequestEnvelope {
  agentFromId: string;
  agentToId: string;
  sessionId: string;
  requestPayload: unknown;
  maxBudget: number;
  policyDigest?: string;
  nonce?: string;
}

/**
 * Recursively sort object keys for deterministic JSON serialization.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep(record[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Build a canonical string from a signed request envelope (excludes signature and requestHash).
 */
export function canonicalizeSignedRequest(envelope: SignedRequestEnvelope): string {
  const normalized = {
    agentFromId: envelope.agentFromId,
    agentToId: envelope.agentToId,
    sessionId: envelope.sessionId,
    requestPayload: sortKeysDeep(envelope.requestPayload),
    maxBudget: envelope.maxBudget,
    ...(envelope.policyDigest !== undefined ? { policyDigest: envelope.policyDigest } : {}),
    ...(envelope.nonce !== undefined ? { nonce: envelope.nonce } : {}),
  };
  return JSON.stringify(normalized);
}

/**
 * SHA-256 hex digest of the canonical request string.
 */
export function hashCanonicalRequest(envelope: SignedRequestEnvelope): string {
  const canonical = canonicalizeSignedRequest(envelope);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
