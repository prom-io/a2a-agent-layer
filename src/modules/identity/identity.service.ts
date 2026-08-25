import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Agent, AgentStatus } from './entities/agent.entity';
import { BlockchainService } from '../../common/blockchain/blockchain.service';
import { AGENT_REGISTRY_ABI } from '../../common/blockchain/abis/agent-registry.abi';
import { withRetry } from '../../common/blockchain/retry.util';
import { RegisterAgentDto } from './dto/register-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { verifyDidController } from './did-controller';

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

  async register(data: RegisterAgentDto): Promise<Agent> {
    const { ownerSignature, ...claim } = data;

    // Verify before touching the database. Registering first and validating
    // afterwards would leave an unverified agent in the catalog whenever the
    // check failed.
    const controls = verifyDidController(
      {
        agentDid: claim.agentDid,
        owner: claim.owner,
        publicKey: claim.publicKey,
        endpoint: claim.endpoint,
      },
      ownerSignature,
    );

    if (!controls) {
      this.logger.warn(
        `Rejected registration of ${claim.agentDid}: signature does not prove control of ${claim.owner}`,
      );
      throw new ForbiddenException(
        'ownerSignature does not prove control of the claimed owner address',
      );
    }

    const existing = await this.agentRepo.findOneBy({ agentDid: claim.agentDid });
    if (existing) {
      throw new ConflictException(`Agent ${claim.agentDid} is already registered`);
    }

    const agent = this.agentRepo.create({
      ...claim,
      owner: claim.owner.toLowerCase(),
    });
    const saved = await this.agentRepo.save(agent);

    if (this.registryAddress) {
      try {
        const contract = this.blockchainService.getContract(this.registryAddress, AGENT_REGISTRY_ABI);
        const receipt = await withRetry(
          async () => {
            const tx = await contract.registerAgent(saved.agentDid, saved.publicKey, saved.endpoint);
            return tx.wait();
          },
          {},
          this.logger,
        );
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

  async update(id: string, data: UpdateAgentDto): Promise<Agent> {
    const agent = await this.findOne(id);
    Object.assign(agent, data);
    const saved = await this.agentRepo.save(agent);

    if (this.registryAddress && (data.publicKey || data.endpoint)) {
      try {
        const contract = this.blockchainService.getContract(this.registryAddress, AGENT_REGISTRY_ABI);
        await withRetry(
          async () => {
            const tx = await contract.updateAgent(saved.agentDid, saved.publicKey, saved.endpoint);
            return tx.wait();
          },
          {},
          this.logger,
        );
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
        await withRetry(
          async () => {
            const tx = await contract.deactivateAgent(saved.agentDid);
            return tx.wait();
          },
          {},
          this.logger,
        );
        this.logger.log(`Agent ${saved.agentDid} deactivated on-chain`);
      } catch (error: any) {
        this.logger.error(`On-chain deactivation failed: ${error.message}`);
      }
    }

    return saved;
  }
}
