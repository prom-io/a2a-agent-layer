import { Controller, Get, Post, Param, Body, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
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
  @ApiOperation({ summary: 'List tariffs, optionally for a single service' })
  @ApiQuery({ name: 'serviceId', required: false, description: 'Only tariffs of this service (UUID)' })
  @ApiResponse({ status: 200, description: 'List of tariffs' })
  async findAll(
    @Query('serviceId', new ParseUUIDPipe({ optional: true })) serviceId?: string,
  ): Promise<Tariff[]> {
    return this.pricingService.findAll({ serviceId });
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
