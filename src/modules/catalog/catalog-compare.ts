import { Tariff, TariffType } from '../pricing/entities/tariff.entity';
import { compareDecimal } from './catalog-filters';
import { Service } from './entities/service.entity';

/**
 * SLA fields the comparison understands. Providers write `slaHints` as free
 * JSON, so every field accepts the spellings seen in practice; the first one
 * present wins.
 */
export const SLA_FIELDS = {
  latencyP95Ms: {
    aliases: ['latencyP95Ms', 'p95LatencyMs', 'latencyMs', 'maxLatencyMs'],
    better: 'lower',
  },
  uptime: { aliases: ['uptime', 'availability', 'uptimePercent'], better: 'higher' },
  maxConcurrency: { aliases: ['maxConcurrency', 'concurrency'], better: 'higher' },
  throughputRpm: {
    aliases: ['throughputRpm', 'requestsPerMinute', 'rateLimitPerMinute'],
    better: 'higher',
  },
} as const;

export type SlaField = keyof typeof SLA_FIELDS;
export type Better = 'lower' | 'higher';

export interface NormalizedSla {
  latencyP95Ms: number | null;
  /** Fraction 0..1; "99.9" percent-style values are converted. */
  uptime: number | null;
  maxConcurrency: number | null;
  throughputRpm: number | null;
}

export interface TariffSummary {
  tariffId: string;
  basePrice: string;
  variablePrice: string | null;
  currency: string;
}

export interface ComparedService {
  id: string;
  agentId: string;
  name: string;
  capabilities: string[];
  available: boolean;
  /** Cheapest tariff per tariff type the service offers. */
  pricing: Partial<Record<TariffType, TariffSummary>>;
  sla: NormalizedSla;
}

export interface FieldVerdict {
  better: Better;
  /** Services that share the best value; empty when nobody has the field. */
  best: string[];
  /** Services that do not state the field at all. */
  missing: string[];
}

export interface ServiceComparison {
  services: ComparedService[];
  /** Keyed by `pricing.<tariff type>` and `sla.<field>`. */
  fields: Record<string, FieldVerdict>;
  /** Requested ids that are not in the catalog. */
  notFound: string[];
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
  return null;
}

export function normalizeSla(hints: Record<string, unknown> | null | undefined): NormalizedSla {
  const sla: NormalizedSla = { latencyP95Ms: null, uptime: null, maxConcurrency: null, throughputRpm: null };
  if (!hints || typeof hints !== 'object') return sla;

  for (const field of Object.keys(SLA_FIELDS) as SlaField[]) {
    for (const alias of SLA_FIELDS[field].aliases) {
      const value = toNumber(hints[alias]);
      if (value === null || value < 0) continue;
      sla[field] = value;
      break;
    }
  }
  // 99.95 means percent; nothing can be up more than 100% of the time.
  if (sla.uptime !== null && sla.uptime > 1) {
    sla.uptime = sla.uptime <= 100 ? Number((sla.uptime / 100).toFixed(6)) : null;
  }
  return sla;
}

/**
 * Cheapest tariff per type. Prices are only compared within one currency:
 * the first currency seen for a type wins and other currencies of that type
 * are ignored rather than compared as if they were the same unit.
 */
export function cheapestByType(tariffs: Tariff[]): Partial<Record<TariffType, TariffSummary>> {
  const result: Partial<Record<TariffType, TariffSummary>> = {};
  for (const tariff of tariffs) {
    const current = result[tariff.type];
    if (current && current.currency !== tariff.currency) continue;
    if (!current || compareDecimal(String(tariff.basePrice), current.basePrice) < 0) {
      result[tariff.type] = {
        tariffId: tariff.id,
        basePrice: String(tariff.basePrice),
        variablePrice: tariff.variablePrice === null ? null : String(tariff.variablePrice),
        currency: tariff.currency,
      };
    }
  }
  return result;
}

function verdict(
  entries: Array<{ id: string; value: string | number | null }>,
  better: Better,
  compare: (a: string | number, b: string | number) => number,
): FieldVerdict {
  const present = entries.filter((entry) => entry.value !== null) as Array<{
    id: string;
    value: string | number;
  }>;
  const missing = entries.filter((entry) => entry.value === null).map((entry) => entry.id);
  if (present.length === 0) return { better, best: [], missing };

  let bestValue = present[0].value;
  for (const entry of present.slice(1)) {
    const order = compare(entry.value, bestValue);
    if ((better === 'lower' && order < 0) || (better === 'higher' && order > 0)) bestValue = entry.value;
  }
  const best = present.filter((entry) => compare(entry.value, bestValue) === 0).map((entry) => entry.id);
  return { better, best, missing };
}

/**
 * Side-by-side view of catalog services: the cheapest price per tariff type
 * and the normalized SLA figures, plus which services lead on each field.
 * Pure function over already loaded rows; the order of `services` follows the
 * order of `requestedIds`.
 */
export function compareServices(
  requestedIds: string[],
  services: Service[],
  tariffs: Map<string, Tariff[]>,
): ServiceComparison {
  const byId = new Map(services.map((service) => [service.id, service]));
  const ordered = requestedIds
    .map((id) => byId.get(id))
    .filter((service): service is Service => service !== undefined);

  const compared: ComparedService[] = ordered.map((service) => ({
    id: service.id,
    agentId: service.agentId,
    name: service.name,
    capabilities: service.capabilities ?? [],
    available: service.available ?? true,
    pricing: cheapestByType(tariffs.get(service.id) ?? []),
    sla: normalizeSla(service.slaHints),
  }));

  const fields: Record<string, FieldVerdict> = {};

  const types = new Set<TariffType>();
  for (const service of compared) {
    for (const type of Object.keys(service.pricing) as TariffType[]) types.add(type);
  }
  for (const type of [...types].sort()) {
    const currencies = new Set(
      compared.map((service) => service.pricing[type]?.currency).filter((currency) => currency),
    );
    // Prices in different currencies are not comparable; say nothing rather than mislead.
    if (currencies.size > 1) continue;
    fields[`pricing.${type}`] = verdict(
      compared.map((service) => ({ id: service.id, value: service.pricing[type]?.basePrice ?? null })),
      'lower',
      (a, b) => compareDecimal(String(a), String(b)),
    );
  }

  for (const field of Object.keys(SLA_FIELDS) as SlaField[]) {
    fields[`sla.${field}`] = verdict(
      compared.map((service) => ({ id: service.id, value: service.sla[field] })),
      SLA_FIELDS[field].better,
      (a, b) => Number(a) - Number(b),
    );
  }

  return {
    services: compared,
    fields,
    notFound: requestedIds.filter((id) => !byId.has(id)),
  };
}
