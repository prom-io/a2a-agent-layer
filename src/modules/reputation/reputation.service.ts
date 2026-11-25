import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { Agent, AgentStatus } from '../identity/entities/agent.entity';
import { AgentReputationSnapshot } from './entities/agent-reputation-snapshot.entity';
import { RemoteReputation, VerificationNetworkClient } from './verification-network.client';

export interface ReputationSyncResult {
  /** False when another sync was still running and this call did nothing. */
  ran: boolean;
  checked: number;
  /** New snapshots written because the figures changed. */
  stored: number;
  unchanged: number;
  /** The verification network has no reputation for the agent yet. */
  missing: number;
  failed: number;
}

export interface AgentReputationView {
  agentId: string;
  agentDid: string;
  current: AgentReputationSnapshot | null;
  history: AgentReputationSnapshot[];
}

const fixed4 = (value: number | null): string | null => (value === null ? null : value.toFixed(4));
const MAX_HISTORY = 100;

@Injectable()
export class ReputationService {
  private readonly logger = new Logger(ReputationService.name);
  private readonly batchSize: number;
  private syncing = false;

  constructor(
    @InjectRepository(AgentReputationSnapshot)
    private readonly snapshots: Repository<AgentReputationSnapshot>,
    @InjectRepository(Agent)
    private readonly agents: Repository<Agent>,
    private readonly client: VerificationNetworkClient,
    config: ConfigService,
  ) {
    this.batchSize = config.get<number>('reputation.batchSize', 100);
  }

  async latest(agentId: string): Promise<AgentReputationSnapshot | null> {
    return this.snapshots.findOne({ where: { agentId }, order: { fetchedAt: 'DESC' } });
  }

  /** Latest score per agent, for many agents in one query. */
  async latestScores(agentIds: string[]): Promise<Map<string, number>> {
    const scores = new Map<string, number>();
    const ids = [...new Set(agentIds)];
    if (ids.length === 0) return scores;
    const rows = await this.snapshots
      .createQueryBuilder('r')
      .select('DISTINCT ON (r.agentId) r.agentId', 'agentId')
      .addSelect('r.score', 'score')
      .where('r.agentId IN (:...ids)', { ids })
      .orderBy('r.agentId')
      .addOrderBy('r.fetchedAt', 'DESC')
      .getRawMany<{ agentId: string; score: string }>();
    for (const row of rows) scores.set(row.agentId, Number(row.score));
    return scores;
  }

  async view(agentId: string, historyLimit = 20): Promise<AgentReputationView> {
    const agent = await this.agents.findOneBy({ id: agentId });
    if (!agent) throw new NotFoundException(`Agent ${agentId} not found`);
    const history = await this.snapshots.find({
      where: { agentId },
      order: { fetchedAt: 'DESC' },
      take: Math.min(Math.max(historyLimit, 1), MAX_HISTORY),
    });
    return { agentId, agentDid: agent.agentDid, current: history[0] ?? null, history };
  }

  /**
   * Pulls the reputation of one agent and stores it when it changed. Returns
   * what happened so the caller can count it.
   */
  async syncAgent(agent: Pick<Agent, 'id' | 'agentDid'>): Promise<'stored' | 'unchanged' | 'missing'> {
    const remote = await this.client.fetchReputation(agent.agentDid);
    if (!remote) return 'missing';

    const previous = await this.latest(agent.id);
    if (previous && sameFigures(previous, remote)) return 'unchanged';

    await this.snapshots.save(
      this.snapshots.create({
        agentId: agent.id,
        agentDid: agent.agentDid,
        score: remote.score.toFixed(4),
        accuracy: fixed4(remote.accuracy),
        uptime: fixed4(remote.uptime),
        disputeLossRate: fixed4(remote.disputeLossRate),
        totalJobs: remote.totalJobs,
        sourceUpdatedAt: remote.updatedAt,
      }),
    );
    return 'stored';
  }

  /**
   * Syncs every active agent, a page at a time (keyset on id, so agents added
   * during the run cannot shift a page). One agent failing is counted and
   * logged; it never stops the run.
   */
  async syncAll(): Promise<ReputationSyncResult> {
    const result: ReputationSyncResult = {
      ran: false,
      checked: 0,
      stored: 0,
      unchanged: 0,
      missing: 0,
      failed: 0,
    };
    if (this.syncing) return result;
    this.syncing = true;
    result.ran = true;
    try {
      let after: string | undefined;
      for (;;) {
        const page = await this.agents.find({
          select: { id: true, agentDid: true },
          where: { status: AgentStatus.ACTIVE, ...(after ? { id: MoreThan(after) } : {}) },
          order: { id: 'ASC' },
          take: this.batchSize,
        });
        for (const agent of page) {
          result.checked += 1;
          try {
            result[await this.syncAgent(agent)] += 1;
          } catch (error) {
            result.failed += 1;
            this.logger.warn(`Reputation sync failed for ${agent.agentDid}: ${(error as Error).message}`);
          }
        }
        if (page.length < this.batchSize) break;
        after = page[page.length - 1].id;
      }
      this.logger.log(
        `Reputation sync: ${result.checked} checked, ${result.stored} stored, ` +
          `${result.unchanged} unchanged, ${result.missing} missing, ${result.failed} failed`,
      );
      return result;
    } finally {
      this.syncing = false;
    }
  }
}

/** Compares at the stored precision, so float noise never writes a new row. */
export function sameFigures(stored: AgentReputationSnapshot, remote: RemoteReputation): boolean {
  const same = (a: string | null, b: number | null) =>
    (a === null && b === null) || (a !== null && b !== null && Number(a).toFixed(4) === b.toFixed(4));
  return (
    same(stored.score, remote.score) &&
    same(stored.accuracy, remote.accuracy) &&
    same(stored.uptime, remote.uptime) &&
    same(stored.disputeLossRate, remote.disputeLossRate) &&
    stored.totalJobs === remote.totalJobs
  );
}
