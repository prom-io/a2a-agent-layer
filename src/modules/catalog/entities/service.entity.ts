import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Agent } from '../../identity/entities/agent.entity';

@Entity('services')
export class Service {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  agentId!: string;

  @ManyToOne(() => Agent)
  @JoinColumn({ name: 'agentId' })
  agent!: Agent;

  @Column()
  name!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'jsonb', nullable: true })
  inputSchema!: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  outputSchema!: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  slaHints!: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;
}
