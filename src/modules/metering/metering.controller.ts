import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { MeteringService } from './metering.service';
import { UsageRecord } from './entities/usage-record.entity';
import { Receipt } from './entities/receipt.entity';

@ApiTags('metering')
@Controller()
export class MeteringController {
  constructor(private readonly meteringService: MeteringService) {}

  @Post('usage')
  @ApiOperation({ summary: 'Record a usage event for an agent session' })
  @ApiResponse({ status: 201, description: 'Usage recorded' })
  @ApiResponse({ status: 400, description: 'Invalid usage payload' })
  async recordUsage(@Body() body: Partial<UsageRecord>): Promise<UsageRecord> {
    return this.meteringService.recordUsage(body);
  }

  @Get('usage/:sessionId')
  @ApiOperation({ summary: 'List usage records for a session' })
  @ApiParam({ name: 'sessionId', description: 'Session UUID' })
  @ApiResponse({ status: 200, description: 'List of usage records' })
  async getUsage(
    @Param('sessionId') sessionId: string,
  ): Promise<UsageRecord[]> {
    return this.meteringService.getUsageBySession(sessionId);
  }

  @Post('receipts')
  @ApiOperation({ summary: 'Create a signed receipt aggregating usage' })
  @ApiResponse({ status: 201, description: 'Receipt created' })
  @ApiResponse({ status: 400, description: 'Invalid receipt payload' })
  async createReceipt(@Body() body: Partial<Receipt>): Promise<Receipt> {
    return this.meteringService.createReceipt(body);
  }

  @Get('receipts/:sessionId')
  @ApiOperation({ summary: 'List receipts for a session' })
  @ApiParam({ name: 'sessionId', description: 'Session UUID' })
  @ApiResponse({ status: 200, description: 'List of receipts' })
  async getReceipts(
    @Param('sessionId') sessionId: string,
  ): Promise<Receipt[]> {
    return this.meteringService.getReceiptsBySession(sessionId);
  }
}
