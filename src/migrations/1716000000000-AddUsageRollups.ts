import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsageRollups1716000000000 implements MigrationInterface {
  name = 'AddUsageRollups1716000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "usage_rollups" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "agentId" uuid NOT NULL,
        "hourBucket" TIMESTAMPTZ NOT NULL,
        "requestCount" int NOT NULL DEFAULT 0,
        "tokensUsed" bigint NOT NULL DEFAULT 0,
        "bytesIn" bigint NOT NULL DEFAULT 0,
        "bytesOut" bigint NOT NULL DEFAULT 0,
        "cpuMs" int NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_usage_rollups" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_usage_rollups_agent_hour" UNIQUE ("agentId", "hourBucket")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_usage_rollups_hour" ON "usage_rollups" ("hourBucket");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_usage_rollups_hour";`);
    await queryRunner.query(`DROP TABLE "usage_rollups";`);
  }
}
