import { randomUUID } from 'node:crypto';
import {
  cleanContactObservationFences,
  cleanEvidence,
  evidenceFixture,
  evidenceKeys,
} from './observability-fixtures.ts';
import { resolve } from 'node:path';

import {
  acceptObservationBatch,
  approveContactFromForm,
  approveContactFromInstallDigest,
  createDatabaseExecutor,
  createEmailLookupHmac,
  deleteContact,
  readContactControlState,
  stopContact,
  type EmailHmacKeyring,
  type SqlExecutor,
} from '../src/index.ts';
// The repository-level migration CLI is deliberately outside the Nx library.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { applyMigrations } from '../../../scripts/apply-migrations.mts';

const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
const describeDatabase =
  process.env['GROWTH_INTEGRATION'] === '1' && testDatabaseUrl
    ? describe
    : describe.skip;

const keyring: EmailHmacKeyring = {
  active: {
    version: 97,
    secret: 'integration-only-email-hmac-secret-32-bytes',
  },
};

describeDatabase(
  testDatabaseUrl
    ? 'growth contacts against TEST_DATABASE_URL'
    : 'growth contacts intentionally skipped: TEST_DATABASE_URL is not set',
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

    async function removeContact(contactId: string): Promise<void> {
      await cleanContactObservationFences(executor, contactId);
      await executor.execute(
        `delete from growth_artifacts
         where contact_id = $1
            or job_id in (select id from growth_jobs where contact_id = $1)`,
        [contactId]
      );
      await executor.execute(
        'delete from growth_activity where contact_id = $1',
        [contactId]
      );
      await executor.execute('delete from growth_jobs where contact_id = $1', [
        contactId,
      ]);
      await executor.execute(
        'delete from growth_projects where contact_id = $1',
        [contactId]
      );
      await executor.execute('delete from growth_contacts where id = $1', [
        contactId,
      ]);
    }

    it('serializes generic approval against a hard stop so the stop always wins', async () => {
      const contactId = randomUUID();
      const email = `race-${contactId}@example.com`;
      const lookup = createEmailLookupHmac(email, keyring.active);
      const stopAt = new Date('2097-05-01T12:00:01.000Z');

      try {
        await executor.execute(
          `insert into growth_contacts (
             id, email_normalized, email_lookup_hmac,
             email_hmac_key_version, source
           ) values ($1, $2, $3, $4, 'integration')`,
          [contactId, email, lookup.digest, lookup.keyVersion]
        );

        await Promise.all([
          approveContactFromForm(executor, {
            email,
            source: 'integration',
            sourceForm: 'whitepaper',
            noticeText: 'Exact integration notice.',
            noticeVersion: 'integration-v1',
            policyVersion: 'integration-v1',
            eventKey: `integration:approval:${contactId}`,
            occurredAt: new Date('2097-05-01T12:00:00.000Z'),
            keyring,
          }),
          executor.transaction(async (transaction) => {
            await transaction.execute(
              'select id from growth_contacts where id = $1 for update',
              [contactId]
            );
            await transaction.execute(
              `insert into growth_activity (
                 event_key, contact_id, kind, occurred_at, data
               ) values ($1, $2, 'unsubscribe', $3, '{"reason":"unsubscribe"}')`,
              [`integration:stop:${contactId}`, contactId, stopAt]
            );
            await transaction.execute(
              `update growth_contacts
               set outreach_approved_at = null
               where id = $1`,
              [contactId]
            );
          }),
        ]);

        const state = await readContactControlState(executor, contactId);
        expect(state.authorization).toBe('stopped');
        expect(state.canSend).toBe(false);
        expect(state.latestHardStop?.reason).toBe('unsubscribe');
      } finally {
        await removeContact(contactId);
      }
    });

    it('serializes mixed key versions and monotonically rekeys live and deleted contacts', async () => {
      const liveContactId = randomUUID();
      const deletedContactId = randomUUID();
      const liveEmail = `rotation-live-${liveContactId}@example.com`;
      const deletedEmail = `rotation-deleted-${deletedContactId}@example.com`;
      const version1 = {
        version: 101,
        secret: 'integration-rotation-version-1-strong',
      };
      const version2 = {
        version: 102,
        secret: 'integration-rotation-version-2-strong',
      };
      const version3 = {
        version: 103,
        secret: 'integration-rotation-version-3-strong',
      };
      const oldKeyring: EmailHmacKeyring = {
        active: version2,
        previous: [version1],
      };
      const newKeyring: EmailHmacKeyring = {
        active: version3,
        previous: [version2],
      };

      try {
        const liveVersion2 = createEmailLookupHmac(liveEmail, version2);
        await executor.execute(
          `insert into growth_contacts (
             id, email_normalized, email_lookup_hmac,
             email_hmac_key_version, source
           ) values ($1, $2, $3, $4, 'integration')`,
          [
            liveContactId,
            liveEmail,
            liveVersion2.digest,
            liveVersion2.keyVersion,
          ]
        );

        const liveRace = await Promise.allSettled([
          approveContactFromForm(executor, {
            email: liveEmail,
            source: 'integration-old',
            sourceForm: 'whitepaper',
            noticeText: 'Exact integration rotation notice.',
            noticeVersion: 'integration-v1',
            policyVersion: 'integration-v1',
            eventKey: `integration:rotation-old:${liveContactId}`,
            occurredAt: new Date('2097-05-01T13:00:00.000Z'),
            keyring: oldKeyring,
          }),
          approveContactFromForm(executor, {
            email: liveEmail,
            source: 'integration-new',
            sourceForm: 'whitepaper',
            noticeText: 'Exact integration rotation notice.',
            noticeVersion: 'integration-v1',
            policyVersion: 'integration-v1',
            eventKey: `integration:rotation-new:${liveContactId}`,
            occurredAt: new Date('2097-05-01T13:00:01.000Z'),
            keyring: newKeyring,
          }),
        ]);
        expect(liveRace[1]?.status).toBe('fulfilled');
        if (liveRace[0]?.status === 'rejected') {
          expect(String(liveRace[0].reason)).toMatch(/rotation coverage.*103/i);
        }

        const liveRows = await executor.execute<{
          email_hmac_key_version: number;
          email_lookup_hmac: string;
        }>(
          `select email_lookup_hmac, email_hmac_key_version
           from growth_contacts where id = $1`,
          [liveContactId]
        );
        expect(liveRows.rows).toEqual([
          {
            email_lookup_hmac: createEmailLookupHmac(liveEmail, version3)
              .digest,
            email_hmac_key_version: version3.version,
          },
        ]);
        await removeContact(liveContactId);

        const deletedVersion1 = createEmailLookupHmac(deletedEmail, version1);
        await executor.execute(
          `insert into growth_contacts (
             id, email_lookup_hmac, email_hmac_key_version,
             source, deleted_at
           ) values ($1, $2, $3, 'deleted:integration', now())`,
          [deletedContactId, deletedVersion1.digest, deletedVersion1.keyVersion]
        );
        await executor.execute(
          `insert into growth_activity (
             event_key, contact_id, kind, occurred_at, data
           ) values ($1, $2, 'deletion', now(), '{"reason":"deletion"}')`,
          [`integration:rotation-deleted:${deletedContactId}`, deletedContactId]
        );

        await approveContactFromForm(executor, {
          email: deletedEmail,
          source: 'integration',
          sourceForm: 'whitepaper',
          noticeText: 'Exact integration rotation notice.',
          noticeVersion: 'integration-v1',
          policyVersion: 'integration-v1',
          eventKey: `integration:rotation-v2:${deletedContactId}`,
          occurredAt: new Date('2097-05-01T14:00:00.000Z'),
          keyring: oldKeyring,
        });
        await approveContactFromForm(executor, {
          email: deletedEmail,
          source: 'integration',
          sourceForm: 'whitepaper',
          noticeText: 'Exact integration rotation notice.',
          noticeVersion: 'integration-v1',
          policyVersion: 'integration-v1',
          eventKey: `integration:rotation-v3:${deletedContactId}`,
          occurredAt: new Date('2097-05-01T14:00:01.000Z'),
          keyring: newKeyring,
        });
        await expect(
          approveContactFromForm(executor, {
            email: deletedEmail,
            source: 'integration-reverse-old',
            sourceForm: 'whitepaper',
            noticeText: 'Exact integration rotation notice.',
            noticeVersion: 'integration-v1',
            policyVersion: 'integration-v1',
            eventKey: `integration:rotation-reverse-old:${deletedContactId}`,
            occurredAt: new Date('2097-05-01T14:00:02.000Z'),
            keyring: oldKeyring,
          })
        ).rejects.toThrow(/rotation coverage.*103/i);

        const deletedRows = await executor.execute<{
          alias_digests: string;
          alias_versions: string;
          activity_count: string;
          email_hmac_key_version: number;
          email_lookup_hmac: string;
          email_normalized: string | null;
          form_count: string;
          outreach_approved_at: Date | null;
        }>(
          `select c.email_normalized,
                  c.email_lookup_hmac,
                  c.email_hmac_key_version,
                  c.outreach_approved_at,
                  count(a.id)::text as activity_count,
                  count(a.id) filter (
                    where a.kind = 'contact.form_submission'
                  )::text as form_count,
                  string_agg(a.data ->> 'key_version', ',' order by a.data ->> 'key_version')
                    filter (where a.kind = 'contact.lookup_alias_added')
                    as alias_versions,
                  string_agg(a.data ->> 'digest', ',' order by a.data ->> 'key_version')
                    filter (where a.kind = 'contact.lookup_alias_added')
                    as alias_digests
           from growth_contacts c
           left join growth_activity a on a.contact_id = c.id
           where c.id = $1
           group by c.id`,
          [deletedContactId]
        );
        expect(deletedRows.rows).toEqual([
          {
            activity_count: '3',
            alias_versions: `${version1.version},${version2.version}`,
            alias_digests: [
              createEmailLookupHmac(deletedEmail, version1).digest,
              createEmailLookupHmac(deletedEmail, version2).digest,
            ].join(','),
            email_hmac_key_version: version3.version,
            email_lookup_hmac: createEmailLookupHmac(deletedEmail, version3)
              .digest,
            email_normalized: null,
            form_count: '0',
            outreach_approved_at: null,
          },
        ]);

        const identityRows = await executor.execute<{ count: string }>(
          `select count(*)::text as count
           from growth_contacts
           where email_normalized = $1
              or email_lookup_hmac = any($2::text[])`,
          [
            deletedEmail,
            [version1, version2, version3].map(
              (key) => createEmailLookupHmac(deletedEmail, key).digest
            ),
          ]
        );
        expect(identityRows.rows).toEqual([{ count: '1' }]);
      } finally {
        await removeContact(liveContactId);
        await removeContact(deletedContactId);
      }
    }, 15_000);

    it('fails closed for uncovered stored key versions and rekeys only with complete coverage', async () => {
      const contactId = randomUUID();
      const email = `coverage-${contactId}@example.com`;
      const version1 = {
        version: 201,
        secret: 'integration-coverage-version-1-strong',
      };
      const version2 = {
        version: 202,
        secret: 'integration-coverage-version-2-strong',
      };
      const version3 = {
        version: 203,
        secret: 'integration-coverage-version-3-strong',
      };
      const incompleteKeyring: EmailHmacKeyring = {
        active: version3,
        previous: [version2],
      };
      const completeKeyring: EmailHmacKeyring = {
        active: version3,
        previous: [version2, version1],
      };
      const retiredWriterKeyring: EmailHmacKeyring = {
        active: version2,
        previous: [version1],
      };

      try {
        const version1Lookup = createEmailLookupHmac(email, version1);
        await executor.execute(
          `insert into growth_contacts (
             id, email_lookup_hmac, email_hmac_key_version,
             source, deleted_at
           ) values ($1, $2, $3, 'deleted:integration', now())`,
          [contactId, version1Lookup.digest, version1Lookup.keyVersion]
        );
        await executor.execute(
          `insert into growth_activity (
             event_key, contact_id, kind, occurred_at, data
           ) values ($1, $2, 'deletion', now(), '{"reason":"deletion"}')`,
          [`integration:coverage-deleted:${contactId}`, contactId]
        );

        const formInput = {
          email,
          source: 'integration',
          sourceForm: 'whitepaper',
          noticeText: 'Exact integration key coverage notice.',
          noticeVersion: 'integration-v1',
          policyVersion: 'integration-v1',
          eventKey: `integration:coverage-form:${contactId}`,
          occurredAt: new Date('2097-05-01T15:00:00.000Z'),
        };
        await expect(
          approveContactFromForm(executor, {
            ...formInput,
            keyring: incompleteKeyring,
          })
        ).rejects.toThrow(/rotation coverage.*201/i);

        const rekeyed = await approveContactFromForm(executor, {
          ...formInput,
          keyring: completeKeyring,
        });
        expect(rekeyed.authorization).toBe('deleted');

        await expect(
          approveContactFromForm(executor, {
            ...formInput,
            eventKey: `integration:coverage-retired:${contactId}`,
            keyring: retiredWriterKeyring,
          })
        ).rejects.toThrow(/rotation coverage.*203/i);

        const rows = await executor.execute<{
          alias_count: string;
          contact_count: string;
          email_hmac_key_version: number;
          form_count: string;
        }>(
          `select c.email_hmac_key_version,
                  count(distinct c.id)::text as contact_count,
                  count(a.id) filter (
                    where a.kind = 'contact.lookup_alias_added'
                  )::text as alias_count,
                  count(a.id) filter (
                    where a.kind = 'contact.form_submission'
                  )::text as form_count
           from growth_contacts c
           left join growth_activity a on a.contact_id = c.id
           where c.id = $1
           group by c.email_hmac_key_version`,
          [contactId]
        );
        expect(rows.rows).toEqual([
          {
            alias_count: '1',
            contact_count: '1',
            email_hmac_key_version: version3.version,
            form_count: '0',
          },
        ]);
      } finally {
        await removeContact(contactId);
      }
    });

    it('deletes repeatedly without restoring PII or stale leased work', async () => {
      const contactId = randomUUID();
      const projectId = randomUUID();
      const pendingJobId = randomUUID();
      const leasedJobId = randomUUID();
      const submittedJobId = randomUUID();
      const leasedToken = randomUUID();
      const email = `delete-${contactId}@example.com`;
      const lookup = createEmailLookupHmac(email, keyring.active);
      const deletedAt = new Date('2097-05-02T12:00:00.000Z');

      let staleWorker: SqlExecutor | undefined;
      try {
        if (!testDatabaseUrl) {
          throw new Error('TEST_DATABASE_URL is required');
        }
        staleWorker = createDatabaseExecutor(testDatabaseUrl);
        await executor.execute(
          `insert into growth_contacts (
             id, email_normalized, email_lookup_hmac,
             email_hmac_key_version, display_name, company_name,
             company_domain, outreach_approved_at, source
           ) values ($1, $2, $3, $4, 'Delete Me', 'Private Co',
                     'private.example', now(), 'integration')`,
          [contactId, email, lookup.digest, lookup.keyVersion]
        );
        await executor.execute(
          `insert into growth_projects (id, contact_id, claim_key_hash)
           values ($1, $2, $3)`,
          [projectId, contactId, `claim:${projectId}`]
        );
        await executor.execute(
          `insert into growth_jobs (
             id, kind, contact_id, project_id, status, available_at,
             lease_until, lease_token, idempotency_key, payload,
             provider_email_id, delivery_status
           ) values
             ($1, 'send_step', $4, $5, 'pending', now(), null, null,
              $6, '{"email":"private@example.com"}', null, 'not_submitted'),
             ($2, 'send_step', $4, $5, 'leased', now(), now() + interval '5 minutes',
              $10::uuid, $7, '{"body":"private"}', null, 'not_submitted'),
             ($3, 'send_step', $4, $5, 'leased', now(), now() + interval '5 minutes',
              gen_random_uuid(),
              $8, '{"body":"private"}', $9, 'submitted')`,
          [
            pendingJobId,
            leasedJobId,
            submittedJobId,
            contactId,
            projectId,
            `integration:pending:${contactId}`,
            `integration:leased:${contactId}`,
            `integration:submitted:${contactId}`,
            `provider:${contactId}`,
            leasedToken,
          ]
        );
        await executor.execute(
          `insert into growth_artifacts (
             job_id, contact_id, project_id, kind, schema_version, content
           ) values ($1, $2, $3, 'draft', 1, '{"private":"draft"}')`,
          [pendingJobId, contactId, projectId]
        );
        await executor.execute(
          `insert into growth_activity (
             event_key, contact_id, project_id, kind, occurred_at, data
           ) values
             ($1, $3, $4, 'contact.form_submission', now(),
              '{"notice_text":"private"}'),
             ($2, $3, $4, 'delivery.sent', now(),
              '{"provider_event_id":"provider-event","private":"remove"}')`,
          [
            `integration:private:${contactId}`,
            `integration:delivery:${contactId}`,
            contactId,
            projectId,
          ]
        );

        const first = await deleteContact(executor, {
          contactId,
          eventKey: `integration:delete:${contactId}`,
          occurredAt: deletedAt,
          actor: 'integration-test',
          source: 'verified-test-request',
          policyVersion: 'integration-v1',
        });
        const repeated = await deleteContact(executor, {
          contactId,
          eventKey: `integration:delete-repeat:${contactId}`,
          occurredAt: new Date('2097-05-02T12:01:00.000Z'),
          actor: 'integration-test',
          source: 'verified-test-request',
          policyVersion: 'integration-v1',
        });

        expect(first.deleted).toBe(true);
        expect(repeated.deleted).toBe(false);

        const staleUpdate = await staleWorker.execute<{ id: string }>(
          `update growth_jobs
           set payload = '{"restored":"private"}'::jsonb
           where id = $1
             and status = 'leased'
             and lease_token = $2::uuid
           returning id`,
          [leasedJobId, leasedToken]
        );
        expect(staleUpdate.rows).toEqual([]);

        const staleArtifact = await staleWorker.execute<{ id: string }>(
          `insert into growth_artifacts (
             job_id, contact_id, kind, schema_version, content
           )
           select id, contact_id, 'stale-draft', 1,
                  '{"restored":"private"}'::jsonb
           from growth_jobs
           where id = $1
             and status = 'leased'
             and lease_token = $2::uuid
           returning id`,
          [leasedJobId, leasedToken]
        );
        expect(staleArtifact.rows).toEqual([]);

        const contacts = await executor.execute<{
          company_domain: string | null;
          company_name: string | null;
          deleted_at: Date;
          display_name: string | null;
          email_hmac_key_version: number;
          email_lookup_hmac: string;
          email_normalized: string | null;
          outreach_approved_at: Date | null;
          source: string;
        }>(
          `select email_normalized, email_lookup_hmac, email_hmac_key_version,
                  display_name, company_name, company_domain,
                  outreach_approved_at, source, deleted_at
           from growth_contacts where id = $1`,
          [contactId]
        );
        expect(contacts.rows[0]).toMatchObject({
          email_normalized: null,
          email_lookup_hmac: lookup.digest,
          email_hmac_key_version: lookup.keyVersion,
          display_name: null,
          company_name: null,
          company_domain: null,
          outreach_approved_at: null,
          source: 'deleted:verified-test-request',
        });

        const jobs = await executor.execute<{
          id: string;
          lease_token: string | null;
          payload: Record<string, unknown>;
          project_id: string | null;
          status: string;
        }>(
          `select id, status, lease_token, payload, project_id
           from growth_jobs where contact_id = $1 order by id`,
          [contactId]
        );
        expect(jobs.rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: pendingJobId,
              status: 'cancelled',
              lease_token: null,
              payload: {},
              project_id: null,
            }),
            expect.objectContaining({
              id: leasedJobId,
              status: 'cancelled',
              lease_token: null,
              payload: {},
              project_id: null,
            }),
            expect.objectContaining({
              id: submittedJobId,
              status: 'completed',
              lease_token: null,
              payload: {},
              project_id: null,
            }),
          ])
        );

        const projects = await executor.execute<{ contact_id: string | null }>(
          'select contact_id from growth_projects where id = $1',
          [projectId]
        );
        expect(projects.rows[0]?.contact_id).toBeNull();

        const artifacts = await executor.execute<{ count: string }>(
          `select count(*)::text as count
           from growth_artifacts where contact_id = $1`,
          [contactId]
        );
        expect(artifacts.rows[0]?.count).toBe('0');

        const activities = await executor.execute<{
          data: Record<string, unknown>;
          kind: string;
          project_id: string | null;
        }>(
          `select kind, data, project_id
           from growth_activity where contact_id = $1 order by kind`,
          [contactId]
        );
        expect(activities.rows.map(({ kind }) => kind)).toEqual([
          'deletion',
          'delivery.sent',
        ]);
        expect(activities.rows[1]?.data).toEqual({
          provider_event_id: 'provider-event',
        });
        expect(
          activities.rows.every(({ project_id }) => project_id === null)
        ).toBe(true);
      } finally {
        await staleWorker?.close?.();
        await cleanContactObservationFences(executor, contactId);
        await executor.execute(
          'delete from growth_artifacts where project_id = $1',
          [projectId]
        );
        await executor.execute(
          'delete from growth_activity where contact_id = $1',
          [contactId]
        );
        await executor.execute(
          'delete from growth_jobs where contact_id = $1',
          [contactId]
        );
        await executor.execute('delete from growth_projects where id = $1', [
          projectId,
        ]);
        await executor.execute('delete from growth_contacts where id = $1', [
          contactId,
        ]);
      }
    });

    describe('approveContactFromInstallDigest', () => {
      const cleanupEmails: string[] = [];
      const cleanupSubjects: string[] = [];

      afterAll(async () => {
        const contacts = (
          await executor.execute<{ id: string }>(
            'select id from growth_contacts where email_normalized=any($1::text[])',
            [cleanupEmails]
          )
        ).rows.map((c) => c.id);
        for (const contactId of contacts) await removeContact(contactId);
        await cleanEvidence(executor, cleanupSubjects);
      });

      async function installObservation(
        email: string,
        now: Date
      ): Promise<string> {
        const batch = evidenceFixture(now);
        const event = batch.events[0]!;
        event.properties = {
          ...event.properties,
          environment: 'unknown',
          environmentEvidence: 'unknown',
        };
        event.identity = {
          gitEmail: email,
          gitDisplayName: 'Digest Developer',
          gitConfigOrigin: 'global',
        };
        cleanupSubjects.push(event.subject.id);
        cleanupEmails.push(email);
        await acceptObservationBatch(executor, 'install', batch, {
          now,
          keyring: evidenceKeys,
        });
        const row = await executor.execute<{ observation_id: string }>(
          'select observation_id from growth_observation_identities where email_normalized=$1 order by observation_id limit 1',
          [email]
        );
        return row.rows[0]!.observation_id;
      }

      it('creates and approves a new contact from an install observation and records a founder reauthorization', async () => {
        const now = new Date('2026-09-16T16:00:00.000Z');
        const email = `${randomUUID()}@approve-corp.example`;
        const observationId = await installObservation(email, now);

        const result = await approveContactFromInstallDigest(executor, {
          installObservationId: observationId,
          occurredAt: now,
          eventKey: `token:founder_approve_install:${observationId}:${now.getTime()}:job-1`,
          keyring: evidenceKeys,
        });
        expect(result).toMatchObject({ approved: true, changed: true });
        if (!result.approved) throw new Error('expected approval');

        const contact = await executor.execute<{
          source: string;
          outreach_approved_at: Date;
        }>(
          'select source, outreach_approved_at from growth_contacts where id=$1',
          [result.contactId]
        );
        expect(contact.rows[0]!.source).toBe('signed_founder_approve_install');
        expect(new Date(contact.rows[0]!.outreach_approved_at).getTime()).toBe(
          now.getTime()
        );
        const activity = await executor.execute<{
          kind: string;
          data: Record<string, unknown>;
        }>(
          "select kind, data from growth_activity where contact_id=$1 and kind='contact.reauthorized'",
          [result.contactId]
        );
        expect(activity.rows).toHaveLength(1);
        expect(activity.rows[0]!.data).toMatchObject({
          provenance: 'founder_action',
          source: 'signed_founder_approve_install',
          install_observation_id: observationId,
        });

        const again = await approveContactFromInstallDigest(executor, {
          installObservationId: observationId,
          occurredAt: new Date(now.getTime() + 1000),
          eventKey: `token:founder_approve_install:${observationId}:${now.getTime()}:job-2`,
          keyring: evidenceKeys,
        });
        expect(again).toMatchObject({
          approved: true,
          changed: false,
          contactId: result.contactId,
        });
      });

      it('refuses a stopped contact and an unknown or redacted observation', async () => {
        const now = new Date('2026-09-16T16:10:00.000Z');
        const email = `${randomUUID()}@stopped-corp.example`;
        const observationId = await installObservation(email, now);
        const first = await approveContactFromInstallDigest(executor, {
          installObservationId: observationId,
          occurredAt: now,
          eventKey: `token:founder_approve_install:${observationId}:${now.getTime()}:job-3`,
          keyring: evidenceKeys,
        });
        if (!first.approved) throw new Error('expected approval');
        await stopContact(executor, {
          contactId: first.contactId,
          reason: 'manual_suppression',
          eventKey: `stop:${first.contactId}`,
          occurredAt: new Date(now.getTime() + 1000),
          source: 'founder_cli',
          provenance: {
            actor: 'founder',
            kind: 'founder_action',
            policyVersion: 'growth-v1',
          },
        });
        const afterStop = await approveContactFromInstallDigest(executor, {
          installObservationId: observationId,
          occurredAt: new Date(now.getTime() + 2000),
          eventKey: `token:founder_approve_install:${observationId}:${now.getTime()}:job-4`,
          keyring: evidenceKeys,
        });
        expect(afterStop).toMatchObject({ approved: false, reason: 'stopped' });

        const unknown = await approveContactFromInstallDigest(executor, {
          installObservationId: randomUUID(),
          occurredAt: now,
          eventKey: `token:founder_approve_install:unknown:${now.getTime()}`,
          keyring: evidenceKeys,
        });
        expect(unknown).toMatchObject({
          approved: false,
          reason: 'identity_unavailable',
        });
      });
    });
  }
);
