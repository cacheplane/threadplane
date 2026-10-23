import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import {
  admitInboxEvent,
  authorizeLeasedJobForSubmission,
  bindOutboundMessageId,
  createDatabaseExecutor,
  deleteContact,
  forwardInboxReceipt,
  leaseDueJobs,
  processInboxReceipt,
  stopContact,
  type SqlExecutor,
} from '../src/index.ts';
import { cleanContactObservationFences } from './observability-fixtures.ts';
// The repository-level migration CLI is deliberately outside the Nx library.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { applyMigrations } from '../../../scripts/apply-migrations.mts';

const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
const describeDatabase =
  process.env['GROWTH_INTEGRATION'] === '1' && testDatabaseUrl
    ? describe
    : describe.skip;

describeDatabase('Resend receiving against TEST_DATABASE_URL', () => {
  let executor: SqlExecutor;
  let ownsMailbox = false;
  const contactIds = new Set<string>();
  const receiptIds = new Set<string>();
  const config = {
    enabled: true as const,
    address: 'brian@threadplane.ai',
    startedAt: new Date('2026-10-22T00:00:00.000Z'),
  };
  // Thursday at 07:00 in Los Angeles: a real campaign submission window.
  const now = new Date('2026-10-22T14:00:00.000Z');
  const approvedAt = new Date('2026-10-22T00:01:00.000Z');
  const receivedAt = new Date('2026-10-22T13:59:00.000Z');

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    executor = createDatabaseExecutor(testDatabaseUrl);
    await applyMigrations({
      directory: resolve(process.cwd(), 'migrations'),
      executor,
    });
    // This singleton mailbox fixture must never overwrite existing operator state.
    const existing = await executor.execute(
      'select address from growth_reply_mailboxes'
    );
    expect(existing.rows).toEqual([]);
    await executor.execute(
      `insert into growth_reply_mailboxes
         (address, enabled, started_at, healthy_through, google_retired_at)
       values ($1, true, $2, $3, $3)`,
      [config.address, config.startedAt, now]
    );
    ownsMailbox = true;
  });

  beforeEach(() => {
    // Config validation requires the production receiving mode, but the database
    // connection is always the explicitly supplied isolated TEST_DATABASE_URL.
    vi.stubEnv('GROWTH_DATABASE_ENVIRONMENT', 'production');
    vi.stubEnv('RESEND_RECEIVING_ENABLED', 'true');
    vi.stubEnv('RESEND_RECEIVING_ADDRESS', config.address);
    vi.stubEnv('RESEND_RECEIVING_STARTED_AT', config.startedAt.toISOString());
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const id of receiptIds) {
      await executor.execute(
        'delete from growth_reply_receipts where id = $1',
        [id]
      );
    }
    receiptIds.clear();
    for (const contactId of contactIds) {
      await cleanContactObservationFences(executor, contactId);
      await executor.execute(
        'delete from growth_activity where contact_id = $1',
        [contactId]
      );
      await executor.execute('delete from growth_jobs where contact_id = $1', [
        contactId,
      ]);
      await executor.execute('delete from growth_contacts where id = $1', [
        contactId,
      ]);
    }
    contactIds.clear();
  });

  afterAll(async () => {
    if (ownsMailbox) {
      await executor.execute(
        'delete from growth_reply_mailboxes where address = $1',
        [config.address]
      );
    }
    await executor?.close?.();
  });

  async function createEnrolledContact() {
    const contactId = randomUUID();
    const jobId = randomUUID();
    const email = `${contactId}@example.com`;
    const approvalEventKey = `inbox-integration:approval:${contactId}`;
    contactIds.add(contactId);
    await executor.execute(
      `insert into growth_contacts (
         id, email_normalized, email_lookup_hmac, email_hmac_key_version,
         outreach_approved_at, source
       ) values ($1, $2, $3, 1, $4, 'inbox-integration')`,
      [contactId, email, `inbox-integration:${contactId}`, approvedAt]
    );
    // Match stops.integration.spec.ts: timestamp-only approvals are insufficient.
    await executor.execute(
      `insert into growth_activity (event_key, contact_id, kind, occurred_at, data)
       values
         ($1, $2, 'form.outreach_approved', $3,
          '{"source_form":"pricing","verification":"server_verified"}'::jsonb),
         ('campaign:v1:' || $2::text || ':enrolled', $2, 'campaign.enrolled:v1', $3,
          jsonb_build_object('campaign_version', 'v1', 'approval_event_key', $1::text,
            'approval_kind', 'form.outreach_approved', 'approval_at', $3::timestamptz))`,
      [approvalEventKey, contactId, approvedAt]
    );
    await executor.execute(
      `insert into growth_jobs
         (id, kind, contact_id, status, available_at, idempotency_key, payload)
       values ($1, 'send_step', $2, 'pending', $3, $4,
         jsonb_build_object('campaign_version', 'v1', 'step', 1,
           'approval_event_key', $5::text, 'approval_kind', 'form.outreach_approved',
           'approval_at', $6::timestamptz))`,
      [
        jobId,
        contactId,
        now,
        `inbox-integration:${jobId}`,
        approvalEventKey,
        approvedAt,
      ]
    );
    return { contactId, jobId, email };
  }

  async function createHistoricalAcceptance(
    contactId: string,
    providerId = randomUUID()
  ) {
    const rfcId = `<${providerId}@resend.com>`;
    await executor.execute(
      `insert into growth_jobs (kind, contact_id, status, available_at,
         idempotency_key, provider_email_id, delivery_status, created_at)
       values ('fulfill', $1, 'completed', $2, $3, $3, 'delivered', $2)`,
      [contactId, new Date('2026-10-21T12:00:00.000Z'), providerId]
    );
    return { providerId, rfcId };
  }

  async function admitReply(email: string, rfcId: string) {
    const id = randomUUID();
    receiptIds.add(id);
    const event = {
      type: 'email.received',
      created_at: receivedAt.toISOString(),
      data: { email_id: id, to: [config.address] },
    };
    // Admission is the durable boundary called after webhook signature validation.
    expect(await admitInboxEvent(executor, event, config)).toBe(id);
    expect(await admitInboxEvent(executor, event, config)).toBe(id);
    const getReceived = vi.fn(async () => ({
      id,
      to: [config.address],
      from: email,
      created_at: receivedAt.toISOString(),
      headers: {
        'Message-ID': `<${id}@example.com>`,
        'In-Reply-To': rfcId,
      },
      subject: 'private subject never persisted',
      text: 'private body never persisted',
    }));
    return { id, getReceived };
  }

  const lease = () =>
    leaseDueJobs(executor, {
      kinds: ['send_step'],
      now,
      batchSize: 100,
      leaseDurationMs: 60_000,
      campaignEnabled: true,
    });

  it('waives old unbound history but blocks a pre-created send accepted after cutover', async () => {
    const contact = await createEnrolledContact();
    const historical = await createHistoricalAcceptance(contact.contactId);
    const leased = (await lease()).find(({ id }) => id === contact.jobId);
    expect(leased?.leaseToken).toEqual(expect.any(String));
    const authorize = () =>
      authorizeLeasedJobForSubmission(executor, {
        jobId: contact.jobId,
        leaseToken: leased?.leaseToken as string,
        now,
        campaignEnabled: true,
        deliveryEnabled: true,
      });
    await expect(authorize()).resolves.toMatchObject({ authorized: true });
    await executor.execute(
      `insert into growth_activity(event_key, contact_id, kind, occurred_at, data)
       select 'job:' || id::text || ':provider-accepted', contact_id,
         'delivery.accepted', $2, '{}'::jsonb from growth_jobs where provider_email_id = $1`,
      [historical.providerId, now]
    );
    await expect(authorize()).resolves.toMatchObject({
      authorized: false,
      reason: 'reply_binding_pending',
    });
  });

  it('blocks an early receipt, binds a historical acceptance, and stops follow-ups once', async () => {
    const contact = await createEnrolledContact();
    const baseline = (await lease()).find(({ id }) => id === contact.jobId);
    expect(baseline?.leaseToken).toEqual(expect.any(String));
    if (!baseline?.leaseToken)
      throw new Error('Expected an eligible campaign lease');
    const providerId = randomUUID();
    const reply = await admitReply(contact.email, `<${providerId}@resend.com>`);
    const authorize = () =>
      authorizeLeasedJobForSubmission(executor, {
        jobId: contact.jobId,
        leaseToken: baseline.leaseToken as string,
        now,
        campaignEnabled: true,
        deliveryEnabled: true,
      });
    await expect(authorize()).resolves.toMatchObject({
      authorized: false,
      reason: 'mailbox_recovery_required',
    });
    await executor.execute(
      "update growth_jobs set status = 'pending', lease_token = null, lease_until = null where id = $1",
      [contact.jobId]
    );
    expect((await lease()).map(({ id }) => id)).not.toContain(contact.jobId);

    const historical = await createHistoricalAcceptance(
      contact.contactId,
      providerId
    );
    const dependencies = { getReceived: reply.getReceived, stopContact };
    await expect(
      processInboxReceipt(executor, reply.id, config, dependencies)
    ).resolves.toBe('pending');
    await bindOutboundMessageId(
      executor,
      historical.providerId,
      historical.rfcId
    );
    await bindOutboundMessageId(
      executor,
      historical.providerId,
      historical.rfcId
    );
    const bound = await executor.execute<{ rfc_message_id: string }>(
      'select rfc_message_id from growth_jobs where provider_email_id = $1',
      [historical.providerId]
    );
    expect(bound.rows).toEqual([{ rfc_message_id: historical.rfcId }]);
    expect((await lease()).map(({ id }) => id)).not.toContain(contact.jobId);
    // Simulate a worker retaining a lease while binding settles the early receipt.
    await executor.execute(
      `update growth_jobs set status = 'leased', lease_token = $2, lease_until = $3 where id = $1`,
      [contact.jobId, baseline.leaseToken, new Date(now.getTime() + 60_000)]
    );
    await expect(authorize()).resolves.toMatchObject({
      authorized: false,
      reason: 'reply_binding_pending',
    });
    await expect(
      processInboxReceipt(executor, reply.id, config, dependencies)
    ).resolves.toBe('stopped');
    await expect(
      processInboxReceipt(executor, reply.id, config, dependencies)
    ).resolves.toBe('stopped');
    const state = await executor.execute<{
      outreach_approved_at: null;
      status: string;
      lease_token: null;
    }>(
      `select c.outreach_approved_at, j.status, j.lease_token
       from growth_contacts c join growth_jobs j on j.contact_id = c.id
       where j.id = $1`,
      [contact.jobId]
    );
    expect(state.rows).toEqual([
      { outreach_approved_at: null, status: 'cancelled', lease_token: null },
    ]);
    const stops = await executor.execute<{ occurred_at: Date; data: unknown }>(
      `select occurred_at, data from growth_activity
       where contact_id = $1 and kind = 'campaign.reply_received'`,
      [contact.contactId]
    );
    expect(stops.rows).toHaveLength(1);
    expect(new Date(stops.rows[0].occurred_at)).toEqual(receivedAt);
    expect(stops.rows[0].data).toMatchObject({ source: 'resend_inbox' });
    expect((await lease()).map(({ id }) => id)).not.toContain(contact.jobId);
    const receipt = await executor.execute(
      'select * from growth_reply_receipts where id = $1',
      [reply.id]
    );
    expect(receipt.rows).toHaveLength(1);
    expect(receipt.rows[0]).toMatchObject({
      status: 'stopped',
      contact_id: contact.contactId,
      reference_ids: null,
      rfc_message_id: null,
    });
    expect(JSON.stringify(receipt.rows)).not.toContain('private');
  });

  it('scrubs a pending associated receipt on deletion and never forwards it', async () => {
    const contact = await createEnrolledContact();
    const historical = await createHistoricalAcceptance(contact.contactId);
    const reply = await admitReply(contact.email, historical.rfcId);
    await expect(
      processInboxReceipt(executor, reply.id, config, {
        getReceived: reply.getReceived,
        stopContact,
      })
    ).resolves.toBe('pending');
    const pending = await executor.execute(
      'select contact_id, reference_ids from growth_reply_receipts where id = $1',
      [reply.id]
    );
    expect(pending.rows).toEqual([
      { contact_id: contact.contactId, reference_ids: [historical.rfcId] },
    ]);
    await deleteContact(executor, {
      contactId: contact.contactId,
      eventKey: `inbox-integration:delete:${reply.id}`,
      occurredAt: now,
      actor: 'integration-test',
      source: 'inbox-integration',
      policyVersion: 'growth-policy:v1',
    });
    const scrubbed = await executor.execute(
      `select contact_id, reference_ids, rfc_message_id, status, last_error_code,
         forward_provider_id from growth_reply_receipts where id = $1`,
      [reply.id]
    );
    expect(scrubbed.rows).toEqual([
      {
        contact_id: null,
        reference_ids: null,
        rfc_message_id: null,
        status: 'ignored',
        last_error_code: 'contact_deleted',
        forward_provider_id: null,
      },
    ]);
    const getRaw = vi.fn(async () => new Uint8Array());
    const send = vi.fn(async () => randomUUID());
    const isErasedSender = vi.fn(async () => true);
    reply.getReceived.mockClear();
    await expect(
      forwardInboxReceipt(executor, reply.id, {
        environment: 'test',
        getReceived: reply.getReceived,
        getRaw,
        send,
        isErasedSender,
      })
    ).resolves.toBeNull();
    expect(reply.getReceived).not.toHaveBeenCalled();
    expect(getRaw).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(isErasedSender).not.toHaveBeenCalled();
  });

  test('blocks leasing and final authorization for a parsed reply with no attributable contact', async () => {
    const contact = await createEnrolledContact();
    const leased = (await lease()).find(({ id }) => id === contact.jobId);
    if (!leased?.leaseToken)
      throw new Error('Expected eligible baseline lease');
    const reply = await admitReply(
      'unverified-alias@example.net',
      '<unknown@resend.com>'
    );

    expect(
      await processInboxReceipt(executor, reply.id, config, {
        getReceived: reply.getReceived,
        stopContact,
      })
    ).toBe('pending');
    const receipt = await executor.execute(
      'select contact_id, reference_ids from growth_reply_receipts where id = $1',
      [reply.id]
    );
    expect(receipt.rows[0]).toMatchObject({
      contact_id: null,
      reference_ids: ['<unknown@resend.com>'],
    });
    await expect(
      authorizeLeasedJobForSubmission(executor, {
        jobId: contact.jobId,
        leaseToken: leased.leaseToken,
        now,
        campaignEnabled: true,
        deliveryEnabled: true,
      })
    ).resolves.toMatchObject({
      authorized: false,
      reason: 'mailbox_recovery_required',
    });
    await executor.execute(
      "update growth_jobs set status = 'pending', lease_token = null, lease_until = null where id = $1",
      [contact.jobId]
    );

    expect((await lease()).map(({ id }) => id)).not.toContain(contact.jobId);
  });
});
