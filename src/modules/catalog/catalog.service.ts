import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Service } from './entities/service.entity';
import { Tariff } from '../pricing/entities/tariff.entity';
import { PricingService } from '../pricing/pricing.service';
import { ListServicesDto } from './dto/list-services.dto';

export type ServiceWithTariffs = Service & { tariffs: Tariff[] };

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepo: Repository<Service>,
    private readonly pricingService: PricingService,
  ) {}

  async create(data: Partial<Service>): Promise<Service> {
    const service = this.serviceRepo.create(data);
    return this.serviceRepo.save(service);
  }

  /**
   * Lists catalog services, optionally filtered and with their tariffs.
   *
   * Callers used to list the catalog and then resolve the price of every
   * service with a request of its own: one query for the page plus one per
   * row. With `include=tariffs` the prices of the whole page come from a
   * single `IN (...)` query, so a listing costs two queries whatever its size.
   */
  async findAll(query: ListServicesDto = {}): Promise<Service[] | ServiceWithTariffs[]> {
    const qb = this.serviceRepo.createQueryBuilder('s').orderBy('s.createdAt', 'DESC');

    if (query.agentId) {
      qb.andWhere('s.agentId = :agentId', { agentId: query.agentId });
    }
    if (query.q?.trim()) {
      qb.andWhere('(s.name ILIKE :q OR s.description ILIKE :q)', {
        q: `%${escapeLike(query.q.trim())}%`,
      });
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

  async findOne(id: string): Promise<Service | null> {
    return this.serviceRepo.findOneBy({ id });
  }
}

/** Escapes LIKE wildcards so a search for `50%` does not match everything. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
