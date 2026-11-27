import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { SEARCH_CONFIG } from './catalog-search';

export const CATALOG_SORTS = ['relevance', 'newest', 'reputation', 'price', 'best'] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

export interface RankWeights {
  reputation: number;
  price: number;
  relevance: number;
}

export const DEFAULT_RANK_WEIGHTS: RankWeights = { reputation: 0.5, price: 0.3, relevance: 0.2 };

/** Score assumed for an agent the verification network has not scored yet. */
export const DEFAULT_NEUTRAL_REPUTATION = 0.5;

export const RANK_ALIASES = {
  reputation: 'rank_reputation',
  price: 'rank_min_price',
  score: 'rank_score',
} as const;

export interface RankingOptions {
  /** The query has a full-text clause, so relevance can take part in `best`. */
  hasSearch: boolean;
  /** Price only counts tariffs in this currency when set. */
  currency?: string;
  weights?: RankWeights;
  neutralReputation?: number;
}

/** Ranking figures attached to a service row when a ranked sort is used. */
export interface RankingFigures {
  reputation: number | null;
  minPrice: string | null;
  score: number | null;
}

/**
 * "reputation:0.6,price:0.4" -> weights; unknown names and negative or
 * non-numeric weights are ignored, missing ones default to 0 once any weight
 * is given. Nothing usable falls back to the defaults.
 */
export function parseRankWeights(raw: string | undefined): RankWeights {
  if (!raw?.trim()) return { ...DEFAULT_RANK_WEIGHTS };
  const weights: RankWeights = { reputation: 0, price: 0, relevance: 0 };
  let any = false;
  for (const part of raw.split(',')) {
    const [name, value] = part.split(':').map((piece) => piece.trim());
    const weight = Number(value);
    if (!(name in weights) || !Number.isFinite(weight) || weight < 0) continue;
    weights[name as keyof RankWeights] = weight;
    any = true;
  }
  return any && weights.reputation + weights.price + weights.relevance > 0
    ? weights
    : { ...DEFAULT_RANK_WEIGHTS };
}

/**
 * Weights that sum to 1. Without a search there is no relevance, and its
 * share is spread over the other components instead of capping every score
 * below 1.
 */
export function effectiveWeights(weights: RankWeights, hasSearch: boolean): RankWeights {
  const relevance = hasSearch ? weights.relevance : 0;
  const total = weights.reputation + weights.price + relevance;
  if (total <= 0) return { reputation: 0, price: 0, relevance: 0 };
  return {
    reputation: weights.reputation / total,
    price: weights.price / total,
    relevance: relevance / total,
  };
}

/** Latest reputation score of the service's agent; NULL until one was synced. */
export function reputationSql(alias: string): string {
  return (
    `(SELECT r."score" FROM "agent_reputation_snapshots" r ` +
    `WHERE r."agentId" = ${alias}.agentId ORDER BY r."fetchedAt" DESC LIMIT 1)`
  );
}

/** Cheapest base price of the service; NULL when it has no (matching) tariff. */
export function minPriceSql(alias: string, withCurrency: boolean): string {
  return (
    `(SELECT MIN(t."basePrice") FROM "tariffs" t WHERE t."serviceId" = ${alias}.id` +
    `${withCurrency ? ' AND t."currency" = :rankCurrency' : ''})`
  );
}

/**
 * Composite `best` score in 0..1:
 *
 *   reputation  latest score, or the neutral score when there is none yet
 *   price       cheapest price in the result set / this service's price
 *               (1 for the cheapest, 1/2 for twice the price, 0 if unpriced)
 *   relevance   text rank / best text rank in the result set
 *
 * The window functions run over the whole filtered result before LIMIT, so a
 * service scores the same on every page.
 */
export function compositeScoreSql(alias: string, options: RankingOptions): string {
  const weights = effectiveWeights(options.weights ?? DEFAULT_RANK_WEIGHTS, options.hasSearch);
  const neutral = options.neutralReputation ?? DEFAULT_NEUTRAL_REPUTATION;
  const price = minPriceSql(alias, options.currency !== undefined);
  const terms = [
    `${weights.reputation.toFixed(6)} * COALESCE(${reputationSql(alias)}, ${neutral.toFixed(4)})`,
    `${weights.price.toFixed(6)} * COALESCE(` +
      `CASE WHEN ${price} = 0 THEN 1 ELSE (MIN(${price}) OVER ()) / NULLIF(${price}, 0) END, 0)`,
  ];
  if (options.hasSearch) {
    const rank = `ts_rank(${alias}.searchVector, websearch_to_tsquery('${SEARCH_CONFIG}', :searchQuery))`;
    terms.push(
      `${weights.relevance.toFixed(6)} * COALESCE(${rank} / NULLIF(MAX(${rank}) OVER (), 0), 0)`,
    );
  }
  return `(${terms.join(' + ')})`;
}

/**
 * Orders a services query. `relevance` keeps the order set by the full-text
 * search (and is `newest` without one); the other sorts add their figures as
 * selected columns so they can be returned with the rows. Ties always fall
 * back to recency, then id, so pages are stable.
 */
export function applyRanking<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  sort: CatalogSort,
  options: RankingOptions,
): boolean {
  if (sort === 'relevance' && options.hasSearch) return false;
  if (sort === 'newest' || sort === 'relevance') {
    qb.orderBy(`${alias}.createdAt`, 'DESC').addOrderBy(`${alias}.id`, 'ASC');
    return false;
  }

  const withCurrency = options.currency !== undefined;
  qb.addSelect(reputationSql(alias), RANK_ALIASES.reputation).addSelect(
    minPriceSql(alias, withCurrency),
    RANK_ALIASES.price,
  );
  if (withCurrency) qb.setParameter('rankCurrency', options.currency);

  if (sort === 'reputation') {
    qb.orderBy(RANK_ALIASES.reputation, 'DESC', 'NULLS LAST');
  } else if (sort === 'price') {
    qb.orderBy(RANK_ALIASES.price, 'ASC', 'NULLS LAST');
  } else {
    qb.addSelect(compositeScoreSql(alias, options), RANK_ALIASES.score);
    qb.orderBy(RANK_ALIASES.score, 'DESC', 'NULLS LAST');
  }
  qb.addOrderBy(`${alias}.createdAt`, 'DESC').addOrderBy(`${alias}.id`, 'ASC');
  return true;
}

/** Reads the ranking columns of one raw row back into numbers. */
export function rankingFromRaw(raw: Record<string, unknown>): RankingFigures {
  const reputation = raw[RANK_ALIASES.reputation];
  const price = raw[RANK_ALIASES.price];
  const score = raw[RANK_ALIASES.score];
  return {
    reputation: reputation === null || reputation === undefined ? null : Number(reputation),
    minPrice: price === null || price === undefined ? null : String(price),
    score: score === null || score === undefined ? null : Number(Number(score).toFixed(6)),
  };
}
