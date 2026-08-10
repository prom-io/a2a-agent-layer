import { registerAs } from '@nestjs/config';

const isProduction = process.env.NODE_ENV === 'production';

function required(name: string, fallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) {
    throw new Error(
      `${name} must be set in production — refusing to start on a development default`,
    );
  }
  return fallback;
}

function int(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Single source of truth for every security knob.
 *
 * The dev defaults are deliberately fatal in production: a service that boots
 * happily on `dev-secret-change-me` is worse than one that refuses to boot,
 * because nothing surfaces the mistake until tokens are already being trusted.
 */
export default registerAs('security', () => ({
  jwt: {
    secret: required('JWT_SECRET', 'dev-secret-change-me'),
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  apiKeys: {
    // Comma-separated `label:key` pairs for service-to-service callers.
    raw: process.env.API_KEYS ?? '',
    header: process.env.API_KEY_HEADER ?? 'x-api-key',
  },
  csrf: {
    secret: required('CSRF_SECRET', 'dev-csrf-secret-change-me'),
    cookieName: process.env.CSRF_COOKIE_NAME ?? 'a2a.csrf',
    headerName: process.env.CSRF_HEADER_NAME ?? 'x-csrf-token',
    ttlMs: int('CSRF_TTL_MS', 3_600_000),
  },
  throttle: {
    shortTtl: int('THROTTLE_SHORT_TTL', 1000),
    shortLimit: int('THROTTLE_SHORT_LIMIT', 10),
    longTtl: int('THROTTLE_LONG_TTL', 60_000),
    longLimit: int('THROTTLE_LONG_LIMIT', 100),
  },
  cors: {
    origins: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  },
  headers: {
    hsts: process.env.HSTS_ENABLED !== 'false',
    csp: process.env.CSP_POLICY ?? "default-src 'self'",
  },
}));
