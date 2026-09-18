import type {
  SqlExecutor,
  SqlQueryResult,
  SqlTransaction,
} from './database.ts';
import {
  JobLeaseConflictError,
  authorizeLeasedJobForSubmission,
  cancelLeasedJob,
  claimInternalNotificationSubmission,
  completeLeasedJob,
  deferLeasedJob,
  failLeasedJob,
  leaseDueJobs,
  markProviderAcceptanceUnknown,
  markInternalNotificationUnknown,
  markProviderRejection,
  materializeCampaignEnrollment,
  persistJobArtifact,
  readLifecycleJobContext,
  recordProviderAcceptance,
  renewJobLease,
} from './jobs.ts';
import { CONTACT_HARD_STOP_REASONS } from './contacts.ts';

type TestRow = Record<string, unknown>;

function executorWith(
  handlers: Record<
    string,
    (parameters: readonly unknown[], sql: string) => SqlQueryResult<TestRow>
  >
): {
  calls: { marker: string; parameters: readonly unknown[]; sql: string }[];
  executor: SqlExecutor;
  transactions: { count: number };
} {
  const calls: {
    marker: string;
    parameters: readonly unknown[];
    sql: string;
  }[] = [];
  const transactions = { count: 0 };
  const transaction: SqlTransaction = {
    async execute<Row extends Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = []
    ): Promise<SqlQueryResult<Row>> {
      const marker = /\/\* growth:([a-z0-9-]+) \*\//u.exec(sql)?.[1];
      if (
        /pg_advisory_xact_lock(?:_shared)?\(hashtextextended\('growth-observation-privacy-v1'/u.test(
          sql
        )
      )
        return { rows: [] };
      const handler = marker ? handlers[marker] : undefined;
      if (!marker || !handler) {
        throw new Error(`Unexpected SQL marker: ${marker ?? 'missing'}`);
      }
      calls.push({ marker, parameters, sql });
      return handler(parameters, sql) as SqlQueryResult<Row>;
    },
  };

  return {
    calls,
    transactions,
    executor: {
      execute: transaction.execute,
      async transaction(operation) {
        transactions.count += 1;
        return operation(transaction);
      },
    },
  };
}

const now = new Date('2026-09-01T14:00:00.000Z');
const leaseToken = '00000000-0000-4000-8000-000000000099';

function jobRow(overrides: TestRow = {}): TestRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'send_step',
    contact_id: '00000000-0000-4000-8000-000000000002',
    project_id: null,
    status: 'leased',
    available_at: now,
    lease_until: new Date('2026-09-01T14:05:00.000Z'),
    lease_token: leaseToken,
    attempts: 1,
    idempotency_key: 'campaign:v1:00000000-0000-4000-8000-000000000002:step:1',
    payload: {
      campaign_version: 'v1',
      step: 1,
      approval_event_key: 'form:submission:accepted:outreach-approved',
      approval_kind: 'form.outreach_approved',
      approval_at: now.toISOString(),
    },
    provider_email_id: null,
    rfc_message_id: null,
    gmail_seed_message_id: null,
    delivery_status: 'not_submitted',
    last_error_code: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('campaign enrollment', () => {
  it('rechecks the send window with a fresh clock after authorization locks', async () => {
    const beforeClose = new Date('2026-09-01T14:59:59.000Z');
    const afterClose = new Date('2026-09-01T15:00:00.000Z');
    const harness = executorWith({
      'acquire-google-reconcile-advisory-lock': () => ({ rows: [] }),
      'lock-contact-for-send': () => ({
        rows: [
          {
            id: jobRow().contact_id,
            email_normalized: 'reader@acme.com',
            outreach_approved_at: now,
            deleted_at: null,
            latest_hard_stop_at: null,
            campaign_approval_valid: true,
            campaign_enrollment_valid: true,
          },
        ],
      }),
      'lock-job-for-send': () => ({
        rows: [jobRow({ lease_until: new Date('2026-09-01T15:01:00Z') })],
      }),
      'read-google-mailbox-recovery-pause': () => ({
        rows: [{ paused: false }],
      }),
    });
    await expect(
      authorizeLeasedJobForSubmission(harness.executor, {
        jobId: String(jobRow().id),
        leaseToken,
        now: beforeClose,
        currentTime: () => afterClose,
        campaignEnabled: true,
        deliveryEnabled: true,
      })
    ).resolves.toMatchObject({
      authorized: false,
      reason: 'outside_send_window',
    });
    expect(
      harness.calls.some((c) => c.marker === 'insert-final-send-authorization')
    ).toBe(false);
  });
  it('does not touch the database when enrollment is disabled', async () => {
    const harness = executorWith({});

    const result = await materializeCampaignEnrollment(harness.executor, {
      enrollmentEnabled: false,
      enrollmentStartAt: new Date('2026-09-01T00:00:00.000Z'),
      now,
      batchSize: 25,
    });

    expect(result).toEqual({ enrolledContactIds: [], createdJobs: 0 });
    expect(harness.calls).toEqual([]);
  });

  it('materializes only post-launch approvals with one activity and three stable keys', async () => {
    const contactId = '00000000-0000-4000-8000-000000000002';
    const harness = executorWith({
      'lock-campaign-enrollment': () => ({ rows: [{}] }),
      'insert-campaign-enrollment-config': () => ({ rows: [{}] }),
      'read-campaign-enrollment-start': () => ({
        rows: [{ enrollment_start_at: '2026-09-01T00:00:00.000Z' }],
      }),
      'enroll-campaign-v1': (parameters, sql) => {
        expect(parameters).toEqual([
          new Date('2026-09-01T00:00:00.000Z'),
          now,
          25,
          CONTACT_HARD_STOP_REASONS,
          new Date('2026-09-02T14:00:00.000Z'),
        ]);
        expect(sql).toMatch(/outreach_approved_at\s*>=\s*\$1/u);
        expect(sql).toMatch(
          /approval\.occurred_at\s*=\s*c\.outreach_approved_at/u
        );
        expect(sql).toMatch(/approval\.kind = 'form\.outreach_approved'/u);
        expect(sql).toMatch(
          /approval\.data->>'verification' = 'server_verified'/u
        );
        expect(sql).toMatch(/approval\.kind = 'project\.claimed'/u);
        expect(sql).toMatch(
          /approval\.data->>'claim_method' = 'one_time_secret'/u
        );
        expect(sql).toMatch(/approval\.kind = 'contact\.reauthorized'/u);
        expect(sql).toMatch(
          /approval\.data->>'provenance' = 'founder_action'/u
        );
        expect(sql).toMatch(
          /stop\.occurred_at\s*>=\s*c\.outreach_approved_at/u
        );
        expect(sql).toMatch(
          /not exists \([\s\S]*from growth_jobs legacy[\s\S]*legacy\.contact_id = c\.id[\s\S]*legacy\.kind = 'legacy'/u
        );
        expect(sql).toMatch(/campaign\.enrolled:v1/u);
        expect(sql).toMatch(/'approval_event_key',\s*e\.approval_event_key/u);
        expect(sql).toMatch(/'approval_kind',\s*e\.approval_kind/u);
        expect(sql).toMatch(/'approval_at',\s*e\.approval_at/u);
        expect(sql).toMatch(/campaign:v1:/u);
        expect(sql).toMatch(/generate_series\(1,\s*3\)/u);
        expect(sql).toMatch(/on conflict \(event_key\) do nothing/u);
        expect(sql).toMatch(/on conflict \(idempotency_key\) do nothing/u);
        return { rows: [{ contact_id: contactId, created_jobs: 3 }] };
      },
    });

    const result = await materializeCampaignEnrollment(harness.executor, {
      enrollmentEnabled: true,
      enrollmentStartAt: new Date('2026-09-01T00:00:00.000Z'),
      now,
      batchSize: 25,
    });

    expect(result).toEqual({ enrolledContactIds: [contactId], createdJobs: 3 });
    expect(harness.transactions.count).toBe(1);
  });

  it('rejects changing the launch timestamp after cohort materialization', async () => {
    const harness = executorWith({
      'lock-campaign-enrollment': () => ({ rows: [{}] }),
      'insert-campaign-enrollment-config': () => ({ rows: [] }),
      'read-campaign-enrollment-start': () => ({
        rows: [{ enrollment_start_at: '2026-09-01T00:00:00.000Z' }],
      }),
    });

    await expect(
      materializeCampaignEnrollment(harness.executor, {
        enrollmentEnabled: true,
        enrollmentStartAt: new Date('2026-08-01T00:00:00.000Z'),
        now,
        batchSize: 25,
      })
    ).rejects.toThrow(/immutable/u);
    expect(harness.calls.map(({ marker }) => marker)).not.toContain(
      'enroll-campaign-v1'
    );
  });
});

describe('job leasing', () => {
  it('uses one atomic bounded skip-locked CTE and pauses campaign/reconciliation work during mailbox recovery', async () => {
    const harness = executorWith({
      'lease-due-jobs': (parameters, sql) => {
        expect(parameters).toEqual([
          ['send_step', 'fulfill', 'enrich', 'notify'],
          now,
          20,
          new Date('2026-09-01T14:05:00.000Z'),
          false,
        ]);
        expect(sql.match(/for update skip locked/gu)).toHaveLength(2);
        expect(sql.match(/limit \$3/gu)).toHaveLength(2);
        expect(sql).toMatch(
          /ambiguous_candidates[\s\S]*kind = any\(\$1::text\[\]\)/u
        );
        expect(sql).toMatch(/gen_random_uuid\(\)/u);
        expect(sql).toMatch(/attempts\s*=\s*j\.attempts\s*\+\s*1/u);
        expect(sql).toMatch(/status = 'leased'/u);
        expect(sql).toMatch(/lease_until <= \$2/u);
        expect(sql).toMatch(/\$5::boolean or j\.kind <> 'send_step'/u);
        expect(sql).toMatch(/provider_email_id is not null/u);
        expect(sql).toMatch(/interval '5 minutes'/u);
        expect(sql).toMatch(/growth_artifacts/u);
        expect(sql).toMatch(/campaign\.enrolled:v1/u);
        expect(sql).toMatch(/mailbox\.recovery_required/u);
        expect(sql).toMatch(/mailbox\.recovery_completed/u);
        expect(sql).toMatch(/delivery\.submission_authorized/u);
        expect(sql).toMatch(
          /delivery_status = 'unknown'[\s\S]*delivery\.acceptance_unknown[\s\S]*'manual_review', true/u
        );
        expect(sql).toMatch(
          /not exists \([\s\S]*from ambiguous_authorized[\s\S]*interrupted\.id = j\.id/u
        );
        expect(sql).toMatch(
          /j\.kind not in \('send_step', 'reply_reconcile'\)/u
        );
        return { rows: [jobRow()] };
      },
    });

    const jobs = await leaseDueJobs(harness.executor, {
      kinds: ['send_step', 'fulfill', 'enrich', 'notify'],
      now,
      batchSize: 20,
      leaseDurationMs: 5 * 60_000,
      campaignEnabled: false,
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.leaseToken).toBe(leaseToken);
    expect(jobs[0]?.attempts).toBe(1);
  });

  it('leases notify only after its submission-matched enrichment completed or failed, independent of UUID order', async () => {
    const harness = executorWith({
      'lease-due-jobs': (_parameters, sql) => {
        expect(sql).toMatch(
          /sibling\.contact_id = j\.contact_id[\s\S]*sibling\.payload->>'submission_id' =\s*j\.payload->>'submission_id'/u
        );
        expect(sql).toMatch(/sibling\.status in \('completed', 'failed'\)/u);
        expect(sql).not.toMatch(/sibling\.id\s*[<>]=?\s*j\.id/u);
        expect(sql).not.toMatch(/order by sibling\.id/u);
        return { rows: [] };
      },
    });

    await expect(
      leaseDueJobs(harness.executor, {
        kinds: ['notify'],
        now,
        batchSize: 20,
        leaseDurationMs: 5 * 60_000,
        campaignEnabled: false,
      })
    ).resolves.toEqual([]);
  });

  it('renews only the matching live lease', async () => {
    const harness = executorWith({
      'renew-job-lease': (parameters, sql) => {
        expect(parameters).toEqual([
          jobRow().id,
          leaseToken,
          now,
          new Date('2026-09-01T14:10:00.000Z'),
        ]);
        expect(sql).toMatch(/status = 'leased'/u);
        expect(sql).toMatch(/lease_token = \$2::uuid/u);
        expect(sql).toMatch(/lease_until > \$3/u);
        expect(sql).toMatch(/lease_until\s*=\s*greatest\(lease_until, \$4\)/u);
        return {
          rows: [jobRow({ lease_until: new Date('2026-09-01T14:10:00.000Z') })],
        };
      },
    });

    const renewed = await renewJobLease(harness.executor, {
      jobId: String(jobRow().id),
      leaseToken,
      now,
      leaseDurationMs: 10 * 60_000,
    });

    expect(renewed?.leaseUntil).toEqual(new Date('2026-09-01T14:10:00.000Z'));
  });

  it('claims an internal notification provider attempt at most once for a live lease', async () => {
    const harness = executorWith({
      'claim-internal-notification-submission': (parameters, sql) => {
        expect(parameters).toEqual([
          jobRow().id,
          leaseToken,
          now,
          'notify',
        ]);
        expect(sql).toMatch(/j\.kind = \$4/u);
        expect(sql).toMatch(/j\.status = 'leased'/u);
        expect(sql).toMatch(/j\.lease_until > \$3/u);
        expect(sql).toMatch(/on conflict \(event_key\) do nothing/u);
        expect(sql).toMatch(/at_most_once/u);
        return { rows: [{ event_key: 'claimed' }] };
      },
    });

    await expect(
      claimInternalNotificationSubmission(harness.executor, {
        jobId: String(jobRow().id),
        leaseToken,
        now,
      })
    ).resolves.toBe(true);
  });

  it('closes an ambiguous internal notification with a manual-review activity', async () => {
    const notify = jobRow({ kind: 'notify' });
    const harness = executorWith({
      'mark-internal-notification-unknown': (parameters, sql) => {
        expect(parameters).toEqual([
          notify.id,
          leaseToken,
          now,
          'internal_notification_outcome_unknown',
          'notify',
        ]);
        expect(sql).toMatch(/kind = \$5/u);
        expect(sql).toMatch(/delivery_status = 'unknown'/u);
        return {
          rows: [
            {
              ...notify,
              status: 'failed',
              delivery_status: 'unknown',
              lease_token: null,
              lease_until: null,
            },
          ],
        };
      },
      'insert-internal-notification-unknown': (_parameters, sql) => {
        expect(sql).toMatch(/internal_notification\.acceptance_unknown/u);
        expect(sql).toMatch(/'manual_review', true/u);
        return { rows: [{}] };
      },
    });

    await expect(
      markInternalNotificationUnknown(harness.executor, {
        jobId: String(notify.id),
        leaseToken,
        occurredAt: now,
        errorCode: 'internal_notification_outcome_unknown',
      })
    ).resolves.toMatchObject({ status: 'failed' });
  });

  it('returns only bounded lifecycle context without selecting recipient email', async () => {
    const artifactContent = { summary: 'bounded' };
    const harness = executorWith({
      'read-lifecycle-job-context': (parameters, sql) => {
        expect(parameters).toEqual([jobRow().id]);
        expect(sql).not.toMatch(/email_normalized|email_lookup_hmac/u);
        expect(sql).not.toMatch(/submission\.data\s+as\s+form_submission/u);
        expect(sql).not.toMatch(/data->>'message'|acquisition_session_id/u);
        expect(sql).not.toMatch(
          /c\.display_name|c\.company_name|c\.company_domain/u
        );
        expect(sql).toMatch(/jsonb_build_object\(\s*'form_kind'/u);
        expect(sql).toMatch(/'display_name', a\.data->'display_name'/u);
        expect(sql).toMatch(/'company_name', a\.data->'company_name'/u);
        expect(sql).toMatch(/'company_domain', a\.data->'company_domain'/u);
        expect(sql).toMatch(
          /'email_classification', a\.data->'email_classification'/u
        );
        expect(sql).toMatch(/'pilot_interest', a\.data->'pilot_interest'/u);
        expect(sql).toMatch(/'team_size', a\.data->'team_size'/u);
        expect(sql).toMatch(/'timeline', a\.data->'timeline'/u);
        expect(sql).toMatch(/contact\.form_submission/u);
        expect(sql).toMatch(
          /'form:' \|\| \(target\.payload->>'submission_id'\) \|\| ':accepted'/u
        );
        expect(sql).not.toMatch(/form\.outreach_approved/u);
        expect(sql).toMatch(/campaign\.enrolled:v1/u);
        expect(sql).toMatch(/enrichment\.v1/u);
        expect(sql).toContain(
          "stored.kind in ('enrichment.v1', 'company_enrichment.v1')"
        );
        expect(sql).toMatch(
          /target\.kind = 'send_step'[\s\S]*source\.payload->>'submission_id' =\s*target\.payload->>'submission_id'/u
        );
        return {
          rows: [
            {
              contact_id: jobRow().contact_id,
              display_name: 'Ada',
              company_name: 'Example',
              company_domain: 'example.com',
              email_classification: 'work',
              form_submission: {
                form_kind: 'whitepaper',
                paper: 'chat',
                display_name: 'Ada',
                company_name: 'Example',
                company_domain: 'example.com',
                email_classification: 'work',
              },
              enrollment_at: now,
              artifact_id: '00000000-0000-4000-8000-000000000010',
              artifact_job_id: '00000000-0000-4000-8000-000000000011',
              artifact_project_id: null,
              artifact_kind: 'enrichment.v1',
              artifact_schema_version: 1,
              artifact_content: artifactContent,
              artifact_created_at: now,
            },
          ],
        };
      },
    });

    await expect(
      readLifecycleJobContext(harness.executor, { jobId: String(jobRow().id) })
    ).resolves.toMatchObject({
      contactId: jobRow().contact_id,
      displayName: 'Ada',
      companyName: 'Example',
      companyDomain: 'example.com',
      emailClassification: 'work',
      formSubmission: { form_kind: 'whitepaper', paper: 'chat' },
      enrollmentAt: now,
      enrichmentArtifact: { content: artifactContent, kind: 'enrichment.v1' },
    });
  });
});

describe('final fulfillment authorization', () => {
  it.each([
    ['reply_binding_pending', { reply_binding_pending: true }],
    ['contact_stopped', { form_abuse_blocked: true }],
  ])('denies submission when %s', async (reason, flags) => {
    const harness = executorWith({
      'acquire-google-reconcile-advisory-lock': () => ({ rows: [] }),
      'lock-contact-for-send': () => ({ rows: [{ id: jobRow().contact_id,
        email_normalized: 'reader@acme.com', outreach_approved_at: now, deleted_at: null,
        latest_hard_stop_kind: null, latest_hard_stop_at: null,
        campaign_approval_valid: true, campaign_enrollment_valid: true, ...flags }] }),
      'lock-job-for-send': () => ({ rows: [jobRow()] }),
    });
    await expect(authorizeLeasedJobForSubmission(harness.executor, {
      campaignEnabled: true, deliveryEnabled: true, jobId: String(jobRow().id), leaseToken, now,
    })).resolves.toMatchObject({ authorized: false, reason });
  });

  it('requires the exact allowlisted approval event and immutable enrollment provenance for campaign sends', async () => {
    const harness = executorWith({
      'acquire-google-reconcile-advisory-lock': () => ({ rows: [{}] }),
      'lock-contact-for-send': (_parameters, sql) => {
        expect(sql).toMatch(
          /authoritative\.event_key =\s*target\.payload->>'approval_event_key'/u
        );
        expect(sql).toMatch(
          /authoritative\.occurred_at = c\.outreach_approved_at/u
        );
        expect(sql).toMatch(/authoritative\.kind = 'form\.outreach_approved'/u);
        expect(sql).toMatch(/authoritative\.kind = 'project\.claimed'/u);
        expect(sql).toMatch(/authoritative\.kind = 'contact\.reauthorized'/u);
        expect(sql).toMatch(/enrolled\.kind = 'campaign\.enrolled:v1'/u);
        expect(sql).toMatch(
          /enrolled\.data->>'approval_event_key' = approval\.event_key/u
        );
        return {
          rows: [
            {
              id: jobRow().contact_id,
              email_normalized: 'reader@acme.com',
              outreach_approved_at: now,
              deleted_at: null,
              latest_hard_stop_kind: null,
              latest_hard_stop_at: null,
              mailbox_recovery_required: false,
              campaign_approval_valid: true,
              campaign_enrollment_valid: true,
            },
          ],
        };
      },
      'lock-job-for-send': () => ({ rows: [jobRow()] }),
      'read-google-mailbox-recovery-pause': () => ({
        rows: [{ paused: false }],
      }),
      'insert-final-send-authorization': () => ({
        rows: [{ event_key: 'authorized' }],
      }),
    });

    await expect(
      authorizeLeasedJobForSubmission(harness.executor, {
        campaignEnabled: true,
        deliveryEnabled: true,
        jobId: String(jobRow().id),
        leaseToken,
        now,
      })
    ).resolves.toMatchObject({ authorized: true });
  });

  it.each([
    ['timestamp-only approval', false, false],
    ['mismatched or unallowlisted approval', false, true],
    ['missing or mismatched enrollment', true, false],
  ] as const)(
    'blocks campaign submission for %s',
    async (_case, campaignApprovalValid, campaignEnrollmentValid) => {
      const harness = executorWith({
        'acquire-google-reconcile-advisory-lock': () => ({ rows: [{}] }),
        'lock-contact-for-send': () => ({
          rows: [
            {
              id: jobRow().contact_id,
              email_normalized: 'reader@acme.com',
              outreach_approved_at: now,
              deleted_at: null,
              latest_hard_stop_kind: null,
              latest_hard_stop_at: null,
              mailbox_recovery_required: false,
              campaign_approval_valid: campaignApprovalValid,
              campaign_enrollment_valid: campaignEnrollmentValid,
            },
          ],
        }),
        'lock-job-for-send': () => ({ rows: [jobRow()] }),
      });

      await expect(
        authorizeLeasedJobForSubmission(harness.executor, {
          campaignEnabled: true,
          deliveryEnabled: true,
          jobId: String(jobRow().id),
          leaseToken,
          now,
        })
      ).resolves.toMatchObject({
        authorized: false,
        reason: 'contact_unapproved',
      });
      expect(harness.calls.map(({ marker }) => marker)).not.toContain(
        'insert-final-send-authorization'
      );
    }
  );

  it.each([
    ['campaign_disabled', false, true],
    ['delivery_disabled', true, false],
  ] as const)(
    'blocks campaign submission at the final gate when %s',
    async (reason, campaignEnabled, deliveryEnabled) => {
      const harness = executorWith({
        'acquire-google-reconcile-advisory-lock': () => ({ rows: [{}] }),
        'lock-contact-for-send': () => ({
          rows: [
            {
              id: jobRow().contact_id,
              email_normalized: 'reader@acme.com',
              outreach_approved_at: now,
              deleted_at: null,
              latest_hard_stop_kind: null,
              latest_hard_stop_at: null,
              mailbox_recovery_required: false,
            },
          ],
        }),
        'lock-job-for-send': () => ({ rows: [jobRow()] }),
      });

      await expect(
        authorizeLeasedJobForSubmission(harness.executor, {
          campaignEnabled,
          deliveryEnabled,
          jobId: String(jobRow().id),
          leaseToken,
          now,
        })
      ).resolves.toMatchObject({ authorized: false, reason });
      expect(harness.calls.map(({ marker }) => marker)).not.toContain(
        'insert-final-send-authorization'
      );
    }
  );

  it.each(['unsubscribe', 'campaign.reply_received'] as const)(
    'delivers requested fulfillment independently of campaign approval and the allowed prior stop %s',
    async (allowedStop) => {
      const fulfillJob = jobRow({
        kind: 'fulfill',
        idempotency_key: 'form:submission:fulfill',
        payload: {
          form_kind: 'whitepaper',
          paper: 'chat',
          submission_id: '00000000-0000-4000-8000-000000000010',
        },
      });
      const harness = executorWith({
        'acquire-google-reconcile-advisory-lock': () => ({ rows: [{}] }),
        'lock-contact-for-send': (_parameters, sql) => {
          expect(sql).toMatch(/fulfillment_delivery_blocked/u);
          return {
            rows: [
              {
                id: fulfillJob.contact_id,
                email_normalized: 'reader@acme.com',
                outreach_approved_at: null,
                deleted_at: null,
                latest_hard_stop_kind: allowedStop,
                latest_hard_stop_at: now,
                mailbox_recovery_required: false,
                fulfillment_delivery_blocked: false,
              },
            ],
          };
        },
        'lock-job-for-send': () => ({ rows: [fulfillJob] }),
        'insert-final-send-authorization': () => ({
          rows: [{ event_key: 'authorized' }],
        }),
      });

      const result = await authorizeLeasedJobForSubmission(harness.executor, {
        campaignEnabled: false,
        deliveryEnabled: true,
        jobId: String(fulfillJob.id),
        leaseToken,
        now,
      });

      expect(result.authorized).toBe(true);
      expect(harness.calls.map(({ marker }) => marker)).not.toContain(
        'read-google-mailbox-recovery-pause'
      );
    }
  );

  it('blocks requested fulfillment while mailbox recovery is paused', async () => {
    const fulfillJob = jobRow({ kind: 'fulfill' });
    const harness = executorWith({
      'acquire-google-reconcile-advisory-lock': () => ({ rows: [{}] }),
      'lock-contact-for-send': () => ({
        rows: [
          {
            id: fulfillJob.contact_id,
            email_normalized: 'reader@acme.com',
            outreach_approved_at: null,
            deleted_at: null,
            latest_hard_stop_kind: null,
            latest_hard_stop_at: null,
            mailbox_recovery_required: true,
            fulfillment_delivery_blocked: false,
            fulfillment_deletion_blocked: false,
          },
        ],
      }),
      'lock-job-for-send': () => ({ rows: [fulfillJob] }),
    });

    await expect(
      authorizeLeasedJobForSubmission(harness.executor, {
        campaignEnabled: false,
        deliveryEnabled: true,
        jobId: String(fulfillJob.id),
        leaseToken,
        now,
      })
    ).resolves.toMatchObject({
      authorized: false,
      reason: 'mailbox_recovery_required',
    });
    expect(harness.calls.map(({ marker }) => marker)).not.toContain(
      'insert-final-send-authorization'
    );
  });

  it.each([
    ['campaignEnabled', undefined, true],
    ['campaignEnabled', 'true', true],
    ['deliveryEnabled', true, undefined],
    ['deliveryEnabled', true, 'true'],
  ] as const)(
    'rejects nonboolean final switch %s before database work',
    async (field, campaignEnabled, deliveryEnabled) => {
      const harness = executorWith({});
      await expect(
        authorizeLeasedJobForSubmission(harness.executor, {
          campaignEnabled: campaignEnabled as never,
          deliveryEnabled: deliveryEnabled as never,
          jobId: String(jobRow().id),
          leaseToken,
          now,
        })
      ).rejects.toThrow(new RegExp(field, 'iu'));
      expect(harness.calls).toEqual([]);
    }
  );

  it.each([
    'complaint',
    'hard_bounce',
    'provider_suppression',
    'invalid_address',
    'manual_suppression',
  ] as const)(
    'blocks requested fulfillment when a current-approval-epoch %s exists behind a newer unsubscribe',
    async (fatalStop) => {
      const fulfillJob = jobRow({
        kind: 'fulfill',
        idempotency_key: `form:submission:${fatalStop}:fulfill`,
        payload: {
          form_kind: 'whitepaper',
          paper: 'chat',
          submission_id: '00000000-0000-4000-8000-000000000010',
        },
      });
      const harness = executorWith({
        'acquire-google-reconcile-advisory-lock': () => ({ rows: [{}] }),
        'lock-contact-for-send': (parameters, sql) => {
          expect(sql).toMatch(/exists[\s\S]+fulfillment_delivery_blocked/u);
          expect(sql).toMatch(/fatal_stop\.kind = any\(\$3::text\[\]\)/u);
          expect(sql).toMatch(
            /c\.outreach_approved_at is null[\s\S]+fatal_stop\.occurred_at >= c\.outreach_approved_at/u
          );
          expect(parameters[2]).toContain(fatalStop);
          return {
            rows: [
              {
                id: fulfillJob.contact_id,
                email_normalized: 'reader@acme.com',
                outreach_approved_at: new Date('2026-09-01T11:55:00.000Z'),
                deleted_at: null,
                latest_hard_stop_kind: 'unsubscribe',
                latest_hard_stop_at: now,
                mailbox_recovery_required: false,
                fulfillment_delivery_blocked: true,
                fulfillment_deletion_blocked: false,
              },
            ],
          };
        },
        'lock-job-for-send': () => ({ rows: [fulfillJob] }),
      });

      const result = await authorizeLeasedJobForSubmission(harness.executor, {
        campaignEnabled: false,
        deliveryEnabled: true,
        jobId: String(fulfillJob.id),
        leaseToken,
        now,
      });

      expect(result).toMatchObject({
        authorized: false,
        reason: 'contact_stopped',
      });
      expect(harness.calls.map(({ marker }) => marker)).not.toContain(
        'insert-final-send-authorization'
      );
    }
  );

  it('allows requested fulfillment after explicit reauthorization supersedes an earlier fatal stop', async () => {
    const fulfillJob = jobRow({ kind: 'fulfill' });
    const harness = executorWith({
      'acquire-google-reconcile-advisory-lock': () => ({ rows: [{}] }),
      'lock-contact-for-send': (_parameters, sql) => {
        expect(sql).toMatch(
          /fatal_stop\.occurred_at >= c\.outreach_approved_at/u
        );
        return {
          rows: [
            {
              id: fulfillJob.contact_id,
              email_normalized: 'reader@acme.com',
              outreach_approved_at: new Date('2026-09-01T14:10:00.000Z'),
              deleted_at: null,
              latest_hard_stop_kind: 'complaint',
              latest_hard_stop_at: new Date('2026-09-01T14:05:00.000Z'),
              mailbox_recovery_required: false,
              fulfillment_delivery_blocked: false,
              fulfillment_deletion_blocked: false,
            },
          ],
        };
      },
      'lock-job-for-send': () => ({ rows: [fulfillJob] }),
      'insert-final-send-authorization': () => ({
        rows: [{ event_key: 'authorized' }],
      }),
    });

    const result = await authorizeLeasedJobForSubmission(harness.executor, {
      campaignEnabled: false,
      deliveryEnabled: true,
      jobId: String(fulfillJob.id),
      leaseToken,
      now,
    });

    expect(result.authorized).toBe(true);
  });

  it('keeps deletion an absolute fulfillment stop after later approval state', async () => {
    const fulfillJob = jobRow({ kind: 'fulfill' });
    const harness = executorWith({
      'acquire-google-reconcile-advisory-lock': () => ({ rows: [{}] }),
      'lock-contact-for-send': () => ({
        rows: [
          {
            id: fulfillJob.contact_id,
            email_normalized: 'reader@acme.com',
            outreach_approved_at: new Date('2026-09-01T14:10:00.000Z'),
            deleted_at: null,
            latest_hard_stop_kind: 'deletion',
            latest_hard_stop_at: new Date('2026-09-01T14:05:00.000Z'),
            mailbox_recovery_required: false,
            fulfillment_delivery_blocked: false,
            fulfillment_deletion_blocked: true,
          },
        ],
      }),
      'lock-job-for-send': () => ({ rows: [fulfillJob] }),
    });

    const result = await authorizeLeasedJobForSubmission(harness.executor, {
      campaignEnabled: false,
      deliveryEnabled: true,
      jobId: String(fulfillJob.id),
      leaseToken,
      now,
    });

    expect(result).toMatchObject({
      authorized: false,
      reason: 'contact_deleted',
    });
  });

  it('blocks campaign submission when a later canonical stop follows approval', async () => {
    const sendJob = jobRow({
      kind: 'send_step',
      idempotency_key: 'campaign:v1:contact:step:1',
      payload: { campaign_version: 'v1', step: '1' },
    });
    const stoppedAt = new Date('2026-09-01T14:03:00.000Z');
    const harness = executorWith({
      'acquire-google-reconcile-advisory-lock': () => ({ rows: [{}] }),
      'lock-contact-for-send': () => ({
        rows: [
          {
            id: sendJob.contact_id,
            email_normalized: 'reader@acme.com',
            outreach_approved_at: new Date('2026-09-01T14:00:00.000Z'),
            deleted_at: null,
            latest_hard_stop_kind: 'unsubscribe',
            latest_hard_stop_at: stoppedAt,
            mailbox_recovery_required: false,
          },
        ],
      }),
      'lock-job-for-send': () => ({ rows: [sendJob] }),
    });

    const result = await authorizeLeasedJobForSubmission(harness.executor, {
      campaignEnabled: true,
      deliveryEnabled: true,
      jobId: String(sendJob.id),
      leaseToken,
      now,
    });

    expect(result).toMatchObject({
      authorized: false,
      reason: 'contact_stopped',
    });
    expect(harness.calls.map(({ marker }) => marker)).not.toContain(
      'insert-final-send-authorization'
    );
  });
});

describe('leased transitions', () => {
  it('defers a live lease to one scheduler-owned retry time', async () => {
    const availableAt = new Date('2026-09-01T14:01:00.000Z');
    const harness = executorWith({
      'defer-leased-job': (parameters, sql) => {
        expect(parameters).toEqual([
          jobRow().id,
          leaseToken,
          now,
          availableAt,
          'enrichment_retry',
        ]);
        expect(sql).toMatch(/status = 'pending'/u);
        expect(sql).toMatch(/available_at = \$4/u);
        expect(sql).toMatch(/lease_token = \$2::uuid/u);
        return {
          rows: [jobRow({ status: 'pending', available_at: availableAt })],
        };
      },
    });

    await expect(
      deferLeasedJob(harness.executor, {
        jobId: String(jobRow().id),
        leaseToken,
        now,
        availableAt,
        errorCode: 'enrichment_retry',
      })
    ).resolves.toMatchObject({ status: 'pending', availableAt });
  });

  it('settles a resolved provider rejection as closed failed work', async () => {
    const harness = executorWith({
      'mark-provider-rejected': (parameters, sql) => {
        expect(parameters).toEqual([
          jobRow().id,
          leaseToken,
          now,
          'resend_validation_error',
        ]);
        expect(sql).toMatch(/status = 'failed'/u);
        expect(sql).toMatch(/delivery_status = 'failed'/u);
        expect(sql).toMatch(/lease_token = \$2::uuid/u);
        return {
          rows: [
            jobRow({
              status: 'failed',
              delivery_status: 'failed',
              last_error_code: 'resend_validation_error',
            }),
          ],
        };
      },
      'insert-provider-rejected-activity': () => ({ rows: [{}] }),
    });

    const failed = await markProviderRejection(harness.executor, {
      errorCode: 'resend_validation_error',
      jobId: String(jobRow().id),
      leaseToken,
      occurredAt: now,
    });

    expect(failed).toMatchObject({
      status: 'failed',
      deliveryStatus: 'failed',
      lastErrorCode: 'resend_validation_error',
    });
  });

  it('records provider acceptance idempotently and anchors later cadence with greatest', async () => {
    const acceptedAt = new Date('2026-09-01T14:02:00.000Z');
    const harness = executorWith({
      'discover-provider-acceptance-contact': (_parameters, sql) => {
        expect(sql).not.toMatch(/for update/u);
        return { rows: [{ contact_id: jobRow().contact_id }] };
      },
      'lock-provider-acceptance-contact': (_parameters, sql) => {
        expect(sql).toMatch(/for update/u);
        return { rows: [{ id: jobRow().contact_id }] };
      },
      'lock-provider-acceptance-job': (_parameters, sql) => {
        expect(sql).toMatch(/for update/u);
        expect(sql).not.toMatch(/lease_token/u);
        return { rows: [jobRow()] };
      },
      'read-final-send-authorization': () => ({
        rows: [
          {
            event_key: `job:${jobRow().id}:submission-authorized:${leaseToken}`,
            contact_id: jobRow().contact_id,
            project_id: null,
            kind: 'delivery.submission_authorized',
            occurred_at: new Date('2026-09-01T14:01:00.000Z'),
            data: { bounded_stop_race: true, lease_token: leaseToken },
          },
        ],
      }),
      'accept-provider-submission': (parameters, sql) => {
        expect(parameters.slice(0, 5)).toEqual([
          jobRow().id,
          leaseToken,
          acceptedAt,
          'resend-email-1',
          'submitted',
        ]);
        expect(sql).toMatch(/lease_token = \$2::uuid/u);
        expect(sql).toMatch(/lease_until > \$3/u);
        expect(sql).toMatch(/prior\.provider_email_id is not null/u);
        return {
          rows: [
            jobRow({
              status: 'completed',
              lease_until: null,
              lease_token: null,
              provider_email_id: 'resend-email-1',
              delivery_status: 'submitted',
            }),
          ],
        };
      },
      'insert-provider-acceptance-activity': (parameters, sql) => {
        expect(parameters).toContain('campaign.step_accepted');
        expect(parameters).toContain(leaseToken);
        expect(sql).toMatch(/on conflict \(event_key\) do nothing/u);
        expect(sql).toMatch(/returning event_key/u);
        return {
          rows: [{ event_key: `job:${jobRow().id}:provider-accepted` }],
        };
      },
      'anchor-campaign-cadence': (parameters, sql) => {
        expect(parameters).toEqual([
          jobRow().contact_id,
          1,
          new Date('2026-09-04T14:00:00.000Z'),
          new Date('2026-09-11T14:00:00.000Z'),
        ]);
        expect(sql).toMatch(/greatest/u);
        expect(sql).toMatch(/\$3::timestamptz/u);
        expect(sql).toMatch(/\$4::timestamptz/u);
        expect(sql).not.toMatch(/interval '\d+ days'/u);
        return { rows: [] };
      },
    });

    const completed = await recordProviderAcceptance(harness.executor, {
      jobId: String(jobRow().id),
      leaseToken,
      acceptedAt,
      providerEmailId: 'resend-email-1',
    });

    expect(completed.status).toBe('completed');
    expect(completed.deliveryStatus).toBe('submitted');
    expect(harness.transactions.count).toBe(1);
    expect(harness.calls.map(({ marker }) => marker).slice(0, 5)).toEqual([
      'discover-provider-acceptance-contact',
      'lock-provider-acceptance-contact',
      'lock-provider-acceptance-job',
      'read-final-send-authorization',
      'accept-provider-submission',
    ]);
  });

  it('upgrades only deletion-provisional unknown to known acceptance without resubmission', async () => {
    const acceptedAt = new Date('2026-09-01T14:02:00.000Z');
    const interrupted = jobRow({
      status: 'failed',
      lease_until: null,
      lease_token: null,
      delivery_status: 'unknown',
      last_error_code: 'provider_acceptance_interrupted_by_deletion',
      payload: { campaign_version: 'v1', step: 1 },
    });
    const harness = executorWith({
      'discover-provider-acceptance-contact': () => ({
        rows: [{ contact_id: interrupted.contact_id }],
      }),
      'lock-provider-acceptance-contact': () => ({
        rows: [{ id: interrupted.contact_id }],
      }),
      'lock-provider-acceptance-job': () => ({ rows: [interrupted] }),
      'read-final-send-authorization': () => ({
        rows: [
          {
            event_key: `job:${interrupted.id}:submission-authorized:${leaseToken}`,
            contact_id: interrupted.contact_id,
            project_id: null,
            kind: 'delivery.submission_authorized',
            occurred_at: new Date('2026-09-01T14:01:00.000Z'),
            data: { bounded_stop_race: true, lease_token: leaseToken },
          },
        ],
      }),
      'reconcile-deletion-interrupted-provider-submission': (
        parameters,
        sql
      ) => {
        expect(parameters).toEqual([
          interrupted.id,
          leaseToken,
          acceptedAt,
          'resend-email-after-delete',
          'submitted',
        ]);
        expect(sql).toMatch(/status = 'failed'/u);
        expect(sql).toMatch(/delivery_status = 'unknown'/u);
        expect(sql).toMatch(/provider_acceptance_interrupted_by_deletion/u);
        expect(sql).toMatch(/delivery\.submission_authorized/u);
        expect(sql).toMatch(/growth_activity submission_authorization/u);
        expect(sql).not.toMatch(/growth_activity authorization/u);
        expect(sql).toMatch(/delivery\.acceptance_unknown/u);
        expect(sql).toMatch(/authorized_worker_interrupted_by_deletion/u);
        expect(sql).toMatch(/manual_review/u);
        expect(sql).toMatch(/kind = 'deletion'/u);
        return {
          rows: [
            {
              ...interrupted,
              status: 'completed',
              provider_email_id: 'resend-email-after-delete',
              delivery_status: 'submitted',
              last_error_code: null,
            },
          ],
        };
      },
      'insert-provider-acceptance-activity': () => ({
        rows: [{ event_key: `job:${interrupted.id}:provider-accepted` }],
      }),
      'insert-provider-unknown-resolution': (parameters, sql) => {
        expect(parameters).toEqual([
          interrupted.id,
          interrupted.contact_id,
          null,
          acceptedAt,
        ]);
        expect(sql).toMatch(/delivery\.acceptance_unknown_resolved/u);
        expect(sql).toMatch(/known_provider_acceptance/u);
        expect(sql).toMatch(/supersedes_event_key/u);
        return {
          rows: [
            {
              event_key: `job:${interrupted.id}:provider-acceptance-unknown-resolved`,
            },
          ],
        };
      },
      'anchor-campaign-cadence': () => ({ rows: [] }),
    });

    await expect(
      recordProviderAcceptance(harness.executor, {
        jobId: String(interrupted.id),
        leaseToken,
        acceptedAt,
        providerEmailId: 'resend-email-after-delete',
      })
    ).resolves.toMatchObject({
      status: 'completed',
      deliveryStatus: 'submitted',
      providerEmailId: 'resend-email-after-delete',
    });
    expect(harness.calls.map(({ marker }) => marker)).not.toContain(
      'accept-provider-submission'
    );
  });

  it('does not upgrade an ordinary failed unknown provider job', async () => {
    const ordinaryUnknown = jobRow({
      status: 'failed',
      lease_until: null,
      lease_token: null,
      delivery_status: 'unknown',
      last_error_code: 'resend_submission_outcome_unknown',
    });
    const harness = executorWith({
      'discover-provider-acceptance-contact': () => ({
        rows: [{ contact_id: ordinaryUnknown.contact_id }],
      }),
      'lock-provider-acceptance-contact': () => ({
        rows: [{ id: ordinaryUnknown.contact_id }],
      }),
      'lock-provider-acceptance-job': () => ({ rows: [ordinaryUnknown] }),
      'read-final-send-authorization': () => ({
        rows: [
          {
            event_key: `job:${ordinaryUnknown.id}:submission-authorized:${leaseToken}`,
            contact_id: ordinaryUnknown.contact_id,
            project_id: null,
            kind: 'delivery.submission_authorized',
            occurred_at: new Date('2026-09-01T14:01:00.000Z'),
            data: { bounded_stop_race: true, lease_token: leaseToken },
          },
        ],
      }),
    });

    await expect(
      recordProviderAcceptance(harness.executor, {
        jobId: String(ordinaryUnknown.id),
        leaseToken,
        acceptedAt: new Date('2026-09-01T14:02:00.000Z'),
        providerEmailId: 'resend-email-ordinary',
      })
    ).rejects.toBeInstanceOf(JobLeaseConflictError);
    expect(harness.calls.map(({ marker }) => marker)).not.toContain(
      'reconcile-deletion-interrupted-provider-submission'
    );
  });

  it('rejects an unbounded provider acceptance identifier before database work', async () => {
    const harness = executorWith({});
    await expect(
      recordProviderAcceptance(harness.executor, {
        jobId: String(jobRow().id),
        leaseToken,
        acceptedAt: now,
        providerEmailId: `raw@example.com:${'x'.repeat(300)}`,
      })
    ).rejects.toThrow(/providerEmailId/u);
    expect(harness.calls).toEqual([]);
  });

  it.each([
    'submitted',
    'delivered',
    'bounced',
    'complained',
    'suppressed',
    'failed',
  ] as const)(
    'does not move cadence when the same provider acceptance is replayed after delivery becomes %s',
    async (deliveryStatus) => {
      const acceptedAt = new Date('2026-09-01T14:02:00.000Z');
      const harness = executorWith({
        'discover-provider-acceptance-contact': () => ({
          rows: [{ contact_id: jobRow().contact_id }],
        }),
        'lock-provider-acceptance-contact': () => ({
          rows: [{ id: jobRow().contact_id }],
        }),
        'lock-provider-acceptance-job': () => ({
          rows: [
            jobRow({
              status: 'completed',
              lease_until: null,
              lease_token: null,
              provider_email_id: 'resend-email-1',
              delivery_status: deliveryStatus,
            }),
          ],
        }),
        'read-final-send-authorization': () => ({
          rows: [
            {
              event_key: `job:${
                jobRow().id
              }:submission-authorized:${leaseToken}`,
              contact_id: jobRow().contact_id,
              project_id: null,
              kind: 'delivery.submission_authorized',
              occurred_at: new Date('2026-09-01T14:01:00.000Z'),
              data: { bounded_stop_race: true, lease_token: leaseToken },
            },
          ],
        }),
        'read-provider-acceptance-activity': () => ({
          rows: [
            {
              event_key: `job:${jobRow().id}:provider-accepted`,
              contact_id: jobRow().contact_id,
              project_id: null,
              kind: 'campaign.step_accepted',
              occurred_at: acceptedAt,
              data: {
                lease_token: leaseToken,
                provider_ref: 'resend-email-1',
                step: 1,
              },
            },
          ],
        }),
      });

      const replay = await recordProviderAcceptance(harness.executor, {
        jobId: String(jobRow().id),
        leaseToken,
        acceptedAt,
        providerEmailId: 'resend-email-1',
      });

      expect(replay.providerEmailId).toBe('resend-email-1');
      expect(replay.deliveryStatus).toBe(deliveryStatus);
      expect(harness.calls.map(({ marker }) => marker)).toEqual([
        'discover-provider-acceptance-contact',
        'lock-provider-acceptance-contact',
        'lock-provider-acceptance-job',
        'read-final-send-authorization',
        'read-provider-acceptance-activity',
      ]);
    }
  );

  it('rejects a completed replay whose immutable acceptance envelope was forged', async () => {
    const acceptedAt = new Date('2026-09-01T14:02:00.000Z');
    const harness = executorWith({
      'discover-provider-acceptance-contact': () => ({
        rows: [{ contact_id: jobRow().contact_id }],
      }),
      'lock-provider-acceptance-contact': () => ({
        rows: [{ id: jobRow().contact_id }],
      }),
      'lock-provider-acceptance-job': () => ({
        rows: [
          jobRow({
            status: 'completed',
            lease_until: null,
            lease_token: null,
            provider_email_id: 'resend-email-1',
            delivery_status: 'submitted',
          }),
        ],
      }),
      'read-final-send-authorization': () => ({
        rows: [
          {
            event_key: `job:${jobRow().id}:submission-authorized:${leaseToken}`,
            contact_id: jobRow().contact_id,
            project_id: null,
            kind: 'delivery.submission_authorized',
            occurred_at: new Date('2026-09-01T14:01:00.000Z'),
            data: { bounded_stop_race: true, lease_token: leaseToken },
          },
        ],
      }),
      'read-provider-acceptance-activity': () => ({
        rows: [
          {
            event_key: `job:${jobRow().id}:provider-accepted`,
            contact_id: jobRow().contact_id,
            project_id: null,
            kind: 'campaign.step_accepted',
            occurred_at: acceptedAt,
            data: {
              lease_token: '00000000-0000-4000-8000-000000000088',
              provider_ref: 'resend-email-1',
              step: 1,
            },
          },
        ],
      }),
    });

    await expect(
      recordProviderAcceptance(harness.executor, {
        jobId: String(jobRow().id),
        leaseToken,
        acceptedAt,
        providerEmailId: 'resend-email-1',
      })
    ).rejects.toThrow(/provider acceptance event key conflict/u);
  });

  it.each(['not_submitted', 'unknown'] as const)(
    'does not treat impossible completed/%s state as an accepted replay',
    async (deliveryStatus) => {
      const acceptedAt = new Date('2026-09-01T14:02:00.000Z');
      const harness = executorWith({
        'discover-provider-acceptance-contact': () => ({
          rows: [{ contact_id: jobRow().contact_id }],
        }),
        'lock-provider-acceptance-contact': () => ({
          rows: [{ id: jobRow().contact_id }],
        }),
        'lock-provider-acceptance-job': () => ({
          rows: [
            jobRow({
              status: 'completed',
              lease_until: null,
              lease_token: null,
              provider_email_id: 'resend-email-1',
              delivery_status: deliveryStatus,
            }),
          ],
        }),
        'read-final-send-authorization': () => ({
          rows: [
            {
              event_key: `job:${
                jobRow().id
              }:submission-authorized:${leaseToken}`,
              contact_id: jobRow().contact_id,
              project_id: null,
              kind: 'delivery.submission_authorized',
              occurred_at: new Date('2026-09-01T14:01:00.000Z'),
              data: { bounded_stop_race: true, lease_token: leaseToken },
            },
          ],
        }),
      });

      await expect(
        recordProviderAcceptance(harness.executor, {
          jobId: String(jobRow().id),
          leaseToken,
          acceptedAt,
          providerEmailId: 'resend-email-1',
        })
      ).rejects.toBeInstanceOf(JobLeaseConflictError);
      expect(harness.calls.map(({ marker }) => marker)).not.toContain(
        'read-provider-acceptance-activity'
      );
    }
  );

  it('rejects a contact delivery when the mandatory final authorization is missing', async () => {
    const acceptedAt = new Date('2026-09-01T14:02:00.000Z');
    const harness = executorWith({
      'discover-provider-acceptance-contact': () => ({
        rows: [{ contact_id: jobRow().contact_id }],
      }),
      'lock-provider-acceptance-contact': () => ({
        rows: [{ id: jobRow().contact_id }],
      }),
      'lock-provider-acceptance-job': () => ({ rows: [jobRow()] }),
      'read-final-send-authorization': () => ({ rows: [] }),
    });

    await expect(
      recordProviderAcceptance(harness.executor, {
        jobId: String(jobRow().id),
        leaseToken,
        acceptedAt,
        providerEmailId: 'resend-email-1',
      })
    ).rejects.toThrow(/final authorization/u);
    expect(harness.calls.map(({ marker }) => marker)).not.toContain(
      'accept-provider-submission'
    );
  });

  it('rejects contactless provider acceptance rather than bypassing the outreach gate', async () => {
    const harness = executorWith({
      'discover-provider-acceptance-contact': () => ({
        rows: [{ contact_id: null }],
      }),
      'lock-provider-acceptance-contact': () => ({ rows: [] }),
      'lock-provider-acceptance-job': () => ({
        rows: [jobRow({ contact_id: null })],
      }),
    });

    await expect(
      recordProviderAcceptance(harness.executor, {
        jobId: String(jobRow().id),
        leaseToken,
        acceptedAt: new Date('2026-09-01T14:02:00.000Z'),
        providerEmailId: 'resend-email-1',
      })
    ).rejects.toThrow(/contact recipient/u);
  });

  it('moves ambiguous acceptance to unknown manual review without making it leaseable', async () => {
    const harness = executorWith({
      'discover-provider-unknown-contact': (_parameters, sql) => {
        expect(sql).not.toMatch(/for update/u);
        return { rows: [{ contact_id: jobRow().contact_id }] };
      },
      'lock-provider-unknown-contact': (_parameters, sql) => {
        expect(sql).toMatch(/for update/u);
        return { rows: [{ id: jobRow().contact_id }] };
      },
      'lock-provider-unknown-job': (_parameters, sql) => {
        expect(sql).toMatch(/for update/u);
        expect(sql).not.toMatch(/lease_token/u);
        return { rows: [jobRow()] };
      },
      'read-final-send-authorization': () => ({
        rows: [
          {
            event_key: `job:${jobRow().id}:submission-authorized:${leaseToken}`,
            contact_id: jobRow().contact_id,
            project_id: null,
            kind: 'delivery.submission_authorized',
            occurred_at: new Date('2026-09-01T11:59:00.000Z'),
            data: { bounded_stop_race: true, lease_token: leaseToken },
          },
        ],
      }),
      'mark-provider-unknown': (_parameters, sql) => {
        expect(sql).toMatch(/status = 'failed'/u);
        expect(sql).toMatch(/delivery_status = 'unknown'/u);
        expect(sql).toMatch(/lease_token = \$2::uuid/u);
        return {
          rows: [
            jobRow({
              status: 'failed',
              delivery_status: 'unknown',
              last_error_code: 'provider_acceptance_ambiguous',
            }),
          ],
        };
      },
      'insert-provider-unknown-activity': () => ({ rows: [{}] }),
    });

    const failed = await markProviderAcceptanceUnknown(harness.executor, {
      jobId: String(jobRow().id),
      leaseToken,
      occurredAt: now,
      errorCode: 'provider_acceptance_ambiguous',
    });

    expect(failed.status).toBe('failed');
    expect(failed.deliveryStatus).toBe('unknown');
    expect(harness.calls.map(({ marker }) => marker).slice(0, 4)).toEqual([
      'discover-provider-unknown-contact',
      'lock-provider-unknown-contact',
      'lock-provider-unknown-job',
      'read-final-send-authorization',
    ]);
  });

  it('reconciles a deletion race with an ambiguous authorized campaign submission', async () => {
    const cancelled = jobRow({
      kind: 'send_step',
      status: 'cancelled',
      lease_token: null,
      lease_until: null,
      payload: { campaign_version: 'v1', step: 2 },
    });
    const harness = executorWith({
      'discover-provider-unknown-contact': () => ({
        rows: [{ contact_id: cancelled.contact_id }],
      }),
      'lock-provider-unknown-contact': () => ({
        rows: [{ id: cancelled.contact_id }],
      }),
      'lock-provider-unknown-job': () => ({ rows: [cancelled] }),
      'read-final-send-authorization': () => ({
        rows: [
          {
            event_key: `job:${cancelled.id}:submission-authorized:${leaseToken}`,
            contact_id: cancelled.contact_id,
            project_id: null,
            kind: 'delivery.submission_authorized',
            occurred_at: new Date('2026-09-01T11:59:00.000Z'),
            data: { bounded_stop_race: true, lease_token: leaseToken },
          },
        ],
      }),
      'reconcile-stopped-provider-unknown': (_parameters, sql) => {
        expect(sql).toMatch(/current\.status = 'cancelled'/u);
        expect(sql).toMatch(/delivery_status = 'unknown'/u);
        expect(sql).toMatch(/delivery\.submission_authorized/u);
        expect(sql).toMatch(/growth_activity submission_authorization/u);
        expect(sql).not.toMatch(/growth_activity authorization/u);
        return {
          rows: [
            {
              ...cancelled,
              status: 'failed',
              delivery_status: 'unknown',
              last_error_code: 'resend_submission_outcome_unknown',
            },
          ],
        };
      },
      'insert-provider-unknown-activity': () => ({ rows: [{}] }),
    });

    await expect(
      markProviderAcceptanceUnknown(harness.executor, {
        jobId: String(cancelled.id),
        leaseToken,
        occurredAt: now,
        errorCode: 'resend_submission_outcome_unknown',
      })
    ).resolves.toMatchObject({
      status: 'failed',
      deliveryStatus: 'unknown',
      payload: { campaign_version: 'v1', step: 2 },
    });
  });

  it.each([
    ['missing', undefined],
    [
      'forged',
      {
        event_key: `job:${jobRow().id}:submission-authorized:${leaseToken}`,
        contact_id: jobRow().contact_id,
        project_id: null,
        kind: 'delivery.submission_authorized',
        occurred_at: new Date('2026-09-01T11:59:00.000Z'),
        data: { bounded_stop_race: false, lease_token: leaseToken },
      },
    ],
  ] as const)(
    'rejects an ambiguous acceptance with %s final authorization',
    async (_case, authorization) => {
      const harness = executorWith({
        'discover-provider-unknown-contact': () => ({
          rows: [{ contact_id: jobRow().contact_id }],
        }),
        'lock-provider-unknown-contact': () => ({
          rows: [{ id: jobRow().contact_id }],
        }),
        'lock-provider-unknown-job': () => ({ rows: [jobRow()] }),
        'read-final-send-authorization': () => ({
          rows: authorization ? [authorization] : [],
        }),
      });

      await expect(
        markProviderAcceptanceUnknown(harness.executor, {
          jobId: String(jobRow().id),
          leaseToken,
          occurredAt: now,
          errorCode: 'provider_acceptance_ambiguous',
        })
      ).rejects.toThrow(/final authorization/u);
      expect(harness.calls.map(({ marker }) => marker)).not.toContain(
        'mark-provider-unknown'
      );
    }
  );

  it('rejects contactless ambiguous acceptance rather than bypassing authorization', async () => {
    const harness = executorWith({
      'discover-provider-unknown-contact': () => ({
        rows: [{ contact_id: null }],
      }),
      'lock-provider-unknown-contact': () => ({ rows: [] }),
      'lock-provider-unknown-job': () => ({
        rows: [jobRow({ contact_id: null })],
      }),
    });

    await expect(
      markProviderAcceptanceUnknown(harness.executor, {
        jobId: String(jobRow().id),
        leaseToken,
        occurredAt: now,
        errorCode: 'provider_acceptance_ambiguous',
      })
    ).rejects.toThrow(/contact recipient/u);
  });

  it.each([
    ['complete', completeLeasedJob, 'completed'],
    ['fail', failLeasedJob, 'failed'],
    ['cancel', cancelLeasedJob, 'cancelled'],
  ] as const)(
    '%s requires the active lease token and leased state',
    async (_, transition, status) => {
      const harness = executorWith({
        [`${status}-leased-job`]: (_parameters, sql) => {
          expect(sql).toMatch(/status = 'leased'/u);
          expect(sql).toMatch(/lease_token = \$2::uuid/u);
          expect(sql).toMatch(/lease_until > \$3/u);
          if (status === 'completed') {
            expect(sql).toMatch(/kind <> 'send_step'/u);
          }
          return { rows: [jobRow({ status })] };
        },
      });

      const result = await transition(harness.executor, {
        jobId: String(jobRow().id),
        leaseToken,
        now,
        errorCode: status === 'failed' ? 'terminal_failure' : undefined,
      });

      expect(result.status).toBe(status);
    }
  );
});

describe('job artifacts', () => {
  it('stores structured JSON once per job and returns an identical replay', async () => {
    const content = { score_version: 'growth-score:v1', reasons: [] };
    const artifact = {
      id: '00000000-0000-4000-8000-000000000010',
      job_id: jobRow().id,
      contact_id: jobRow().contact_id,
      project_id: null,
      kind: 'growth.score',
      schema_version: 1,
      content,
      created_at: now,
    };
    const harness = executorWith({
      'discover-install-runtime-artifact-job': () => ({ rows: [] }),
      'insert-job-artifact': (parameters, sql) => {
        expect(parameters).toEqual([
          jobRow().id,
          'growth.score',
          1,
          JSON.stringify(content),
        ]);
        expect(sql).toMatch(/insert into growth_artifacts/u);
        expect(sql).toMatch(
          /select j\.id, j\.contact_id, j\.project_id, \$2, \$3, \$4::jsonb/u
        );
        expect(sql).toMatch(/from growth_jobs j/u);
        expect(sql).toMatch(/where j\.id = \$1/u);
        expect(sql).toMatch(/on conflict \(job_id\) do nothing/u);
        return { rows: [] };
      },
      'read-job-artifact': () => ({ rows: [artifact] }),
    });

    const result = await persistJobArtifact(harness.executor, {
      jobId: String(jobRow().id),
      kind: 'growth.score',
      schemaVersion: 1,
      content,
    });

    expect(result.content).toEqual(content);
    expect(result.contactId).toBe(jobRow().contact_id);
    expect(harness.transactions.count).toBe(1);
  });

  it('does not accept caller-controlled artifact scope', async () => {
    const callerScopedArtifact = () =>
      persistJobArtifact(executorWith({}).executor, {
        jobId: String(jobRow().id),
        // @ts-expect-error artifact contact scope is derived from the job
        contactId: '00000000-0000-4000-8000-000000000099',
        projectId: null,
        kind: 'growth.score',
        schemaVersion: 1,
        content: {},
      });
    expect(callerScopedArtifact).toBeTypeOf('function');
  });

  it('persists an enrichment artifact only for the matching unexpired lease', async () => {
    const content = { summary: 'bounded' };
    const artifact = {
      id: '00000000-0000-4000-8000-000000000010',
      job_id: jobRow().id,
      contact_id: jobRow().contact_id,
      project_id: null,
      kind: 'enrichment.v1',
      schema_version: 1,
      content,
      created_at: now,
    };
    const harness = executorWith({
      'discover-install-runtime-artifact-job': () => ({ rows: [] }),
      'insert-job-artifact': (parameters, sql) => {
        expect(parameters).toEqual([
          jobRow().id,
          'enrichment.v1',
          1,
          JSON.stringify(content),
          leaseToken,
          now,
        ]);
        expect(sql).toMatch(/j\.kind = 'enrich'/u);
        expect(sql).toMatch(/j\.status = 'leased'/u);
        expect(sql).toMatch(/j\.lease_token = \$5::uuid/u);
        expect(sql).toMatch(/j\.lease_until > \$6/u);
        return { rows: [artifact] };
      },
      'read-job-artifact': () => ({ rows: [artifact] }),
    });

    await expect(
      persistJobArtifact(harness.executor, {
        jobId: String(jobRow().id),
        leaseToken,
        now,
        kind: 'enrichment.v1',
        schemaVersion: 1,
        content,
      })
    ).resolves.toMatchObject({ kind: 'enrichment.v1', content });
  });
});
