import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RefreshTokenService } from './refresh-token.service';

const CONFIG = {
  'security.jwt.expiresIn': '1h',
  'security.jwt.refreshExpiresIn': '7d',
} as Record<string, string>;

function build() {
  const jwt = new JwtService({ secret: 'test-secret' });
  const config = {
    get: (key: string, fallback: string) => CONFIG[key] ?? fallback,
  } as unknown as ConfigService;
  return new RefreshTokenService(jwt, config);
}

const PAYLOAD = { sub: 'agent-1', did: 'did:prom:agent-1', role: 'agent' };

describe('RefreshTokenService', () => {
  it('issues an access and refresh token pair', () => {
    const pair = build().issueTokenPair(PAYLOAD);
    expect(pair.accessToken).toBeTruthy();
    expect(pair.refreshToken).toBeTruthy();
    expect(pair.expiresIn).toBe(3600);
  });

  it('rotates a refresh token into a new pair', () => {
    const service = build();
    const first = service.issueTokenPair(PAYLOAD);
    const second = service.rotate(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
  });

  it('refuses to reuse a rotated refresh token', () => {
    const service = build();
    const first = service.issueTokenPair(PAYLOAD);
    service.rotate(first.refreshToken);
    expect(() => service.rotate(first.refreshToken)).toThrow(UnauthorizedException);
  });

  it('rejects a token signed with a different secret', () => {
    const service = build();
    const foreign = new JwtService({ secret: 'other-secret' }).sign(PAYLOAD);
    expect(() => service.rotate(foreign)).toThrow(UnauthorizedException);
  });

  it('rejects a malformed token', () => {
    expect(() => build().rotate('not-a-jwt')).toThrow(UnauthorizedException);
  });

  it('preserves the subject, did and role across rotation', () => {
    const service = build();
    const jwt = new JwtService({ secret: 'test-secret' });
    const rotated = service.rotate(service.issueTokenPair(PAYLOAD).refreshToken);
    expect(jwt.verify(rotated.accessToken, { secret: 'test-secret' })).toMatchObject(
      PAYLOAD,
    );
  });

  it('drops revocation entries once the token itself has expired', () => {
    const service = build();
    const token = service.issueTokenPair(PAYLOAD).refreshToken;

    service.revoke(token, Math.floor(Date.now() / 1000) - 1);
    expect(service.isRevoked(token)).toBe(false);
    expect(service.revokedCount).toBe(0);
  });

  it('keeps revocation entries that have not expired', () => {
    const service = build();
    const token = service.issueTokenPair(PAYLOAD).refreshToken;

    service.revoke(token, Math.floor(Date.now() / 1000) + 600);
    expect(service.isRevoked(token)).toBe(true);
  });
});
