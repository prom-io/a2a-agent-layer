import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Tariff } from './entities/tariff.entity';

@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(Tariff)
    private readonly tariffRepo: Repository<Tariff>,
  ) {}

  async create(data: Partial<Tariff>): Promise<Tariff> {
    const tariff = this.tariffRepo.create(data);
    return this.tariffRepo.save(tariff);
  }

  /**
   * Lists tariffs, newest first. Pass `serviceId` to price one service without
   * downloading the whole tariff table and filtering on the client.
   */
  async findAll(filter: { serviceId?: string } = {}): Promise<Tariff[]> {
    return this.tariffRepo.find({
      where: filter.serviceId ? { serviceId: filter.serviceId } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Tariff | null> {
    return this.tariffRepo.findOneBy({ id });
  }

  /**
   * Tariffs for many services in one query, grouped by service id.
   *
   * This is the batched replacement for calling a per-service lookup in a
   * loop. Ids are de-duplicated and an empty input does not touch the
   * database at all.
   */
  async findByServiceIds(serviceIds: string[]): Promise<Map<string, Tariff[]>> {
    const grouped = new Map<string, Tariff[]>();
    const ids = Array.from(new Set(serviceIds));
    if (ids.length === 0) return grouped;

    const tariffs = await this.tariffRepo.find({
      where: { serviceId: In(ids) },
      order: { createdAt: 'DESC' },
    });
    for (const tariff of tariffs) {
      const bucket = grouped.get(tariff.serviceId);
      if (bucket) bucket.push(tariff);
      else grouped.set(tariff.serviceId, [tariff]);
    }
    return grouped;
  }
}
