import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/auth/roles.enum';
import { AgentReputationView, ReputationService, ReputationSyncResult } from './reputation.service';
import { VerificationNetworkClient } from './verification-network.client';

@ApiTags('reputation')
@Controller()
export class ReputationController {
  constructor(
    private readonly reputation: ReputationService,
    private readonly client: VerificationNetworkClient,
  ) {}

  @Get('agents/:id/reputation')
  @ApiOperation({ summary: 'Current reputation of an agent and its recent changes' })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiQuery({ name: 'history', required: false, description: 'Snapshots to return, 1-100' })
  @ApiResponse({ status: 200, description: 'current is null until the first sync found a score' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async view(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('history', new DefaultValuePipe(20), ParseIntPipe) history: number,
  ): Promise<AgentReputationView> {
    return this.reputation.view(id, history);
  }

  @Post('reputation/sync')
  @Roles(Role.OPERATOR, Role.ADMIN, Role.SERVICE)
  @ApiOperation({ summary: 'Pull reputation of every active agent from the verification network now' })
  @ApiResponse({ status: 201, description: 'Counts of stored, unchanged, missing and failed agents' })
  @ApiResponse({ status: 403, description: 'Caller lacks the operator, admin or service role' })
  @ApiResponse({ status: 503, description: 'The verification network is not configured' })
  async sync(): Promise<ReputationSyncResult> {
    if (!this.client.configured) {
      throw new ServiceUnavailableException('VERIFICATION_NETWORK_URL is not configured');
    }
    return this.reputation.syncAll();
  }
}
