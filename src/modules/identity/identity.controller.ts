import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { IdentityService } from './identity.service';
import { Agent } from './entities/agent.entity';

@ApiTags('agents')
@Controller('agents')
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new agent' })
  @ApiResponse({ status: 201, description: 'Agent registered (and on-chain if AGENT_REGISTRY_ADDRESS set)' })
  @ApiResponse({ status: 400, description: 'Invalid agent payload' })
  @ApiResponse({ status: 409, description: 'Agent with this DID already exists' })
  async register(@Body() body: Partial<Agent>): Promise<Agent> {
    return this.identityService.register(body);
  }

  @Get()
  @ApiOperation({ summary: 'List all agents' })
  @ApiResponse({ status: 200, description: 'List of agents' })
  async findAll(): Promise<Agent[]> {
    return this.identityService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get agent by ID' })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Agent found' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async findOne(@Param('id') id: string): Promise<Agent> {
    return this.identityService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an agent' })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Agent updated' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async update(@Param('id') id: string, @Body() body: Partial<Agent>): Promise<Agent> {
    return this.identityService.update(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate an agent' })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Agent deactivated' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async deactivate(@Param('id') id: string): Promise<Agent> {
    return this.identityService.deactivate(id);
  }
}
