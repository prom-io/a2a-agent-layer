import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { PricingService } from './pricing.service';
import { Tariff } from './entities/tariff.entity';

@ApiTags('tariffs')
@Controller('tariffs')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Post()
  @ApiOperation({ summary: 'Create a tariff for a service' })
  @ApiResponse({ status: 201, description: 'Tariff created' })
  @ApiResponse({ status: 400, description: 'Invalid tariff payload' })
  async create(@Body() body: Partial<Tariff>): Promise<Tariff> {
    return this.pricingService.create(body);
  }

  @Get()
  @ApiOperation({ summary: 'List all tariffs' })
  @ApiResponse({ status: 200, description: 'List of tariffs' })
  async findAll(): Promise<Tariff[]> {
    return this.pricingService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get tariff by ID' })
  @ApiParam({ name: 'id', description: 'Tariff UUID' })
  @ApiResponse({ status: 200, description: 'Tariff found' })
  @ApiResponse({ status: 404, description: 'Tariff not found' })
  async findOne(@Param('id') id: string): Promise<Tariff | null> {
    return this.pricingService.findOne(id);
  }
}
