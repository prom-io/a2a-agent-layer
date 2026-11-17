import { readFileSync } from 'fs';
import { join } from 'path';
import { SelectQueryBuilder } from 'typeorm';
import {
  applyFullTextSearch,
  escapeLike,
  normalizeSearchQuery,
  SEARCH_RANK_ALIAS,
  SERVICE_SEARCH_VECTOR_SQL,
} from './catalog-search';
import { Service } from './entities/service.entity';

type MockQb = Record<'addSelect' | 'andWhere' | 'orderBy' | 'addOrderBy', jest.Mock>;

function mockQueryBuilder(): MockQb {
  const qb = {} as MockQb;
  for (const method of ['addSelect', 'andWhere', 'orderBy', 'addOrderBy'] as const) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  return qb;
}

const search = (qb: MockQb, alias: string, query: string) =>
  applyFullTextSearch(qb as unknown as SelectQueryBuilder<Service>, alias, query);

describe('normalizeSearchQuery', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeSearchQuery('  image \n\t resize  ')).toBe('image resize');
  });

  it.each([undefined, null, '', '   ', '!!! --- ""', '%'])(
    'returns null for %p, which has nothing to match',
    (raw) => {
      expect(normalizeSearchQuery(raw as string | undefined)).toBeNull();
    },
  );

  it('keeps non-latin letters and digits', () => {
    expect(normalizeSearchQuery('перевод')).toBe('перевод');
    expect(normalizeSearchQuery('gpt 4')).toBe('gpt 4');
  });

  it('caps the length of what reaches the database', () => {
    expect(normalizeSearchQuery('a'.repeat(500))).toHaveLength(100);
  });
});

describe('applyFullTextSearch', () => {
  it('matches with websearch_to_tsquery and the name fallback in one clause', () => {
    const qb = mockQueryBuilder();

    search(qb, 's', 'translate "legal documents"');

    expect(qb.andWhere).toHaveBeenCalledTimes(1);
    const [clause, params] = qb.andWhere.mock.calls[0];
    expect(clause).toBe(
      "(s.searchVector @@ websearch_to_tsquery('english', :searchQuery) OR s.name ILIKE :searchLike)",
    );
    expect(params).toEqual({
      searchQuery: 'translate "legal documents"',
      searchLike: '%translate "legal documents"%',
    });
  });

  it('passes the query as a bound parameter, never inlined', () => {
    const qb = mockQueryBuilder();

    search(qb, 's', "x'); DROP TABLE services; --");

    const [clause] = qb.andWhere.mock.calls[0];
    expect(clause).not.toContain('DROP');
    expect(qb.addSelect.mock.calls[0][0]).not.toContain('DROP');
  });

  it('escapes LIKE wildcards in the fallback', () => {
    const qb = mockQueryBuilder();

    search(qb, 's', '50%_off');

    expect(qb.andWhere.mock.calls[0][1].searchLike).toBe('%50\\%\\_off%');
  });

  it('orders by relevance first and recency second', () => {
    const qb = mockQueryBuilder();

    search(qb, 'svc', 'ocr');

    expect(qb.addSelect).toHaveBeenCalledWith(
      "ts_rank_cd(svc.searchVector, websearch_to_tsquery('english', :searchQuery))",
      SEARCH_RANK_ALIAS,
    );
    expect(qb.orderBy).toHaveBeenCalledWith(SEARCH_RANK_ALIAS, 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('svc.createdAt', 'DESC');
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLike('100%_a\\b')).toBe('100\\%\\_a\\\\b');
    expect(escapeLike('translate')).toBe('translate');
  });
});

describe('search vector definition', () => {
  // The entity and the migration describe the same generated column. If they
  // drift, a synchronized development database ranks differently from
  // production and nobody notices.
  it('is identical in the entity and in the migration', () => {
    const migration = readFileSync(
      join(__dirname, '../../migrations/1718000000000-AddServiceSearchVector.ts'),
      'utf8',
    );
    const squash = (sql: string) => sql.replace(/\s+/g, ' ').trim();
    expect(squash(migration)).toContain(squash(SERVICE_SEARCH_VECTOR_SQL));
  });

  it('weighs the name above the description', () => {
    expect(SERVICE_SEARCH_VECTOR_SQL).toMatch(/coalesce\("name", ''\)\), 'A'\)/);
    expect(SERVICE_SEARCH_VECTOR_SQL).toMatch(/coalesce\("description", ''\)\), 'B'\)/);
  });
});
