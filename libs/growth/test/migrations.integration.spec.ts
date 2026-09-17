import { randomUUID } from 'node:crypto';
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

describeDatabase(
  testDatabaseUrl
    ? 'growth migrations against TEST_DATABASE_URL'
    : 'growth migrations intentionally skipped: TEST_DATABASE_URL is not set',
  () => {
    let executor: SqlExecutor;

    beforeAll(() => {
      if (!testDatabaseUrl) {
        throw new Error(
          'TEST_DATABASE_URL is required for growth integration tests'
        );
      }
      executor = createDatabaseExecutor(testDatabaseUrl);
    });

    afterAll(async () => {
      await executor?.close?.();
    });

    it('applies repeatably and exposes the exact growth tables and reporting views', async () => {
      const directory = resolve(process.cwd(), 'migrations');

      await applyMigrations({ directory, executor });
      const repeated = await applyMigrations({ directory, executor });

      expect(repeated.applied).toEqual([]);

      const tables = await executor.execute<{ table_name: string }>(`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_type = 'BASE TABLE'
          and table_name like 'growth\\_%' escape '\\'
        order by table_name
      `);
      expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
        'growth_activity',
        'growth_artifacts',
        'growth_collection_budgets',
        'growth_contacts',
        'growth_install_digest_reports',
        'growth_install_runtime_links',
        'growth_jobs',
        'growth_observation_facts',
        'growth_observation_form_links',
        'growth_observation_identities',
        'growth_observation_operations',
        'growth_observation_redactions',
        'growth_observation_subjects',
        'growth_observation_work',
        'growth_observations',
        'growth_projects',
      ]);

      const views = await executor.execute<{ table_name: string }>(`
        select table_name
        from information_schema.views
        where table_schema = 'public'
          and table_name like 'growth\\_%' escape '\\'
        order by table_name
      `);
      expect(views.rows.map(({ table_name }) => table_name)).toEqual([
        'growth_campaign_performance_v1',
        'growth_contact_overview_v1',
        'growth_funnel_daily_v1',
        'growth_job_health_v1',
        'growth_legacy_progress_v1',
        'growth_observation_source_health_v1',
        'growth_observation_subject_overview_v1',
        'growth_observation_work_health_v1',
      ]);

      const ledger = await executor.execute<{
        checksum_length: number;
        name: string;
      }>(`
        select name, length(checksum) as checksum_length
        from public.threadplane_schema_migrations
        order by name
      `);
      expect(ledger.rows).toEqual([
        { checksum_length: 64, name: '0001_rate_limit_events.sql' },
        { checksum_length: 64, name: '0002_growth_control_plane.sql' },
        { checksum_length: 64, name: '0003_growth_reporting_views.sql' },
        { checksum_length: 64, name: '0004_growth_observability.sql' },
        { checksum_length: 64, name: '0005_growth_observability_views.sql' },
        { checksum_length: 64, name: '0006_growth_form_observations.sql' },
        { checksum_length: 64, name: '0007_growth_install_runtime.sql' },
      ]);
    });

    it('installs the required columns, constraints, and indexes', async () => {
      const columns = await executor.execute<{
        column_name: string;
        table_name: string;
      }>(`
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name like 'growth\\_%' escape '\\'
        order by table_name, ordinal_position
      `);
      const columnNames = new Map<string, string[]>();
      for (const { table_name, column_name } of columns.rows) {
        columnNames.set(table_name, [
          ...(columnNames.get(table_name) ?? []),
          column_name,
        ]);
      }
      expect(columnNames.get('growth_contacts')).toEqual([
        'id',
        'email_normalized',
        'email_lookup_hmac',
        'email_hmac_key_version',
        'display_name',
        'company_name',
        'company_domain',
        'outreach_approved_at',
        'source',
        'created_at',
        'updated_at',
        'deleted_at',
      ]);
      expect(columnNames.get('growth_projects')).toEqual([
        'id',
        'contact_id',
        'posthog_distinct_id',
        'claim_key_hash',
        'claim_consumed_at',
        'claim_method',
        'created_at',
        'updated_at',
      ]);
      expect(columnNames.get('growth_activity')).toEqual([
        'id',
        'event_key',
        'contact_id',
        'project_id',
        'kind',
        'occurred_at',
        'data',
        'created_at',
      ]);
      expect(columnNames.get('growth_jobs')).toEqual([
        'id',
        'kind',
        'contact_id',
        'project_id',
        'status',
        'available_at',
        'lease_until',
        'lease_token',
        'attempts',
        'idempotency_key',
        'payload',
        'provider_email_id',
        'rfc_message_id',
        'gmail_seed_message_id',
        'delivery_status',
        'last_error_code',
        'created_at',
        'updated_at',
      ]);
      expect(columnNames.get('growth_artifacts')).toEqual([
        'id',
        'job_id',
        'contact_id',
        'project_id',
        'kind',
        'schema_version',
        'content',
        'created_at',
      ]);

      const constraints = await executor.execute<{ constraint_name: string }>(`
        select constraint_name
        from information_schema.table_constraints
        where table_schema = 'public'
          and table_name like 'growth\\_%' escape '\\'
        order by constraint_name
      `);
      expect(
        constraints.rows.map(({ constraint_name }) => constraint_name)
      ).toEqual(
        expect.arrayContaining([
          'growth_activity_contact_id_fkey',
          'growth_activity_event_key_key',
          'growth_activity_pkey',
          'growth_activity_project_id_fkey',
          'growth_artifacts_contact_id_fkey',
          'growth_artifacts_job_id_key',
          'growth_artifacts_job_id_fkey',
          'growth_artifacts_pkey',
          'growth_artifacts_project_id_fkey',
          'growth_contacts_email_lookup_hmac_key',
          'growth_contacts_email_normalized_key',
          'growth_contacts_pkey',
          'growth_jobs_contact_id_fkey',
          'growth_jobs_delivery_status_check',
          'growth_jobs_idempotency_key_key',
          'growth_jobs_pkey',
          'growth_jobs_project_id_fkey',
          'growth_jobs_status_check',
          'growth_projects_contact_id_fkey',
          'growth_projects_pkey',
          'growth_projects_posthog_distinct_id_key',
        ])
      );

      const indexes = await executor.execute<{ indexname: string }>(`
        select indexname
        from pg_indexes
        where schemaname = 'public'
          and tablename like 'growth\\_%' escape '\\'
        order by indexname
      `);
      expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(
        expect.arrayContaining([
          'growth_activity_contact_time',
          'growth_activity_project_time',
          'growth_jobs_campaign_predecessor',
          'growth_jobs_contact',
          'growth_jobs_due',
          'growth_jobs_expired_lease',
          'growth_jobs_gmail_seed',
          'growth_jobs_provider_email',
          'growth_jobs_rfc_message',
          'growth_projects_contact',
        ])
      );
    });

    it('keeps raw email out of every reporting view except contact overview', async () => {
      const emailColumns = await executor.execute<{ table_name: string }>(`
        select distinct columns.table_name
        from information_schema.columns columns
        join information_schema.views reporting_view
          on reporting_view.table_schema = columns.table_schema
         and reporting_view.table_name = columns.table_name
        where columns.table_schema = 'public'
          and columns.table_name like 'growth\\_%' escape '\\'
          and columns.column_name like '%email%'
        order by columns.table_name
      `);

      expect(emailColumns.rows.map(({ table_name }) => table_name)).toEqual([
        'growth_contact_overview_v1',
      ]);
    });

    it('keeps private lookup aliases out of overview and funnel activity reporting', async () => {
      const contactId = randomUUID();

      try {
        await executor.execute(
          `insert into growth_contacts (
             id, email_lookup_hmac, email_hmac_key_version, source, created_at
           ) values ($1, $2, 1, 'integration', '2097-04-10T12:00:00Z')`,
          [contactId, `integration:${contactId}`]
        );
        await executor.execute(
          `insert into growth_activity (
             event_key, contact_id, kind, occurred_at, data
           ) values
             ($1, $3, 'contact.form_submission', '2097-04-11T12:00:00Z', '{}'),
             ($2, $3, 'contact.lookup_alias_added', '2097-04-12T12:00:00Z',
              '{"key_version":1,"digest":"private-test-digest"}')`,
          [
            `integration:reported-activity:${contactId}`,
            `integration:private-alias:${contactId}`,
            contactId,
          ]
        );

        const overview = await executor.execute<{
          activity_count: string;
          last_activity_at: Date;
        }>(
          `select activity_count, last_activity_at
           from growth_contact_overview_v1
           where contact_id = $1`,
          [contactId]
        );
        expect(overview.rows).toEqual([
          {
            activity_count: '1',
            last_activity_at: new Date('2097-04-11T12:00:00.000Z'),
          },
        ]);

        const funnel = await executor.execute<{
          activities_recorded: string;
          day: string;
        }>(`
          select to_char(day, 'YYYY-MM-DD') as day, activities_recorded
          from growth_funnel_daily_v1
          where day in ('2097-04-11'::date, '2097-04-12'::date)
          order by day
        `);
        expect(funnel.rows).toEqual([
          { activities_recorded: '1', day: '2097-04-11' },
        ]);
      } finally {
        await executor.execute(
          'delete from growth_activity where contact_id = $1',
          [contactId]
        );
        await executor.execute('delete from growth_contacts where id = $1', [
          contactId,
        ]);
      }
    });

    it('reports dates that contain only approvals or only project claims', async () => {
      const contactId = randomUUID();
      const projectId = randomUUID();

      try {
        await executor.execute(
          `insert into growth_contacts (
             id, email_lookup_hmac, email_hmac_key_version, source,
             outreach_approved_at, created_at
           ) values ($1, $2, 1, 'integration', $3::timestamptz, $4::timestamptz)`,
          [
            contactId,
            `integration:${contactId}`,
            '2097-04-02T12:00:00Z',
            '2097-04-01T12:00:00Z',
          ]
        );
        await executor.execute(
          `insert into growth_projects (
             id, contact_id, claim_key_hash, claim_consumed_at, created_at
           ) values ($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
          [
            projectId,
            contactId,
            `integration:${projectId}`,
            '2097-04-04T12:00:00Z',
            '2097-04-03T12:00:00Z',
          ]
        );

        const rows = await executor.execute<{
          contacts_approved: string;
          day: string;
          projects_claimed: string;
        }>(`
          select to_char(day, 'YYYY-MM-DD') as day,
                 contacts_approved,
                 projects_claimed
          from growth_funnel_daily_v1
          where day in ('2097-04-02'::date, '2097-04-04'::date)
          order by day
        `);

        expect(
          rows.rows.map(({ day, contacts_approved, projects_claimed }) => ({
            day,
            contactsApproved: contacts_approved,
            projectsClaimed: projects_claimed,
          }))
        ).toEqual([
          {
            day: '2097-04-02',
            contactsApproved: '1',
            projectsClaimed: '0',
          },
          {
            day: '2097-04-04',
            contactsApproved: '0',
            projectsClaimed: '1',
          },
        ]);
      } finally {
        await executor.execute('delete from growth_projects where id = $1', [
          projectId,
        ]);
        await executor.execute('delete from growth_contacts where id = $1', [
          contactId,
        ]);
      }
    });
  }
);
