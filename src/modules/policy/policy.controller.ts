import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { PolicyService } from './policy.service';
import { Policy } from './entities/policy.entity';

@ApiTags('policies')
@Controller('policies')
export class PolicyController {
  constructor(private readonly policyService: PolicyService) {}

  @Post()
  @ApiOperation({ summary: 'Create a policy (spend limits, allowlists, verification rules)' })
  @ApiResponse({ status: 201, description: 'Policy created' })
  @ApiResponse({ status: 400, description: 'Invalid policy payload' })
  async create(@Body() body: Partial<Policy>): Promise<Policy> {
    return this.policyService.create(body);
  }

  @Get()
  @ApiOperation({ summary: 'List all policies' })
  @ApiResponse({ status: 200, description: 'List of policies' })
  async findAll(): Promise<Policy[]> {
    return this.policyService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get policy by ID' })
  @ApiParam({ name: 'id', description: 'Policy UUID' })
  @ApiResponse({ status: 200, description: 'Policy found' })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  async findOne(@Param('id') id: string): Promise<Policy | null> {
    return this.policyService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a policy' })
  @ApiParam({ name: 'id', description: 'Policy UUID' })
  @ApiResponse({ status: 200, description: 'Policy updated' })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  async update(
    @Param('id') id: string,
    @Body() body: Partial<Policy>,
  ): Promise<Policy | null> {
    return this.policyService.update(id, body);
  }
}
