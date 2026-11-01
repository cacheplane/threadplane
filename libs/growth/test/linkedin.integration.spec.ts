import { resolve } from 'node:path';

import { createDatabaseExecutor, type SqlExecutor } from '../src/index.ts';
// The repository-level migration CLI is deliberately outside the Nx library.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { applyMigrations } from '../../../scripts/apply-migrations.mts';

const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
const describeDatabase =
  process.env['GROWTH_INTEGRATION'] === '1' && testDatabaseUrl
    ? describe
    : describe.skip;

const LINKEDIN_TABLES = [
  'growth_linkedin_posts',
  'growth_linkedin_receipts',
  'growth_linkedin_leads',
  'growth_linkedin_engagements',
  'growth_linkedin_deny',
  'growth_linkedin_drops',
  'growth_linkedin_digests',
];

describeDatabase(
  testDatabaseUrl
    ? 'growth LinkedIn lead schema against TEST_DATABASE_URL'
    : 'growth LinkedIn lead schema intentionally skipped: TEST_DATABASE_URL is not set',
  () => {
    let executor: SqlExecutor;

    beforeAll(async () => {
      if (!testDatabaseUrl) {
        throw new Error(
          'TEST_DATABASE_URL is required for growth integration tests'
        );
      }
      executor = createDatabaseExecutor(testDatabaseUrl);
      await applyMigrations({
        directory: resolve(process.cwd(), 'migrations'),
        executor,
      });
    });

    afterAll(async () => {
      await executor?.close?.();
    });

    it('creates every LinkedIn lead table', async () => {
      for (const table of LINKEDIN_TABLES) {
        const result = await executor.execute<{ regclass: string | null }>(
          'select to_regclass($1) as regclass',
          [`public.${table}`]
        );
        expect(result.rows[0]?.regclass).not.toBeNull();
      }
    });

    it('rejects a drop row without a receipt', async () => {
      await expect(
        executor.execute(
          'insert into growth_linkedin_drops (deny_id) values (gen_random_uuid())'
        )
      ).rejects.toThrow();
    });
  }
);
