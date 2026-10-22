import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brings the identifier columns in line with the entities.
 *
 * The initial schema typed these columns as uuid, but the entities declare
 * them as strings and the protocol layer stores agent DIDs (`did:prom:...`)
 * and caller-chosen session ids in them. On a migrated database every A2A
 * request therefore failed with "invalid input syntax for type uuid"; only
 * synchronized development databases worked. Found by running the e2e suite
 * against a migrated schema in CI.
 */
const COLUMNS: Array<[table: string, column: string]> = [
  ['usage_records', 'sessionId'],
  ['usage_records', 'agentId'],
  ['usage_rollups', 'agentId'],
  ['receipts', 'sessionId'],
  ['policies', 'agentId'],
];

export class AlignIdentifierColumnTypes1717000000000 implements MigrationInterface {
  name = 'AlignIdentifierColumnTypes1717000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE varchar USING "${column}"::text;`,
      );
    }
  }

  // Only succeeds while every stored value is still a valid uuid, i.e. before
  // any DID or free-form session id has been written.
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of [...COLUMNS].reverse()) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE uuid USING "${column}"::uuid;`,
      );
    }
  }
}
