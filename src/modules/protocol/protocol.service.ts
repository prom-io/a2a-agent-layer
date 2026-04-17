import { Injectable, Logger } from '@nestjs/common';
import { A2aRequestDto } from './dto/a2a-request.dto';
import { MeteringService } from '../metering/metering.service';
import { IdentityService } from '../identity/identity.service';
import { BlockchainService } from '../../common/blockchain/blockchain.service';

@Injectable()
export class ProtocolService {
  private readonly logger = new Logger(ProtocolService.name);

  constructor(
    private readonly meteringService: MeteringService,
    private readonly identityService: IdentityService,
    private readonly blockchainService: BlockchainService,
  ) {}

  async handleRequest(dto: A2aRequestDto): Promise<{
    status: string;
    sessionId: string;
    resultHash: string;
    receipt: {
      id: string;
      sessionId: string;
      requestHash: string;
      resultHash: string;
      usageMetrics: Record<string, unknown>;
      priceComputed: string;
      nonce: string;
      signature: string;
    };
  }> {
    const requestHash = this.blockchainService.hashData(
      JSON.stringify(dto.requestPayload),
    );

    if (dto.requestHash !== requestHash) {
      this.logger.warn(`Hash mismatch for session ${dto.sessionId}`);
    }

    const startTime = Date.now();

    const resultPayload = {
      agentFrom: dto.agentToId,
      agentTo: dto.agentFromId,
      sessionId: dto.sessionId,
      result: `Processed request from ${dto.agentFromId}`,
      timestamp: new Date().toISOString(),
    };

    const elapsedMs = Date.now() - startTime;
    const resultHash = this.blockchainService.hashData(JSON.stringify(resultPayload));

    const payloadStr = JSON.stringify(dto.requestPayload);
    const resultStr = JSON.stringify(resultPayload);
    const usageMetrics = {
      tokensUsed: Math.ceil(payloadStr.length / 4),
      cpuMs: elapsedMs,
      bytesIn: payloadStr.length,
      bytesOut: resultStr.length,
      toolCallsCount: 1,
    };

    await this.meteringService.recordUsage({
      sessionId: dto.sessionId,
      agentId: dto.agentToId,
      tokensUsed: usageMetrics.tokensUsed,
      cpuMs: usageMetrics.cpuMs,
      bytesIn: String(usageMetrics.bytesIn),
      bytesOut: String(usageMetrics.bytesOut),
      toolCallsCount: usageMetrics.toolCallsCount,
    });

    const pricePerToken = 0.0001;
    const priceComputed = (usageMetrics.tokensUsed * pricePerToken).toFixed(8);

    const receipt = await this.meteringService.createSignedReceipt({
      sessionId: dto.sessionId,
      requestHash,
      resultHash,
      usageMetrics,
      priceComputed,
    });

    this.logger.log(
      `A2A request processed: session=${dto.sessionId}, tokens=${usageMetrics.tokensUsed}, price=${priceComputed}`,
    );

    return {
      status: 'completed',
      sessionId: dto.sessionId,
      resultHash,
      receipt: {
        id: receipt.id,
        sessionId: receipt.sessionId,
        requestHash: receipt.requestHash,
        resultHash: receipt.resultHash ?? '',
        usageMetrics: receipt.usageMetrics,
        priceComputed: receipt.priceComputed,
        nonce: receipt.nonce,
        signature: receipt.signature,
      },
    };
  }
}
