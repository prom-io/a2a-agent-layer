import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MeteringService } from './metering.service';
import { UsageRecord } from './entities/usage-record.entity';
import { Receipt } from './entities/receipt.entity';

@ApiTags('metering')
@Controller()
export class MeteringController {
  constructor(private readonly meteringService: MeteringService) {}

  @Post('usage')
  async recordUsage(@Body() body: Partial<UsageRecord>): Promise<UsageRecord> {
    return this.meteringService.recordUsage(body);
  }

  @Get('usage/:sessionId')
  async getUsage(
    @Param('sessionId') sessionId: string,
  ): Promise<UsageRecord[]> {
    return this.meteringService.getUsageBySession(sessionId);
  }

  @Post('receipts')
  async createReceipt(@Body() body: Partial<Receipt>): Promise<Receipt> {
    return this.meteringService.createReceipt(body);
  }

  @Get('receipts/:sessionId')
  async getReceipts(
    @Param('sessionId') sessionId: string,
  ): Promise<Receipt[]> {
    return this.meteringService.getReceiptsBySession(sessionId);
  }
}
