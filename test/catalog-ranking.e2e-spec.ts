import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { Role } from '../src/common/auth/roles.enum';
import type { E2eApp } from './helpers/e2e-app';

/**
 * Reputation sync from a stand-in verification network and catalog ranking
 * by reputation, price and the weighted mix, against a migrated Postgres.
 *
 * The verification network URL has to be in the environment before the
 * application is loaded, and its port is only known once the stand-in
 * listens, so the helper is imported dynamically in beforeAll.
 */
describe('catalog ranking by reputation and price (e2e)', () => {
  let e2e: E2eApp;
  let network: Server;
  let operator: string;
  let agent: string;
  let token: string;
  const reputations = new Map<string, Record<string, unknown>>();
  const agents: Record<string, string> = {};
  const services: Record<string, string> = {};

  const listed = async (query: Record<string, unknown>) => {
    const res = await e2e
      .http()
      .get('/services')
      .query({ q: token, ...query })
      .set('Authorization', agent)
      .expect(200);
    return res.body as Array<{ id: string; ranking?: Record<string, unknown> }>;
  };
  const keys = (rows: Array<{ id: string }>) =>
    rows.map((row) => Object.keys(services).find((key) => services[key] === row.id));

  beforeAll(async () => {
    network = createServer((req, res) => {
      const did = decodeURIComponent((req.url ?? '').replace(/^\/reputation\//, ''));
      const body = reputations.get(did);
      res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body ?? { message: 'not found' }));
    });
    await new Promise<void>((resolve) => network.listen(0, '127.0.0.1', resolve));
    process.env.VERIFICATION_NETWORK_URL = `http://127.0.0.1:${(network.address() as AddressInfo).port}`;
    process.env.REPUTATION_SYNC_INTERVAL_MS = '0';

    const helper = await import('./helpers/e2e-app');
    e2e = await helper.createE2eApp();
    operator = e2e.bearer(Role.OPERATOR);
    agent = e2e.bearer(Role.AGENT);
    const run = helper.runId();
    token = `rank${run}`;

    // trusted: high reputation, mid price; cheap: low reputation, lowest
    // price; unknown: never scored, highest price.
    const plan: Array<[string, number | null, string]> = [
      ['trusted', 0.95, '0.50'],
      ['cheap', 0.4, '0.10'],
      ['unknown', null, '2.00'],
    ];
    for (const [key, score, price] of plan) {
      const did = `did:prom:e2e-rank-${key}-${run}`;
      const registered = await helper.registerAgent(e2e, did);
      agents[key] = registered.id;
      if (score !== null) {
        reputations.set(did, {
          entityId: did,
          accuracy: '0.9000',
          uptime: '1.0000',
          disputeLossRate: '0.0000',
          totalJobs: 7,
          effectiveScore: score,
          lastUpdated: '2026-11-20T10:00:00.000Z',
        });
      }
      const service = await e2e
        .http()
        .post('/services')
        .set('Authorization', operator)
        .send({ agentId: registered.id, name: `${key} summarizer`, description: `Summaries ${token}` })
        .expect(201);
      services[key] = service.body.id;
      await e2e
        .http()
        .post('/tariffs')
        .set('Authorization', operator)
        .send({ agentId: registered.id, serviceId: service.body.id, type: 'per_request', basePrice: price })
        .expect(201);
    }
  });

  afterAll(async () => {
    await e2e?.close();
    await new Promise((resolve) => network?.close(resolve));
  });

  describe('reputation sync', () => {
    it('is restricted to operators', async () => {
      await e2e.http().post('/reputation/sync').set('Authorization', agent).expect(403);
    });

    it('stores a snapshot for every scored agent', async () => {
      const res = await e2e.http().post('/reputation/sync').set('Authorization', operator).expect(201);

      expect(res.body.ran).toBe(true);
      expect(res.body.stored).toBeGreaterThanOrEqual(2);
      expect(res.body.failed).toBe(0);

      const view = await e2e
        .http()
        .get(`/agents/${agents.trusted}/reputation`)
        .set('Authorization', agent)
        .expect(200);
      expect(view.body.current).toMatchObject({ score: '0.9500', accuracy: '0.9000', totalJobs: 7 });

      const none = await e2e
        .http()
        .get(`/agents/${agents.unknown}/reputation`)
        .set('Authorization', agent)
        .expect(200);
      expect(none.body.current).toBeNull();
    });

    it('writes nothing new when the figures did not change', async () => {
      const res = await e2e.http().post('/reputation/sync').set('Authorization', operator).expect(201);
      expect(res.body.stored).toBe(0);

      const view = await e2e
        .http()
        .get(`/agents/${agents.trusted}/reputation`)
        .set('Authorization', agent)
        .expect(200);
      expect(view.body.history).toHaveLength(1);
    });

    it('records a change as a new snapshot', async () => {
      const did = [...reputations.keys()].find((key) => key.includes('-trusted-')) as string;
      reputations.set(did, { ...reputations.get(did), effectiveScore: 0.97 });

      await e2e.http().post('/reputation/sync').set('Authorization', operator).expect(201);

      const view = await e2e
        .http()
        .get(`/agents/${agents.trusted}/reputation`)
        .set('Authorization', agent)
        .expect(200);
      expect(view.body.current.score).toBe('0.9700');
      expect(view.body.history.map((s: { score: string }) => s.score)).toEqual(['0.9700', '0.9500']);
    });
  });

  describe('ranking', () => {
    it('orders by reputation with unscored agents last', async () => {
      const rows = await listed({ sort: 'reputation' });

      expect(keys(rows)).toEqual(['trusted', 'cheap', 'unknown']);
      expect(rows[0].ranking).toMatchObject({ reputation: 0.97 });
      expect(rows[2].ranking).toMatchObject({ reputation: null });
    });

    it('orders by the cheapest tariff', async () => {
      const rows = await listed({ sort: 'price' });

      expect(keys(rows)).toEqual(['cheap', 'trusted', 'unknown']);
      expect(rows[0].ranking?.minPrice).toBe('0.10000000');
    });

    it('mixes reputation, price and relevance for best', async () => {
      const rows = await listed({ sort: 'best' });
      const score = (key: string) =>
        rows.find((row) => row.id === services[key])?.ranking?.score as number;

      // Equal text relevance, so with the default weights (normalized over
      // reputation, price and relevance) the scores are:
      //   trusted 0.5*0.97 + 0.3*(0.10/0.50) + 0.2*1 = 0.745
      //   cheap   0.5*0.40 + 0.3*1           + 0.2*1 = 0.700
      //   unknown 0.5*0.50 + 0.3*(0.10/2.00) + 0.2*1 = 0.465
      expect(keys(rows)).toEqual(['trusted', 'cheap', 'unknown']);
      expect(score('trusted')).toBeCloseTo(0.745, 4);
      expect(score('cheap')).toBeCloseTo(0.7, 4);
      expect(score('unknown')).toBeCloseTo(0.465, 4);
    });

    it('scores a row the same on every page', async () => {
      const all = await listed({ sort: 'best' });
      const second = await listed({ sort: 'best', limit: 1, page: 2 });

      expect(second).toHaveLength(1);
      expect(second[0].id).toBe(all[1].id);
      expect(second[0].ranking?.score).toBe(all[1].ranking?.score);
    });

    it('combines ranking with filters and embedded tariffs', async () => {
      const rows = await listed({ sort: 'reputation', maxPrice: '1', include: 'tariffs' });

      expect(keys(rows)).toEqual(['trusted', 'cheap']);
      expect((rows[0] as unknown as { tariffs: unknown[] }).tariffs).toHaveLength(1);
    });

    it('rejects an unknown sort', async () => {
      await e2e.http().get('/services').query({ sort: 'random' }).set('Authorization', agent).expect(400);
    });
  });
});
