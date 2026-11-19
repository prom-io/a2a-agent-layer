import { BadRequestException } from '@nestjs/common';
import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/** `translate`, `ocr.pdf`, `llm:chat`, `image-resize`: lowercase, no spaces. */
export const CAPABILITY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
export const MAX_CAPABILITIES_PER_SERVICE = 32;
export const MAX_CAPABILITY_FILTERS = 10;

export type CapabilityMatch = 'all' | 'any';

export interface CatalogFilters {
  capabilities?: string[];
  capabilityMatch?: CapabilityMatch;
  minPrice?: string;
  maxPrice?: string;
  currency?: string;
  available?: boolean;
}

/**
 * Lowercases, trims and de-duplicates capability tags, keeping the first
 * occurrence order. Throws on a tag that does not match CAPABILITY_PATTERN so
 * the catalog never stores a tag nobody can filter on.
 */
export function normalizeCapabilities(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  for (const raw of values) {
    const tag = String(raw).trim().toLowerCase();
    if (!CAPABILITY_PATTERN.test(tag)) {
      throw new BadRequestException(
        `Invalid capability "${raw}": use 1-64 lowercase letters, digits, ".", "_", ":" or "-"`,
      );
    }
    seen.add(tag);
  }
  return [...seen];
}

/** Compares two non-negative decimal strings without going through floats. */
export function compareDecimal(a: string, b: string): number {
  const [aWhole, aFraction = ''] = a.split('.');
  const [bWhole, bFraction = ''] = b.split('.');
  const width = Math.max(aFraction.length, bFraction.length);
  const left = BigInt(aWhole + aFraction.padEnd(width, '0'));
  const right = BigInt(bWhole + bFraction.padEnd(width, '0'));
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * Adds the filter clauses to a services query. Every filter is a WHERE clause
 * with bound parameters; nothing is filtered in memory, so pagination stays
 * correct.
 *
 * - capabilities: `@>` (has all) or `&&` (has any) on the GIN-indexed array.
 * - price range: the service has at least one tariff whose base price is in
 *   range (optionally in one currency). A service without tariffs has no price
 *   and is excluded as soon as a price bound is given.
 * - available: the listing is switched on and its agent is active. `false`
 *   returns exactly the complement, for operators cleaning up the catalog.
 */
export function applyCatalogFilters<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  filters: CatalogFilters,
): SelectQueryBuilder<T> {
  const capabilities = normalizeCapabilities(filters.capabilities);
  if (capabilities.length > MAX_CAPABILITY_FILTERS) {
    throw new BadRequestException(`At most ${MAX_CAPABILITY_FILTERS} capability filters`);
  }
  if (capabilities.length > 0) {
    const operator = filters.capabilityMatch === 'any' ? '&&' : '@>';
    qb.andWhere(`${alias}.capabilities ${operator} CAST(:capabilities AS text[])`, {
      capabilities,
    });
  }

  if (filters.minPrice !== undefined && filters.maxPrice !== undefined) {
    if (compareDecimal(filters.minPrice, filters.maxPrice) > 0) {
      throw new BadRequestException('minPrice must not be greater than maxPrice');
    }
  }
  const priceConditions: string[] = [];
  const priceParams: Record<string, string> = {};
  if (filters.minPrice !== undefined) {
    priceConditions.push('t."basePrice" >= CAST(:minPrice AS numeric)');
    priceParams.minPrice = filters.minPrice;
  }
  if (filters.maxPrice !== undefined) {
    priceConditions.push('t."basePrice" <= CAST(:maxPrice AS numeric)');
    priceParams.maxPrice = filters.maxPrice;
  }
  if (filters.currency !== undefined) {
    priceConditions.push('t."currency" = :currency');
    priceParams.currency = filters.currency;
  }
  if (priceConditions.length > 0) {
    qb.andWhere(
      `EXISTS (SELECT 1 FROM "tariffs" t WHERE t."serviceId" = ${alias}.id AND ${priceConditions.join(' AND ')})`,
      priceParams,
    );
  }

  if (filters.available !== undefined) {
    const availability =
      `(${alias}.available = true AND EXISTS ` +
      `(SELECT 1 FROM "agents" a WHERE a."id" = ${alias}.agentId AND a."status" = 'active'))`;
    qb.andWhere(filters.available ? availability : `NOT ${availability}`);
  }

  return qb;
}
