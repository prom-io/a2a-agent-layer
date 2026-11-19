import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Capability tags and the availability switch of catalog listings.
 *
 * Both columns are defaulted, so rows written by the previous release stay
 * valid and older code keeps working against the new schema. The GIN index
 * serves the `@>` (has all) and `&&` (has any) capability filters.
 */
export class AddServiceCapabilities1719000000000 implements MigrationInterface {
  name = 'AddServiceCapabilities1719000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "services" ADD COLUMN "capabilities" text[] NOT NULL DEFAULT '{}';`,
    );
    await queryRunner.query(
      `ALTER TABLE "services" ADD COLUMN "available" boolean NOT NULL DEFAULT true;`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_services_capabilities" ON "services" USING GIN ("capabilities");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_services_capabilities";`);
    await queryRunner.query(`ALTER TABLE "services" DROP COLUMN IF EXISTS "available";`);
    await queryRunner.query(`ALTER TABLE "services" DROP COLUMN IF EXISTS "capabilities";`);
  }
}
