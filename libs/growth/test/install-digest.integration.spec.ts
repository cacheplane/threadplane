import { randomUUID } from 'node:crypto';
import { acceptObservationBatch } from '../src/lib/observability/ingest.ts';
import {
  enqueueInstallDigestJob,
  markInstallDigestReported,
  readInstallDigestCandidates,
  readInstallDigestContext,
} from '../src/lib/observability/install-digest.ts';
import {
  evidenceDatabase,
  evidenceFixture,
  evidenceKeys,
} from './observability-fixtures.ts';
import type { SqlExecutor } from '../src/lib/database.ts';
import { createEmailLookupHmac } from '../src/lib/crypto.ts';

describe('install digest candidates', () => {
  let db: SqlExecutor;
  const subjects: string[] = [];
  const emails: string[] = [];
  const jobKeys: string[] = [];
  beforeAll(async () => {
    db = await evidenceDatabase();
  });
  afterAll(async () => {
    if (!db) return;
    const digests = emails.map(
      (email) => createEmailLookupHmac(email, evidenceKeys.active).digest
    );
    await db.execute(
      'delete from growth_install_digest_reports where email_lookup_hmac=any($1::text[])',
      [digests]
    );
    await db.execute(
      'delete from growth_jobs where idempotency_key=any($1::text[])',
      [jobKeys]
    );
    await db.execute(
      'delete from growth_observation_subjects where external_id=any($1::uuid[])',
      [subjects]
    );
    const contacts = (
      await db.execute<{ id: string }>(
        'select id from growth_contacts where email_normalized=any($1::text[])',
        [emails]
      )
    ).rows.map((c) => c.id);
    await db.execute(
      'delete from growth_activity where contact_id=any($1::uuid[])',
      [contacts]
    );
    await db.execute('delete from growth_contacts where id=any($1::uuid[])', [
      contacts,
    ]);
    await db.close?.();
  });

  function install(
    now: Date,
    overrides: {
      email?: string | null;
      environment?: 'ci' | 'unknown';
      packageName?: string;
      packageVersion?: string;
      gitConfigOrigin?: 'local' | 'global';
    } = {}
  ) {
    const batch = evidenceFixture(now);
    const event = batch.events[0];
    event.properties = {
      ...event.properties,
      packageName: overrides.packageName ?? '@threadplane/langgraph',
      packageVersion: overrides.packageVersion ?? '0.2.0',
      environment: overrides.environment ?? 'unknown',
      environmentEvidence: overrides.environment ?? 'unknown',
    };
    if (overrides.email === null) delete event.identity;
    else if (overrides.email) {
      event.identity = {
        gitEmail: overrides.email,
        gitDisplayName: 'Digest Developer',
        gitConfigOrigin: overrides.gitConfigOrigin ?? 'global',
        repositoryProvider: 'github',
        repositoryOwner: 'digest-org',
      };
    }
    subjects.push(event.subject.id);
    if (event.identity?.gitEmail) emails.push(event.identity.gitEmail);
    return batch;
  }
  const accept = (batch: ReturnType<typeof install>, now: Date) =>
    acceptObservationBatch(db, 'install', batch, { now, keyring: evidenceKeys });

  it('groups one line per work email, excluding personal, CI, contacts and reported identities', async () => {
    const now = new Date('2026-09-16T15:00:00.000Z');
    const later = new Date(now.getTime() + 60_000);
    const work = `${randomUUID()}@digest-corp.example`;
    const personal = `${randomUUID()}@gmail.com`;
    const ci = `${randomUUID()}@ci-corp.example`;
    const existing = `${randomUUID()}@existing-corp.example`;
    await accept(
      install(now, { email: work, packageName: '@threadplane/langgraph' }),
      now
    );
    await accept(
      install(later, {
        email: work,
        packageName: '@threadplane/chat',
        gitConfigOrigin: 'local',
      }),
      later
    );
    await accept(install(now, { email: personal }), now);
    await accept(install(now, { email: ci, environment: 'ci' }), now);
    await accept(install(now, { email: existing }), now);
    await accept(install(now, { email: null }), now);
    await db.execute(
      `insert into growth_contacts (email_normalized, email_lookup_hmac, email_hmac_key_version, source)
       values ($1, $2, $3, 'website')`,
      [
        existing,
        createEmailLookupHmac(existing, evidenceKeys.active).digest,
        evidenceKeys.active.version,
      ]
    );

    const candidates = await readInstallDigestCandidates(db, { limit: 200 });
    const line = candidates.find((c) => c.email === work);
    expect(line).toBeDefined();
    expect(line).toMatchObject({
      companyDomain: 'digest-corp.example',
      gitDisplayName: 'Digest Developer',
      repositoryProvider: 'github',
      repositoryOwner: 'digest-org',
      gitConfigOrigin: 'local',
      installCount: 2,
    });
    expect(
      line!.packages
        .map((p) => `${p.packageName}@${p.packageVersion}`)
        .sort()
    ).toEqual(['@threadplane/chat@0.2.0', '@threadplane/langgraph@0.2.0']);
    expect(line!.firstSeenAt.getTime()).toBe(now.getTime());
    expect(line!.lastSeenAt.getTime()).toBe(later.getTime());
    expect(candidates.map((c) => c.email)).not.toContain(personal);
    expect(candidates.map((c) => c.email)).not.toContain(ci);
    expect(candidates.map((c) => c.email)).not.toContain(existing);

    const jobKey = `install_digest:test:${randomUUID()}`;
    jobKeys.push(jobKey);
    const jobId = await enqueueInstallDigestJob(db, {
      now,
      idempotencyKey: jobKey,
      businessDate: '2026-09-16',
    });
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(
      await enqueueInstallDigestJob(db, {
        now,
        idempotencyKey: jobKey,
        businessDate: '2026-09-16',
      })
    ).toBeNull();

    await markInstallDigestReported(db, {
      digestJobId: jobId!,
      reportedAt: now,
      candidates: [line!],
    });
    await markInstallDigestReported(db, {
      digestJobId: jobId!,
      reportedAt: now,
      candidates: [line!],
    });
    expect(
      (await readInstallDigestCandidates(db, { limit: 200 })).map(
        (c) => c.email
      )
    ).not.toContain(work);

    const context = await readInstallDigestContext(db, { since: now });
    expect(context.anonymousInstallSubjects).toBeGreaterThanOrEqual(1);
    expect(context.ciInstallSubjects).toBeGreaterThanOrEqual(1);
  });

  it('does not enqueue when there are no candidates', async () => {
    const now = new Date('2026-09-17T15:00:00.000Z');
    const jobKey = `install_digest:test:${randomUUID()}`;
    jobKeys.push(jobKey);
    // The shared disposable database may hold candidates from other runs.
    const before = await readInstallDigestCandidates(db, { limit: 200 });
    const enqueued = await enqueueInstallDigestJob(db, {
      now,
      idempotencyKey: jobKey,
      businessDate: '2026-09-17',
    });
    if (before.length === 0) expect(enqueued).toBeNull();
    else expect(enqueued).not.toBeNull();
  });
});
