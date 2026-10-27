import {
  completeProviderAttempt,
  providerIdempotencyKey,
  reserveProviderAttempt,
} from './provider-attempts.ts';
import type { SqlExecutor } from './database.ts';
import type { ErrorResponse } from 'resend';
import { isCampaignSendWindow } from './campaign-schedule.ts';
import {
  authorizeLeasedJobForSubmission,
  markProviderAcceptanceUnknown,
  markProviderRejection,
  recordProviderAcceptance,
} from './jobs.ts';
import {
  unsubscribeActionUrlValueForContact,
  unsubscribeActionUrlValue,
  type UnsubscribeActionUrl,
} from './tokens.ts';
import { normalizeRecipientEmail } from './crypto.ts';
import {
  bindProviderMessageId,
  ProviderMessageIdBindingError,
} from './replies.ts';

export const RECIPIENT_EMAIL_SENDER =
  'Brian at Threadplane <brian@threadplane.ai>';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OPAQUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const RECIPIENT_JOB_KINDS = new Set(['fulfill', 'send_step']);
const AMBIGUOUS_PROVIDER_ERROR_NAMES = new Set([
  'concurrent_idempotent_requests',
  'invalid_idempotent_request',
]);
const AMBIGUOUS_PROVIDER_STATUSES = new Set([408, 409, 425, 429]);

export function classifyResendProviderError(
  error: Pick<ErrorResponse, 'name' | 'statusCode'>
): 'rejected' | 'unknown' {
  return error.statusCode === null ||
    error.statusCode >= 500 ||
    AMBIGUOUS_PROVIDER_STATUSES.has(error.statusCode) ||
    AMBIGUOUS_PROVIDER_ERROR_NAMES.has(error.name)
    ? 'unknown'
    : 'rejected';
}

export type DeliveryEnvironment = 'production' | 'preview' | 'test';

export interface RecipientDeliveryPolicy {
  campaignEnabled: boolean;
  deliveryEnabled: boolean;
  environment: DeliveryEnvironment;
  databaseEnvironment: DeliveryEnvironment;
  senderVerified: boolean;
  verifiedDomain: string;
  configuredSender: string;
  providerTrackingDisabled: boolean;
  nonProductionRecipientAllowlist: readonly string[];
  nonProductionRedirectTo?: string;
}

/**
 * The closed set of campaign template ids a send_step may be attributed to.
 * Provider tags are the only per-template signal webhooks and reply handling
 * can see, so every value here is a fixed identifier and never contact data.
 */
export const CAMPAIGN_TEMPLATE_IDS = [
  'immediate',
  'day-3',
  'day-8',
  'streaming_foundation',
  'debugging_layers',
  'event_state_boundary',
] as const;
export type CampaignTemplateId = (typeof CAMPAIGN_TEMPLATE_IDS)[number];
const CAMPAIGN_TEMPLATE_ID_SET: ReadonlySet<string> = new Set(
  CAMPAIGN_TEMPLATE_IDS
);

export function isCampaignTemplateId(
  value: unknown
): value is CampaignTemplateId {
  return typeof value === 'string' && CAMPAIGN_TEMPLATE_ID_SET.has(value);
}

/**
 * Every file recipient mail may carry. Resend fetches the bytes from `path`
 * itself, so the closed registry is the only thing standing between a caller
 * and an arbitrary outbound fetch made under the Threadplane sender. Keep it
 * to deployed threadplane.ai deliverables.
 */
export const APPROVED_ATTACHMENT_PATHS = [
  'https://threadplane.ai/whitepaper.pdf',
  'https://threadplane.ai/whitepapers/angular.pdf',
  'https://threadplane.ai/whitepapers/render.pdf',
  'https://threadplane.ai/whitepapers/chat.pdf',
] as const;
const APPROVED_ATTACHMENT_PATH_SET: ReadonlySet<string> = new Set(
  APPROVED_ATTACHMENT_PATHS
);
const ATTACHMENT_FILENAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.pdf$/u;
const ATTACHMENT_JOB_KINDS = new Set(['fulfill']);

export interface RecipientAttachment {
  filename: string;
  path: string;
}

