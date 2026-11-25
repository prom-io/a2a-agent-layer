import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reputation snapshots pulled from the verification network. Rows go with
 * their agent; the composite index serves "latest snapshot per agent", which
 * is what catalog ranking reads.
 */
export class AddAgentReputationSnapshots1720000000000 implements MigrationInterface {
  name = 'AddAgentReputationSnapshots1720000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agent_reputation_snapshots" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "agentId" uuid NOT NULL,
        "agentDid" varchar NOT NULL,
        "score" numeric(5,4) NOT NULL,
        "accuracy" numeric(5,4),
        "uptime" numeric(5,4),
        "disputeLossRate" numeric(5,4),
        "totalJobs" int NOT NULL DEFAULT 0,
        "sourceUpdatedAt" TIMESTAMPTZ,
        "fetchedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_reputation_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_reputation_score_range" CHECK ("score" >= 0 AND "score" <= 1),
        CONSTRAINT "FK_reputation_snapshots_agent" FOREIGN KEY ("agentId")
          REFERENCES "agents"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_reputation_snapshots_agent_fetched" ON "agent_reputation_snapshots" ("agentId", "fetchedAt");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_reputation_snapshots";`);
  }
}
