import type { SqlExecutor, SqlTransaction } from './database.ts';
import { CONTACT_HARD_STOP_REASONS } from './contacts.ts';
import { normalizeEmail } from './crypto.ts';
import type { GrowthArtifact, GrowthJob } from './models.ts';
import { privacyLock } from './observability/store.ts';
import {
  businessMorningAfter,
  isCampaignSendWindow,
} from './campaign-schedule.ts';
import { installRuntimeEvidenceSql } from './observability/install-runtime-enrichment.ts';

const FULFILLMENT_ALLOWED_PRIOR_STOPS = new Set([
  'unsubscribe',
  'campaign.reply_received',
]);
const FULFILLMENT_EPOCH_FATAL_STOP_REASONS = CONTACT_HARD_STOP_REASONS.filter(
  (reason) =>
    reason !== 'deletion' && !FULFILLMENT_ALLOWED_PRIOR_STOPS.has(reason)
);

interface JobRow extends Record<string, unknown> {
  id: string;
  kind: string;
  contact_id: string | null;
  project_id: string | null;
  status: GrowthJob['status'];
  available_at: Date | string;
  lease_until: Date | string | null;
  lease_token: string | null;
  attempts: number;
  idempotency_key: string;
  payload: Record<string, unknown>;
  provider_email_id: string | null;
  rfc_message_id: string | null;
  gmail_seed_message_id: string | null;
  delivery_status: GrowthJob['deliveryStatus'];
  last_error_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ArtifactRow extends Record<string, unknown> {
  id: string;
  job_id: string;
  contact_id: string | null;
  project_id: string | null;
  kind: string;
  schema_version: number;
  content: Record<string, unknown>;
  created_at: Date | string;
}

interface LifecycleJobContextRow extends Record<string, unknown> {
  campaign_enrollment_reason?: string | null;
  contact_id: string;
  display_name: string | null;
  company_name: string | null;
  company_domain: string | null;
  email_classification: string | null;
  form_submission: Record<string, unknown> | null;
  enrollment_at: Date | string | null;
  artifact_id: string | null;
  artifact_job_id: string | null;
  artifact_project_id: string | null;
  artifact_kind: string | null;
  artifact_schema_version: number | null;
  artifact_content: Record<string, unknown> | null;
  artifact_created_at: Date | string | null;
}

export class JobLeaseConflictError extends Error {
  constructor(jobId: string) {
    super(`Growth job lease is no longer active: ${jobId}`);
    this.name = 'JobLeaseConflictError';
  }
}

export class FinalSendAuthorizationConflictError extends JobLeaseConflictError {
  constructor(eventKey: string, jobId: string) {
    super(jobId);
    this.name = 'FinalSendAuthorizationConflictError';
    this.message = `Growth final authorization event key conflict: ${eventKey}`;
  }
}

export type FinalSendAuthorization =
  | {
      authorized: true;
      job: GrowthJob;
      recipient: {
        contactId: string;
        emailNormalized: string;
      };
      boundedRaceNotice: 'a_future_stop_can_overlap_provider_submission';
    }
  | {
      authorized: false;
      reason:
        | 'contact_deleted'
        | 'contact_stopped'
        | 'contact_unapproved'
        | 'campaign_disabled'
        | 'delivery_disabled'
        | 'outside_send_window'
        | 'mailbox_recovery_required'
        | 'reply_binding_pending';
      job: GrowthJob;
    };

interface SendContactRow extends Record<string, unknown> {
  id: string;
  email_normalized: string | null;
  outreach_approved_at: Date | string | null;
  deleted_at: Date | string | null;
  latest_hard_stop_kind: string | null;
  latest_hard_stop_at: Date | string | null;
  mailbox_recovery_required?: boolean;
  fulfillment_delivery_blocked?: boolean;
  fulfillment_deletion_blocked?: boolean;
  campaign_approval_valid?: boolean;
  campaign_enrollment_valid?: boolean;
  reply_binding_pending?: boolean;
  form_abuse_blocked?: boolean;
}

interface FinalSendAuthorizationRow extends Record<string, unknown> {
  event_key: string;
  contact_id: string | null;
  project_id: string | null;
  kind: string;
  occurred_at: Date | string;
  data: Record<string, unknown>;
}

type ProviderAcceptanceActivityRow = FinalSendAuthorizationRow;

interface ProviderAcceptanceContactReference extends Record<string, unknown> {
  contact_id: string | null;
}

function validDate(field: string, value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${field} must be a valid Date`);
  }
  return value;
}

function positiveInteger(
  field: string,
  value: number,
  maximum: number
): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function requiredText(field: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} is required`);
  return normalized;
}

function opaqueIdentifier(
  field: string,
  value: string,
  maximum: number
): string {
  const normalized = requiredText(field, value);
  if (
    normalized.length > maximum ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized)
  ) {
    throw new Error(`${field} must be a bounded opaque identifier`);
  }
  return normalized;
}

