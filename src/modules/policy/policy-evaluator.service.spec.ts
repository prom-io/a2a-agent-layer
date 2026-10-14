import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BusinessMetricsService } from '../../observability/business-metrics.service';
import { Policy } from './entities/policy.entity';
import { PolicyEvaluatorService } from './policy-evaluator.service';

describe('PolicyEvaluatorService', () => {
  const ctx = { subject: 'did:prom:caller', action: 'invoke', resource: 'session-1' };
  let policies: Array<Pick<Policy, 'name' | 'rules'>>;
  let recordPolicyDecision: jest.Mock;
  let service: PolicyEvaluatorService;

  beforeEach(() => {
    policies = [];
    recordPolicyDecision = jest.fn();
    service = new PolicyEvaluatorService(
      { find: jest.fn(async () => policies) } as unknown as Repository<Policy>,
      { recordPolicyDecision } as unknown as BusinessMetricsService,
    );
  });

  it('allows and records the decision when the agent has no policy', async () => {
    await expect(service.assertAllowed('agent-1', ctx)).resolves.toBeUndefined();

    expect(recordPolicyDecision).toHaveBeenCalledWith('allow', 'no active policy');
  });

  it('records an allow when every policy admits the caller', async () => {
    policies = [{ name: 'open', rules: { allowlist: ['did:prom:*'] } }];

    await service.assertAllowed('agent-1', ctx);

    expect(recordPolicyDecision).toHaveBeenCalledTimes(1);
    expect(recordPolicyDecision).toHaveBeenCalledWith('allow', 'subject on allowlist');
  });

  it('records a deny with the evaluator reason and rejects with 403', async () => {
    policies = [
      { name: 'open', rules: { allowlist: ['did:prom:*'] } },
      { name: 'blocklist', rules: { denylist: ['did:prom:caller'] } },
    ];

    await expect(service.assertAllowed('agent-1', ctx)).rejects.toBeInstanceOf(ForbiddenException);

    expect(recordPolicyDecision).toHaveBeenCalledTimes(1);
    expect(recordPolicyDecision).toHaveBeenCalledWith('deny', 'subject on denylist');
  });
});
