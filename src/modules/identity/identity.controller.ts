import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IdentityService } from './identity.service';
import { Agent } from './entities/agent.entity';

@ApiTags('agents')
@Controller('agents')
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new agent' })
  async register(@Body() body: Partial<Agent>): Promise<Agent> {
    return this.identityService.register(body);
  }

  @Get()
  @ApiOperation({ summary: 'List all agents' })
  async findAll(): Promise<Agent[]> {
    return this.identityService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get agent by ID' })
  async findOne(@Param('id') id: string): Promise<Agent> {
    return this.identityService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an agent' })
  async update(@Param('id') id: string, @Body() body: Partial<Agent>): Promise<Agent> {
    return this.identityService.update(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate an agent' })
  async deactivate(@Param('id') id: string): Promise<Agent> {
    return this.identityService.deactivate(id);
  }
}
