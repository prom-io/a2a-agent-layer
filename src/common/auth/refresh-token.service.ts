import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { JwtPayload } from './jwt.strategy';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

type RefreshPayload = JwtPayload & { jti: string; exp?: number };

/**
 * Refresh tokens with rotation and a revocation list.
 *
 * Every rotation invalidates the token it consumed, so a stolen refresh token
 * is usable at most once, and the theft becomes visible the next time the
 * legitimate holder tries to use it.
 *
 * The revocation list is in-process. That is correct for a single instance and
 * wrong the moment the layer is scaled horizontally — a token revoked on one
 * pod stays valid on the others. Moving this to Redis is P4 work; until then
 * do not run more than one replica with refresh enabled.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  /** token hash -> unix seconds at which the entry can be forgotten */
  private readonly revoked = new Map<string, number>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  issueTokenPair(payload: JwtPayload): TokenPair {
    const accessExpiresIn = this.configService.get<string>('security.jwt.expiresIn', '1h');
    const refreshExpiresIn = this.configService.get<string>(
      'security.jwt.refreshExpiresIn',
      '7d',
    );

    const accessToken = this.jwtService.sign(payload, { expiresIn: accessExpiresIn });
    const refreshToken = this.jwtService.sign(
      { ...payload, jti: randomBytes(16).toString('hex') },
      { expiresIn: refreshExpiresIn },
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: this.parseExpiresIn(accessExpiresIn),
    };
  }

  rotate(refreshToken: string): TokenPair {
    this.evictExpired();

    if (this.revoked.has(this.hashToken(refreshToken))) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    let payload: RefreshPayload;
    try {
      payload = this.jwtService.verify<RefreshPayload>(refreshToken);
    } catch (error) {
      this.logger.warn(`Refresh token rotation failed: ${(error as Error).message}`);
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Revoke before issuing: if issuing throws, the consumed token must not
    // remain usable.
    this.revoke(refreshToken, payload.exp);

    return this.issueTokenPair({
      sub: payload.sub,
      did: payload.did,
      role: payload.role,
    });
  }

  revoke(refreshToken: string, expiresAtSeconds?: number): void {
    // An entry only has to outlive the token itself; keeping it forever turns
    // the revocation list into an unbounded memory leak.
    const fallback = Math.floor(Date.now() / 1000) + this.parseExpiresIn(
      this.configService.get<string>('security.jwt.refreshExpiresIn', '7d'),
    );
    this.revoked.set(this.hashToken(refreshToken), expiresAtSeconds ?? fallback);
  }

  isRevoked(refreshToken: string): boolean {
    this.evictExpired();
    return this.revoked.has(this.hashToken(refreshToken));
  }

  /** Visible for tests and health reporting. */
  get revokedCount(): number {
    return this.revoked.size;
  }

  private evictExpired(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [hash, expiresAt] of this.revoked) {
      if (expiresAt <= now) this.revoked.delete(hash);
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseExpiresIn(value: string): number {
    const match = /^(\d+)([smhd])$/.exec(value);
    if (!match) return 3600;
    const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return Number.parseInt(match[1], 10) * (units[match[2]] ?? 1);
  }
}
