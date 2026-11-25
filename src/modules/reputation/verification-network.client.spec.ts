import { ConfigService } from '@nestjs/config';
import {
  parseReputation,
  VerificationNetworkClient,
  VerificationNetworkError,
} from './verification-network.client';

const config = (values: Record<string, unknown>) =>
  ({ get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback) }) as ConfigService;

const view = {
  entityId: 'did:prom:agent-1',
  accuracy: '0.9500',
  uptime: '1.0000',
  disputeLossRate: '0.0200',
  totalJobs: 42,
  lastUpdated: '2026-11-20T10:00:00.000Z',
  rawScore: 0.971,
  effectiveScore: 0.9312,
};

describe('parseReputation', () => {
  it('takes the decayed score and the components', () => {
    expect(parseReputation('did:prom:agent-1', view)).toEqual({
      entityId: 'did:prom:agent-1',
      score: 0.9312,
      accuracy: 0.95,
      uptime: 1,
      disputeLossRate: 0.02,
      totalJobs: 42,
      updatedAt: new Date('2026-11-20T10:00:00.000Z'),
    });
  });

  it('falls back to the raw score from deployments without decay', () => {
    const { effectiveScore: _drop, ...older } = view;
    expect(parseReputation('a', older).score).toBe(0.971);
  });

  it('drops components outside 0..1 and bad dates instead of storing them', () => {
    const parsed = parseReputation('a', { ...view, uptime: '1.7', lastUpdated: 'yesterday', totalJobs: -3 });
    expect(parsed.uptime).toBeNull();
    expect(parsed.updatedAt).toBeNull();
    expect(parsed.totalJobs).toBe(0);
  });

  it.each([null, 'text', {}, { effectiveScore: 2 }, { rawScore: 'NaN' }])(
    'rejects %p without a usable score',
    (body) => {
      expect(() => parseReputation('a', body)).toThrow(VerificationNetworkError);
    },
  );
});

describe('VerificationNetworkClient', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  const respond = (status: number, body?: unknown) =>
    fetchMock.mockResolvedValueOnce(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  const client = (extra: Record<string, unknown> = {}) =>
    new VerificationNetworkClient(
      config({ 'reputation.baseUrl': 'http://vn.internal:3002', ...extra }),
    );

  it('fetches the reputation of a DID with the service API key', async () => {
    respond(200, view);

    const result = await client({ 'reputation.apiKey': 'k-1' }).fetchReputation('did:prom:agent-1');

    expect(result?.score).toBe(0.9312);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://vn.internal:3002/reputation/did%3Aprom%3Aagent-1');
    expect(init.headers).toEqual({ accept: 'application/json', 'x-api-key': 'k-1' });
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends no key header when no key is configured', async () => {
    respond(200, view);

    await client().fetchReputation('did:prom:agent-1');

    expect(fetchMock.mock.calls[0][1].headers).toEqual({ accept: 'application/json' });
  });

  it('returns null for an agent the network does not know', async () => {
    respond(404, { message: 'not found' });

    await expect(client().fetchReputation('did:prom:new')).resolves.toBeNull();
  });

  it('raises on other error statuses with the status attached', async () => {
    respond(503, { message: 'down' });

    await expect(client().fetchReputation('did:prom:x')).rejects.toMatchObject({
      name: 'VerificationNetworkError',
      status: 503,
    });
  });

  it('wraps network failures', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(client().fetchReputation('did:prom:x')).rejects.toThrow(
      'Reputation request for did:prom:x failed: fetch failed',
    );
  });

  it('refuses to run unconfigured', async () => {
    const unconfigured = new VerificationNetworkClient(config({}));

    expect(unconfigured.configured).toBe(false);
    await expect(unconfigured.fetchReputation('did:prom:x')).rejects.toThrow('not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
