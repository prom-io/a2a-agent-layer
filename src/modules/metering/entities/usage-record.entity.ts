import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('usage_records')
export class UsageRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  sessionId!: string;

  @Column()
  agentId!: string;

  @Column({ type: 'int' })
  tokensUsed!: number;

  @Column({ type: 'int' })
  cpuMs!: number;

  @Column({ type: 'bigint' })
  bytesIn!: string;

  @Column({ type: 'bigint' })
  bytesOut!: string;

  @Column({ type: 'varchar', nullable: true })
  modelId!: string | null;

  @Column({ type: 'int', default: 0 })
  toolCallsCount!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
