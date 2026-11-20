import { BadRequestException, NotFoundException } from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { Tariff, TariffType } from '../pricing/entities/tariff.entity';
import { PricingService } from '../pricing/pricing.service';
import { cheapestByType, compareServices, normalizeSla } from './catalog-compare';
import { CatalogService } from './catalog.service';
import { Service } from './entities/service.entity';

const service = (id: string, slaHints: Record<string, unknown> | null = null) =>
  ({ id, agentId: `agent-${id}`, name: `svc ${id}`, capabilities: ['ocr'], available: true, slaHints }) as Service;

const tariff = (
  id: string,
  serviceId: string,
  type: TariffType,
  basePrice: string,
  currency = 'PROM',
) => ({ id, serviceId, type, basePrice, variablePrice: null, currency }) as Tariff;

describe('normalizeSla', () => {
  it('reads the canonical names', () => {
    expect(
      normalizeSla({ latencyP95Ms: 800, uptime: 0.999, maxConcurrency: 4, throughputRpm: 600 }),
    ).toEqual({ latencyP95Ms: 800, uptime: 0.999, maxConcurrency: 4, throughputRpm: 600 });
  });

  it('accepts aliases and numeric strings', () => {
    expect(normalizeSla({ p95LatencyMs: '250', availability: '0.95', concurrency: 2 })).toEqual({
      latencyP95Ms: 250,
      uptime: 0.95,
      maxConcurrency: 2,
      throughputRpm: null,
    });
  });

  it('converts percent-style uptime and drops impossible values', () => {
    expect(normalizeSla({ uptime: 99.95 }).uptime).toBe(0.9995);
    expect(normalizeSla({ uptime: 250 }).uptime).toBeNull();
    expect(normalizeSla({ latencyMs: -5 }).latencyP95Ms).toBeNull();
  });

  it('ignores values that are not numbers', () => {
    expect(normalizeSla({ latencyMs: 'fast', uptime: true })).toEqual({
      latencyP95Ms: null,
      uptime: null,
      maxConcurrency: null,
      throughputRpm: null,
    });
    expect(normalizeSla(null).uptime).toBeNull();
  });
});

describe('cheapestByType', () => {
  it('keeps the cheapest tariff of each type, compared as decimals', () => {
    const result = cheapestByType([
      tariff('t1', 's', TariffType.PER_REQUEST, '0.10000000'),
      tariff('t2', 's', TariffType.PER_REQUEST, '0.09'),
      tariff('t3', 's', TariffType.PER_TOKEN, '0.00001'),
    ]);

    expect(result[TariffType.PER_REQUEST]?.tariffId).toBe('t2');
    expect(result[TariffType.PER_TOKEN]?.basePrice).toBe('0.00001');
  });

  it('does not compare prices across currencies', () => {
    const result = cheapestByType([
      tariff('t1', 's', TariffType.PER_REQUEST, '5', 'PROM'),
      tariff('t2', 's', TariffType.PER_REQUEST, '1', 'USDC'),
    ]);

    expect(result[TariffType.PER_REQUEST]?.tariffId).toBe('t1');
  });
});

describe('compareServices', () => {
  const services = [
    service('a', { latencyP95Ms: 900, uptime: 0.99 }),
    service('b', { latencyP95Ms: 300, uptime: 0.999 }),
    service('c', { latencyP95Ms: 300 }),
  ];
  const tariffs = new Map<string, Tariff[]>([
    ['a', [tariff('ta', 'a', TariffType.PER_REQUEST, '0.5')]],
    ['b', [tariff('tb', 'b', TariffType.PER_REQUEST, '0.75')]],
    ['c', [tariff('tc', 'c', TariffType.PER_REQUEST, '0.50000000')]],
  ]);

  it('keeps the requested order and reports unknown ids', () => {
    const result = compareServices(['c', 'x', 'a', 'b'], services, tariffs);

    expect(result.services.map((s) => s.id)).toEqual(['c', 'a', 'b']);
    expect(result.notFound).toEqual(['x']);
  });

  it('marks the cheapest services, ties included', () => {
    const result = compareServices(['a', 'b', 'c'], services, tariffs);

    expect(result.fields['pricing.per_request']).toEqual({
      better: 'lower',
      best: ['a', 'c'],
      missing: [],
    });
  });

  it('marks lower latency and higher uptime as better', () => {
    const result = compareServices(['a', 'b', 'c'], services, tariffs);

    expect(result.fields['sla.latencyP95Ms'].best).toEqual(['b', 'c']);
    expect(result.fields['sla.uptime']).toEqual({ better: 'higher', best: ['b'], missing: ['c'] });
    expect(result.fields['sla.maxConcurrency']).toEqual({
      better: 'higher',
      best: [],
      missing: ['a', 'b', 'c'],
    });
  });

  it('lists services without a tariff of a type as missing it', () => {
    const result = compareServices(
      ['a', 'b'],
      services,
      new Map([['a', [tariff('ta', 'a', TariffType.PER_TOKEN, '0.001')]]]),
    );

    expect(result.fields['pricing.per_token']).toEqual({
      better: 'lower',
      best: ['a'],
      missing: ['b'],
    });
    expect(result.services[1].pricing).toEqual({});
  });

  it('skips a price verdict when the services price in different currencies', () => {
    const result = compareServices(
      ['a', 'b'],
      services,
      new Map([
        ['a', [tariff('ta', 'a', TariffType.PER_REQUEST, '1', 'PROM')]],
        ['b', [tariff('tb', 'b', TariffType.PER_REQUEST, '1', 'USDC')]],
      ]),
    );

    expect(result.fields['pricing.per_request']).toBeUndefined();
  });
});

describe('CatalogService.compare', () => {
  let findBy: jest.Mock;
  let findByServiceIds: jest.Mock;
  let catalog: CatalogService;

  beforeEach(() => {
    findBy = jest.fn(async () => [service('11111111-1111-4111-8111-111111111111')]);
    findByServiceIds = jest.fn(async () => new Map());
    catalog = new CatalogService(
      { findBy } as unknown as Repository<Service>,
      { findByServiceIds } as unknown as PricingService,
    );
  });

  it('loads services and their tariffs in two queries', async () => {
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];

    const result = await catalog.compare(ids);

    expect(findBy).toHaveBeenCalledWith({ id: In(ids) });
    expect(findByServiceIds).toHaveBeenCalledTimes(1);
    expect(result.notFound).toEqual(['22222222-2222-4222-8222-222222222222']);
  });

  it('rejects comparing a service with itself', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    await expect(catalog.compare([id, id.toUpperCase()])).rejects.toThrow(BadRequestException);
    expect(findBy).not.toHaveBeenCalled();
  });

  it('answers 404 when nothing exists', async () => {
    findBy.mockResolvedValue([]);
    await expect(
      catalog.compare(['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']),
    ).rejects.toThrow(NotFoundException);
  });
});
