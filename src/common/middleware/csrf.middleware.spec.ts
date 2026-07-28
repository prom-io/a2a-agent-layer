import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import { CsrfMiddleware } from './csrf.middleware';

const DEFAULTS: Record<string, unknown> = {
  'security.csrf.cookieName': 'a2a.csrf',
  'security.csrf.headerName': 'x-csrf-token',
  'security.csrf.ttlMs': 3_600_000,
  'security.apiKeys.header': 'x-api-key',
  'security.csrf.secret': 'test-csrf-secret',
};

function build(): CsrfMiddleware {
  const config = {
    get: (key: string, fallback: unknown) => DEFAULTS[key] ?? fallback,
    getOrThrow: (key: string) => DEFAULTS[key],
  } as unknown as ConfigService;
  return new CsrfMiddleware(config);
}

function reply() {
  const headers: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  return {
    headers,
    cookies,
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    cookie: (k: string, v: string) => {
      cookies[k] = v;
    },
  } as unknown as Response & { headers: Record<string, string> };
}

function request(overrides: Partial<Request> = {}): Request {
  return { method: 'GET', headers: {}, ...overrides } as Request;
}

function issueToken(): string {
  const middleware = build();
  const res = reply();
  middleware.use(request(), res, (() => undefined) as NextFunction);
  return (res as unknown as { headers: Record<string, string> }).headers['x-csrf-token'];
}

describe('CsrfMiddleware', () => {
  it('mints a token on a safe request', () => {
    expect(issueToken()).toMatch(/^[a-f0-9]{32}\.\d+\.[a-f0-9]{64}$/);
  });

  it('lets a safe request through without a token', () => {
    const next = jest.fn();
    build().use(request({ method: 'GET' }), reply(), next as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it('accepts an unsafe request whose header matches the cookie', () => {
    const token = issueToken();
    const next = jest.fn();
    build().use(
      request({
        method: 'POST',
        headers: { cookie: `a2a.csrf=${token}`, 'x-csrf-token': token },
      }),
      reply(),
      next as NextFunction,
    );
    expect(next).toHaveBeenCalled();
  });

  it('rejects an unsafe request with no token at all', () => {
    expect(() =>
      build().use(request({ method: 'POST' }), reply(), jest.fn() as NextFunction),
    ).toThrow(ForbiddenException);
  });

  it('rejects a header that does not match the cookie', () => {
    const token = issueToken();
    const other = issueToken();
    expect(() =>
      build().use(
        request({
          method: 'POST',
          headers: { cookie: `a2a.csrf=${token}`, 'x-csrf-token': other },
        }),
        reply(),
        jest.fn() as NextFunction,
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects a forged token that was not signed by this service', () => {
    // Plain double-submit would accept this: attacker writes the cookie and
    // echoes the same value in the header. The HMAC is what stops it.
    const forged = 'a'.repeat(32) + '.' + Date.now() + '.' + 'b'.repeat(64);
    expect(() =>
      build().use(
        request({
          method: 'POST',
          headers: { cookie: `a2a.csrf=${forged}`, 'x-csrf-token': forged },
        }),
        reply(),
        jest.fn() as NextFunction,
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects an expired token', () => {
    const token = issueToken();
    const [nonce, , mac] = token.split('.');
    const stale = `${nonce}.${Date.now() - 7_200_000}.${mac}`;
    expect(() =>
      build().use(
        request({
          method: 'POST',
          headers: { cookie: `a2a.csrf=${stale}`, 'x-csrf-token': stale },
        }),
        reply(),
        jest.fn() as NextFunction,
      ),
    ).toThrow(ForbiddenException);
  });

  it('exempts bearer-token callers', () => {
    const next = jest.fn();
    build().use(
      request({ method: 'POST', headers: { authorization: 'Bearer abc' } }),
      reply(),
      next as NextFunction,
    );
    expect(next).toHaveBeenCalled();
  });

  it('exempts API-key callers', () => {
    const next = jest.fn();
    build().use(
      request({ method: 'POST', headers: { 'x-api-key': 'service-key' } }),
      reply(),
      next as NextFunction,
    );
    expect(next).toHaveBeenCalled();
  });
});
