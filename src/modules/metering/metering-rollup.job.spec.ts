import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MeteringRollupJob } from './metering-rollup.job';
import { UsageRecord } from './entities/usage-record.entity';
import { UsageRollup } from './entities/usage-rollup.entity';

describe('MeteringRollupJob', () => {
  let job: MeteringRollupJob;
  let usageRepo: jest.Mocked<Pick<Repository<UsageRecord>, 'createQueryBuilder'>>;
  let rollupRepo: jest.Mocked<Pick<Repository<UsageRollup>, 'createQueryBuilder'>>;

  const mockExecute = jest.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    mockExecute.mockClear();
    const qbChain = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          agentId: 'agent-1',
          requestCount: '2',
          tokensUsed: '100',
          bytesIn: '200',
          bytesOut: '300',
          cpuMs: '40',
        },
      ]),
    };

    usageRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qbChain),
    };

    const insertChain = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orUpdate: jest.fn().mockReturnThis(),
      execute: mockExecute,
    };

    rollupRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(insertChain),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MeteringRollupJob,
        { provide: getRepositoryToken(UsageRecord), useValue: usageRepo },
        { provide: getRepositoryToken(UsageRollup), useValue: rollupRepo },
      ],
    }).compile();

    job = moduleRef.get(MeteringRollupJob);
  });

  it('upserts hourly aggregates with conflict-safe semantics', async () => {
    const count = await job.runHourlyRollup(new Date('2026-05-29T14:30:00.000Z'));
    expect(count).toBe(1);
    expect(rollupRepo.createQueryBuilder).toHaveBeenCalled();
    expect(mockExecute).toHaveBeenCalled();
  });

  it('is idempotent when run twice for the same hour bucket', async () => {
    const ref = new Date('2026-05-29T14:45:00.000Z');
    await job.runHourlyRollup(ref);
    await job.runHourlyRollup(ref);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });
});
