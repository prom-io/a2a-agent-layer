import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Service } from './entities/service.entity';
import { Tariff } from '../pricing/entities/tariff.entity';
import { PricingService } from '../pricing/pricing.service';
import { ListServicesDto } from './dto/list-services.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { applyFullTextSearch, normalizeSearchQuery } from './catalog-search';
import { applyCatalogFilters, normalizeCapabilities } from './catalog-filters';
import { compareServices, ServiceComparison } from './catalog-compare';

export { escapeLike } from './catalog-search';

export type ServiceWithTariffs = Service & { tariffs: Tariff[] };

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepo: Repository<Service>,
    private readonly pricingService: PricingService,
  ) {}

  async create(data: CreateServiceDto): Promise<Service> {
    const service = this.serviceRepo.create({
      ...data,
      capabilities: normalizeCapabilities(data.capabilities),
      available: data.available ?? true,
    });
    return this.serviceRepo.save(service);
  }

  /**
   * Lists catalog services, optionally filtered and with their tariffs.
   *
   * Callers used to list the catalog and then resolve the price of every
   * service with a request of its own: one query for the page plus one per
   * row. With `include=tariffs` the prices of the whole page come from a
   * single `IN (...)` query, so a listing costs two queries whatever its size.
   *
   * With `q` the listing becomes a full-text search over name and description
   * (Postgres tsvector, GIN-indexed) ordered by relevance; without it services
   * come newest first.
   */
  async findAll(query: ListServicesDto = {}): Promise<Service[] | ServiceWithTariffs[]> {
    const qb = this.serviceRepo.createQueryBuilder('s').orderBy('s.createdAt', 'DESC');

    if (query.agentId) {
      qb.andWhere('s.agentId = :agentId', { agentId: query.agentId });
    }
    applyCatalogFilters(qb, 's', {
      capabilities: query.capability,
      capabilityMatch: query.capabilityMatch,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      currency: query.currency,
      available: query.available,
    });
    const search = normalizeSearchQuery(query.q);
    if (search) {
      applyFullTextSearch(qb, 's', search);
    }
    if (query.limit) {
      qb.take(query.limit).skip(((query.page ?? 1) - 1) * query.limit);
    }

    const services = await qb.getMany();
    if (query.include !== 'tariffs') return services;

    const tariffs = await this.pricingService.findByServiceIds(services.map((s) => s.id));
    return services.map((service) =>
      Object.assign(service, { tariffs: tariffs.get(service.id) ?? [] }),
    );
  }

  /**
   * Compares services on price and SLA. Two queries whatever the number of
   * services: one for the services, one batched query for their tariffs.
   * Unknown ids are reported in `notFound` instead of failing the whole
   * comparison; it fails only when nothing at all was found.
   */
  async compare(ids: string[]): Promise<ServiceComparison> {
    const unique = [...new Set(ids.map((id) => id.toLowerCase()))];
    if (unique.length < 2) {
      throw new BadRequestException('Compare at least two different services');
    }
    const services = await this.serviceRepo.findBy({ id: In(unique) });
    if (services.length === 0) {
      throw new NotFoundException('None of the requested services exist');
    }
    const tariffs = await this.pricingService.findByServiceIds(services.map((s) => s.id));
    return compareServices(unique, services, tariffs);
  }

  async findOne(id: string): Promise<Service | null> {
    return this.serviceRepo.findOneBy({ id });
  }
}
