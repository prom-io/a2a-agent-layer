import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('receipts')
export class Receipt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  sessionId!: string;

  @Column()
  requestHash!: string;

  @Column({ type: 'varchar', nullable: true })
  resultHash!: string | null;

  @Column({ type: 'jsonb' })
  usageMetrics!: Record<string, unknown>;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  priceComputed!: string;

  @Column()
  nonce!: string;

  @Column()
  signature!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
