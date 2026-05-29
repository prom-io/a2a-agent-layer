import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('usage_rollups')
@Unique('UQ_usage_rollups_agent_hour', ['agentId', 'hourBucket'])
@Index('IDX_usage_rollups_hour', ['hourBucket'])
export class UsageRollup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  agentId!: string;

  /** UTC hour bucket as ISO-8601 truncated to hour, e.g. 2026-05-29T14:00:00.000Z */
  @Column({ type: 'timestamptz' })
  hourBucket!: Date;

  @Column({ type: 'int', default: 0 })
  requestCount!: number;

  @Column({ type: 'bigint', default: '0' })
  tokensUsed!: string;

  @Column({ type: 'bigint', default: '0' })
  bytesIn!: string;

  @Column({ type: 'bigint', default: '0' })
  bytesOut!: string;

  @Column({ type: 'int', default: 0 })
  cpuMs!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
