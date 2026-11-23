import { createE2eApp, E2eApp, registerAgent, runId } from './helpers/e2e-app';
import { Role } from '../src/common/auth/roles.enum';

/**
 * Catalog discovery against a migrated Postgres: the tsvector column and its
 * GIN index, capability arrays, the tariff price subquery and the
 * availability join are all SQL, so mocks cannot vouch for them.
 *
 * Every service carries the run token in its description and every search
 * includes it, so rows left behind by earlier runs never show up here.
 */
describe('catalog search and filters (e2e)', () => {
  let e2e: E2eApp;
  let operator: string;
  let agent: string;
  const run = runId();
  const token = `e2e${run}`;
  const ids: Record<string, string> = {};

  const createService = async (
    agentId: string,
    key: string,
    body: Record<string, unknown>,
    basePrice?: string,
    currency = 'PROM',
  ) => {
    const res = await e2e
      .http()
      .post('/services')
      .set('Authorization', operator)
      .send({ agentId, ...body, description: `${body.description} ${token}` })
      .expect(201);
    ids[key] = res.body.id;
    if (basePrice !== undefined) {
      await e2e
        .http()
        .post('/tariffs')
        .set('Authorization', operator)
        .send({ agentId, serviceId: res.body.id, type: 'per_request', basePrice, currency })
        .expect(201);
    }
  };

  const search = async (query: Record<string, unknown>, expected = 200) => {
    const res = await e2e.http().get('/services').query(query).set('Authorization', agent).expect(expected);
    return res.body;
  };
  const names = (body: Array<{ id: string }>) =>
    body.map((row) => Object.keys(ids).find((key) => ids[key] === row.id) ?? row.id);

  beforeAll(async () => {
    e2e = await createE2eApp();
    operator = e2e.bearer(Role.OPERATOR);
    agent = e2e.bearer(Role.AGENT);

    const provider = await registerAgent(e2e, `did:prom:e2e-catalog-${run}`);
    const retired = await registerAgent(e2e, `did:prom:e2e-catalog-retired-${run}`);

    await createService(
      provider.id,
      'translator',
      {
        name: 'Legal translator',
        description: 'Contracts between English and German',
        capabilities: ['translate', 'legal'],
        slaHints: { latencyP95Ms: 1200, uptime: 0.995 },
      },
      '0.40',
    );
    await createService(
      provider.id,
      'summarizer',
      {
        name: 'Document summarizer',
        description: 'Short summaries, with optional translation of the summary',
        capabilities: ['summarize', 'translate'],
        slaHints: { p95LatencyMs: 400, uptime: 99.9 },
      },
      '1.25',
    );
    await createService(
      provider.id,
      'ocr',
      {
        name: 'Scan reader',
        description: 'OCR for scanned invoices',
        capabilities: ['ocr', 'pdf'],
        available: false,
      },
      '0.05',
    );
    await createService(retired.id, 'retired', {
      name: 'Retired translator',
      description: 'Translation from an agent that has been switched off',
      capabilities: ['translate'],
    });

    await e2e
      .http()
      .delete(`/agents/${retired.id}`)
      .set('Authorization', e2e.bearer(Role.ADMIN))
      .expect(200);
  });

  afterAll(async () => {
    await e2e?.close();
  });

  describe('full-text search', () => {
    it('matches word forms through stemming', async () => {
      // "translations" is in no service text; it stems to the same lexeme as
      // "translator" and "translation".
      const body = await search({ q: `translations ${token}` });

      expect(names(body).sort()).toEqual(['retired', 'summarizer', 'translator']);
    });

    it('ranks a match in the name above a match in the description', async () => {
      // "translator" is in the name of one service and only in the
      // description of the summarizer.
      const ranked = names(await search({ q: `translator ${token}` }));

      expect(ranked).toContain('summarizer');
      expect(ranked.indexOf('translator')).toBeLessThan(ranked.indexOf('summarizer'));
    });

    it('understands web search syntax', async () => {
      const body = await search({ q: `translation -summary ${token}` });

      expect(names(body)).not.toContain('summarizer');
      expect(names(body)).toContain('translator');
    });

    it('never fails on query syntax and matches nothing for gibberish', async () => {
      const body = await search({ q: `"unbalanced & | ! ( ${token} zzqxv` });

      expect(body).toEqual([]);
    });

    it('does not select the search vector', async () => {
      const [row] = await search({ q: `ocr ${token}` });

      expect(row).toBeDefined();
      expect(row).not.toHaveProperty('searchVector');
      expect(row.capabilities).toEqual(['ocr', 'pdf']);
    });
  });

  describe('filters', () => {
    it('requires every capability by default and any of them on request', async () => {
      expect(names(await search({ q: token, capability: 'translate,legal' }))).toEqual([
        'translator',
      ]);
      expect(
        names(await search({ q: token, capability: ['legal', 'ocr'], capabilityMatch: 'any' })).sort(),
      ).toEqual(['ocr', 'translator']);
    });

    it('matches capabilities case-insensitively', async () => {
      expect(names(await search({ q: token, capability: 'OCR' }))).toEqual(['ocr']);
    });

    it('filters on the tariff price range', async () => {
      expect(names(await search({ q: token, minPrice: '0.1', maxPrice: '1' }))).toEqual([
        'translator',
      ]);
      expect(names(await search({ q: token, minPrice: '1' }))).toEqual(['summarizer']);
      // A service without a tariff has no price at all.
      expect(names(await search({ q: token, maxPrice: '100' }))).not.toContain('retired');
    });

    it('filters on the tariff currency', async () => {
      expect(await search({ q: token, maxPrice: '100', currency: 'USDC' })).toEqual([]);
    });

    it('hides switched-off listings and inactive agents when asked for available services', async () => {
      expect(names(await search({ q: token, available: true })).sort()).toEqual([
        'summarizer',
        'translator',
      ]);
      expect(names(await search({ q: token, available: false })).sort()).toEqual([
        'ocr',
        'retired',
      ]);
    });

    it('combines search, filters and pagination', async () => {
      const first = await search({ q: `translate ${token}`, available: true, limit: 1, page: 1 });
      const second = await search({ q: `translate ${token}`, available: true, limit: 1, page: 2 });

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(first[0].id).not.toBe(second[0].id);
    });

    it.each([
      [{ minPrice: '2', maxPrice: '1' }],
      [{ minPrice: '-1' }],
      [{ capability: 'not a tag' }],
      [{ available: 'maybe' }],
      [{ capabilityMatch: 'some' }],
    ])('rejects %p with 400', async (query) => {
      await search(query, 400);
    });
  });

  describe('comparison', () => {
    it('compares price and SLA across services', async () => {
      const res = await e2e
        .http()
        .get('/services/compare')
        .query({ ids: `${ids.translator},${ids.summarizer}` })
        .set('Authorization', agent)
        .expect(200);

      expect(res.body.services.map((s: { id: string }) => s.id)).toEqual([
        ids.translator,
        ids.summarizer,
      ]);
      expect(res.body.fields['pricing.per_request'].best).toEqual([ids.translator]);
      expect(res.body.fields['sla.latencyP95Ms'].best).toEqual([ids.summarizer]);
      expect(res.body.services[1].sla.uptime).toBe(0.999);
      expect(res.body.notFound).toEqual([]);
    });

    it('reports unknown ids without failing', async () => {
      const unknown = '00000000-0000-4000-8000-000000000000';
      const res = await e2e
        .http()
        .get('/services/compare')
        .query({ ids: [ids.ocr, unknown] })
        .set('Authorization', agent)
        .expect(200);

      expect(res.body.notFound).toEqual([unknown]);
      expect(res.body.services).toHaveLength(1);
    });

    it('needs at least two distinct services', async () => {
      await e2e
        .http()
        .get('/services/compare')
        .query({ ids: `${ids.ocr},${ids.ocr}` })
        .set('Authorization', agent)
        .expect(400);
      await e2e
        .http()
        .get('/services/compare')
        .query({ ids: 'not-a-uuid,also-not' })
        .set('Authorization', agent)
        .expect(400);
    });

    it('answers 404 when none of the services exist', async () => {
      await e2e
        .http()
        .get('/services/compare')
        .query({
          ids: '00000000-0000-4000-8000-000000000001,00000000-0000-4000-8000-000000000002',
        })
        .set('Authorization', agent)
        .expect(404);
    });
  });
});
