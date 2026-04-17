import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AgentStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('agents')
export class Agent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  agentDid!: string;

  @Column()
  owner!: string;

  @Column()
  publicKey!: string;

  @Column()
  endpoint!: string;

  @Column({ type: 'enum', enum: AgentStatus, default: AgentStatus.ACTIVE })
  status!: AgentStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
