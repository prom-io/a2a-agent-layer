import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Signed double-submit CSRF protection.
 *
 * The cookie holds `nonce.issuedAt.hmac`; an unsafe request must echo the same
 * value in a header. Plain double-submit trusts any cookie the browser sends,
 * which a subdomain takeover can write — the HMAC means only this service can
 * mint a token that validates.
 *
 * Bearer-token and API-key callers are exempt. CSRF only applies to
 * credentials the browser attaches on its own; requiring a token from
 * server-to-server agents would break them for no security gain.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  constructor(private readonly config: ConfigService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const cookieName = this.config.get<string>('security.csrf.cookieName', 'a2a.csrf');
    const headerName = this.config.get<string>('security.csrf.headerName', 'x-csrf-token');
    const apiKeyHeader = this.config.get<string>('security.apiKeys.header', 'x-api-key');

    const existing = this.readCookie(req, cookieName);
    if (!existing || !this.isValid(existing)) {
      const token = this.mint();
      res.cookie?.(cookieName, token, {
        httpOnly: false, // the client has to read it to echo it back
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
      });
      res.setHeader(headerName, token);
    }

    if (SAFE_METHODS.has(req.method)) return next();
    if (req.headers.authorization || req.headers[apiKeyHeader]) return next();

    const cookieToken = this.readCookie(req, cookieName);
    const headerToken = req.headers[headerName];
    const presented = Array.isArray(headerToken) ? headerToken[0] : headerToken;

    if (!cookieToken || !presented) {
      throw new ForbiddenException('CSRF token missing');
    }
    if (!this.isValid(presented) || !this.equal(cookieToken, presented)) {
      throw new ForbiddenException('CSRF token invalid');
    }

    return next();
  }

  private mint(): string {
    const nonce = randomBytes(16).toString('hex');
    const issuedAt = Date.now().toString();
    return `${nonce}.${issuedAt}.${this.sign(nonce, issuedAt)}`;
  }

  private isValid(token: string): boolean {
    const [nonce, issuedAt, mac] = token.split('.');
    if (!nonce || !issuedAt || !mac) return false;

    const age = Date.now() - Number.parseInt(issuedAt, 10);
    const ttl = this.config.get<number>('security.csrf.ttlMs', 3_600_000);
    if (!Number.isFinite(age) || age < 0 || age > ttl) return false;

    return this.equal(mac, this.sign(nonce, issuedAt));
  }

  private sign(nonce: string, issuedAt: string): string {
    const secret = this.config.getOrThrow<string>('security.csrf.secret');
    return createHmac('sha256', secret).update(`${nonce}.${issuedAt}`).digest('hex');
  }

  private equal(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  /**
   * Reads the cookie off the raw header rather than req.cookies, so the
   * middleware works whether or not cookie-parser is installed ahead of it.
   */
  private readCookie(req: Request, name: string): string | undefined {
    const parsed = (req as Request & { cookies?: Record<string, string> }).cookies;
    if (parsed?.[name]) return parsed[name];

    const header = req.headers.cookie;
    if (!header) return undefined;

    for (const part of header.split(';')) {
      const [key, ...rest] = part.trim().split('=');
      if (key === name) return decodeURIComponent(rest.join('='));
    }
    return undefined;
  }
}
