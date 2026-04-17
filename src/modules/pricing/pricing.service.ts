import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async findAll(): Promise<Tariff[]> {
    return this.tariffRepo.find();
  }

  async findOne(id: string): Promise<Tariff | null> {
    return this.tariffRepo.findOneBy({ id });
  }
}
