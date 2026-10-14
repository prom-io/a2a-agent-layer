import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { BlockchainService } from '../../common/blockchain/blockchain.service';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/auth/roles.enum';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthService.detail', () => {
  let query: jest.Mock;
  let getBlockNumber: jest.Mock;
  let service: HealthService;

  const delay = <T>(ms: number, value: T) =>
    new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    getBlockNumber = jest.fn().mockResolvedValue(1207);
    service = new HealthService(
      { query } as unknown as DataSource,
      { getProvider: () => ({ getBlockNumber }) } as unknown as BlockchainService,
    );
  });

  afterEach(() => {
    delete process.env.HEALTH_CHECK_TIMEOUT_MS;
  });

  it('reports ok with a latency per dependency', async () => {
    query.mockImplementation(() => delay(15, []));

    const result = await service.detail();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('a2a-agent-layer');
    expect(result.dependencies.map((dep) => dep.name)).toEqual(['database', 'blockchain']);

    const [database, blockchain] = result.dependencies;
    expect(database).toMatchObject({ status: 'up', critical: true });
    expect(database.latencyMs).toBeGreaterThanOrEqual(10);
    expect(blockchain).toMatchObject({
      status: 'up',
      critical: false,
      details: { blockNumber: 1207 },
    });
    expect(blockchain.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('is degraded, not down, when only the RPC node fails', async () => {
    getBlockNumber.mockRejectedValue(new Error('could not detect network'));

    const result = await service.detail();

    expect(result.status).toBe('degraded');
    expect(result.dependencies[1]).toMatchObject({
      name: 'blockchain',
      status: 'down',
      error: 'could not detect network',
    });
    expect(result.dependencies[0].status).toBe('up');
  });

  it('is down when the database fails', async () => {
    query.mockRejectedValue(new Error('connection refused'));

    const result = await service.detail();

    expect(result.status).toBe('down');
    expect(result.dependencies[0]).toMatchObject({ status: 'down', error: 'connection refused' });
  });

  it('gives up on a hung dependency after the timeout', async () => {
    process.env.HEALTH_CHECK_TIMEOUT_MS = '20';
    getBlockNumber.mockImplementation(() => delay(500, 1));

    const started = Date.now();
    const result = await service.detail();

    expect(Date.now() - started).toBeLessThan(400);
    expect(result.dependencies[1]).toMatchObject({
      status: 'down',
      error: 'timed out after 20ms',
    });
    expect(result.dependencies[1].latencyMs).toBeGreaterThanOrEqual(15);
  });

  it('probes the dependencies concurrently', async () => {
    query.mockImplementation(() => delay(150, []));
    getBlockNumber.mockImplementation(() => delay(150, 1));

    const started = Date.now();
    await service.detail();

    expect(Date.now() - started).toBeLessThan(280);
  });
});

describe('HealthController access', () => {
  const reflector = new Reflector();

  it('keeps the probes public and the detail endpoint role-restricted', () => {
    const proto = HealthController.prototype;

    expect(reflector.get(IS_PUBLIC_KEY, proto.check)).toBe(true);
    expect(reflector.get(IS_PUBLIC_KEY, proto.ready)).toBe(true);
    expect(reflector.get(IS_PUBLIC_KEY, proto.detail)).toBeUndefined();
    expect(reflector.get(IS_PUBLIC_KEY, HealthController)).toBeUndefined();
    expect(reflector.get(ROLES_KEY, proto.detail)).toEqual([
      Role.OPERATOR,
      Role.ADMIN,
      Role.SERVICE,
    ]);
  });
});