function toJob(row: JobRow): GrowthJob {
  return {
    id: row.id,
    kind: row.kind,
    contactId: row.contact_id,
    projectId: row.project_id,
    status: row.status,
    availableAt: new Date(row.available_at),
    leaseUntil: row.lease_until ? new Date(row.lease_until) : null,
    leaseToken: row.lease_token,
    attempts: row.attempts,
    idempotencyKey: row.idempotency_key,
    payload: row.payload,
    providerEmailId: row.provider_email_id,
    rfcMessageId: row.rfc_message_id,
    gmailSeedMessageId: row.gmail_seed_message_id,
    deliveryStatus: row.delivery_status,
    lastErrorCode: row.last_error_code,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toArtifact(row: ArtifactRow): GrowthArtifact {
  return {
    id: row.id,
    jobId: row.job_id,
    contactId: row.contact_id,
    projectId: row.project_id,
    kind: row.kind,
    schemaVersion: row.schema_version,
    content: row.content,
    createdAt: new Date(row.created_at),
  };
}

export interface MaterializeCampaignEnrollmentInput {
  enrollmentEnabled: boolean;
  enrollmentStartAt: Date;
  now: Date;
  batchSize: number;
}

/** Only persisted, still-applicable installation/runtime evidence admits this approval. */
function installRuntimeApproval(alias: 'approval' | 'authoritative'): string {
  return `(${alias}.kind = 'install_runtime.outreach_approved'
    and ${alias}.data->>'provenance' = 'linked_install_runtime'
    and exists (
      select 1 from growth_install_runtime_links link
      join growth_observations i on i.id=link.install_observation_id
      join growth_observations r on r.id=link.runtime_observation_id
      join growth_observation_identities identity on identity.observation_id=i.id
      where link.contact_id=c.id and link.outcome='approved'
        and i.id::text=${alias}.data->>'install_observation_id'
        and r.id::text=${alias}.data->>'runtime_observation_id'
        and i.redacted_at is null and r.redacted_at is null
        and i.source='install' and r.source='runtime' and r.kind='runtime.session_started'
        and i.properties->>'environment'<>'ci'
        and i.installation_token_digest=r.installation_token_digest
        and i.properties->>'packageName'=r.properties->>'packageName'
        and i.properties->>'packageVersion'=r.properties->>'packageVersion'
        and identity.email_normalized=c.email_normalized
        and not exists(select 1 from growth_observations removed
          where removed.source='install' and removed.installation_token_digest=i.installation_token_digest
            and removed.redacted_at is not null)
        and not exists(select 1 from growth_observations other
          join growth_observation_identities other_identity on other_identity.observation_id=other.id
          where other.source='install' and other.installation_token_digest=i.installation_token_digest
            and other_identity.email_normalized<>identity.email_normalized)
    ))`;
}

function blockedFormJob(alias: string): string {
  return `exists (select 1 from growth_activity form_assessment
    where form_assessment.kind = 'form.abuse_assessed'
      and form_assessment.contact_id = ${alias}.contact_id
      and form_assessment.event_key in (
        'form:' || (${alias}.payload->>'submission_id') || ':assessment',
        regexp_replace(${alias}.payload->>'approval_event_key', ':accepted:outreach-approved$', ':assessment')
      ) and form_assessment.data->'result'->>'deliverySuppressed' = 'true')`;
}

export async function materializeCampaignEnrollment(
  executor: SqlExecutor,
  input: MaterializeCampaignEnrollmentInput
): Promise<{ enrolledContactIds: string[]; createdJobs: number }> {
  const enrollmentStartAt = validDate(
    'enrollmentStartAt',
    input.enrollmentStartAt
  );
  const now = validDate('now', input.now);
  const batchSize = positiveInteger('batchSize', input.batchSize, 1_000);
  if (!input.enrollmentEnabled) {
    return { enrolledContactIds: [], createdJobs: 0 };
  }

  return executor.transaction(async (transaction) => {
    await privacyLock(transaction);
    await transaction.execute(
      `/* growth:lock-campaign-enrollment */
       select pg_advisory_xact_lock(
         hashtextextended('growth:campaign-enrollment:v1', 0)
       )`
    );
    await transaction.execute(
      `/* growth:insert-campaign-enrollment-config */
       insert into growth_activity (
         event_key, kind, occurred_at, data
       ) values (
         'campaign:v1:configuration',
         'campaign.configured:v1',
         $2,
         jsonb_build_object('enrollment_start_at', $1::timestamptz)
       )
       on conflict (event_key) do nothing`,
      [enrollmentStartAt, now]
    );
    const configured = await transaction.execute<{
      enrollment_start_at: Date | string | null;
    }>(
      `/* growth:read-campaign-enrollment-start */
       select data->>'enrollment_start_at' as enrollment_start_at
       from growth_activity
       where event_key = 'campaign:v1:configuration'
         and kind = 'campaign.configured:v1'`
    );
    const configuredAt = configured.rows[0]?.enrollment_start_at;
    if (
      configuredAt == null ||
      new Date(configuredAt).getTime() !== enrollmentStartAt.getTime()
    ) {
      throw new Error(
        'CAMPAIGN_ENROLLMENT_START_AT is immutable after campaign configuration'
      );
    }
    const result = await transaction.execute<{
      contact_id: string;
      created_jobs: number | string;
    }>(
      `/* growth:enroll-campaign-v1 */
       with eligible as (
         select c.id,
                approved.event_key as approval_event_key,
                approved.kind as approval_kind,
                approved.occurred_at as approval_at
         from growth_contacts c
         join lateral (
           select approval.event_key,
                  approval.kind,
                  approval.occurred_at
           from growth_activity approval
           where approval.contact_id = c.id
             and approval.occurred_at = c.outreach_approved_at
             and not exists (
               select 1 from growth_activity form_assessment
               where form_assessment.kind = 'form.abuse_assessed'
                 and form_assessment.contact_id = c.id
                 and form_assessment.event_key = regexp_replace(approval.event_key, ':accepted:outreach-approved$', ':assessment')
                 and form_assessment.data->'result'->>'deliverySuppressed' = 'true'
             )
             and (
               (
                 approval.kind = 'form.outreach_approved'
                 and approval.data->>'verification' = 'server_verified'
                 and approval.data->>'source_form' = any(
                   array['whitepaper', 'newsletter', 'contact', 'pricing']
                 )
               )
               or (
                 approval.kind = 'project.claimed'
                 and approval.data->>'claim_method' = 'one_time_secret'
                 and approval.data->>'relationship' = 'self_claimed_project'
                 and exists (
                   select 1
                   from growth_projects claimed_project
                   where claimed_project.id = approval.project_id
                     and claimed_project.contact_id = c.id
                     and claimed_project.claim_consumed_at =
                         approval.occurred_at
                     and claimed_project.claim_method = 'one_time_secret'
                 )
               )
               or (
                 approval.kind = 'contact.reauthorized'
                 and approval.data->>'provenance' = 'founder_action'
               )
               or ${installRuntimeApproval('approval')}
             )
           order by approval.event_key
           limit 1
         ) approved on true
         where c.deleted_at is null
           and c.outreach_approved_at >= $1
           and not exists (
             select 1
             from growth_activity stop
             where stop.contact_id = c.id
               and stop.kind = any($4::text[])
               and stop.occurred_at >= c.outreach_approved_at
           )
           and not exists (
             select 1
             from growth_jobs legacy
             where legacy.contact_id = c.id
               and legacy.kind = 'legacy'
           )
           and not exists (
             select 1
             from growth_activity a
             where a.event_key = 'campaign:v1:' || c.id::text || ':enrolled'
           )
         order by c.outreach_approved_at, c.id
         for update skip locked
         limit $3
       ), inserted_enrollment as (
         insert into growth_activity (
           event_key, contact_id, kind, occurred_at, data
         )
         select 'campaign:v1:' || e.id::text || ':enrolled',
                e.id,
                'campaign.enrolled:v1',
                $2,
                jsonb_build_object(
                  'campaign_version', 'v1',
                  'enrollment_reason', case when e.approval_kind='install_runtime.outreach_approved' then 'install_runtime' else null end,
                  'enrollment_start_at', $1::timestamptz,
                  'approval_event_key', e.approval_event_key,
                  'approval_kind', e.approval_kind,
                  'approval_at', e.approval_at
                )
         from eligible e
         on conflict (event_key) do nothing
         returning contact_id, data
       ), enrolled as (
         select contact_id,
                data->>'approval_event_key' as approval_event_key,
                data->>'approval_kind' as approval_kind,
                data->>'approval_at' as approval_at
         from inserted_enrollment
       ), inserted_jobs as (
         insert into growth_jobs (
           kind, contact_id, status, available_at,
           idempotency_key, payload
         )
         select 'send_step',
                e.contact_id,
                'pending',
                $5,
                'campaign:v1:' || e.contact_id::text || ':step:' || step::text,
                jsonb_build_object(
                  'campaign_version', 'v1',
                  'step', step,
                  'approval_event_key', e.approval_event_key,
                  'approval_kind', e.approval_kind,
                  'approval_at', e.approval_at
                )
         from enrolled e
         cross join generate_series(1, 3) step
         on conflict (idempotency_key) do nothing
         returning contact_id
       )
       select e.contact_id, count(j.contact_id)::integer as created_jobs
       from enrolled e
       left join inserted_jobs j on j.contact_id = e.contact_id
       group by e.contact_id
       order by e.contact_id`,
      [
        enrollmentStartAt,
        now,
        batchSize,
        CONTACT_HARD_STOP_REASONS,
        businessMorningAfter(now, 1),
      ]
    );
    return {
      enrolledContactIds: result.rows.map(({ contact_id }) => contact_id),
      createdJobs: result.rows.reduce(
        (total, { created_jobs }) => total + Number(created_jobs),
        0
      ),
    };
  });
}

export interface LeaseDueJobsInput {
  kinds: readonly string[];
  now: Date;
  batchSize: number;
  leaseDurationMs: number;
  campaignEnabled: boolean;
}

export async function leaseDueJobs(
  executor: SqlExecutor,
  input: LeaseDueJobsInput
): Promise<GrowthJob[]> {
  const kinds = [
    ...new Set(input.kinds.map((kind) => requiredText('kind', kind))),
  ];
  if (kinds.length === 0) throw new Error('at least one job kind is required');
  const now = validDate('now', input.now);
  const batchSize = positiveInteger('batchSize', input.batchSize, 100);
  if (!Number.isInteger(input.leaseDurationMs) || input.leaseDurationMs < 1) {
    throw new Error('leaseDurationMs must be a positive integer');
  }
  const leaseUntil = new Date(now.getTime() + input.leaseDurationMs);

  const result = await executor.execute<JobRow>(
    `/* growth:lease-due-jobs */
     with ambiguous_candidates as (
       select interrupted.id
       from growth_jobs interrupted
       where interrupted.kind = any($1::text[])
         and interrupted.status = 'leased'
         and interrupted.lease_until <= $2
         and interrupted.delivery_status = 'not_submitted'
         and exists (
           select 1
           from growth_activity submission_authorization
           where submission_authorization.kind =
                 'delivery.submission_authorized'
             and submission_authorization.event_key =
                 'job:' || interrupted.id::text || ':submission-authorized:' || interrupted.lease_token::text
             and submission_authorization.data->>'lease_token' = interrupted.lease_token::text
         )
       order by interrupted.lease_until, interrupted.id
       for update skip locked
       limit $3
     ), ambiguous_authorized as (
       update growth_jobs interrupted
       set status = 'failed',
           lease_token = null,
           lease_until = null,
           delivery_status = 'unknown',
           last_error_code = 'worker_interrupted_after_authorization'
       from ambiguous_candidates candidate
       where interrupted.id = candidate.id
       returning interrupted.id, interrupted.contact_id,
                 interrupted.project_id
     ), recorded_ambiguous as (
       insert into growth_activity (
         event_key, contact_id, project_id, kind, occurred_at, data
       )
       select 'job:' || interrupted.id::text || ':provider-acceptance-unknown',
              interrupted.contact_id,
              interrupted.project_id,
              'delivery.acceptance_unknown',
              $2,
              jsonb_build_object(
                'error_code', 'worker_interrupted_after_authorization',
                'manual_review', true
              )
       from ambiguous_authorized interrupted
       on conflict (event_key) do nothing
       returning event_key
     ), due as (
       select j.id
       from growth_jobs j
       where j.kind = any($1::text[])
         and not ${blockedFormJob('j')}
         and (j.kind <> 'send_step' or not exists (
           select 1 from growth_jobs unbound
           where unbound.contact_id = j.contact_id and unbound.id <> j.id
             and unbound.kind in ('fulfill', 'send_step') and unbound.status = 'completed'
             and unbound.provider_email_id is not null and unbound.rfc_message_id is null
         ))
         and ($5::boolean or j.kind <> 'send_step')
         and (
           j.kind not in ('send_step', 'reply_reconcile')
           or not exists (
             select 1
             from growth_activity recovery_required
             where recovery_required.kind = 'mailbox.recovery_required'
               and not exists (
                 select 1
                 from growth_activity recovery_completed
                 where recovery_completed.kind = 'mailbox.recovery_completed'
                   and recovery_completed.data->>'recovery_id' =
                       recovery_required.data->>'recovery_id'
               )
           )
         )
         and j.available_at <= $2
         and (
           j.status = 'pending'
           or (j.status = 'leased' and j.lease_until <= $2)
         )
         and not exists (
           select 1 from ambiguous_authorized interrupted
           where interrupted.id = j.id
         )
         and (
           j.kind <> 'notify'
           or exists (
             select 1
             from growth_jobs sibling
             where sibling.contact_id = j.contact_id
               and sibling.kind = 'enrich'
               and sibling.payload->>'submission_id' =
                   j.payload->>'submission_id'
               and sibling.status in ('completed', 'failed')
           )
         )
         and (
           j.kind <> 'send_step'
           or (
             j.payload->>'campaign_version' = 'v1'
             and extract(isodow from $2::timestamptz at time zone 'America/Los_Angeles') between 1 and 5
             and extract(hour from $2::timestamptz at time zone 'America/Los_Angeles') = 7
             and (
               (
                 j.payload->>'step' = '1'
                 and (
                   exists (
                     select 1 from growth_activity enrollment
                     where enrollment.event_key='campaign:v1:' || j.contact_id::text || ':enrolled'
                       and enrollment.contact_id=j.contact_id
                       and enrollment.data->>'enrollment_reason'='install_runtime'
                       and enrollment.data->>'approval_kind'='install_runtime.outreach_approved'
                   )
                   or
                   exists (
                     select 1
                     from growth_artifacts artifact
                     join growth_jobs enrichment
                       on enrichment.id = artifact.job_id
                     where artifact.contact_id = j.contact_id
                       and artifact.kind = 'enrichment.v1'
                       and artifact.schema_version = 1
                       and enrichment.kind = 'enrich'
                   )
                   or exists (
                     select 1
                     from growth_activity enrollment
                     where enrollment.contact_id = j.contact_id
                       and enrollment.kind = 'campaign.enrolled:v1'
                       and enrollment.occurred_at + interval '5 minutes' <= $2
                   )
                 )
               )
               or exists (
                 select 1
                 from growth_jobs prior
                 where prior.contact_id = j.contact_id
                   and prior.kind = 'send_step'
                   and prior.payload->>'campaign_version' = 'v1'
                   and prior.payload->>'step' = case j.payload->>'step'
                     when '2' then '1'
                     when '3' then '2'
                     else null
                   end
                   and prior.status = 'completed'
                   and prior.provider_email_id is not null
                   and prior.delivery_status in ('submitted', 'delivered')
               )
             )
           )
         )
       order by j.available_at, j.id
       for update skip locked
       limit $3
     )
     update growth_jobs j
     set status = 'leased',
         lease_token = gen_random_uuid(),
         lease_until = $4,
         attempts = j.attempts + 1
     from due
     where j.id = due.id
     returning j.*`,
    [kinds, now, batchSize, leaseUntil, input.campaignEnabled]
  );
  return result.rows.map(toJob);
}

export interface GrowthLifecycleJobContext {
  campaignEnrollmentReason?: 'install_runtime' | null;
  contactId: string;
  displayName: string | null;
  companyName: string | null;
  companyDomain: string | null;
  emailClassification: 'work' | 'personal' | 'unknown';
  formSubmission: Record<string, unknown>;
  enrollmentAt: Date | null;
  enrichmentArtifact: GrowthArtifact | null;
}

export async function readLifecycleJobContext(
  executor: SqlExecutor,
  input: { jobId: string }
): Promise<GrowthLifecycleJobContext> {
  const result = await executor.execute<LifecycleJobContextRow>(
    `/* growth:read-lifecycle-job-context */
     select c.id as contact_id,
            submission.form_submission->>'display_name' as display_name,
            submission.form_submission->>'company_name' as company_name,
            submission.form_submission->>'company_domain' as company_domain,
            submission.form_submission->>'email_classification'
              as email_classification,
            submission.form_submission,
            enrollment.occurred_at as enrollment_at,
            enrollment.enrollment_reason as campaign_enrollment_reason,
            artifact.id as artifact_id,
            artifact.job_id as artifact_job_id,
            artifact.project_id as artifact_project_id,
            artifact.kind as artifact_kind,
            artifact.schema_version as artifact_schema_version,
            artifact.content as artifact_content,
            artifact.created_at as artifact_created_at
     from growth_jobs target
     join growth_contacts c on c.id = target.contact_id
     left join lateral (
       select jsonb_strip_nulls(
                jsonb_build_object(
                  'form_kind', a.data->'form_kind',
                  'submission_id', a.data->'submission_id',
                  'display_name', a.data->'display_name',
                  'company_name', a.data->'company_name',
                  'company_domain', a.data->'company_domain',
                  'email_classification', a.data->'email_classification',
                  'paper', a.data->'paper',
                  'pilot_interest', a.data->'pilot_interest',
                  'team_size', a.data->'team_size',
                  'timeline', a.data->'timeline'
                )
              ) as form_submission
       from growth_activity a
       where a.contact_id = c.id
         and a.kind = 'contact.form_submission'
         and a.event_key =
             'form:' || (target.payload->>'submission_id') || ':accepted'
       limit 1
     ) submission on true
     left join lateral (
       select a.occurred_at, case when a.data->>'approval_kind'='install_runtime.outreach_approved'
         then a.data->>'enrollment_reason' else null end as enrollment_reason
       from growth_activity a
       where a.contact_id = c.id
         and a.kind = 'campaign.enrolled:v1'
       order by a.occurred_at desc, a.id desc
       limit 1
     ) enrollment on true
     left join lateral (
       select stored.*
       from growth_artifacts stored
       join growth_jobs source on source.id = stored.job_id
       where stored.contact_id = c.id
         and stored.kind in ('enrichment.v1', 'company_enrichment.v1')
         and stored.schema_version = 1
         and source.kind = 'enrich'
         and (
           target.kind = 'send_step'
           or source.payload->>'submission_id' =
              target.payload->>'submission_id'
         )
       order by stored.created_at desc, stored.id desc
       limit 1
     ) artifact on true
     where target.id = $1`,
    [input.jobId]
  );
  const row = result.rows[0];
  if (!row)
    throw new Error(`Growth lifecycle job context not found: ${input.jobId}`);
  const emailClassification =
    row.email_classification === 'work' ||
    row.email_classification === 'personal' ||
    row.email_classification === 'unknown'
      ? row.email_classification
      : 'unknown';
  const enrichmentArtifact =
    row.artifact_id &&
    row.artifact_job_id &&
    row.artifact_kind &&
    row.artifact_schema_version !== null &&
    row.artifact_content &&
    row.artifact_created_at
      ? {
          id: row.artifact_id,
          jobId: row.artifact_job_id,
          contactId: row.contact_id,
          projectId: row.artifact_project_id,
          kind: row.artifact_kind,
          schemaVersion: row.artifact_schema_version,
          content: row.artifact_content,
          createdAt: new Date(row.artifact_created_at),
        }
      : null;
  return {
    contactId: row.contact_id,
    campaignEnrollmentReason:
      row.campaign_enrollment_reason === 'install_runtime'
        ? 'install_runtime'
        : null,
    displayName: row.display_name,
    companyName: row.company_name,
    companyDomain: row.company_domain,
    emailClassification,
    formSubmission: row.form_submission ?? {},
    enrollmentAt: row.enrollment_at ? new Date(row.enrollment_at) : null,
    enrichmentArtifact,
  };
}

export async function authorizeLeasedJobForSubmission(
  executor: SqlExecutor,
  input: {
    jobId: string;
    leaseToken: string;
    now: Date;
    campaignEnabled: boolean;
    deliveryEnabled: boolean;
    currentTime?: () => Date;
  }
): Promise<FinalSendAuthorization> {
  const jobId = requiredText('jobId', input.jobId);
  const leaseToken = requiredText('leaseToken', input.leaseToken);
  let now = validDate('now', input.now);
  if (typeof input.campaignEnabled !== 'boolean') {
    throw new Error('campaignEnabled must be a boolean');
  }
  if (typeof input.deliveryEnabled !== 'boolean') {
    throw new Error('deliveryEnabled must be a boolean');
  }

  return executor.transaction(async (transaction) => {
    await privacyLock(transaction);
    await transaction.execute(
      `/* growth:acquire-google-reconcile-advisory-lock */
       select pg_advisory_xact_lock(hashtextextended('google-mailbox-reconciliation', 0))`
    );
    const contactResult = await transaction.execute<SendContactRow>(
      `/* growth:lock-contact-for-send */
       select c.id,
              c.email_normalized,
              c.outreach_approved_at,
              c.deleted_at,
              ${blockedFormJob('target')} as form_abuse_blocked,
              exists (
                select 1 from growth_jobs unbound
                where unbound.contact_id = c.id and unbound.id <> target.id
                  and unbound.kind in ('fulfill', 'send_step') and unbound.status = 'completed'
                  and unbound.provider_email_id is not null and unbound.rfc_message_id is null
              ) as reply_binding_pending,
              stop.kind as latest_hard_stop_kind,
              stop.occurred_at as latest_hard_stop_at,
              exists (
                select 1
                from growth_activity recovery_required
                where recovery_required.kind = 'mailbox.recovery_required'
                  and not exists (
                    select 1
                    from growth_activity recovery_completed
                    where recovery_completed.kind = 'mailbox.recovery_completed'
                      and recovery_completed.data->>'recovery_id' =
                          recovery_required.data->>'recovery_id'
                  )
              ) as mailbox_recovery_required,
              exists (
                select 1
                from growth_activity fatal_stop
                where fatal_stop.contact_id = c.id
                  and fatal_stop.kind = any($3::text[])
                  and (
                    c.outreach_approved_at is null
                    or fatal_stop.occurred_at >= c.outreach_approved_at
                  )
              ) as fulfillment_delivery_blocked,
              exists (
                select 1
                from growth_activity deletion_stop
                where deletion_stop.contact_id = c.id
                  and deletion_stop.kind = 'deletion'
              ) as fulfillment_deletion_blocked,
              approval.event_key is not null as campaign_approval_valid,
              enrollment.event_key is not null as campaign_enrollment_valid
       from growth_contacts c
       join growth_jobs target on target.contact_id = c.id
       left join lateral (
         select authoritative.event_key,
                authoritative.kind,
                authoritative.occurred_at
         from growth_activity authoritative
         where authoritative.contact_id = c.id
           and authoritative.event_key =
               target.payload->>'approval_event_key'
           and authoritative.kind = target.payload->>'approval_kind'
           and authoritative.occurred_at = c.outreach_approved_at
           and (
             (
               authoritative.kind = 'form.outreach_approved'
               and authoritative.data->>'verification' = 'server_verified'
               and authoritative.data->>'source_form' = any(
                 array['whitepaper', 'newsletter', 'contact', 'pricing']
               )
             )
             or (
               authoritative.kind = 'project.claimed'
               and authoritative.data->>'claim_method' = 'one_time_secret'
               and authoritative.data->>'relationship' = 'self_claimed_project'
               and exists (
                 select 1
                 from growth_projects claimed_project
                 where claimed_project.id = authoritative.project_id
                   and claimed_project.contact_id = c.id
                   and claimed_project.claim_consumed_at =
                       authoritative.occurred_at
                   and claimed_project.claim_method = 'one_time_secret'
               )
             )
             or (
               authoritative.kind = 'contact.reauthorized'
               and authoritative.data->>'provenance' = 'founder_action'
             )
             or ${installRuntimeApproval('authoritative')}
           )
         limit 1
       ) approval on true
       left join lateral (
         select enrolled.event_key
         from growth_activity enrolled
         where enrolled.event_key =
               'campaign:v1:' || c.id::text || ':enrolled'
           and enrolled.contact_id = c.id
           and enrolled.kind = 'campaign.enrolled:v1'
           and enrolled.data->>'campaign_version' =
               target.payload->>'campaign_version'
           and enrolled.data->>'approval_event_key' = approval.event_key
           and enrolled.data->>'approval_kind' = approval.kind
           and enrolled.data->>'approval_at' = target.payload->>'approval_at'
           and target.payload->>'approval_event_key' = approval.event_key
           and target.payload->>'approval_kind' = approval.kind
         limit 1
       ) enrollment on true
       left join lateral (
         select a.kind, a.occurred_at
         from growth_activity a
         where a.contact_id = c.id
           and a.kind = any($2::text[])
         order by a.occurred_at desc, a.id desc
         limit 1
       ) stop on true
       where target.id = $1
       for update of c`,
      [jobId, CONTACT_HARD_STOP_REASONS, FULFILLMENT_EPOCH_FATAL_STOP_REASONS]
    );
    const contact = contactResult.rows[0];
    if (!contact) throw new JobLeaseConflictError(jobId);

    const jobResult = await transaction.execute<JobRow>(
      `/* growth:lock-job-for-send */
       select j.*
       from growth_jobs j
       where j.id = $1
       for update of j`,
      [jobId]
    );
    const row = jobResult.rows[0];
    if (!row) throw new JobLeaseConflictError(jobId);
    const job = toJob(row);

    if (!input.deliveryEnabled) {
      return { authorized: false, reason: 'delivery_disabled', job };
    }
    if (job.kind === 'send_step' && !input.campaignEnabled) {
      return { authorized: false, reason: 'campaign_disabled', job };
    }

    if (contact.deleted_at !== null) {
      return { authorized: false, reason: 'contact_deleted', job };
    }
    if (contact.form_abuse_blocked === true) {
      return { authorized: false, reason: 'contact_stopped', job };
    }
    if (job.kind === 'send_step' && contact.reply_binding_pending === true) {
      return { authorized: false, reason: 'reply_binding_pending', job };
    }
    if (
      job.kind === 'fulfill' &&
      (contact.fulfillment_delivery_blocked === true ||
        contact.fulfillment_deletion_blocked === true)
    ) {
      return {
        authorized: false,
        reason:
          contact.fulfillment_deletion_blocked === true
            ? 'contact_deleted'
            : 'contact_stopped',
        job,
      };
    }
    if (contact.mailbox_recovery_required === true) {
      return {
        authorized: false,
        reason: 'mailbox_recovery_required',
        job,
      };
    }
    const requiresOutreachApproval = job.kind !== 'fulfill';
    if (requiresOutreachApproval) {
      const approvedAt = contact.outreach_approved_at
        ? new Date(contact.outreach_approved_at)
        : null;
      if (!approvedAt) {
        return {
          authorized: false,
          reason: contact.latest_hard_stop_kind
            ? 'contact_stopped'
            : 'contact_unapproved',
          job,
        };
      }
      const stoppedAt = contact.latest_hard_stop_at
        ? new Date(contact.latest_hard_stop_at)
        : null;
      if (stoppedAt && stoppedAt.getTime() >= approvedAt.getTime()) {
        return { authorized: false, reason: 'contact_stopped', job };
      }
      if (
        job.kind === 'send_step' &&
        (contact.campaign_approval_valid !== true ||
          contact.campaign_enrollment_valid !== true)
      ) {
        return { authorized: false, reason: 'contact_unapproved', job };
      }
    }
    if (
      job.contactId !== contact.id ||
      job.status !== 'leased' ||
      job.leaseToken !== leaseToken ||
      job.leaseUntil === null ||
      job.leaseUntil.getTime() <= now.getTime() ||
      job.deliveryStatus !== 'not_submitted'
    ) {
      throw new JobLeaseConflictError(jobId);
    }
    if (typeof contact.email_normalized !== 'string') {
      throw new JobLeaseConflictError(jobId);
    }
    if (requiresOutreachApproval) {
      const recoveryPause = await transaction.execute<{ paused: boolean }>(
        `/* growth:read-google-mailbox-recovery-pause */
       select exists (
         select 1
         from growth_activity required
         where required.kind = 'mailbox.recovery_required'
           and not exists (
             select 1
             from growth_activity completed
             where completed.kind = 'mailbox.recovery_completed'
               and completed.data->>'recovery_id' =
                   required.data->>'recovery_id'
           )
       ) as paused`
      );
      if (recoveryPause.rows[0]?.paused === true) {
        return {
          authorized: false,
          reason: 'mailbox_recovery_required',
          job,
        };
      }
    }
    let emailNormalized: string;
    try {
      emailNormalized = normalizeEmail(contact.email_normalized);
    } catch {
      throw new JobLeaseConflictError(jobId);
    }
    if (emailNormalized !== contact.email_normalized) {
      throw new JobLeaseConflictError(jobId);
    }

    // Lock waits must not carry a pre-window-boundary timestamp into a send.
    now = validDate('now', input.currentTime?.() ?? now);
    if (job.leaseUntil === null || job.leaseUntil.getTime() <= now.getTime())
      throw new JobLeaseConflictError(jobId);
    if (job.kind === 'send_step' && !isCampaignSendWindow(now)) {
      return { authorized: false, reason: 'outside_send_window', job };
    }

    const inserted = await transaction.execute<{ event_key: string }>(
      `/* growth:insert-final-send-authorization */
       insert into growth_activity (
         event_key, contact_id, project_id, kind, occurred_at, data
       ) values (
         'job:' || $1::text || ':submission-authorized:' || $4::text,
         $2,
         $3,
         'delivery.submission_authorized',
         $5,
         jsonb_build_object(
           'lease_token', $4::text,
           'bounded_stop_race', true
         )
       )
       on conflict (event_key) do nothing
       returning event_key`,
      [job.id, job.contactId, job.projectId, leaseToken, now]
    );
    if (inserted.rows.length === 0) {
      await readAndValidateFinalSendAuthorization(transaction, {
        job,
        leaseToken,
        exactOccurredAt: now,
      });
    }
    return {
      authorized: true,
      job,
      recipient: { contactId: contact.id, emailNormalized },
      boundedRaceNotice: 'a_future_stop_can_overlap_provider_submission',
    };
  });
}

async function readAndValidateFinalSendAuthorization(
  transaction: SqlTransaction,
  input: {
    job: GrowthJob;
    leaseToken: string;
    exactOccurredAt?: Date;
    mustOccurBy?: Date;
  }
): Promise<FinalSendAuthorizationRow> {
  const eventKey = `job:${input.job.id}:submission-authorized:${input.leaseToken}`;
  const result = await transaction.execute<FinalSendAuthorizationRow>(
    `/* growth:read-final-send-authorization */
     select event_key, contact_id, project_id, kind, occurred_at, data
     from growth_activity
     where event_key = $1`,
    [eventKey]
  );
  const row = result.rows[0];
  const occurredAt = row ? new Date(row.occurred_at) : null;
  const expectedData = {
    bounded_stop_race: true,
    lease_token: input.leaseToken,
  };
  const validOccurredAt =
    occurredAt !== null &&
    !Number.isNaN(occurredAt.getTime()) &&
    (input.exactOccurredAt === undefined ||
      occurredAt.getTime() === input.exactOccurredAt.getTime()) &&
    (input.mustOccurBy === undefined ||
      occurredAt.getTime() <= input.mustOccurBy.getTime());
  if (
    !row ||
    row.event_key !== eventKey ||
    row.contact_id !== input.job.contactId ||
    row.project_id !== input.job.projectId ||
    row.kind !== 'delivery.submission_authorized' ||
    !validOccurredAt ||
    canonicalJson(row.data) !== canonicalJson(expectedData)
  ) {
    throw new FinalSendAuthorizationConflictError(eventKey, input.job.id);
  }
  return row;
}

export async function renewJobLease(
  executor: SqlExecutor,
  input: {
    jobId: string;
    leaseToken: string;
    now: Date;
    leaseDurationMs: number;
  }
): Promise<GrowthJob | null> {
  const now = validDate('now', input.now);
  if (!Number.isInteger(input.leaseDurationMs) || input.leaseDurationMs < 1) {
    throw new Error('leaseDurationMs must be a positive integer');
  }
  const leaseUntil = new Date(now.getTime() + input.leaseDurationMs);
  const result = await executor.execute<JobRow>(
    `/* growth:renew-job-lease */
     update growth_jobs
     set lease_until = greatest(lease_until, $4)
     where id = $1
       and lease_token = $2::uuid
       and status = 'leased'
       and lease_until > $3
     returning *`,
    [input.jobId, input.leaseToken, now, leaseUntil]
  );
  return result.rows[0] ? toJob(result.rows[0]) : null;
}

export async function claimInternalNotificationSubmission(
  executor: SqlExecutor,
  input: {
    jobId: string;
    leaseToken: string;
    now: Date;
    kind?: 'notify' | 'digest';
  }
): Promise<boolean> {
  const jobId = requiredText('jobId', input.jobId);
  const leaseToken = requiredText('leaseToken', input.leaseToken);
  const now = validDate('now', input.now);
  const kind = input.kind ?? 'notify';
  const result = await executor.execute<{ event_key: string }>(
    `/* growth:claim-internal-notification-submission */
     insert into growth_activity (
       event_key, contact_id, project_id, kind, occurred_at, data
     )
     select 'job:' || j.id::text || ':internal-notification-submission',
            j.contact_id,
            j.project_id,
            'internal_notification.submission_started',
            $3,
            jsonb_build_object('at_most_once', true)
     from growth_jobs j
     where j.id = $1
       and j.kind = $4
       and j.status = 'leased'
       and j.lease_token = $2::uuid
       and j.lease_until > $3
       and not ${blockedFormJob('j')}
     on conflict (event_key) do nothing
     returning event_key`,
    [jobId, leaseToken, now, kind]
  );
  return result.rows.length === 1;
}

export async function markInternalNotificationUnknown(
  executor: SqlExecutor,
  input: {
    jobId: string;
    leaseToken: string;
    occurredAt: Date;
    errorCode: string;
    kind?: 'notify' | 'digest';
  }
): Promise<GrowthJob> {
  const jobId = requiredText('jobId', input.jobId);
  const leaseToken = requiredText('leaseToken', input.leaseToken);
  const occurredAt = validDate('occurredAt', input.occurredAt);
  const errorCode = requiredText('errorCode', input.errorCode);
  const kind = input.kind ?? 'notify';
  return executor.transaction(async (transaction) => {
    const result = await transaction.execute<JobRow>(
      `/* growth:mark-internal-notification-unknown */
       update growth_jobs
       set status = 'failed',
           lease_token = null,
           lease_until = null,
           delivery_status = 'unknown',
           last_error_code = $4
       where id = $1
         and kind = $5
         and lease_token = $2::uuid
         and status = 'leased'
         and lease_until > $3
         and delivery_status = 'not_submitted'
       returning *`,
      [jobId, leaseToken, occurredAt, errorCode, kind]
    );
    const row = result.rows[0];
    if (!row) throw new JobLeaseConflictError(jobId);
    const job = toJob(row);
    await transaction.execute(
      `/* growth:insert-internal-notification-unknown */
       insert into growth_activity (
         event_key, contact_id, project_id, kind, occurred_at, data
       ) values (
         'job:' || $1::text || ':internal-notification-acceptance-unknown',
         $2, $3, 'internal_notification.acceptance_unknown', $4,
         jsonb_build_object('error_code', $5::text, 'manual_review', true)
       )
       on conflict (event_key) do nothing`,
      [job.id, job.contactId, job.projectId, occurredAt, errorCode]
    );
    return job;
  });
}

async function transitionLeasedJob(
  executor: SqlExecutor,
  marker: string,
  status: 'completed' | 'failed' | 'cancelled',
  input: {
    jobId: string;
    leaseToken: string;
    now: Date;
    errorCode?: string;
  }
): Promise<GrowthJob> {
  const now = validDate('now', input.now);
  const result = await executor.execute<JobRow>(
    `/* growth:${marker} */
     update growth_jobs
     set status = '${status}',
         lease_token = null,
         lease_until = null,
         last_error_code = $4
     where id = $1
       and lease_token = $2::uuid
       and status = 'leased'
       and lease_until > $3
       ${status === 'completed' ? "and kind <> 'send_step'" : ''}
     returning *`,
    [input.jobId, input.leaseToken, now, input.errorCode ?? null]
  );
  const row = result.rows[0];
  if (!row) throw new JobLeaseConflictError(input.jobId);
  return toJob(row);
}

export function completeLeasedJob(
  executor: SqlExecutor,
  input: {
    jobId: string;
    leaseToken: string;
    now: Date;
    errorCode?: string;
  }
): Promise<GrowthJob> {
  return transitionLeasedJob(
    executor,
    'completed-leased-job',
    'completed',
    input
  );
}

export function failLeasedJob(
  executor: SqlExecutor,
  input: {
    jobId: string;
    leaseToken: string;
    now: Date;
    errorCode?: string;
  }
): Promise<GrowthJob> {
  return transitionLeasedJob(executor, 'failed-leased-job', 'failed', input);
}

export function cancelLeasedJob(
  executor: SqlExecutor,
  input: {
    jobId: string;
    leaseToken: string;
    now: Date;
    errorCode?: string;
  }
): Promise<GrowthJob> {
  return transitionLeasedJob(
    executor,
    'cancelled-leased-job',
    'cancelled',
    input
  );
}

export async function deferLeasedJob(
  executor: SqlExecutor,
  input: {
    jobId: string;
    leaseToken: string;
    now: Date;
    availableAt: Date;
    errorCode?: string;
  }
): Promise<GrowthJob> {
  const now = validDate('now', input.now);
  const availableAt = validDate('availableAt', input.availableAt);
  if (availableAt.getTime() < now.getTime()) {
    throw new Error('availableAt must not be earlier than now');
  }
  const result = await executor.execute<JobRow>(
    `/* growth:defer-leased-job */
     update growth_jobs
     set status = 'pending',
         available_at = $4,
         lease_token = null,
         lease_until = null,
         last_error_code = $5
     where id = $1
       and lease_token = $2::uuid
       and status = 'leased'
       and lease_until > $3
     returning *`,
    [input.jobId, input.leaseToken, now, availableAt, input.errorCode ?? null]
  );
  const row = result.rows[0];
  if (!row) throw new JobLeaseConflictError(input.jobId);
  return toJob(row);
}

export async function markProviderRejection(
  executor: SqlExecutor,
  input: {
    jobId: string;
    leaseToken: string;
    occurredAt: Date;
    errorCode: string;
  }
): Promise<GrowthJob> {
  const occurredAt = validDate('occurredAt', input.occurredAt);
  const errorCode = requiredText('errorCode', input.errorCode);
  return executor.transaction(async (transaction) => {
    const result = await transaction.execute<JobRow>(
      `/* growth:mark-provider-rejected */
       update growth_jobs
       set status = 'failed',
           lease_token = null,
           lease_until = null,
           delivery_status = 'failed',
           last_error_code = $4
       where id = $1
         and lease_token = $2::uuid
         and status = 'leased'
         and lease_until > $3
         and delivery_status = 'not_submitted'
       returning *`,
      [input.jobId, input.leaseToken, occurredAt, errorCode]
    );
    const row = result.rows[0];
    if (!row) throw new JobLeaseConflictError(input.jobId);
    const job = toJob(row);
    await transaction.execute(
      `/* growth:insert-provider-rejected-activity */
       insert into growth_activity (
         event_key, contact_id, project_id, kind, occurred_at, data
       ) values (
         'job:' || $1::text || ':provider-rejected',
         $2, $3, 'delivery.provider_rejected', $4,
         jsonb_build_object('error_code', $5::text)
       )
       on conflict (event_key) do nothing`,
      [job.id, job.contactId, job.projectId, occurredAt, errorCode]
    );
    return job;
  });
}

function campaignStep(job: GrowthJob): number | null {
  if (job.kind !== 'send_step' || job.payload['campaign_version'] !== 'v1') {
    return null;
  }
  const step = job.payload['step'];
  return step === 1 || step === 2 || step === 3 ? step : null;
}

const REPLAYABLE_ACCEPTANCE_DELIVERY_STATUSES: readonly GrowthJob['deliveryStatus'][] =
  ['submitted', 'delivered', 'bounced', 'complained', 'suppressed', 'failed'];

export async function recordProviderAcceptance(
  executor: SqlExecutor,
  input: {
    jobId: string;
    leaseToken: string;
    acceptedAt: Date;
    providerEmailId: string;
  }
): Promise<GrowthJob> {
  const acceptedAt = validDate('acceptedAt', input.acceptedAt);
  const providerEmailId = opaqueIdentifier(
    'providerEmailId',
    input.providerEmailId,
    256
  );
  return executor.transaction(async (transaction) => {
    const discovered =
      await transaction.execute<ProviderAcceptanceContactReference>(
        `/* growth:discover-provider-acceptance-contact */
         select contact_id
         from growth_jobs
         where id = $1`,
        [input.jobId]
      );
    const contactReference = discovered.rows[0];
    if (!contactReference) throw new JobLeaseConflictError(input.jobId);

    const lockedContact = await transaction.execute<{ id: string }>(
      `/* growth:lock-provider-acceptance-contact */
       select id
       from growth_contacts
       where id = $1
       for update`,
      [contactReference.contact_id]
    );
    if (contactReference.contact_id !== null && !lockedContact.rows[0]) {
      throw new JobLeaseConflictError(input.jobId);
    }

    const lockedJob = await transaction.execute<JobRow>(
      `/* growth:lock-provider-acceptance-job */
       select j.*
       from growth_jobs j
       where j.id = $1
       for update of j`,
      [input.jobId]
    );
    const lockedRow = lockedJob.rows[0];
    if (!lockedRow || lockedRow.contact_id !== contactReference.contact_id) {
      throw new JobLeaseConflictError(input.jobId);
    }
    let job = toJob(lockedRow);
    if (job.contactId === null) {
      throw new Error(
        'Provider acceptance requires an authorized contact recipient'
      );
    }
    await readAndValidateFinalSendAuthorization(transaction, {
      job,
      leaseToken: input.leaseToken,
      mustOccurBy: acceptedAt,
    });

    if (
      job.status === 'completed' &&
      job.providerEmailId === providerEmailId &&
      REPLAYABLE_ACCEPTANCE_DELIVERY_STATUSES.includes(job.deliveryStatus)
    ) {
      await readAndValidateProviderAcceptanceActivity(transaction, {
        job,
        leaseToken: input.leaseToken,
        acceptedAt,
        providerEmailId,
      });
      return job;
    }

    let newlyAccepted = false;
    let resolvedDeletionUnknown = false;
    if (
      job.status === 'leased' &&
      job.leaseToken === input.leaseToken &&
      job.leaseUntil !== null &&
      job.leaseUntil.getTime() > acceptedAt.getTime() &&
      job.deliveryStatus === 'not_submitted'
    ) {
      const accepted = await transaction.execute<JobRow>(
        `/* growth:accept-provider-submission */
         update growth_jobs current
         set status = 'completed',
             lease_token = null,
             lease_until = null,
             provider_email_id = $4,
             delivery_status = $5,
             last_error_code = null
         where current.id = $1
           and current.lease_token = $2::uuid
           and current.status = 'leased'
           and current.lease_until > $3
           and current.delivery_status = 'not_submitted'
           and (
             current.kind <> 'send_step'
             or current.payload->>'step' = '1'
             or exists (
               select 1
               from growth_jobs prior
               where prior.contact_id = current.contact_id
                 and prior.kind = 'send_step'
                 and prior.payload->>'campaign_version' =
                   current.payload->>'campaign_version'
                 and prior.payload->>'step' = case current.payload->>'step'
                   when '2' then '1'
                   when '3' then '2'
                   else null
                 end
                 and prior.status = 'completed'
                 and prior.provider_email_id is not null
                 and prior.delivery_status in ('submitted', 'delivered')
             )
           )
         returning current.*`,
        [
          input.jobId,
          input.leaseToken,
          acceptedAt,
          providerEmailId,
          'submitted',
        ]
      );
      const acceptedRow = accepted.rows[0];
      if (!acceptedRow) throw new JobLeaseConflictError(input.jobId);
      job = toJob(acceptedRow);
      newlyAccepted = true;
    } else if (
      job.status === 'cancelled' &&
      job.deliveryStatus === 'not_submitted' &&
      job.providerEmailId === null
    ) {
      const reconciled = await transaction.execute<JobRow>(
        `/* growth:reconcile-stopped-provider-submission */
         update growth_jobs current
         set status = 'completed',
             lease_token = null,
             lease_until = null,
             provider_email_id = $4,
             delivery_status = $5,
             last_error_code = null
         where current.id = $1
           and current.status = 'cancelled'
           and current.delivery_status = 'not_submitted'
           and current.provider_email_id is null
           and exists (
             select 1
             from growth_activity submission_authorization
             where submission_authorization.contact_id = current.contact_id
               and submission_authorization.project_id is not distinct from current.project_id
               and submission_authorization.kind = 'delivery.submission_authorized'
               and submission_authorization.event_key =
                 'job:' || current.id::text ||
                 ':submission-authorized:' || $2::text
               and submission_authorization.data->>'lease_token' = $2::text
               and submission_authorization.data->>'bounded_stop_race' = 'true'
               and submission_authorization.occurred_at <= $3
           )
         returning current.*`,
        [
          input.jobId,
          input.leaseToken,
          acceptedAt,
          providerEmailId,
          'submitted',
        ]
      );
      if (reconciled.rows[0]) {
        job = toJob(reconciled.rows[0]);
        newlyAccepted = true;
      }
    } else if (
      job.status === 'failed' &&
      job.deliveryStatus === 'unknown' &&
      job.lastErrorCode === 'provider_acceptance_interrupted_by_deletion' &&
      job.providerEmailId === null &&
      job.leaseToken === null &&
      job.leaseUntil === null
    ) {
      const reconciled = await transaction.execute<JobRow>(
        `/* growth:reconcile-deletion-interrupted-provider-submission */
         update growth_jobs current
         set status = 'completed',
             provider_email_id = $4,
             delivery_status = $5,
             last_error_code = null
         where current.id = $1
           and current.status = 'failed'
           and current.delivery_status = 'unknown'
           and current.last_error_code =
               'provider_acceptance_interrupted_by_deletion'
           and current.provider_email_id is null
           and current.lease_token is null
           and current.lease_until is null
           and exists (
             select 1
             from growth_activity submission_authorization
             where submission_authorization.contact_id = current.contact_id
               and submission_authorization.project_id is not distinct from current.project_id
               and submission_authorization.kind = 'delivery.submission_authorized'
               and submission_authorization.event_key =
                 'job:' || current.id::text ||
                 ':submission-authorized:' || $2::text
               and submission_authorization.data->>'lease_token' = $2::text
               and submission_authorization.data->>'bounded_stop_race' = 'true'
               and submission_authorization.occurred_at <= $3
           )
           and exists (
             select 1
             from growth_activity provisional
             where provisional.contact_id = current.contact_id
               and provisional.project_id is not distinct from current.project_id
               and provisional.kind = 'delivery.acceptance_unknown'
               and provisional.event_key =
                 'job:' || current.id::text ||
                 ':provider-acceptance-unknown'
               and provisional.data->>'reason' =
                   'authorized_worker_interrupted_by_deletion'
               and provisional.data->>'delivery_status' = 'unknown'
               and provisional.data->>'manual_review' = 'true'
           )
           and exists (
             select 1
             from growth_activity deletion
             where deletion.contact_id = current.contact_id
               and deletion.kind = 'deletion'
           )
         returning current.*`,
        [
          input.jobId,
          input.leaseToken,
          acceptedAt,
          providerEmailId,
          'submitted',
        ]
      );
      if (reconciled.rows[0]) {
        job = toJob(reconciled.rows[0]);
        newlyAccepted = true;
        resolvedDeletionUnknown = true;
      }
    } else {
      throw new JobLeaseConflictError(input.jobId);
    }
    if (!newlyAccepted) throw new JobLeaseConflictError(input.jobId);

    const step = campaignStep(job);
    const insertedAcceptance = await transaction.execute<{ event_key: string }>(
      `/* growth:insert-provider-acceptance-activity */
       insert into growth_activity (
         event_key, contact_id, project_id, kind, occurred_at, data
       ) values (
         'job:' || $1::text || ':provider-accepted',
         $2,
         $3,
         $4,
         $5,
         jsonb_build_object(
           'provider_ref', $6::text,
           'step', $7::integer,
           'lease_token', $8::text
         )
       )
       on conflict (event_key) do nothing
       returning event_key`,
      [
        job.id,
        job.contactId,
        job.projectId,
        step === null ? 'delivery.submitted' : 'campaign.step_accepted',
        acceptedAt,
        providerEmailId,
        step,
        input.leaseToken,
      ]
    );
    if (insertedAcceptance.rows.length === 0) {
      await readAndValidateProviderAcceptanceActivity(transaction, {
        job,
        leaseToken: input.leaseToken,
        acceptedAt,
        providerEmailId,
      });
    }

    if (resolvedDeletionUnknown) {
      const resolution = await transaction.execute<{ event_key: string }>(
        `/* growth:insert-provider-unknown-resolution */
         insert into growth_activity (
           event_key, contact_id, project_id, kind, occurred_at, data
         ) values (
           'job:' || $1::text || ':provider-acceptance-unknown-resolved',
           $2,
           $3,
           'delivery.acceptance_unknown_resolved',
           $4,
           jsonb_build_object(
             'resolution', 'known_provider_acceptance',
             'supersedes_event_key',
               'job:' || $1::text || ':provider-acceptance-unknown'
           )
         )
         returning event_key`,
        [job.id, job.contactId, job.projectId, acceptedAt]
      );
      if (resolution.rows.length !== 1) {
        throw new Error(
          `Growth provider unknown resolution was not recorded: ${job.id}`
        );
      }
    }

    if (step !== null && job.contactId) {
      await transaction.execute(
        `/* growth:anchor-campaign-cadence */
         update growth_jobs later
         set available_at = greatest(
           later.available_at,
           case
             when $2::integer = 1 and later.payload->>'step' = '2'
               then $3::timestamptz
             when $2::integer = 1 and later.payload->>'step' = '3'
               then $4::timestamptz
             when $2::integer = 2 and later.payload->>'step' = '3'
               then $3::timestamptz
             else later.available_at
           end
         )
         where later.contact_id = $1
           and later.kind = 'send_step'
           and later.payload->>'campaign_version' = 'v1'
           and later.status = 'pending'
           and (
             ($2::integer = 1 and later.payload->>'step' in ('2', '3'))
             or ($2::integer = 2 and later.payload->>'step' = '3')
           )`,
        [
          job.contactId,
          step,
          businessMorningAfter(acceptedAt, step === 1 ? 3 : 5),
          businessMorningAfter(acceptedAt, 8),
        ]
      );
    }

    return job;
  });
}

async function readAndValidateProviderAcceptanceActivity(
  transaction: SqlTransaction,
  input: {
    job: GrowthJob;
    leaseToken: string;
    acceptedAt: Date;
    providerEmailId: string;
  }
): Promise<ProviderAcceptanceActivityRow> {
  const eventKey = `job:${input.job.id}:provider-accepted`;
  const result = await transaction.execute<ProviderAcceptanceActivityRow>(
    `/* growth:read-provider-acceptance-activity */
     select event_key, contact_id, project_id, kind, occurred_at, data
     from growth_activity
     where event_key = $1`,
    [eventKey]
  );
  const row = result.rows[0];
  const step = campaignStep(input.job);
  const expectedKind =
    step === null ? 'delivery.submitted' : 'campaign.step_accepted';
  const expectedData = {
    lease_token: input.leaseToken,
    provider_ref: input.providerEmailId,
    step,
  };
  const occurredAt = row ? new Date(row.occurred_at) : null;
  if (
    !row ||
    row.event_key !== eventKey ||
    row.contact_id !== input.job.contactId ||
    row.project_id !== input.job.projectId ||
    row.kind !== expectedKind ||
    occurredAt?.getTime() !== input.acceptedAt.getTime() ||
    canonicalJson(row.data) !== canonicalJson(expectedData)
  ) {
    throw new Error(
      `Growth provider acceptance event key conflict: ${eventKey}`
    );
  }
  return row;
}

export async function markProviderAcceptanceUnknown(
  executor: SqlExecutor,
  input: {
    jobId: string;
    leaseToken: string;
    occurredAt: Date;
    errorCode: string;
  }
): Promise<GrowthJob> {
  const occurredAt = validDate('occurredAt', input.occurredAt);
  const errorCode = requiredText('errorCode', input.errorCode);
  return executor.transaction(async (transaction) => {
    const discovered =
      await transaction.execute<ProviderAcceptanceContactReference>(
        `/* growth:discover-provider-unknown-contact */
         select contact_id
         from growth_jobs
         where id = $1`,
        [input.jobId]
      );
    const contactReference = discovered.rows[0];
    if (!contactReference) throw new JobLeaseConflictError(input.jobId);

    const lockedContact = await transaction.execute<{ id: string }>(
      `/* growth:lock-provider-unknown-contact */
       select id
       from growth_contacts
       where id = $1
       for update`,
      [contactReference.contact_id]
    );
    if (contactReference.contact_id !== null && !lockedContact.rows[0]) {
      throw new JobLeaseConflictError(input.jobId);
    }

    const lockedJob = await transaction.execute<JobRow>(
      `/* growth:lock-provider-unknown-job */
       select j.*
       from growth_jobs j
       where j.id = $1
       for update of j`,
      [input.jobId]
    );
    const lockedRow = lockedJob.rows[0];
    if (!lockedRow || lockedRow.contact_id !== contactReference.contact_id) {
      throw new JobLeaseConflictError(input.jobId);
    }
    const locked = toJob(lockedRow);
    if (locked.contactId === null) {
      throw new Error(
        'Provider acceptance requires an authorized contact recipient'
      );
    }
    await readAndValidateFinalSendAuthorization(transaction, {
      job: locked,
      leaseToken: input.leaseToken,
      mustOccurBy: occurredAt,
    });

    let row: JobRow | undefined;
    if (locked.status === 'leased') {
      const result = await transaction.execute<JobRow>(
        `/* growth:mark-provider-unknown */
       update growth_jobs current
       set status = 'failed',
           lease_token = null,
           lease_until = null,
           delivery_status = 'unknown',
           last_error_code = $4
       where current.id = $1
         and current.lease_token = $2::uuid
         and current.status = 'leased'
         and current.lease_until > $3
         and current.delivery_status = 'not_submitted'
         and (
           current.kind <> 'send_step'
           or current.payload->>'step' = '1'
           or exists (
             select 1
             from growth_jobs prior
             where prior.contact_id = current.contact_id
               and prior.kind = 'send_step'
               and prior.payload->>'campaign_version' =
                 current.payload->>'campaign_version'
               and prior.payload->>'step' = case current.payload->>'step'
                 when '2' then '1'
                 when '3' then '2'
                 else null
               end
               and prior.status = 'completed'
               and prior.provider_email_id is not null
               and prior.delivery_status in ('submitted', 'delivered')
           )
         )
       returning current.*`,
        [input.jobId, input.leaseToken, occurredAt, errorCode]
      );
      row = result.rows[0];
    } else if (
      locked.status === 'cancelled' &&
      locked.deliveryStatus === 'not_submitted' &&
      locked.providerEmailId === null
    ) {
      const reconciled = await transaction.execute<JobRow>(
        `/* growth:reconcile-stopped-provider-unknown */
         update growth_jobs current
         set status = 'failed',
             lease_token = null,
             lease_until = null,
             delivery_status = 'unknown',
             last_error_code = $4
         where current.id = $1
           and current.status = 'cancelled'
           and current.delivery_status = 'not_submitted'
           and current.provider_email_id is null
           and exists (
             select 1
             from growth_activity submission_authorization
             where submission_authorization.contact_id = current.contact_id
               and submission_authorization.project_id is not distinct from current.project_id
               and submission_authorization.kind = 'delivery.submission_authorized'
               and submission_authorization.event_key =
                 'job:' || current.id::text ||
                 ':submission-authorized:' || $2::text
               and submission_authorization.data->>'lease_token' = $2::text
               and submission_authorization.data->>'bounded_stop_race' = 'true'
               and submission_authorization.occurred_at <= $3
           )
         returning current.*`,
        [input.jobId, input.leaseToken, occurredAt, errorCode]
      );
      row = reconciled.rows[0];
    }
    if (!row) throw new JobLeaseConflictError(input.jobId);
    const job = toJob(row);
    await transaction.execute(
      `/* growth:insert-provider-unknown-activity */
       insert into growth_activity (
         event_key, contact_id, project_id, kind, occurred_at, data
       ) values (
         'job:' || $1::text || ':provider-acceptance-unknown',
         $2, $3, 'delivery.acceptance_unknown', $4,
         jsonb_build_object('error_code', $5::text, 'manual_review', true)
       )
       on conflict (event_key) do nothing`,
      [job.id, job.contactId, job.projectId, occurredAt, errorCode]
    );
    return job;
  });
}

function canonicalJson(value: unknown): string {
  function normalize(candidate: unknown): unknown {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate !== null && typeof candidate === 'object') {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, normalize(item)])
      );
    }
    return candidate;
  }
  return JSON.stringify(normalize(value));
}

