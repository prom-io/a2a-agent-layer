import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Agent } from '../identity/entities/agent.entity';
import { AgentReputationSnapshot } from './entities/agent-reputation-snapshot.entity';
import { ReputationService, sameFigures } from './reputation.service';
import { ReputationSyncJob } from './reputation-sync.job';
import { RemoteReputation, VerificationNetworkClient } from './verification-network.client';

const remote = (overrides: Partial<RemoteReputation> = {}): RemoteReputation => ({
  entityId: 'did:prom:a',
  score: 0.9,
  accuracy: 0.95,
  uptime: 1,
  disputeLossRate: 0,
  totalJobs: 10,
  updatedAt: null,
  ...overrides,
});

const stored = (overrides: Partial<AgentReputationSnapshot> = {}) =>
  ({
    score: '0.9000',
    accuracy: '0.9500',
    uptime: '1.0000',
    disputeLossRate: '0.0000',
    totalJobs: 10,
    ...overrides,
  }) as AgentReputationSnapshot;

const config = (values: Record<string, unknown> = {}) =>
  ({ get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback) }) as ConfigService;

describe('sameFigures', () => {
  it('compares at the stored precision', () => {
    expect(sameFigures(stored(), remote({ score: 0.90001 }))).toBe(true);
    expect(sameFigures(stored(), remote({ score: 0.9001 }))).toBe(false);
  });

  it('notices a change in jobs or a component appearing', () => {
    expect(sameFigures(stored(), remote({ totalJobs: 11 }))).toBe(false);
    expect(sameFigures(stored({ uptime: null }), remote())).toBe(false);
    expect(sameFigures(stored({ uptime: null }), remote({ uptime: null }))).toBe(true);
  });
});

describe('ReputationService', () => {
  let snapshots: Record<string, jest.Mock>;
  let agents: Record<string, jest.Mock>;
  let fetchReputation: jest.Mock;
  let service: ReputationService;

  const agent = (n: number) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, agentDid: `did:prom:a${n}` });

  beforeEach(() => {
    snapshots = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      create: jest.fn((data) => data),
      save: jest.fn(async (row) => row),
      createQueryBuilder: jest.fn(),
    };
    agents = { find: jest.fn(async () => []), findOneBy: jest.fn() };
    fetchReputation = jest.fn(async () => remote());
    service = new ReputationService(
      snapshots as unknown as Repository<AgentReputationSnapshot>,
      agents as unknown as Repository<Agent>,
      { fetchReputation } as unknown as VerificationNetworkClient,
      config({ 'reputation.batchSize': 2 }),
    );
  });

  it('stores the first reading of an agent', async () => {
    await expect(service.syncAgent(agent(1))).resolves.toBe('stored');

    expect(snapshots.save).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: agent(1).id,
        agentDid: 'did:prom:a1',
        score: '0.9000',
        accuracy: '0.9500',
        totalJobs: 10,
      }),
    );
  });

  it('writes nothing when the figures did not change', async () => {
    snapshots.findOne.mockResolvedValue(stored());

    await expect(service.syncAgent(agent(1))).resolves.toBe('unchanged');
    expect(snapshots.save).not.toHaveBeenCalled();
  });

  it('reports an agent the network does not know yet', async () => {
    fetchReputation.mockResolvedValue(null);

    await expect(service.syncAgent(agent(1))).resolves.toBe('missing');
  });

  it('walks every active agent page by page and counts the outcomes', async () => {
    agents.find
      .mockResolvedValueOnce([agent(1), agent(2)])
      .mockResolvedValueOnce([agent(3)]);
    fetchReputation
      .mockResolvedValueOnce(remote())
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('timeout'));

    const result = await service.syncAll();

    expect(result).toEqual({ ran: true, checked: 3, stored: 1, unchanged: 0, missing: 1, failed: 1 });
    expect(agents.find).toHaveBeenCalledTimes(2);
    // The second page starts after the last id of the first one.
    expect(agents.find.mock.calls[1][0].where.id.value).toBe(agent(2).id);
  });

  it('does not start a second sync while one is running', async () => {
    let release: () => void = () => undefined;
    agents.find.mockReturnValueOnce(new Promise((resolve) => (release = () => resolve([]))));

    const first = service.syncAll();
    const second = await service.syncAll();
    release();

    expect(second.ran).toBe(false);
    expect((await first).ran).toBe(true);
  });

  it('returns the current score and history of an agent', async () => {
    agents.findOneBy.mockResolvedValue({ id: agent(1).id, agentDid: 'did:prom:a1' });
    snapshots.find.mockResolvedValue([stored({ score: '0.8000' }), stored()]);

    const view = await service.view(agent(1).id, 500);

    expect(view.current?.score).toBe('0.8000');
    expect(view.history).toHaveLength(2);
    expect(snapshots.find).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it('answers 404 for an unknown agent', async () => {
    agents.findOneBy.mockResolvedValue(null);

    await expect(service.view(agent(9).id)).rejects.toThrow(NotFoundException);
  });

  it('reads the latest score of many agents in one query', async () => {
    const qb: Record<string, jest.Mock> = {};
    for (const method of ['select', 'addSelect', 'where', 'orderBy', 'addOrderBy']) {
      qb[method] = jest.fn().mockReturnValue(qb);
    }
    qb.getRawMany = jest.fn(async () => [{ agentId: 'a', score: '0.7500' }]);
    snapshots.createQueryBuilder.mockReturnValue(qb);

    const scores = await service.latestScores(['a', 'a', 'b']);

    expect(scores.get('a')).toBe(0.75);
    expect(scores.has('b')).toBe(false);
    expect(qb.where).toHaveBeenCalledWith('r.agentId IN (:...ids)', { ids: ['a', 'b'] });
    expect(await service.latestScores([])).toEqual(new Map());
  });
});

describe('ReputationSyncJob', () => {
  afterEach(() => jest.useRealTimers());

  it('stays off without a verification network', () => {
    const syncAll = jest.fn();
    const job = new ReputationSyncJob(
      { syncAll } as unknown as ReputationService,
      { configured: false } as VerificationNetworkClient,
      config(),
    );
    jest.useFakeTimers();

    job.onModuleInit();
    jest.advanceTimersByTime(10_000_000);

    expect(syncAll).not.toHaveBeenCalled();
  });

  it('syncs on the configured interval until destroyed', () => {
    const syncAll = jest.fn(async () => ({}));
    jest.useFakeTimers();
    const job = new ReputationSyncJob(
      { syncAll } as unknown as ReputationService,
      { configured: true } as VerificationNetworkClient,
      config({ 'reputation.syncIntervalMs': 1000 }),
    );

    job.onModuleInit();
    jest.advanceTimersByTime(3000);
    job.onModuleDestroy();
    jest.advanceTimersByTime(3000);

    expect(syncAll).toHaveBeenCalledTimes(3);
  });
});
