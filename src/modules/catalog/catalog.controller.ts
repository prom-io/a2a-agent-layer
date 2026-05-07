import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { Service } from './entities/service.entity';

@ApiTags('services')
@Controller('services')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new service in the catalog' })
  @ApiResponse({ status: 201, description: 'Service created' })
  @ApiResponse({ status: 400, description: 'Invalid service payload' })
  async create(@Body() body: Partial<Service>): Promise<Service> {
    return this.catalogService.create(body);
  }

  @Get()
  @ApiOperation({ summary: 'List all services' })
  @ApiResponse({ status: 200, description: 'List of services' })
  async findAll(): Promise<Service[]> {
    return this.catalogService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get service by ID' })
  @ApiParam({ name: 'id', description: 'Service UUID' })
  @ApiResponse({ status: 200, description: 'Service found' })
  @ApiResponse({ status: 404, description: 'Service not found' })
  async findOne(@Param('id') id: string): Promise<Service | null> {
    return this.catalogService.findOne(id);
  }
}
