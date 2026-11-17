import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Agent } from '../../identity/entities/agent.entity';
import { SERVICE_SEARCH_VECTOR_SQL } from '../catalog-search';

@Entity('services')
// GIN index from the AddServiceSearchVector migration. synchronize: false
// because TypeORM can only create btree indexes; the migration owns it.
@Index('IDX_services_search_vector', { synchronize: false })
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

  /**
   * Weighted full-text document over name and description, maintained by
   * Postgres itself (generated column), so it can never drift from the text.
   * Never selected: it is only used for matching and ranking.
   */
  @Column({
    type: 'tsvector',
    select: false,
    insert: false,
    update: false,
    nullable: true,
    generatedType: 'STORED',
    asExpression: SERVICE_SEARCH_VECTOR_SQL,
  })
  searchVector?: string;
}
