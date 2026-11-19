import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SelectQueryBuilder } from 'typeorm';
import {
  applyCatalogFilters,
  CatalogFilters,
  compareDecimal,
  normalizeCapabilities,
} from './catalog-filters';
import { ListServicesDto } from './dto/list-services.dto';
import { Service } from './entities/service.entity';

function run(filters: CatalogFilters) {
  const andWhere = jest.fn();
  const qb = { andWhere } as unknown as SelectQueryBuilder<Service>;
  andWhere.mockReturnValue(qb);
  applyCatalogFilters(qb, 's', filters);
  return andWhere.mock.calls as Array<[string, Record<string, unknown>?]>;
}

describe('normalizeCapabilities', () => {
  it('lowercases, trims and de-duplicates in first-seen order', () => {
    expect(normalizeCapabilities([' OCR ', 'translate', 'ocr', 'llm:chat'])).toEqual([
      'ocr',
      'translate',
      'llm:chat',
    ]);
  });

  it('returns an empty list for nothing', () => {
    expect(normalizeCapabilities(undefined)).toEqual([]);
  });

  it.each(['', 'has space', '-leading', 'x'.repeat(65), 'emoji🙂'])(
    'rejects the tag %p',
    (tag) => {
      expect(() => normalizeCapabilities([tag])).toThrow(BadRequestException);
    },
  );
});

describe('compareDecimal', () => {
  it.each([
    ['1', '1.0', 0],
    ['0.5', '0.50000000', 0],
    ['0.1', '0.09', 1],
    ['2', '10', -1],
    ['10.000000001', '10', 1],
  ])('%s vs %s is %i', (a, b, expected) => {
    expect(compareDecimal(a, b)).toBe(expected);
  });
});

describe('applyCatalogFilters', () => {
  it('adds nothing without filters', () => {
    expect(run({})).toEqual([]);
  });

  it('requires every capability by default', () => {
    const [[clause, params]] = run({ capabilities: ['Translate', 'ocr'] });

    expect(clause).toBe('s.capabilities @> CAST(:capabilities AS text[])');
    expect(params).toEqual({ capabilities: ['translate', 'ocr'] });
  });

  it('accepts any capability when asked', () => {
    const [[clause]] = run({ capabilities: ['ocr'], capabilityMatch: 'any' });

    expect(clause).toBe('s.capabilities && CAST(:capabilities AS text[])');
  });

  it('caps the number of capability filters', () => {
    const many = Array.from({ length: 11 }, (_, i) => `cap-${i}`);
    expect(() => run({ capabilities: many })).toThrow('At most 10 capability filters');
  });

  it('filters on a tariff in the price range, in one EXISTS clause', () => {
    const [[clause, params]] = run({ minPrice: '0.1', maxPrice: '2', currency: 'PROM' });

    expect(clause).toBe(
      'EXISTS (SELECT 1 FROM "tariffs" t WHERE t."serviceId" = s.id AND ' +
        't."basePrice" >= CAST(:minPrice AS numeric) AND ' +
        't."basePrice" <= CAST(:maxPrice AS numeric) AND t."currency" = :currency)',
    );
    expect(params).toEqual({ minPrice: '0.1', maxPrice: '2', currency: 'PROM' });
  });

  it('supports an open-ended price range', () => {
    const [[clause, params]] = run({ maxPrice: '0.5' });

    expect(clause).toContain('t."basePrice" <= CAST(:maxPrice AS numeric)');
    expect(clause).not.toContain(':minPrice');
    expect(params).toEqual({ maxPrice: '0.5' });
  });

  it('rejects an inverted price range', () => {
    expect(() => run({ minPrice: '2', maxPrice: '1.99' })).toThrow(
      'minPrice must not be greater than maxPrice',
    );
  });

  it('keeps a range with equal bounds', () => {
    expect(run({ minPrice: '1.0', maxPrice: '1' })).toHaveLength(1);
  });

  it('treats available=true as listed and offered by an active agent', () => {
    const [[clause]] = run({ available: true });

    expect(clause).toBe(
      `(s.available = true AND EXISTS (SELECT 1 FROM "agents" a WHERE a."id" = s.agentId AND a."status" = 'active'))`,
    );
  });

  it('returns the exact complement for available=false', () => {
    const [[clause]] = run({ available: false });

    expect(clause.startsWith('NOT (s.available = true AND EXISTS')).toBe(true);
  });

  it('combines filters with AND, one clause each', () => {
    expect(
      run({ capabilities: ['ocr'], minPrice: '0', available: true }).map(([clause]) =>
        clause.slice(0, 12),
      ),
    ).toEqual(['s.capabiliti', 'EXISTS (SELE', '(s.available']);
  });
});

describe('ListServicesDto query parsing', () => {
  const parse = (query: Record<string, unknown>) => {
    const dto = plainToInstance(ListServicesDto, query);
    return { dto, errors: validateSync(dto) };
  };

  it('accepts repeated and comma-separated capabilities alike', () => {
    expect(parse({ capability: 'OCR,translate' }).dto.capability).toEqual(['ocr', 'translate']);
    expect(parse({ capability: ['ocr', 'translate'] }).dto.capability).toEqual([
      'ocr',
      'translate',
    ]);
  });

  it('parses available only from the literal words', () => {
    expect(parse({ available: 'true' }).dto.available).toBe(true);
    expect(parse({ available: 'false' }).dto.available).toBe(false);
    expect(parse({ available: 'yes' }).errors.map((e) => e.property)).toEqual(['available']);
  });

  it('rejects prices that are not plain decimals', () => {
    const { errors } = parse({ minPrice: '-1', maxPrice: '1e3' });
    expect(errors.map((e) => e.property).sort()).toEqual(['maxPrice', 'minPrice']);
  });

  it('rejects a malformed capability and an unknown match mode', () => {
    const { errors } = parse({ capability: 'bad tag', capabilityMatch: 'some' });
    expect(errors.map((e) => e.property).sort()).toEqual(['capability', 'capabilityMatch']);
  });
});
