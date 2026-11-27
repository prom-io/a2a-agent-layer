import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import {
  applyRanking,
  DEFAULT_NEUTRAL_REPUTATION,
  DEFAULT_RANK_WEIGHTS,
  rankingFromRaw,
  RankWeights,
} from './catalog-ranking';

export { escapeLike } from './catalog-search';

export type ServiceWithTariffs = Service & { tariffs: Tariff[] };

@Injectable()
export class CatalogService {
  private readonly rankWeights: RankWeights;
  private readonly neutralReputation: number;

  constructor(
    @InjectRepository(Service)
    private readonly serviceRepo: Repository<Service>,
    private readonly pricingService: PricingService,
    @Optional() config?: ConfigService,
  ) {
    this.rankWeights = config?.get<RankWeights>('catalog.rankWeights') ?? DEFAULT_RANK_WEIGHTS;
    this.neutralReputation =
      config?.get<number>('catalog.neutralReputation') ?? DEFAULT_NEUTRAL_REPUTATION;
  }

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
   * come newest first. `sort=reputation|price|best` orders by the agent's
   * synced reputation, the cheapest tariff, or a weighted mix of both with
   * relevance, and returns those figures with each row under `ranking`.
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
    const ranked = applyRanking(qb, 's', query.sort ?? (search ? 'relevance' : 'newest'), {
      hasSearch: search !== null,
      currency: query.currency,
      weights: this.rankWeights,
      neutralReputation: this.neutralReputation,
    });
    if (query.limit) {
      qb.take(query.limit).skip(((query.page ?? 1) - 1) * query.limit);
    }

    let services: Service[];
    if (ranked) {
      // The ranking figures are computed columns; read them from the raw rows.
      const { entities, raw } = await qb.getRawAndEntities();
      const figures = new Map(
        raw.map((row: Record<string, unknown>) => [String(row.s_id), rankingFromRaw(row)]),
      );
      services = entities.map((service) =>
        Object.assign(service, { ranking: figures.get(service.id) ?? rankingFromRaw({}) }),
      );
    } else {
      services = await qb.getMany();
    }
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
