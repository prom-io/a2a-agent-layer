import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One reading of an agent's reputation as published by the verification
 * network. A new row is written only when the figures change, so the table is
 * a history of changes and the newest row is the current score.
 */
@Entity('agent_reputation_snapshots')
@Index('IDX_reputation_snapshots_agent_fetched', ['agentId', 'fetchedAt'])
export class AgentReputationSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  agentId!: string;

  @Column({ type: 'varchar' })
  agentDid!: string;

  /** Effective (time-decayed) composite score, 0..1. */
  @Column({ type: 'numeric', precision: 5, scale: 4 })
  score!: string;

  @Column({ type: 'numeric', precision: 5, scale: 4, nullable: true })
  accuracy!: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 4, nullable: true })
  uptime!: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 4, nullable: true })
  disputeLossRate!: string | null;

  @Column({ type: 'int', default: 0 })
  totalJobs!: number;

  /** When the verification network last changed the score, if it says. */
  @Column({ type: 'timestamptz', nullable: true })
  sourceUpdatedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  fetchedAt!: Date;
}