export async function persistJobArtifact(
  executor: SqlExecutor,
  input: {
    jobId: string;
    leaseToken?: string;
    now?: Date;
    kind: string;
    schemaVersion: number;
    content: Record<string, unknown>;
  }
): Promise<GrowthArtifact> {
  const kind = requiredText('kind', input.kind);
  if (kind === 'company_enrichment.v1') {
    throw new Error('Company research requires publishResearchArtifact');
  }
  const schemaVersion = positiveInteger(
    'schemaVersion',
    input.schemaVersion,
    2_147_483_647
  );
  if (
    input.content === null ||
    Array.isArray(input.content) ||
    typeof input.content !== 'object'
  ) {
    throw new Error('content must be a structured JSON object');
  }
  const leaseBound = input.leaseToken !== undefined || input.now !== undefined;
  if (
    leaseBound &&
    (input.leaseToken === undefined || input.now === undefined)
  ) {
    throw new Error('leaseToken and now are required together');
  }
  const leaseToken = input.leaseToken
    ? requiredText('leaseToken', input.leaseToken)
    : undefined;
  const now = input.now ? validDate('now', input.now) : undefined;
  const leasePredicate = leaseBound
    ? `and j.kind = 'enrich'
       and j.status = 'leased'
       and j.lease_token = $5::uuid
       and j.lease_until > $6`
    : '';
  const parameters = [
    input.jobId,
    kind,
    schemaVersion,
    JSON.stringify(input.content),
    ...(leaseBound ? [leaseToken, now] : []),
  ];

  return executor.transaction(async (transaction) => {
    // Exclude ingest too: it can admit conflicting evidence after authorization.
    // This short transaction takes privacy before contact/job locks and has no provider calls.
    await privacyLock(transaction, true);
    const installJob = await transaction.execute<{ contact_id: string | null }>(
      `/* growth:discover-install-runtime-artifact-job */
       select contact_id from growth_jobs where id=$1
         and (payload->>'source'='install_runtime' or idempotency_key like 'install-runtime:v1:%')`,
      [input.jobId]
    );
    if (installJob.rows.length) {
      if (!leaseBound || !installJob.rows[0].contact_id)
        throw new JobLeaseConflictError(input.jobId);
      await transaction.execute(
        `/* growth:lock-install-runtime-artifact-contact */
         select id from growth_contacts where id=$1 for update`,
        [installJob.rows[0].contact_id]
      );
      const authorized = await transaction.execute<{ id: string }>(
        `/* growth:authorize-install-runtime-artifact */
         select j.id from growth_jobs j join growth_contacts c on c.id=j.contact_id
         where j.id=$1 and j.contact_id=$4 and j.kind='enrich'
           and j.payload->>'source'='install_runtime'
           and j.payload->>'evidence_redacted' is distinct from 'true'
           and j.status='leased' and j.lease_token=$2::uuid and j.lease_until>$3
           and c.deleted_at is null and c.outreach_approved_at is not null
           and not exists(select 1 from growth_activity stop where stop.contact_id=c.id
             and stop.kind=any($5::text[]) and stop.occurred_at>=c.outreach_approved_at)
           and ${installRuntimeEvidenceSql(
             "j.payload->>'install_observation_id'",
             "j.payload->>'runtime_observation_id'"
           )}
         for update of j`,
        [
          input.jobId,
          leaseToken,
          now,
          installJob.rows[0].contact_id,
          CONTACT_HARD_STOP_REASONS,
        ]
      );
      if (!authorized.rows.length) throw new JobLeaseConflictError(input.jobId);
    }
    await transaction.execute<ArtifactRow>(
      `/* growth:insert-job-artifact */
       insert into growth_artifacts (
         job_id, contact_id, project_id, kind, schema_version, content
       )
       select j.id, j.contact_id, j.project_id, $2, $3, $4::jsonb
       from growth_jobs j
       where j.id = $1
         ${leasePredicate}
       on conflict (job_id) do nothing
       returning *`,
      parameters
    );
    const result = await transaction.execute<ArtifactRow>(
      `/* growth:read-job-artifact */
       select * from growth_artifacts where job_id = $1`,
      [input.jobId]
    );
    const row = result.rows[0];
    if (!row)
      throw new Error(`Growth artifact was not persisted: ${input.jobId}`);
    if (
      row.kind !== kind ||
      row.schema_version !== schemaVersion ||
      canonicalJson(row.content) !== canonicalJson(input.content)
    ) {
      throw new Error(
        `Growth job already has a different artifact: ${input.jobId}`
      );
    }
    return toArtifact(row);
  });
}
