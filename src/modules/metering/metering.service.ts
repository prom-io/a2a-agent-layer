import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsageRecord } from './entities/usage-record.entity';
import { Receipt } from './entities/receipt.entity';
import { BlockchainService } from '../../common/blockchain/blockchain.service';
import { randomUUID } from 'crypto';

@Injectable()
export class MeteringService {
  private readonly logger = new Logger(MeteringService.name);

  constructor(
    @InjectRepository(UsageRecord)
    private readonly usageRepo: Repository<UsageRecord>,
    @InjectRepository(Receipt)
    private readonly receiptRepo: Repository<Receipt>,
    private readonly blockchainService: BlockchainService,
  ) {}

  async recordUsage(data: Partial<UsageRecord>): Promise<UsageRecord> {
    const record = this.usageRepo.create(data);
    return this.usageRepo.save(record);
  }

  async getUsageBySession(sessionId: string): Promise<UsageRecord[]> {
    return this.usageRepo.find({ where: { sessionId } });
  }

  async createSignedReceipt(params: {
    sessionId: string;
    requestHash: string;
    resultHash?: string;
    usageMetrics: Record<string, unknown>;
    priceComputed: string;
  }): Promise<Receipt> {
    const nonce = randomUUID();
    const messageToSign = JSON.stringify({
      sessionId: params.sessionId,
      requestHash: params.requestHash,
      resultHash: params.resultHash ?? null,
      usageMetrics: params.usageMetrics,
      priceComputed: params.priceComputed,
      nonce,
    });

    const signature = await this.blockchainService.signMessage(messageToSign);

    const receipt = this.receiptRepo.create({
      sessionId: params.sessionId,
      requestHash: params.requestHash,
      resultHash: params.resultHash ?? null,
      usageMetrics: params.usageMetrics,
      priceComputed: params.priceComputed,
      nonce,
      signature,
    });

    const saved = await this.receiptRepo.save(receipt);
    this.logger.log(`Receipt created for session ${params.sessionId}, nonce: ${nonce}`);
    return saved;
  }

  async createReceipt(data: Partial<Receipt>): Promise<Receipt> {
    const receipt = this.receiptRepo.create(data);
    return this.receiptRepo.save(receipt);
  }

  async getReceiptsBySession(sessionId: string): Promise<Receipt[]> {
    return this.receiptRepo.find({ where: { sessionId } });
  }
}
