import { ethers } from 'ethers';

export interface RegistrationClaim {
  agentDid: string;
  owner: string;
  publicKey: string;
  endpoint: string;
}

/**
 * Canonical message an owner signs to prove it controls a DID.
 *
 * Every field that ends up in the registry is bound into the message. Signing
 * only the DID would let a valid signature be replayed against a different
 * endpoint, which is enough to hijack where an agent's traffic is sent.
 */
export function buildRegistrationMessage(claim: RegistrationClaim): string {
  return [
    'PROM agent registration',
    `did: ${claim.agentDid}`,
    `owner: ${claim.owner.toLowerCase()}`,
    `publicKey: ${claim.publicKey}`,
    `endpoint: ${claim.endpoint}`,
  ].join('\n');
}

/**
 * Recovers the signer and checks it against the claimed owner.
 *
 * Returns false rather than throwing on a malformed signature: to the caller a
 * forged signature and an unparseable one are the same failure, and telling
 * them apart only helps whoever is probing.
 */
export function verifyDidController(
  claim: RegistrationClaim,
  signature: string,
): boolean {
  let recovered: string;
  try {
    recovered = ethers.verifyMessage(buildRegistrationMessage(claim), signature);
  } catch {
    return false;
  }
  return recovered.toLowerCase() === claim.owner.toLowerCase();
}
