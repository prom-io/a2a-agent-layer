import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, ScryptOptions, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

// promisify() resolves to scrypt's three-argument overload, which silently
// drops the cost parameters below. Pin the options-aware signature.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS: ScryptOptions = {
  N: 16384,
  r: 8,
  p: 1,
  // Node's default maxmem (32 MB) is below what N=16384, r=8 needs, so without
  // this the call fails at runtime rather than at review time.
  maxmem: 64 * 1024 * 1024,
};

/**
 * Password hashing for operator accounts.
 *
 * Format is `salt:key`, both hex. Verification is constant-time and never
 * short-circuits on length, so neither the salt nor the key length is
 * observable from timing.
 */
@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
    return `${salt}:${derived.toString('hex')}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const [salt, keyHex] = (stored ?? '').split(':');
    if (!salt || !keyHex) return false;

    let storedKey: Buffer;
    try {
      storedKey = Buffer.from(keyHex, 'hex');
    } catch {
      return false;
    }
    if (storedKey.length !== SCRYPT_KEYLEN) return false;

    const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
    return timingSafeEqual(storedKey, derived);
  }
}