export interface RecipientEmailInput {
  jobId: string;
  leaseToken: string;
  subject: string;
  text: string;
  /**
   * Files to attach. Only `fulfill` jobs may carry one, at most one, and only
   * from the approved path registry above.
   */
  attachments?: readonly RecipientAttachment[];
  /**
   * Which campaign template rendered this message. Required for send_step
   * jobs and forbidden otherwise; it is emitted as the bounded
   * `campaign_template` provider tag.
   */
  campaignTemplate?: CampaignTemplateId;
  /**
   * Optional HTML alternative for the same message. It must stay a plain
   * rendering of the text part: paragraphs and HTTPS anchors only, no images,
   * scripts, styles, forms, or event handlers, and it must carry the same
   * unsubscribe link as the text part.
   */
  html?: string;
  unsubscribeUrl: UnsubscribeActionUrl;
  signal?: AbortSignal;
}

type ResendResponse =
  | { data: { id: string }; error: null }
  | { data: null; error: ErrorResponse };

export interface RecipientEmailProviderPayload {
  from: typeof RECIPIENT_EMAIL_SENDER;
  to: string;
  replyTo: typeof RECIPIENT_EMAIL_SENDER;
  subject: string;
  text: string;
  html?: string;
  attachments?: RecipientAttachment[];
  headers: {
    'List-Unsubscribe': string;
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click';
    'X-Threadplane-Job-ID': string;
  };
  tags: { name: string; value: string }[];
}

export interface RecipientResendClient {
  emails: {
    send(
      payload: RecipientEmailProviderPayload,
      options: { idempotencyKey: string; signal?: AbortSignal }
    ): Promise<ResendResponse>;
  };
}

export interface RecipientSendDependencies {
  reserveProviderAttempt?: typeof reserveProviderAttempt;
  completeProviderAttempt?: typeof completeProviderAttempt;
  now: () => Date;
  resend: RecipientResendClient;
  authorizeLeasedJobForSubmission: typeof authorizeLeasedJobForSubmission;
  recordProviderAcceptance: typeof recordProviderAcceptance;
  markProviderAcceptanceUnknown: typeof markProviderAcceptanceUnknown;
  markProviderRejection: typeof markProviderRejection;
}

export type RecipientSendResult =
  | { accepted: true; providerEmailId: string }
  | {
      accepted: false;
      reason:
        | 'contact_deleted'
        | 'contact_stopped'
        | 'contact_unapproved'
        | 'campaign_disabled'
        | 'delivery_disabled'
        | 'outside_send_window'
        | 'mailbox_recovery_required'
        | 'reply_binding_pending'
        | 'provider_rejected'
        | 'provider_outcome_unknown';
    };

const HTML_MAXIMUM = 40_000;
const FORBIDDEN_HTML_ELEMENT_PATTERN =
  /<(?:img|picture|source|script|style|link|iframe|frame|object|embed|svg|video|audio|form|input|button|select|textarea|meta|base|template|math)\b/iu;
const HTML_EVENT_HANDLER_PATTERN = /\son[a-z]+\s*=/iu;
const HTML_RESOURCE_ATTRIBUTE_PATTERN =
  /\s(?:src|srcset|style|background|poster|ping|formaction|action|data)\s*=/iu;
const HTML_TAG_PATTERN = /<\/?([a-z][a-z0-9]*)\b[^>]*>/giu;
const ALLOWED_HTML_ELEMENTS = new Set(['p', 'br', 'a']);
const HTML_ANCHOR_PATTERN = /<a\b([^>]*)>/giu;
const HTML_HREF_PATTERN = /\bhref\s*=\s*"([^"]*)"/iu;

function optionalPlainHtml(
  field: string,
  value: string | undefined,
  unsubscribeUrl: string
): string | undefined {
  if (value === undefined) return undefined;
  const html = requiredBoundedText(field, value, HTML_MAXIMUM, true);
  if (
    FORBIDDEN_HTML_ELEMENT_PATTERN.test(html) ||
    HTML_EVENT_HANDLER_PATTERN.test(html) ||
    HTML_RESOURCE_ATTRIBUTE_PATTERN.test(html) ||
    /<!--|<!doctype|<\?/iu.test(html)
  ) {
    throw new Error(`${field} must be plain paragraphs and links only`);
  }
  for (const match of html.matchAll(HTML_TAG_PATTERN)) {
    if (!ALLOWED_HTML_ELEMENTS.has((match[1] ?? '').toLowerCase())) {
      throw new Error(`${field} must be plain paragraphs and links only`);
    }
  }
  let unsubscribeAnchors = 0;
  for (const match of html.matchAll(HTML_ANCHOR_PATTERN)) {
    const href = HTML_HREF_PATTERN.exec(match[1] ?? '')?.[1];
    if (typeof href !== 'string' || !href.startsWith('https://')) {
      throw new Error(`${field} anchors must use HTTPS hrefs`);
    }
    if (href === unsubscribeUrl) unsubscribeAnchors += 1;
  }
  if (unsubscribeAnchors !== 1) {
    throw new Error(`${field} must link the unsubscribe URL exactly once`);
  }
  return html;
}

