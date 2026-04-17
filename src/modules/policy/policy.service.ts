import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Policy } from './entities/policy.entity';

@Injectable()
export class PolicyService {
  constructor(
    @InjectRepository(Policy)
    private readonly policyRepo: Repository<Policy>,
  ) {}

  async create(data: Partial<Policy>): Promise<Policy> {
    const policy = this.policyRepo.create(data);
    return this.policyRepo.save(policy);
  }

  async findAll(): Promise<Policy[]> {
    return this.policyRepo.find();
  }

  async findOne(id: string): Promise<Policy | null> {
    return this.policyRepo.findOneBy({ id });
  }

  async update(id: string, data: Partial<Policy>): Promise<Policy | null> {
    await this.policyRepo.update(id, data);
    return this.findOne(id);
  }
}
