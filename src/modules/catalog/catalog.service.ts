import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Service } from './entities/service.entity';

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepo: Repository<Service>,
  ) {}

  async create(data: Partial<Service>): Promise<Service> {
    const service = this.serviceRepo.create(data);
    return this.serviceRepo.save(service);
  }

  async findAll(): Promise<Service[]> {
    return this.serviceRepo.find();
  }

  async findOne(id: string): Promise<Service | null> {
    return this.serviceRepo.findOneBy({ id });
  }
}