function requiredBoundedText(
  field: string,
  value: string,
  maximum: number,
  allowNewlines = false
): string {
  if (typeof value !== 'string') throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    (!allowNewlines && /[\r\n]/u.test(normalized)) ||
    /\0/u.test(normalized)
  ) {
    throw new Error(
      `${field} must contain between 1 and ${maximum} safe characters`
    );
  }
  return normalized;
}

function validEmail(field: string, value: string): string {
  try {
    return normalizeRecipientEmail(value);
  } catch {
    throw new Error(`${field} must be a valid email address`);
  }
}

function validUuid(field: string, value: string): string {
  const normalized = requiredBoundedText(field, value, 36).toLowerCase();
  if (!UUID_V4_PATTERN.test(normalized)) {
    throw new Error(`${field} must be a UUID v4`);
  }
  return normalized;
}

function opaqueIdentifier(
  field: string,
  value: string,
  maximum: number
): string {
  const normalized = requiredBoundedText(field, value, maximum);
  if (!OPAQUE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} must be an opaque identifier`);
  }
  return normalized;
}

export function assertRecipientDeliveryPolicy(
  policy: RecipientDeliveryPolicy
): void {
  if (typeof policy.campaignEnabled !== 'boolean') {
    throw new Error('campaignEnabled must be a boolean');
  }
  if (typeof policy.deliveryEnabled !== 'boolean') {
    throw new Error('deliveryEnabled must be a boolean');
  }
  if (
    !['production', 'preview', 'test'].includes(policy.environment) ||
    !['production', 'preview', 'test'].includes(policy.databaseEnvironment)
  ) {
    throw new Error('A registered delivery environment is required');
  }
  if (
    !policy.senderVerified ||
    policy.verifiedDomain !== 'threadplane.ai' ||
    policy.configuredSender !== RECIPIENT_EMAIL_SENDER ||
    !policy.providerTrackingDisabled
  ) {
    throw new Error(
      'Exact verified Threadplane sender configuration is required'
    );
  }
  if (policy.databaseEnvironment !== policy.environment) {
    throw new Error('Delivery environment must match the database environment');
  }
  if (policy.environment === 'production') return;
  if (policy.nonProductionRecipientAllowlist.length === 0) {
    throw new Error('A non-production recipient allowlist is required');
  }
  const allowlist = new Set(
    policy.nonProductionRecipientAllowlist.map((email) =>
      validEmail('nonProductionRecipientAllowlist', email)
    )
  );
  if (policy.nonProductionRedirectTo !== undefined) {
    const redirect = validEmail(
      'nonProductionRedirectTo',
      policy.nonProductionRedirectTo
    );
    if (!allowlist.has(redirect)) {
      throw new Error('Non-production recipient is not allowlisted');
    }
  }
}

function effectiveRecipient(
  recipient: string,
  policy: RecipientDeliveryPolicy
): string {
  if (policy.environment === 'production') return recipient;
  const allowlist = new Set(
    policy.nonProductionRecipientAllowlist.map((email) =>
      validEmail('nonProductionRecipientAllowlist', email)
    )
  );
  const redirected = policy.nonProductionRedirectTo
    ? validEmail('nonProductionRedirectTo', policy.nonProductionRedirectTo)
    : recipient;
  if (!allowlist.has(redirected)) {
    throw new Error('Non-production recipient is not allowlisted');
  }
  return redirected;
}

function campaignTags(
  environment: DeliveryEnvironment,
  kind: string,
  payload: Record<string, unknown>,
  campaignTemplate: unknown
): { name: string; value: string }[] {
  const tags = [
    { name: 'app', value: 'threadplane' },
    { name: 'environment', value: environment },
    { name: 'job_kind', value: kind },
  ];
  if (kind !== 'send_step') {
    if (campaignTemplate !== undefined) {
      throw new Error('Only send_step carries a campaign template');
    }
    return tags;
  }
  const campaignVersion = payload['campaign_version'];
  const step = payload['step'];
  if (campaignVersion !== 'v1' || (step !== 1 && step !== 2 && step !== 3)) {
    throw new Error(
      'send_step requires a registered campaign version and step'
    );
  }
  if (!isCampaignTemplateId(campaignTemplate)) {
    throw new Error('send_step requires a registered campaign template');
  }
  tags.push(
    { name: 'campaign_version', value: campaignVersion },
    { name: 'campaign_step', value: String(step) },
    { name: 'campaign_template', value: campaignTemplate }
  );
  return tags;
}

/**
 * Resolve the attachments a leased job is allowed to submit. Like
 * `campaignTags`, this runs after authorization because the rule depends on
 * the authorized `job.kind`, and it throws rather than dropping a bad value
 * so a mis-wired caller fails the job instead of silently sending nothing.
 */
function recipientAttachments(
  kind: string,
  attachments: readonly RecipientAttachment[] | undefined
): RecipientAttachment[] | undefined {
  if (attachments === undefined) return undefined;
  if (!ATTACHMENT_JOB_KINDS.has(kind)) {
    throw new Error('Only fulfill mail carries an attachment');
  }
  if (!Array.isArray(attachments) || attachments.length !== 1) {
    throw new Error('Recipient mail carries exactly one attachment');
  }
  return attachments.map((attachment) => {
    const filename = requiredBoundedText(
      'attachment.filename',
      attachment.filename,
      100
    );
    if (!ATTACHMENT_FILENAME_PATTERN.test(filename)) {
      throw new Error('attachment.filename must be a lowercase PDF name');
    }
    const path = requiredBoundedText('attachment.path', attachment.path, 200);
    if (!APPROVED_ATTACHMENT_PATH_SET.has(path)) {
      throw new Error('attachment.path must be an approved deliverable');
    }
    return { filename, path };
  });
}

export async function sendRecipientEmail(
  executor: SqlExecutor,
  input: RecipientEmailInput,
  policy: RecipientDeliveryPolicy,
  dependencies: RecipientSendDependencies
): Promise<RecipientSendResult> {
  input.signal?.throwIfAborted();
  assertRecipientDeliveryPolicy(policy);
  const jobId = validUuid('jobId', input.jobId);
  const leaseToken = validUuid('leaseToken', input.leaseToken);
  const subject = requiredBoundedText('subject', input.subject, 200);
  const text = requiredBoundedText('text', input.text, 20_000, true);
  const html = optionalPlainHtml(
    'html',
    input.html,
    unsubscribeActionUrlValue(input.unsubscribeUrl)
  );
  const authorizedAt = dependencies.now();
  if (Number.isNaN(authorizedAt.getTime()))
    throw new Error('now must be valid');

  const authorization = await dependencies.authorizeLeasedJobForSubmission(
    executor,
    {
      campaignEnabled: policy.campaignEnabled,
      deliveryEnabled: policy.deliveryEnabled,
      jobId,
      leaseToken,
      now: authorizedAt,
      currentTime: dependencies.now,
    }
  );
  if (!authorization.authorized) {
    return { accepted: false, reason: authorization.reason };
  }
  input.signal?.throwIfAborted();
  const job = authorization.job;
  if (job.id !== jobId || job.leaseToken !== leaseToken) {
    throw new Error('Final send authorization returned a different job lease');
  }
  if (
    authorization.recipient.contactId !== job.contactId ||
    typeof authorization.recipient.emailNormalized !== 'string'
  ) {
    throw new Error('Final send authorization returned a different recipient');
  }
  const recipient = validEmail(
    'authorized recipient',
    authorization.recipient.emailNormalized
  );
  if (recipient !== authorization.recipient.emailNormalized) {
    throw new Error(
      'Final send authorization returned a noncanonical recipient'
    );
  }
  const unsubscribeUrl = unsubscribeActionUrlValueForContact(
    input.unsubscribeUrl,
    authorization.recipient.contactId
  );
  const to = effectiveRecipient(recipient, policy);
  if (!RECIPIENT_JOB_KINDS.has(job.kind)) {
    throw new Error(`Unsupported recipient job kind: ${job.kind}`);
  }
  const idempotencyKey = providerIdempotencyKey(
    policy.environment,
    opaqueIdentifier('job.idempotencyKey', job.idempotencyKey, 256)
  );
  const tags = campaignTags(
    policy.environment,
    job.kind,
    job.payload,
    input.campaignTemplate
  );
  const attachments = recipientAttachments(job.kind, input.attachments);

  input.signal?.throwIfAborted();
  let response: ResendResponse;
  if (job.kind === 'send_step' && !isCampaignSendWindow(dependencies.now())) {
    return { accepted: false, reason: 'outside_send_window' };
  }
  const payload: RecipientEmailProviderPayload = {
    from: RECIPIENT_EMAIL_SENDER,
    to,
    replyTo: RECIPIENT_EMAIL_SENDER,
    subject,
    text,
    ...(html === undefined ? {} : { html }),
    ...(attachments === undefined ? {} : { attachments }),
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'X-Threadplane-Job-ID': jobId,
    },
    tags,
  };
  try {
    const existingId = await (
      dependencies.reserveProviderAttempt ?? reserveProviderAttempt
    )(executor, idempotencyKey, payload, dependencies.now());
    input.signal?.throwIfAborted();
    if (
      existingId === null &&
      job.kind === 'send_step' &&
      !isCampaignSendWindow(dependencies.now())
    ) {
      return { accepted: false, reason: 'outside_send_window' };
    }
    response = existingId
      ? { data: { id: existingId }, error: null }
      : await dependencies.resend.emails.send(payload, {
          idempotencyKey,
          ...(input.signal ? { signal: input.signal } : {}),
        });
  } catch {
    const occurredAt = dependencies.now();
    await dependencies.markProviderAcceptanceUnknown(executor, {
      jobId,
      leaseToken,
      occurredAt: Number.isNaN(occurredAt.getTime())
        ? authorizedAt
        : occurredAt,
      errorCode: 'resend_submission_outcome_unknown',
    });
    return { accepted: false, reason: 'provider_outcome_unknown' };
  }

  if (response.error !== null) {
    if (classifyResendProviderError(response.error) === 'unknown') {
      const occurredAt = dependencies.now();
      await dependencies.markProviderAcceptanceUnknown(executor, {
        jobId,
        leaseToken,
        occurredAt: Number.isNaN(occurredAt.getTime())
          ? authorizedAt
          : occurredAt,
        errorCode: 'resend_submission_outcome_unknown',
      });
      return { accepted: false, reason: 'provider_outcome_unknown' };
    }
    const occurredAt = dependencies.now();
    const providerErrorName = /^[a-z0-9_]{1,80}$/u.test(response.error.name)
      ? response.error.name
      : 'provider_rejected';
    await dependencies.markProviderRejection(executor, {
      errorCode: `resend_${providerErrorName}`,
      jobId,
      leaseToken,
      occurredAt: Number.isNaN(occurredAt.getTime())
        ? authorizedAt
        : occurredAt,
    });
    return { accepted: false, reason: 'provider_rejected' };
  }
  let providerEmailId: string;
  try {
    providerEmailId = opaqueIdentifier(
      'providerEmailId',
      response.data.id,
      256
    );
  } catch {
    const occurredAt = dependencies.now();
    await dependencies.markProviderAcceptanceUnknown(executor, {
      jobId,
      leaseToken,
      occurredAt: Number.isNaN(occurredAt.getTime())
        ? authorizedAt
        : occurredAt,
      errorCode: 'resend_submission_outcome_unknown',
    });
    return { accepted: false, reason: 'provider_outcome_unknown' };
  }
  const acceptedAt = dependencies.now();
  if (Number.isNaN(acceptedAt.getTime())) {
    await dependencies.markProviderAcceptanceUnknown(executor, {
      jobId,
      leaseToken,
      occurredAt: authorizedAt,
      errorCode: 'resend_submission_outcome_unknown',
    });
    return { accepted: false, reason: 'provider_outcome_unknown' };
  }
  await (dependencies.completeProviderAttempt ?? completeProviderAttempt)(
    executor,
    idempotencyKey,
    providerEmailId
  );
  await dependencies.recordProviderAcceptance(executor, {
    jobId,
    leaseToken,
    acceptedAt,
    providerEmailId,
  });
  return { accepted: true, providerEmailId };
}

export interface ResendMessageIdLookupDependencies {
  apiKey: string;
  environment: DeliveryEnvironment;
  databaseEnvironment: DeliveryEnvironment;
  fetch: typeof globalThis.fetch;
  bindProviderMessageId: typeof bindProviderMessageId;
}

function defaultMessageIdLookupDependencies(): ResendMessageIdLookupDependencies | null {
  if (
    !process.env['RESEND_API_KEY']?.trim() ||
    !process.env['DELIVERY_ENVIRONMENT']?.trim() ||
    !process.env['GROWTH_DATABASE_ENVIRONMENT']?.trim()
  )
    return null;
  return {
    apiKey: process.env['RESEND_API_KEY'] ?? '',
    environment: process.env['DELIVERY_ENVIRONMENT'] as DeliveryEnvironment,
    databaseEnvironment: process.env[
      'GROWTH_DATABASE_ENVIRONMENT'
    ] as DeliveryEnvironment,
    fetch: globalThis.fetch,
    bindProviderMessageId,
  };
}

async function boundedProviderResponse(
  response: Response
): Promise<Record<string, unknown>> {
  if (!response.ok || !response.body)
    throw new Error('Provider lookup unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 131_072) throw new Error('Provider lookup exceeds limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid provider lookup');
  return value as Record<string, unknown>;
}

/** Accepted sends themselves are the durable retry queue; this path can only GET. */
export async function reconcilePendingResendMessageIds(
  executor: SqlExecutor,
  input: { now: Date; signal: AbortSignal },
  dependencies: ResendMessageIdLookupDependencies | null = defaultMessageIdLookupDependencies()
): Promise<{ attempted: number; bound: number }> {
  input.signal.throwIfAborted();
  // Non-mail dispatcher work remains available without delivery configuration.
  // The final contact-specific send gate still requires every prior binding.
  if (!dependencies) return { attempted: 0, bound: 0 };
  if (
    !['production', 'preview', 'test'].includes(dependencies.environment) ||
    dependencies.environment !== dependencies.databaseEnvironment ||
    !dependencies.apiKey.trim() ||
    Number.isNaN(input.now.getTime())
  ) {
    throw new Error(
      'Provider lookup requires matching environments and credentials'
    );
  }
  // Reserve retries atomically before network I/O, including process crashes.
  // A missing ID never reopens a completed send or changes its idempotency key.
  const claimed = await executor.execute<{ provider_email_id: string }>(
    `/* growth:claim-provider-message-lookups */
     with due as (
       select job.id from growth_jobs job
       join growth_contacts contact on contact.id = job.contact_id
       where job.kind in ('fulfill', 'send_step') and job.status = 'completed'
         and job.provider_email_id is not null and job.rfc_message_id is null
         and contact.deleted_at is null
         and coalesce((job.payload->>'message_id_lookup_after')::timestamptz, job.updated_at) <= $1
       order by coalesce((job.payload->>'message_id_lookup_after')::timestamptz, job.updated_at), job.id
       limit 5 for update of job skip locked
     )
     update growth_jobs job set payload = job.payload || jsonb_build_object(
       'message_id_lookup_attempts', least(16, coalesce((job.payload->>'message_id_lookup_attempts')::int, 0) + 1),
       'message_id_lookup_after', $1::timestamptz + make_interval(mins => least(60, power(2,
         least(6, coalesce((job.payload->>'message_id_lookup_attempts')::int, 0) + 1))::int))
     ) from due where job.id = due.id returning job.provider_email_id`,
    [input.now]
  );
  let bound = 0;
  for (const row of claimed.rows) {
    input.signal.throwIfAborted();
    let binding: { providerEmailId: string; rfcMessageId: string };
    try {
      const providerEmailId = opaqueIdentifier(
        'providerEmailId',
        row.provider_email_id,
        256
      );
      const response = await dependencies.fetch(
        `https://api.resend.com/emails/${encodeURIComponent(providerEmailId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${dependencies.apiKey}` },
          redirect: 'error',
          signal: AbortSignal.any([input.signal, AbortSignal.timeout(5_000)]),
        }
      );
      const data = await boundedProviderResponse(response);
      const tags = data['tags'];
      const environment = Array.isArray(tags)
        ? tags
            .filter((tag) => tag && tag.name === 'environment')
            .map((tag) => tag.value)
        : tags && typeof tags === 'object'
        ? [(tags as Record<string, unknown>)['environment']]
        : [];
      if (
        data['id'] !== providerEmailId ||
        environment.length !== 1 ||
        environment[0] !== dependencies.environment ||
        typeof data['message_id'] !== 'string'
      )
        continue;
      binding = { providerEmailId, rfcMessageId: data['message_id'] };
    } catch {
      input.signal.throwIfAborted();
      // The durable next-at reservation survives provider errors and timeouts.
      continue;
    }
    try {
      if (
        (await dependencies.bindProviderMessageId(executor, binding)) ===
        'bound'
      )
        bound += 1;
    } catch (error) {
      input.signal.throwIfAborted();
      if (!(error instanceof ProviderMessageIdBindingError)) throw error;
      // Malformed/conflicting identities remain unbound; database errors surface.
    }
  }
  return { attempted: claimed.rows.length, bound };
}
