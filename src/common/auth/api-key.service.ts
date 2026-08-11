import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';

export interface ApiKeyIdentity {
  label: string;
}

/**
 * Static API keys for service-to-service callers (payment rail, verification
 * network). Configured as comma-separated `label:key` pairs in API_KEYS.
 *
 * Keys are stored as SHA-256 digests and compared with timingSafeEqual over
 * fixed-width digests. Comparing the raw strings would leak key length and
 * allow a byte-by-byte timing attack, which matters here because these keys do
 * not rotate on their own.
 */
@Injectable()
export class ApiKeyService implements OnModuleInit {
  private readonly logger = new Logger(ApiKeyService.name);
  private readonly keys = new Map<string, string>(); // digest -> label

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const raw = this.config.get<string>('security.apiKeys.raw', '');
    for (const pair of raw.split(',')) {
      const trimmed = pair.trim();
      if (!trimmed) continue;

      const separator = trimmed.indexOf(':');
      if (separator <= 0 || separator === trimmed.length - 1) {
        this.logger.warn(`Ignoring malformed API_KEYS entry, expected label:key`);
        continue;
      }

      const label = trimmed.slice(0, separator);
      const secret = trimmed.slice(separator + 1);
      this.keys.set(this.digest(secret), label);
    }

    this.logger.log(`Loaded ${this.keys.size} service API key(s)`);
  }

  get header(): string {
    return this.config.get<string>('security.apiKeys.header', 'x-api-key');
  }

  get enabled(): boolean {
    return this.keys.size > 0;
  }

  verify(presented: string | undefined): ApiKeyIdentity | null {
    if (!presented || this.keys.size === 0) return null;

    const candidate = this.digest(presented);
    const candidateBuffer = Buffer.from(candidate, 'hex');

    for (const [digest, label] of this.keys) {
      const known = Buffer.from(digest, 'hex');
      if (known.length === candidateBuffer.length && timingSafeEqual(known, candidateBuffer)) {
        return { label };
      }
    }
    return null;
  }

  private digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
