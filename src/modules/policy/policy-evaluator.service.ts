import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Policy } from './entities/policy.entity';
import { evaluatePolicyAccess, PolicyEvaluationContext } from './policy-evaluator';
import { BusinessMetricsService } from '../../observability/business-metrics.service';

@Injectable()
export class PolicyEvaluatorService {
  private readonly logger = new Logger(PolicyEvaluatorService.name);

  constructor(
    @InjectRepository(Policy)
    private readonly policyRepo: Repository<Policy>,
    private readonly businessMetrics: BusinessMetricsService,
  ) {}

  async assertAllowed(agentId: string, ctx: PolicyEvaluationContext): Promise<void> {
    const policies = await this.policyRepo.find({
      where: { agentId, isActive: true },
    });

    if (policies.length === 0) {
      this.businessMetrics.recordPolicyDecision('allow', 'no active policy');
      return;
    }

    let allowReason = 'allowed';

    for (const policy of policies) {
      const result = evaluatePolicyAccess(policy.rules, ctx);
      if (!result.allowed) {
        this.logger.warn(
          `Policy denied: agent=${agentId}, policy=${policy.name}, reason=${result.reason}`,
        );
        this.businessMetrics.recordPolicyDecision('deny', result.reason);
        throw new ForbiddenException(`Policy denied: ${result.reason}`);
      }
      allowReason = result.reason;
    }

    // One decision per request, not one per policy, so the deny ratio in the
    // alert rules is a ratio of requests.
    this.businessMetrics.recordPolicyDecision('allow', allowReason);
  }
}
