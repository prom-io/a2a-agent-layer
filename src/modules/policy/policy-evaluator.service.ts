import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Policy } from './entities/policy.entity';
import { evaluatePolicyAccess, PolicyEvaluationContext } from './policy-evaluator';

@Injectable()
export class PolicyEvaluatorService {
  private readonly logger = new Logger(PolicyEvaluatorService.name);

  constructor(
    @InjectRepository(Policy)
    private readonly policyRepo: Repository<Policy>,
  ) {}

  async assertAllowed(agentId: string, ctx: PolicyEvaluationContext): Promise<void> {
    const policies = await this.policyRepo.find({
      where: { agentId, isActive: true },
    });

    if (policies.length === 0) {
      return;
    }

    for (const policy of policies) {
      const result = evaluatePolicyAccess(policy.rules, ctx);
      if (!result.allowed) {
        this.logger.warn(
          `Policy denied: agent=${agentId}, policy=${policy.name}, reason=${result.reason}`,
        );
        throw new ForbiddenException(`Policy denied: ${result.reason}`);
      }
    }
  }
}
