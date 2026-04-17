import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { Service } from './entities/service.entity';

@ApiTags('services')
@Controller('services')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post()
  async create(@Body() body: Partial<Service>): Promise<Service> {
    return this.catalogService.create(body);
  }

  @Get()
  async findAll(): Promise<Service[]> {
    return this.catalogService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Service | null> {
    return this.catalogService.findOne(id);
  }
}
