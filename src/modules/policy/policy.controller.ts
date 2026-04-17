import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PolicyService } from './policy.service';
import { Policy } from './entities/policy.entity';

@ApiTags('policies')
@Controller('policies')
export class PolicyController {
  constructor(private readonly policyService: PolicyService) {}

  @Post()
  async create(@Body() body: Partial<Policy>): Promise<Policy> {
    return this.policyService.create(body);
  }

  @Get()
  async findAll(): Promise<Policy[]> {
    return this.policyService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Policy | null> {
    return this.policyService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Partial<Policy>,
  ): Promise<Policy | null> {
    return this.policyService.update(id, body);
  }
}
