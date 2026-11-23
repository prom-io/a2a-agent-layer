import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/**
 * Text search configuration used for the catalog. It has to be the same in the
 * generated column (see the AddServiceSearchVector migration) and in every
 * query, otherwise stemming differs between the indexed document and the
 * query and "translating" stops matching "translation".
 */
export const SEARCH_CONFIG = 'english';

/**
 * Expression behind `services.searchVector`. The name weighs more than the
 * description, so a service called "translate" ranks above one that only
 * mentions translation somewhere in its description.
 */
export const SERVICE_SEARCH_VECTOR_SQL =
  `setweight(to_tsvector('${SEARCH_CONFIG}', coalesce("name", '')), 'A') || ` +
  `setweight(to_tsvector('${SEARCH_CONFIG}', coalesce("description", '')), 'B')`;

/** Alias of the relevance column added to a searched query. */
export const SEARCH_RANK_ALIAS = 'search_rank';

export const MAX_SEARCH_QUERY_LENGTH = 100;

/**
 * Collapses whitespace and drops queries that cannot match anything. Returns
 * null when there is nothing to search for, so callers skip the clause
 * entirely instead of sending an empty tsquery (which Postgres answers with a
 * notice and no rows).
 */
export function normalizeSearchQuery(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
  return /[\p{L}\p{N}]/u.test(collapsed) ? collapsed : null;
}

/** Escapes LIKE wildcards so a search for `50%` does not match everything. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Restricts a services query to full-text matches and orders it by relevance.
 *
 * `websearch_to_tsquery` accepts what people type into a search box (quoted
 * phrases, `or`, `-excluded`) and never raises a syntax error, unlike
 * `to_tsquery`. The GIN index on `searchVector` serves the `@@` match.
 *
 * Stemming does not help with identifiers such as `gpt-4o-mini` or with the
 * middle of a word, so a case-insensitive substring match on the name is kept
 * as a fallback. Those rows rank 0 and sort after every real text match.
 */
export function applyFullTextSearch<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  query: string,
): SelectQueryBuilder<T> {
  const tsquery = `websearch_to_tsquery('${SEARCH_CONFIG}', :searchQuery)`;
  return qb
    .addSelect(`ts_rank(${alias}.searchVector, ${tsquery})`, SEARCH_RANK_ALIAS)
    .andWhere(`(${alias}.searchVector @@ ${tsquery} OR ${alias}.name ILIKE :searchLike)`, {
      searchQuery: query,
      searchLike: `%${escapeLike(query)}%`,
    })
    .orderBy(SEARCH_RANK_ALIAS, 'DESC')
    .addOrderBy(`${alias}.createdAt`, 'DESC');
}
