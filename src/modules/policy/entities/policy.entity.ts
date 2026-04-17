import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('policies')
export class Policy {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  agentId!: string;

  @Column()
  name!: string;

  @Column({ type: 'jsonb' })
  rules!: {
    maxSpendPerHour?: number;
    allowlist?: string[];
    denylist?: string[];
    requireVerification?: boolean;
    maxLatencyMs?: number;
  };

  @Column({ type: 'varchar', nullable: true })
  signature!: string | null;

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
