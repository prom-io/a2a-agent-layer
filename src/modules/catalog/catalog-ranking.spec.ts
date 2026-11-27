import { Repository, SelectQueryBuilder } from 'typeorm';
import { PricingService } from '../pricing/pricing.service';
import {
  applyRanking,
  compositeScoreSql,
  DEFAULT_RANK_WEIGHTS,
  effectiveWeights,
  minPriceSql,
  parseRankWeights,
  RANK_ALIASES,
  rankingFromRaw,
  reputationSql,
} from './catalog-ranking';
import { CatalogService } from './catalog.service';
import { Service } from './entities/service.entity';

type Qb = Record<'addSelect' | 'orderBy' | 'addOrderBy' | 'setParameter', jest.Mock>;

function mockQb(): Qb {
  const qb = {} as Qb;
  for (const method of ['addSelect', 'orderBy', 'addOrderBy', 'setParameter'] as const) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  return qb;
}
const asQb = (qb: Qb) => qb as unknown as SelectQueryBuilder<Service>;

describe('parseRankWeights', () => {
  it('reads named weights', () => {
    expect(parseRankWeights('reputation:0.7, price:0.3')).toEqual({
      reputation: 0.7,
      price: 0.3,
      relevance: 0,
    });
  });

  it.each([undefined, '', 'nonsense', 'reputation:-1', 'price:abc', 'reputation:0,price:0'])(
    'falls back to the defaults for %p',
    (raw) => {
      expect(parseRankWeights(raw)).toEqual(DEFAULT_RANK_WEIGHTS);
    },
  );

  it('ignores unknown names next to valid ones', () => {
    expect(parseRankWeights('speed:9,price:1')).toEqual({ reputation: 0, price: 1, relevance: 0 });
  });
});

describe('effectiveWeights', () => {
  it('normalizes to a sum of 1', () => {
    const weights = effectiveWeights({ reputation: 2, price: 1, relevance: 1 }, true);
    expect(weights).toEqual({ reputation: 0.5, price: 0.25, relevance: 0.25 });
  });

  it('spreads the relevance share over the rest when there is no search', () => {
    const weights = effectiveWeights(DEFAULT_RANK_WEIGHTS, false);
    expect(weights.relevance).toBe(0);
    expect(weights.reputation).toBeCloseTo(0.625);
    expect(weights.price).toBeCloseTo(0.375);
  });

  it('gives all zeros when only relevance is weighted and nothing is searched', () => {
    expect(effectiveWeights({ reputation: 0, price: 0, relevance: 1 }, false)).toEqual({
      reputation: 0,
      price: 0,
      relevance: 0,
    });
  });
});

describe('ranking SQL', () => {
  it('reads the newest snapshot of the agent', () => {
    expect(reputationSql('s')).toBe(
      '(SELECT r."score" FROM "agent_reputation_snapshots" r WHERE r."agentId" = s.agentId ' +
        'ORDER BY r."fetchedAt" DESC LIMIT 1)',
    );
  });

  it('takes the cheapest tariff, optionally in one currency', () => {
    expect(minPriceSql('s', false)).toBe(
      '(SELECT MIN(t."basePrice") FROM "tariffs" t WHERE t."serviceId" = s.id)',
    );
    expect(minPriceSql('s', true)).toContain('AND t."currency" = :rankCurrency');
  });

  it('weighs the components of the composite score', () => {
    const sql = compositeScoreSql('s', {
      hasSearch: true,
      weights: { reputation: 0.5, price: 0.3, relevance: 0.2 },
      neutralReputation: 0.4,
    });

    expect(sql).toContain('0.500000 * COALESCE((SELECT r."score"');
    expect(sql).toContain(', 0.4000)');
    expect(sql).toContain('0.300000 * COALESCE(CASE WHEN');
    expect(sql).toContain('MIN((SELECT MIN(t."basePrice")');
    expect(sql).toContain('0.200000 * COALESCE(ts_rank(s.searchVector');
    expect(sql).toContain('MAX(ts_rank(');
  });

  it('leaves relevance out without a search', () => {
    expect(compositeScoreSql('s', { hasSearch: false })).not.toContain('ts_rank');
  });
});

