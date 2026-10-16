import { In, Repository } from 'typeorm';
import { Tariff } from '../pricing/entities/tariff.entity';
import { PricingService } from '../pricing/pricing.service';
import { CatalogService, escapeLike, ServiceWithTariffs } from './catalog.service';
import { Service } from './entities/service.entity';

describe('catalog listing query count', () => {
  let services: Service[];
  let tariffs: Tariff[];
  let serviceQueries: number;
  let tariffFind: jest.Mock;
  let qb: Record<string, jest.Mock>;
  let catalog: CatalogService;
  let pricing: PricingService;

  const service = (n: number) => ({ id: `svc-${n}`, agentId: 'agent-1', name: `s${n}` }) as Service;
  const tariff = (id: string, serviceId: string) => ({ id, serviceId }) as Tariff;

  beforeEach(() => {
    serviceQueries = 0;
    services = [];
    tariffs = [];

    qb = {};
    for (const method of ['orderBy', 'andWhere', 'take', 'skip']) {
      qb[method] = jest.fn().mockReturnValue(qb);
    }
    qb.getMany = jest.fn(async () => {
      serviceQueries += 1;
      return services;
    });

    tariffFind = jest.fn(async () => tariffs);
    pricing = new PricingService({ find: tariffFind } as unknown as Repository<Tariff>);
    catalog = new CatalogService(
      { createQueryBuilder: jest.fn(() => qb) } as unknown as Repository<Service>,
      pricing,
    );
  });

  it('lists services without touching tariffs by default', async () => {
    services = [service(1), service(2)];

    const result = await catalog.findAll();

    expect(result).toHaveLength(2);
    expect(serviceQueries).toBe(1);
    expect(tariffFind).not.toHaveBeenCalled();
  });

  it.each([1, 10, 150])('uses two queries for a page of %i services with tariffs', async (count) => {
    services = Array.from({ length: count }, (_, i) => service(i));
    tariffs = services.map((s) => tariff(`t-${s.id}`, s.id));

    const result = (await catalog.findAll({ include: 'tariffs' })) as ServiceWithTariffs[];

    expect(result).toHaveLength(count);
    expect(serviceQueries).toBe(1);
    expect(tariffFind).toHaveBeenCalledTimes(1);
    expect(result.every((s) => s.tariffs.length === 1 && s.tariffs[0].serviceId === s.id)).toBe(true);
  });

  it('asks for all page ids in one IN clause', async () => {
    services = [service(1), service(2), service(3)];

    await catalog.findAll({ include: 'tariffs' });

    expect(tariffFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { serviceId: In(['svc-1', 'svc-2', 'svc-3']) } }),
    );
  });

  it('groups several tariffs per service and gives unpriced services an empty list', async () => {
    services = [service(1), service(2)];
    tariffs = [tariff('t-a', 'svc-1'), tariff('t-b', 'svc-1')];

    const result = (await catalog.findAll({ include: 'tariffs' })) as ServiceWithTariffs[];

    expect(result[0].tariffs.map((t) => t.id)).toEqual(['t-a', 't-b']);
    expect(result[1].tariffs).toEqual([]);
  });

  it('skips the tariff query when the page is empty', async () => {
    const result = await catalog.findAll({ include: 'tariffs' });

    expect(result).toEqual([]);
    expect(tariffFind).not.toHaveBeenCalled();
  });

  it('applies filters and pagination in the database', async () => {
    await catalog.findAll({ agentId: 'agent-1', q: ' 50%_off ', page: 3, limit: 20 });

    expect(qb.andWhere).toHaveBeenCalledWith('s.agentId = :agentId', { agentId: 'agent-1' });
    expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), {
      q: '%50\\%\\_off%',
    });
    expect(qb.take).toHaveBeenCalledWith(20);
    expect(qb.skip).toHaveBeenCalledWith(40);
  });
});

describe('PricingService lookups', () => {
  let find: jest.Mock;
  let pricing: PricingService;

  beforeEach(() => {
    find = jest.fn(async () => []);
    pricing = new PricingService({ find } as unknown as Repository<Tariff>);
  });

  it('does not query for an empty id list', async () => {
    expect((await pricing.findByServiceIds([])).size).toBe(0);
    expect(find).not.toHaveBeenCalled();
  });

  it('de-duplicates ids before querying', async () => {
    await pricing.findByServiceIds(['svc-1', 'svc-1', 'svc-2']);

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { serviceId: In(['svc-1', 'svc-2']) } }),
    );
  });

  it('filters by service in the database when asked', async () => {
    await pricing.findAll({ serviceId: 'svc-9' });
    await pricing.findAll();

    expect(find).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { serviceId: 'svc-9' } }));
    expect(find).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: {} }));
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLike('100%_a\\b')).toBe('100\\%\\_a\\\\b');
    expect(escapeLike('translate')).toBe('translate');
  });
});
