import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum TariffType {
  PER_REQUEST = 'per_request',
  PER_TOKEN = 'per_token',
  PER_SECOND = 'per_second',
  FIXED_VARIABLE = 'fixed_variable',
}

@Entity('tariffs')
export class Tariff {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  agentId!: string;

  @Column()
  serviceId!: string;

  @Column({ type: 'enum', enum: TariffType })
  type!: TariffType;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  basePrice!: string;

  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true })
  variablePrice!: string | null;

  @Column({ default: 'PROM' })
  currency!: string;

  @Column({ type: 'varchar', nullable: true })
  metadataUri!: string | null;

  @Column({ type: 'varchar', nullable: true })
  metadataHash!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
