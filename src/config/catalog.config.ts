import { registerAs } from '@nestjs/config';
import { DEFAULT_NEUTRAL_REPUTATION, parseRankWeights } from '../modules/catalog/catalog-ranking';

function fractionFromEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : fallback;
}

/** Catalog ranking knobs for `GET /services?sort=best`. */
export const catalogConfig = registerAs('catalog', () => ({
  // "reputation:0.5,price:0.3,relevance:0.2"; normalized to sum to 1.
  rankWeights: parseRankWeights(process.env.CATALOG_RANK_WEIGHTS),
  // Reputation assumed for agents the verification network has not scored.
  neutralReputation: fractionFromEnv(
    process.env.CATALOG_NEUTRAL_REPUTATION,
    DEFAULT_NEUTRAL_REPUTATION,
  ),
}));
