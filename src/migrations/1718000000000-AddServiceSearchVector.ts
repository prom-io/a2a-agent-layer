import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Full-text search over the service catalog.
 *
 * `searchVector` is a stored generated column, so Postgres keeps it in step
 * with name and description on every write and no application code can forget
 * to refresh it. The expression must stay identical to
 * SERVICE_SEARCH_VECTOR_SQL in catalog-search.ts; the two-argument
 * to_tsvector with a literal configuration is immutable, which a generated
 * column requires.
 */
export class AddServiceSearchVector1718000000000 implements MigrationInterface {
  name = 'AddServiceSearchVector1718000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "services" ADD COLUMN "searchVector" tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
          setweight(to_tsvector('english', coalesce("description", '')), 'B')
        ) STORED;
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_services_search_vector" ON "services" USING GIN ("searchVector");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_services_search_vector";`);
    await queryRunner.query(`ALTER TABLE "services" DROP COLUMN IF EXISTS "searchVector";`);
  }
}
