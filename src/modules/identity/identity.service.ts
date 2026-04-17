import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Agent, AgentStatus } from './entities/agent.entity';
import { BlockchainService } from '../../common/blockchain/blockchain.service';
import { AGENT_REGISTRY_ABI } from '../../common/blockchain/abis/agent-registry.abi';

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  private readonly registryAddress: string;

  constructor(
    @InjectRepository(Agent)
    private readonly agentRepo: Repository<Agent>,
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
  ) {
    this.registryAddress = this.configService.get<string>('AGENT_REGISTRY_ADDRESS', '');
  }

  async register(data: Partial<Agent>): Promise<Agent> {
    const agent = this.agentRepo.create(data);
    const saved = await this.agentRepo.save(agent);

    if (this.registryAddress) {
      try {
        const contract = this.blockchainService.getContract(this.registryAddress, AGENT_REGISTRY_ABI);
        const tx = await contract.registerAgent(saved.agentDid, saved.publicKey, saved.endpoint);
        const receipt = await tx.wait();
        this.logger.log(`Agent ${saved.agentDid} registered on-chain, tx: ${receipt.hash}`);
      } catch (error: any) {
        this.logger.error(`On-chain registration failed for ${saved.agentDid}: ${error.message}`);
      }
    }

    return saved;
  }

  async findAll(): Promise<Agent[]> {
    return this.agentRepo.find();
  }

  async findOne(id: string): Promise<Agent> {
    const agent = await this.agentRepo.findOneBy({ id });
    if (!agent) throw new NotFoundException(`Agent ${id} not found`);
    return agent;
  }

  async findByDid(did: string): Promise<Agent> {
    const agent = await this.agentRepo.findOneBy({ agentDid: did });
    if (!agent) throw new NotFoundException(`Agent with DID ${did} not found`);
    return agent;
  }

  async update(id: string, data: Partial<Agent>): Promise<Agent> {
    const agent = await this.findOne(id);
    Object.assign(agent, data);
    const saved = await this.agentRepo.save(agent);

    if (this.registryAddress && (data.publicKey || data.endpoint)) {
      try {
        const contract = this.blockchainService.getContract(this.registryAddress, AGENT_REGISTRY_ABI);
        const tx = await contract.updateAgent(saved.agentDid, saved.publicKey, saved.endpoint);
        await tx.wait();
        this.logger.log(`Agent ${saved.agentDid} updated on-chain`);
      } catch (error: any) {
        this.logger.error(`On-chain update failed: ${error.message}`);
      }
    }

    return saved;
  }

  async deactivate(id: string): Promise<Agent> {
    const agent = await this.findOne(id);
    agent.status = AgentStatus.INACTIVE;
    const saved = await this.agentRepo.save(agent);

    if (this.registryAddress) {
      try {
        const contract = this.blockchainService.getContract(this.registryAddress, AGENT_REGISTRY_ABI);
        const tx = await contract.deactivateAgent(saved.agentDid);
        await tx.wait();
        this.logger.log(`Agent ${saved.agentDid} deactivated on-chain`);
      } catch (error: any) {
        this.logger.error(`On-chain deactivation failed: ${error.message}`);
      }
    }

    return saved;
  }
}
