import { ethers } from 'ethers';
import {
  buildRegistrationMessage,
  RegistrationClaim,
  verifyDidController,
} from './did-controller';

const wallet = ethers.Wallet.createRandom();
const attacker = ethers.Wallet.createRandom();

const claim: RegistrationClaim = {
  agentDid: 'did:prom:agent-1',
  owner: wallet.address,
  publicKey: '0xpublickey',
  endpoint: 'https://agent.example.com',
};

const sign = (c: RegistrationClaim, signer = wallet) =>
  signer.signMessageSync(buildRegistrationMessage(c));

describe('verifyDidController', () => {
  it('accepts a signature from the claimed owner', () => {
    expect(verifyDidController(claim, sign(claim))).toBe(true);
  });

  it('accepts a checksummed or lowercased owner equally', () => {
    const lowercased = { ...claim, owner: wallet.address.toLowerCase() };
    expect(verifyDidController(lowercased, sign(lowercased))).toBe(true);
  });

  it('rejects a signature from a different key', () => {
    expect(verifyDidController(claim, sign(claim, attacker))).toBe(false);
  });

  it('rejects a signature replayed onto a different endpoint', () => {
    // The whole point of binding the endpoint: otherwise a valid signature
    // could be reused to point an agent's traffic somewhere else.
    const signature = sign(claim);
    const moved = { ...claim, endpoint: 'https://attacker.example.com' };
    expect(verifyDidController(moved, signature)).toBe(false);
  });

  it('rejects a signature replayed onto a different DID', () => {
    const signature = sign(claim);
    expect(verifyDidController({ ...claim, agentDid: 'did:prom:other' }, signature)).toBe(
      false,
    );
  });

  it('rejects a signature replayed onto a different public key', () => {
    const signature = sign(claim);
    expect(verifyDidController({ ...claim, publicKey: '0xother' }, signature)).toBe(false);
  });

  it.each([['', 'empty'], ['0xdeadbeef', 'too short'], ['not-hex', 'not hex']])(
    'returns false for a malformed signature (%s, %s)',
    (signature) => {
      expect(verifyDidController(claim, signature)).toBe(false);
    },
  );

  it('binds every registry field into the message', () => {
    const message = buildRegistrationMessage(claim);
    expect(message).toContain(claim.agentDid);
    expect(message).toContain(claim.owner.toLowerCase());
    expect(message).toContain(claim.publicKey);
    expect(message).toContain(claim.endpoint);
  });
});
