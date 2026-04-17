import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PricingService } from './pricing.service';
import { Tariff } from './entities/tariff.entity';

@ApiTags('tariffs')
@Controller('tariffs')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Post()
  async create(@Body() body: Partial<Tariff>): Promise<Tariff> {
    return this.pricingService.create(body);
  }

  @Get()
  async findAll(): Promise<Tariff[]> {
    return this.pricingService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Tariff | null> {
    return this.pricingService.findOne(id);
  }
}
