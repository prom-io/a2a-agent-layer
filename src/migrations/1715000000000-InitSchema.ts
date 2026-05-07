import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1715000000000 implements MigrationInterface {
  name = 'InitSchema1715000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE agent_status AS ENUM ('active', 'inactive');
    `);

    await queryRunner.query(`
      CREATE TYPE tariff_type AS ENUM ('per_request', 'per_token', 'per_second', 'fixed_variable');
    `);

    await queryRunner.query(`
      CREATE TABLE "agents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "agentDid" varchar NOT NULL,
        "owner" varchar NOT NULL,
        "publicKey" varchar NOT NULL,
        "endpoint" varchar NOT NULL,
        "status" agent_status NOT NULL DEFAULT 'active',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agents" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agents_did" UNIQUE ("agentDid")
      );
    `);
    await queryRunner.query(`CREATE INDEX "IDX_agents_owner" ON "agents" ("owner");`);

    await queryRunner.query(`
      CREATE TABLE "services" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "agentId" uuid NOT NULL,
        "name" varchar NOT NULL,
        "description" text NOT NULL,
        "inputSchema" jsonb,
        "outputSchema" jsonb,
        "slaHints" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_services" PRIMARY KEY ("id"),
        CONSTRAINT "FK_services_agent" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`CREATE INDEX "IDX_services_agent" ON "services" ("agentId");`);

    await queryRunner.query(`
      CREATE TABLE "tariffs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "agentId" uuid NOT NULL,
        "serviceId" uuid NOT NULL,
        "type" tariff_type NOT NULL,
        "basePrice" decimal(18,8) NOT NULL,
        "variablePrice" decimal(18,8),
        "currency" varchar NOT NULL DEFAULT 'PROM',
        "metadataUri" varchar,
        "metadataHash" varchar,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tariffs" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(`CREATE INDEX "IDX_tariffs_service" ON "tariffs" ("serviceId");`);

    await queryRunner.query(`
      CREATE TABLE "usage_records" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "sessionId" uuid NOT NULL,
        "agentId" uuid NOT NULL,
        "tokensUsed" int NOT NULL,
        "cpuMs" int NOT NULL,
        "bytesIn" bigint NOT NULL,
        "bytesOut" bigint NOT NULL,
        "modelId" varchar,
        "toolCallsCount" int NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_usage_records" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(`CREATE INDEX "IDX_usage_session" ON "usage_records" ("sessionId");`);

    await queryRunner.query(`
      CREATE TABLE "receipts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "sessionId" uuid NOT NULL,
        "requestHash" varchar NOT NULL,
        "resultHash" varchar,
        "usageMetrics" jsonb NOT NULL,
        "priceComputed" decimal(18,8) NOT NULL,
        "nonce" varchar NOT NULL,
        "signature" varchar NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_receipts" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(`CREATE INDEX "IDX_receipts_session" ON "receipts" ("sessionId");`);

    await queryRunner.query(`
      CREATE TABLE "policies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "agentId" uuid NOT NULL,
        "name" varchar NOT NULL,
        "rules" jsonb NOT NULL,
        "signature" varchar,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_policies" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(`CREATE INDEX "IDX_policies_agent" ON "policies" ("agentId");`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "policies";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "receipts";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "usage_records";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tariffs";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "services";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agents";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tariff_type";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "agent_status";`);
  }
}