describe('applyRanking', () => {
  it('keeps the search order for relevance', () => {
    const qb = mockQb();

    expect(applyRanking(asQb(qb), 's', 'relevance', { hasSearch: true })).toBe(false);
    expect(qb.orderBy).not.toHaveBeenCalled();
  });

  it('orders newest first with a stable tie-break, also for relevance without a search', () => {
    for (const sort of ['newest', 'relevance'] as const) {
      const qb = mockQb();
      expect(applyRanking(asQb(qb), 's', sort, { hasSearch: false })).toBe(false);
      expect(qb.orderBy).toHaveBeenCalledWith('s.createdAt', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('s.id', 'ASC');
      expect(qb.addSelect).not.toHaveBeenCalled();
    }
  });

  it('orders by reputation with unscored agents last', () => {
    const qb = mockQb();

    expect(applyRanking(asQb(qb), 's', 'reputation', { hasSearch: false })).toBe(true);
    expect(qb.orderBy).toHaveBeenCalledWith(RANK_ALIASES.reputation, 'DESC', 'NULLS LAST');
    expect(qb.addOrderBy).toHaveBeenNthCalledWith(1, 's.createdAt', 'DESC');
  });

  it('orders by price with unpriced services last and binds the currency', () => {
    const qb = mockQb();

    applyRanking(asQb(qb), 's', 'price', { hasSearch: false, currency: 'PROM' });

    expect(qb.orderBy).toHaveBeenCalledWith(RANK_ALIASES.price, 'ASC', 'NULLS LAST');
    expect(qb.setParameter).toHaveBeenCalledWith('rankCurrency', 'PROM');
  });

  it('selects and orders by the composite score for best', () => {
    const qb = mockQb();

    applyRanking(asQb(qb), 's', 'best', { hasSearch: false });

    expect(qb.addSelect.mock.calls.map((call) => call[1])).toEqual([
      RANK_ALIASES.reputation,
      RANK_ALIASES.price,
      RANK_ALIASES.score,
    ]);
    expect(qb.orderBy).toHaveBeenCalledWith(RANK_ALIASES.score, 'DESC', 'NULLS LAST');
  });
});

describe('rankingFromRaw', () => {
  it('converts the raw columns', () => {
    expect(
      rankingFromRaw({ rank_reputation: '0.9000', rank_min_price: '0.50000000', rank_score: '0.81234567' }),
    ).toEqual({ reputation: 0.9, minPrice: '0.50000000', score: 0.812346 });
  });

  it('keeps missing figures as null', () => {
    expect(rankingFromRaw({ rank_reputation: null })).toEqual({
      reputation: null,
      minPrice: null,
      score: null,
    });
  });
});

describe('CatalogService ranked listing', () => {
  it('attaches the ranking figures of each row', async () => {
    const qb: Record<string, jest.Mock> = {};
    for (const method of ['orderBy', 'addOrderBy', 'addSelect', 'andWhere', 'setParameter']) {
      qb[method] = jest.fn().mockReturnValue(qb);
    }
    qb.getRawAndEntities = jest.fn(async () => ({
      entities: [{ id: 'svc-1' }, { id: 'svc-2' }],
      raw: [
        { s_id: 'svc-2', rank_reputation: null, rank_min_price: '1.00000000', rank_score: '0.1' },
        { s_id: 'svc-1', rank_reputation: '0.9000', rank_min_price: null, rank_score: '0.7' },
      ],
    }));
    qb.getMany = jest.fn();
    const catalog = new CatalogService(
      { createQueryBuilder: () => qb } as unknown as Repository<Service>,
      {} as PricingService,
    );

    const rows = (await catalog.findAll({ sort: 'best' })) as Array<Service & { ranking: unknown }>;

    expect(qb.getMany).not.toHaveBeenCalled();
    expect(rows[0].ranking).toEqual({ reputation: 0.9, minPrice: null, score: 0.7 });
    expect(rows[1].ranking).toEqual({ reputation: null, minPrice: '1.00000000', score: 0.1 });
  });
});
