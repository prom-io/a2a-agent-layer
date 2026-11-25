import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Agent } from '../identity/entities/agent.entity';
import { AgentReputationSnapshot } from './entities/agent-reputation-snapshot.entity';
import { ReputationController } from './reputation.controller';
import { ReputationService } from './reputation.service';
import { ReputationSyncJob } from './reputation-sync.job';
import { VerificationNetworkClient } from './verification-network.client';

@Module({
  imports: [TypeOrmModule.forFeature([AgentReputationSnapshot, Agent])],
  controllers: [ReputationController],
  providers: [ReputationService, ReputationSyncJob, VerificationNetworkClient],
  exports: [ReputationService],
})
export class ReputationModule {}
