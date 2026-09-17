import {
  authorizeLeasedJobForSubmission,
  assertRecipientDeliveryPolicy,
  cancelLeasedJob,
  classifyResendProviderError,
  claimInternalNotificationSubmission,
  completeLeasedJob,
  createGrowthActionToken,
  createUnsubscribeActionUrl,
  deferLeasedJob,
  failLeasedJob,
  loadGrowthTokenKeyring,
  markProviderAcceptanceUnknown,
  markInstallDigestReported,
  markInternalNotificationUnknown,
  markProviderRejection,
  normalizeGrowthPublicActionOrigin,
  normalizeRecipientEmail,
  parseEmailHmacKeyring,
  readInstallDigestCandidates,
  readInstallDigestContext,
  readLifecycleJobContext,
  recordProviderAcceptance,
  RECIPIENT_EMAIL_SENDER,
  sendRecipientEmail,
  unsubscribeActionUrlValue,
  type DeliveryEnvironment,
  type GrowthArtifact,
  type GrowthDispatchResult,
  type GrowthJob,
  type GrowthTokenKey,
  type InstallDigestCandidate,
  type InstallDigestContext,
  type RecipientDeliveryPolicy,
  type RecipientAttachment,
  type RecipientEmailInput,
  type RecipientSendResult,
  type SqlExecutor,
  type CampaignTemplateId,
  type UnsubscribeActionUrl,
} from '../growth.js';
import { Resend } from 'resend';

import {
  createDawnJobHandlers,
  type DawnJobDependencies,
} from '../enrichment/dawn-jobs.js';
import {
  EnrichmentArtifactSchema,
  type EnrichmentArtifact,
} from '../enrichment/schema.js';
import { renderFulfillmentTemplate } from '../fulfillment/templates.js';
import { renderInstallDigest } from '../notifications/install-digest.js';
import { renderInternalNotificationSummary } from '../notifications/templates.js';
import { DeterministicLifecycleJobError } from '../job-errors.js';
export { LIFECYCLE_SCORE_CONTENT_REGISTRY_V1 } from '../score-policy.js';
import {
  renderCampaignTemplate,
  renderEvidenceCampaignTemplate,
  type CampaignDraft,
  type CampaignStep,
} from './templates.js';

const STEP_NAMES: Record<1 | 2 | 3, CampaignStep> = {
  1: 'immediate',
  2: 'day-3',
  3: 'day-8',
};
const RETRY_DELAY_MS = 60_000;

export interface LifecycleJobContext {
  contactId: string;
  displayName: string | null;
  companyName: string | null;
  companyDomain: string | null;
  emailClassification: 'work' | 'personal' | 'unknown';
  formSubmission: Record<string, unknown>;
  enrollmentAt: Date | null;
  campaignEnrollmentReason?: 'install_runtime' | null;
  enrichmentArtifact: GrowthArtifact | null;
}

interface LeasedTransitionInput {
  jobId: string;
  leaseToken: string;
  now: Date;
  errorCode?: string;
}

interface DeferLeasedJobInput extends LeasedTransitionInput {
  availableAt: Date;
}

type EmailHmacKeyring = ReturnType<typeof parseEmailHmacKeyring>;
type InternalNotificationKind = 'notify' | 'digest';

export interface LifecycleJobDependencies {
  now: () => Date;
  readJobContext: (
    executor: SqlExecutor,
    input: { jobId: string }
  ) => Promise<LifecycleJobContext>;
  createUnsubscribeUrl: (
    input: { contactId: string; issuedAt: Date; eventNonce?: string },
    key: GrowthTokenKey
  ) => UnsubscribeActionUrl;
  sendRecipient: (
    executor: SqlExecutor,
    input: RecipientEmailInput,
    policy: RecipientDeliveryPolicy
  ) => Promise<RecipientSendResult>;
  deferJob: (
    executor: SqlExecutor,
    input: DeferLeasedJobInput
  ) => Promise<GrowthJob>;
  completeJob: (
    executor: SqlExecutor,
    input: LeasedTransitionInput
  ) => Promise<GrowthJob>;
  cancelJob: (
    executor: SqlExecutor,
    input: LeasedTransitionInput
  ) => Promise<GrowthJob>;
  claimInternalNotification: (
    executor: SqlExecutor,
    input: {
      jobId: string;
      leaseToken: string;
      now: Date;
      kind?: InternalNotificationKind;
    }
  ) => Promise<boolean>;
  markInternalNotificationUnknown: (
    executor: SqlExecutor,
    input: {
      jobId: string;
      leaseToken: string;
      occurredAt: Date;
      errorCode: string;
      kind?: InternalNotificationKind;
    }
  ) => Promise<GrowthJob>;
  failJob: (
    executor: SqlExecutor,
    input: LeasedTransitionInput
  ) => Promise<GrowthJob>;
  sendInternalNotification: (input: {
    to: string;
    subject: string;
    text: string;
    idempotencyKey: string;
    kind?: InternalNotificationKind;
  }) => Promise<{ outcome: 'accepted' | 'rejected' | 'unknown' }>;
  readInstallDigestCandidates: (
    executor: SqlExecutor,
    input: { limit: number; keyring?: EmailHmacKeyring }
  ) => Promise<InstallDigestCandidate[]>;
  readInstallDigestContext: (
    executor: SqlExecutor,
    input: { since: Date }
  ) => Promise<InstallDigestContext>;
  markInstallDigestReported: (
    executor: SqlExecutor,
    input: {
      digestJobId: string;
      reportedAt: Date;
      candidates: readonly InstallDigestCandidate[];
    }
  ) => Promise<void>;
  readonly publicActionOrigin: string;
  founderNotificationEmail: string;
  recipientPolicy: RecipientDeliveryPolicy;
  tokenKey: GrowthTokenKey;
}

export interface LifecycleRuntimeConfiguration {
  campaignEnrollmentEnabled: boolean;
  installRuntimeHelloEnabled: boolean;
  installDigestEnabled: boolean;
  campaignEnrollmentStartAt?: Date;
  campaignEnabled: boolean;
  deliveryEnabled: boolean;
  environment?: DeliveryEnvironment;
}

type RuntimeEnvironment = Record<string, string | undefined>;

export type PreparedCampaignMessage = {
  status: 'ready';
  subject: string;
  text: string;
  html: string;
  /** The template id that rendered this message, attributed as a provider tag. */
  template: CampaignTemplateId;
};

type SelectedCampaignDraft = CampaignDraft & {
  readonly template: CampaignTemplateId;
};

function campaignStep(job: GrowthJob): 1 | 2 | 3 {
  const step = job.payload['step'];
  if (
    job.kind !== 'send_step' ||
    job.payload['campaign_version'] !== 'v1' ||
    (step !== 1 && step !== 2 && step !== 3)
  ) {
    throw new DeterministicLifecycleJobError(
      'Invalid campaign send_step payload'
    );
  }
  return step;
}

function validArtifact(
  stored: GrowthArtifact | null,
  contactId: string
): EnrichmentArtifact | null {
  if (
    !stored ||
    stored.kind !== 'enrichment.v1' ||
    stored.schemaVersion !== 1 ||
    stored.contactId !== contactId
  ) {
    return null;
  }
  const parsed = EnrichmentArtifactSchema.safeParse(stored.content);
  if (!parsed.success) return null;
  const sourceIds = new Set(parsed.data.sources.map(({ id }) => id));
  if (sourceIds.size !== parsed.data.sources.length) return null;
  const citedIds = new Set(
    parsed.data.cited_signals.flatMap(({ source_ids }) => source_ids)
  );
  if (
    [...citedIds].some((id) => !sourceIds.has(id)) ||
    parsed.data.sources.some(({ id }) => !citedIds.has(id))
  ) {
    return null;
  }
  return parsed.data;
}

function draftFor(
  step: 1 | 2 | 3,
  artifact: EnrichmentArtifact | null
): SelectedCampaignDraft {
  // Every step is the founder session offer. A cited research angle only
  // changes which flavor of that offer goes out.
  if (artifact) {
    const selection = artifact.drafts[step - 1];
    const cited =
      selection !== null &&
      artifact.cited_signals.some(({ source_ids }) =>
        source_ids.includes(selection.source_id)
      );
    if (selection !== null && cited) {
      return {
        ...renderEvidenceCampaignTemplate(selection.angle_id, {
          finalStep: step === 3,
        }),
        template: selection.angle_id,
      };
    }
  }
  return {
    ...renderCampaignTemplate(STEP_NAMES[step]),
    template: STEP_NAMES[step],
  };
}

const FIRST_NAME_PATTERN = /^[A-Za-z][A-Za-z'’-]{0,29}$/u;
const PLAIN_NAME_PATTERN = /^[A-Za-z'’.-]+(?:\s[A-Za-z'’.-]+){0,5}$/u;

/**
 * "Hey <first name>," when the persisted display name is a plain name and its
 * first word is a plain first name; otherwise "Hey there,". Campaign steps and
 * fulfillment mail both open with it. Display names are
 * free-text form input, so a name carrying digits, punctuation, or a URL
 * anywhere is discarded as a whole and never reaches the email.
 */
export function campaignGreeting(
  displayName: string | null | undefined
): string {
  const name = (displayName ?? '').trim();
  if (name.length > 60 || !PLAIN_NAME_PATTERN.test(name)) return 'Hey there,';
  const first = name.split(/\s+/u)[0] ?? '';
  return FIRST_NAME_PATTERN.test(first) ? `Hey ${first},` : 'Hey there,';
}

function signedText(
  body: string,
  unsubscribeUrl: UnsubscribeActionUrl
): string {
  return `${body}\n\n—\nBrian\n\nIs this email not relevant to you? Stop here: ${unsubscribeActionUrlValue(
    unsubscribeUrl
  )}`;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const BODY_LINK_PATTERN = /https:\/\/[^\s<>()"'“”‘’\]}]+/gu;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) => HTML_ESCAPES[character] ?? character
  );
}

function htmlLine(line: string): string {
  let rendered = '';
  let cursor = 0;
  for (const match of line.matchAll(BODY_LINK_PATTERN)) {
    const start = match.index;
    const trailing = /[.,;:!]+$/u.exec(match[0])?.[0] ?? '';
    const link = match[0].slice(0, match[0].length - trailing.length);
    rendered += escapeHtml(line.slice(cursor, start));
    rendered += `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`;
    rendered += escapeHtml(trailing);
    cursor = start + match[0].length;
  }
  return rendered + escapeHtml(line.slice(cursor));
}

/**
 * A plain HTML alternative for the text part: the same paragraphs, bare HTTPS
 * links as anchors, and a one-word unsubscribe link instead of the long signed
 * URL. No layout, images, styles, or tracking.
 */
function signedHtml(
  body: string,
  unsubscribeUrl: UnsubscribeActionUrl
): string {
  const paragraphs = body
    .split('\n\n')
    .map((paragraph) => paragraph.split('\n').map(htmlLine).join('<br>'))
    .map((paragraph) => `<p>${paragraph}</p>`);
  const unsubscribe = escapeHtml(unsubscribeActionUrlValue(unsubscribeUrl));
  return [
    ...paragraphs,
    '<p>—<br>Brian</p>',
    `<p>Is this email not relevant to you? Click <a href="${unsubscribe}">here</a>.</p>`,
  ].join('\n');
}

export function prepareCampaignMessage(input: {
  context: LifecycleJobContext;
  job: GrowthJob;
  unsubscribeUrl: UnsubscribeActionUrl;
}): PreparedCampaignMessage {
  const genericHello =
    input.context.campaignEnrollmentReason === 'install_runtime';
  const artifact = genericHello
    ? null
    : validArtifact(input.context.enrichmentArtifact, input.context.contactId);
  const draft = draftFor(campaignStep(input.job), artifact);
  const body = `${campaignGreeting(input.context.displayName)}\n\n${
    draft.body
  }`;
  return {
    status: 'ready',
    subject: draft.subject,
    text: signedText(body, input.unsubscribeUrl),
    html: signedHtml(body, input.unsubscribeUrl),
    template: draft.template,
  };
}

function requireLease(job: GrowthJob): string {
  if (job.status !== 'leased' || !job.leaseToken) {
    throw new Error(`Inactive lifecycle job: ${job.id}`);
  }
  return job.leaseToken;
}

function fulfillmentInput(payload: Record<string, unknown>): unknown {
  const formKind = payload['form_kind'];
  if (formKind === 'whitepaper') {
    return { context: 'whitepaper', paper: payload['paper'] };
  }
  if (
    formKind === 'newsletter' ||
    formKind === 'contact' ||
    formKind === 'pricing'
  ) {
    return { context: formKind };
  }
  throw new DeterministicLifecycleJobError(
    'Unsupported fulfillment form context'
  );
}

function enrichmentDrafts(context: LifecycleJobContext): CampaignDraft[] {
  const artifact = validArtifact(context.enrichmentArtifact, context.contactId);
  return ([1, 2, 3] as const).map((step) => {
    const { subject, body } = draftFor(step, artifact);
    return { subject, body };
  });
}

interface RecipientMessage {
  subject: string;
  text: string;
  html: string;
  unsubscribeUrl: UnsubscribeActionUrl;
  campaignTemplate?: CampaignTemplateId;
  attachment?: RecipientAttachment;
}

async function dispatchRecipient(
  executor: SqlExecutor,
  job: GrowthJob,
  message: RecipientMessage,
  signal: AbortSignal,
  dependencies: LifecycleJobDependencies
): Promise<GrowthDispatchResult> {
  const leaseToken = requireLease(job);
  signal.throwIfAborted();
  const { campaignTemplate, attachment, ...parts } = message;
  const result = await dependencies.sendRecipient(
    executor,
    {
      jobId: job.id,
      leaseToken,
      ...parts,
      signal,
      ...(campaignTemplate === undefined ? {} : { campaignTemplate }),
      ...(attachment === undefined ? {} : { attachments: [attachment] }),
    },
    dependencies.recipientPolicy
  );
  if (result.accepted) return 'completed';
  if (result.reason === 'mailbox_recovery_required') return 'recovery_paused';
  if (
    result.reason === 'campaign_disabled' ||
    result.reason === 'delivery_disabled' ||
    result.reason === 'outside_send_window' ||
    result.reason === 'reply_binding_pending'
  ) {
    const now = dependencies.now();
    await dependencies.deferJob(executor, {
      jobId: job.id,
      leaseToken,
      now,
      availableAt: new Date(now.getTime() + RETRY_DELAY_MS),
      errorCode: result.reason,
    });
    return 'deferred';
  }
  if (
    result.reason === 'contact_deleted' ||
    result.reason === 'contact_stopped' ||
    result.reason === 'contact_unapproved'
  ) {
    await dependencies.cancelJob(executor, {
      jobId: job.id,
      leaseToken,
      now: dependencies.now(),
      errorCode: result.reason,
    });
    return 'cancelled';
  }
  return 'failed';
}

export async function dispatchLifecycleAppOwnedJob(
  executor: SqlExecutor,
  job: GrowthJob,
  dispatchContext: { signal?: AbortSignal },
  dependencies: LifecycleJobDependencies
): Promise<GrowthDispatchResult> {
  const leaseToken = requireLease(job);
  const signal = dispatchContext.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  if (job.kind === 'digest') {
    return dispatchInstallDigestJob(
      executor,
      job,
      leaseToken,
      signal,
      dependencies
    );
  }
  const now = dependencies.now();
  const context = await dependencies.readJobContext(executor, {
    jobId: job.id,
  });
  signal.throwIfAborted();
  if (context.contactId !== job.contactId) {
    throw new DeterministicLifecycleJobError(
      'Lifecycle context contact does not match the leased job'
    );
  }

  if (job.kind === 'fulfill') {
    let message: ReturnType<typeof renderFulfillmentTemplate>;
    try {
      message = renderFulfillmentTemplate(fulfillmentInput(job.payload));
    } catch (error) {
      if (error instanceof DeterministicLifecycleJobError) throw error;
      throw new DeterministicLifecycleJobError(
        `Persisted fulfillment input is invalid: ${
          error instanceof Error ? error.message : 'unknown validation error'
        }`
      );
    }
    const unsubscribeUrl = dependencies.createUnsubscribeUrl(
      { contactId: context.contactId, issuedAt: now, eventNonce: job.id },
      dependencies.tokenKey
    );
    // Fulfillment mail is the first message a contact gets from Brian, so it
    // opens the same way every campaign step does.
    const body = `${campaignGreeting(context.displayName)}\n\n${message.body}`;
    return dispatchRecipient(
      executor,
      job,
      {
        subject: message.subject,
        text: signedText(body, unsubscribeUrl),
        html: signedHtml(body, unsubscribeUrl),
        unsubscribeUrl,
        ...(message.attachment === undefined
          ? {}
          : { attachment: message.attachment }),
      },
      signal,
      dependencies
    );
  }

  if (job.kind === 'send_step') {
    const unsubscribeUrl = dependencies.createUnsubscribeUrl(
      { contactId: context.contactId, issuedAt: now, eventNonce: job.id },
      dependencies.tokenKey
    );
    const message = prepareCampaignMessage({
      context,
      job,
      unsubscribeUrl,
    });
    return dispatchRecipient(
      executor,
      job,
      {
        subject: message.subject,
        text: message.text,
        html: message.html,
        unsubscribeUrl,
        campaignTemplate: message.template,
      },
      signal,
      dependencies
    );
  }

  if (job.kind === 'notify') {
    if (!dependencies.recipientPolicy.deliveryEnabled) {
      const retryAt = dependencies.now();
      await dependencies.deferJob(executor, {
        jobId: job.id,
        leaseToken,
        now: retryAt,
        availableAt: new Date(retryAt.getTime() + RETRY_DELAY_MS),
        errorCode: 'delivery_disabled',
      });
      return 'deferred';
    }
    const notificationClaimedAt = dependencies.now();
    const parsed = validArtifact(context.enrichmentArtifact, context.contactId);
    const founderStopToken = createGrowthActionToken(
      {
        contactId: context.contactId,
        purpose: 'founder_stop',
        issuedAt: notificationClaimedAt,
        eventNonce: job.id,
      },
      dependencies.tokenKey
    );
    const text = renderInternalNotificationSummary({
      scoreVersion: parsed?.score_version ?? 'growth-score:v1:unscored',
      scoreReasons: parsed?.score_reasons ?? [],
      evidenceSourceUrls: parsed?.sources.map(({ url }) => url) ?? [],
      drafts: enrichmentDrafts(context),
      founderStopUrl: `https://threadplane.ai/api/growth/stop?token=${founderStopToken}`,
    });
    signal.throwIfAborted();
    const claimed = await dependencies.claimInternalNotification(executor, {
      jobId: job.id,
      leaseToken,
      now: notificationClaimedAt,
    });
    if (!claimed) {
      await dependencies.markInternalNotificationUnknown(executor, {
        jobId: job.id,
        leaseToken,
        occurredAt: dependencies.now(),
        errorCode: 'internal_notification_outcome_unknown',
      });
      signal.throwIfAborted();
      return 'failed';
    }
    signal.throwIfAborted();
    const sent = await dependencies.sendInternalNotification({
      to: dependencies.founderNotificationEmail,
      subject: 'Threadplane lifecycle review',
      text,
      idempotencyKey: job.idempotencyKey,
    });
    if (sent.outcome === 'unknown') {
      await dependencies.markInternalNotificationUnknown(executor, {
        jobId: job.id,
        leaseToken,
        occurredAt: dependencies.now(),
        errorCode: 'internal_notification_outcome_unknown',
      });
      return 'failed';
    }
    if (sent.outcome === 'rejected') {
      await dependencies.failJob(executor, {
        jobId: job.id,
        leaseToken,
        now: dependencies.now(),
        errorCode: 'internal_notification_rejected',
      });
      return 'failed';
    }
    await dependencies.completeJob(executor, {
      jobId: job.id,
      leaseToken,
      now: dependencies.now(),
    });
    return 'completed';
  }

  throw new DeterministicLifecycleJobError(
    `Unsupported app-owned growth job kind: ${job.kind}`
  );
}

const INSTALL_DIGEST_CANDIDATE_LIMIT = 200;
const INSTALL_DIGEST_CONTEXT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Founder-only install digest. The job has no contact, so it never reads the
 * lifecycle contact context; the identities are recorded as reported only
 * after the provider accepted the message.
 */
async function dispatchInstallDigestJob(
  executor: SqlExecutor,
  job: GrowthJob,
  leaseToken: string,
  signal: AbortSignal,
  dependencies: LifecycleJobDependencies
): Promise<GrowthDispatchResult> {
  if (!dependencies.recipientPolicy.deliveryEnabled) {
    const retryAt = dependencies.now();
    await dependencies.deferJob(executor, {
      jobId: job.id,
      leaseToken,
      now: retryAt,
      availableAt: new Date(retryAt.getTime() + RETRY_DELAY_MS),
      errorCode: 'delivery_disabled',
    });
    return 'deferred';
  }
  const businessDate =
    typeof job.payload['business_date'] === 'string'
      ? job.payload['business_date']
      : null;
  if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/u.test(businessDate)) {
    throw new DeterministicLifecycleJobError(
      'Digest job is missing its business date'
    );
  }
  const candidates = await dependencies.readInstallDigestCandidates(executor, {
    limit: INSTALL_DIGEST_CANDIDATE_LIMIT,
  });
  signal.throwIfAborted();
  if (candidates.length === 0) {
    await dependencies.completeJob(executor, {
      jobId: job.id,
      leaseToken,
      now: dependencies.now(),
    });
    return 'completed';
  }
  const issuedAt = dependencies.now();
  const context = await dependencies.readInstallDigestContext(executor, {
    since: new Date(issuedAt.getTime() - INSTALL_DIGEST_CONTEXT_WINDOW_MS),
  });
  const text = renderInstallDigest({
    businessDate,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      approveUrl: `${
        dependencies.publicActionOrigin
      }/api/growth/approve-install?token=${createGrowthActionToken(
        {
          contactId: candidate.firstInstallObservationId,
          purpose: 'founder_approve_install',
          issuedAt,
          eventNonce: job.id,
        },
        dependencies.tokenKey
      )}`,
    })),
    context,
  });
  signal.throwIfAborted();
  const claimed = await dependencies.claimInternalNotification(executor, {
    jobId: job.id,
    leaseToken,
    now: issuedAt,
    kind: 'digest',
  });
  if (!claimed) {
    await dependencies.markInternalNotificationUnknown(executor, {
      jobId: job.id,
      leaseToken,
      occurredAt: dependencies.now(),
      errorCode: 'install_digest_outcome_unknown',
      kind: 'digest',
    });
    return 'failed';
  }
  signal.throwIfAborted();
  const sent = await dependencies.sendInternalNotification({
    to: dependencies.founderNotificationEmail,
    subject: `Threadplane install digest for ${businessDate}: ${
      candidates.length
    } new ${candidates.length === 1 ? 'identity' : 'identities'}`,
    text,
    idempotencyKey: job.idempotencyKey,
    kind: 'digest',
  });
  if (sent.outcome === 'unknown') {
    await dependencies.markInternalNotificationUnknown(executor, {
      jobId: job.id,
      leaseToken,
      occurredAt: dependencies.now(),
      errorCode: 'install_digest_outcome_unknown',
      kind: 'digest',
    });
    return 'failed';
  }
  if (sent.outcome === 'rejected') {
    await dependencies.failJob(executor, {
      jobId: job.id,
      leaseToken,
      now: dependencies.now(),
      errorCode: 'install_digest_rejected',
    });
    return 'failed';
  }
  await dependencies.markInstallDigestReported(executor, {
    digestJobId: job.id,
    reportedAt: dependencies.now(),
    candidates,
  });
  await dependencies.completeJob(executor, {
    jobId: job.id,
    leaseToken,
    now: dependencies.now(),
  });
  return 'completed';
}

function exactBoolean(
  environment: Record<string, string | undefined>,
  name: string
): boolean {
  const value = environment[name];
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`${name} must be exactly true or false`);
}

export function loadLifecycleRuntimeConfiguration(
  environment: RuntimeEnvironment
): LifecycleRuntimeConfiguration {
  const campaignEnrollmentEnabled = exactBoolean(
    environment,
    'CAMPAIGN_ENROLLMENT_ENABLED'
  );
  const campaignEnabled = exactBoolean(environment, 'CAMPAIGN_ENABLED');
  const installRuntimeHelloEnabled = exactBoolean(
    environment,
    'GROWTH_INSTALL_RUNTIME_HELLO_ENABLED'
  );
  const installDigestEnabled = exactBoolean(
    environment,
    'GROWTH_INSTALL_DIGEST_ENABLED'
  );
  const deliveryEnabled = exactBoolean(environment, 'DELIVERY_ENABLED');
  let campaignEnrollmentStartAt: Date | undefined;
  if (campaignEnrollmentEnabled) {
    const raw = environment['CAMPAIGN_ENROLLMENT_START_AT'];
    campaignEnrollmentStartAt =
      raw && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(raw)
        ? new Date(raw)
        : undefined;
    if (
      !campaignEnrollmentStartAt ||
      Number.isNaN(campaignEnrollmentStartAt.getTime()) ||
      campaignEnrollmentStartAt.toISOString() !== raw
    ) {
      throw new Error(
        'CAMPAIGN_ENROLLMENT_START_AT must be canonical UTC RFC3339 with milliseconds when enrollment is enabled'
      );
    }
  }
  return {
    campaignEnrollmentEnabled,
    installRuntimeHelloEnabled,
    installDigestEnabled,
    ...(campaignEnrollmentStartAt ? { campaignEnrollmentStartAt } : {}),
    campaignEnabled,
    deliveryEnabled,
  };
}

function deliveryEnvironment(
  environment: RuntimeEnvironment,
  name: string
): DeliveryEnvironment {
  const value = environment[name];
  if (value === 'production' || value === 'preview' || value === 'test') {
    return value;
  }
  throw new Error(`${name} must be production, preview, or test`);
}

function requiredEnvironmentText(
  environment: RuntimeEnvironment,
  name: string
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredEnvironmentCanonicalValue(
  environment: RuntimeEnvironment,
  name: string
): string {
  const value = environment[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function recipientPolicyFromEnvironment(
  environment: RuntimeEnvironment,
  runtime: LifecycleRuntimeConfiguration
): RecipientDeliveryPolicy {
  const delivery = deliveryEnvironment(environment, 'DELIVERY_ENVIRONMENT');
  const database = deliveryEnvironment(
    environment,
    'GROWTH_DATABASE_ENVIRONMENT'
  );
  const allowlist = (environment['RESEND_NON_PRODUCTION_ALLOWLIST'] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const redirect = environment['RESEND_NON_PRODUCTION_REDIRECT_TO']?.trim();
  return {
    campaignEnabled: runtime.campaignEnabled,
    deliveryEnabled: runtime.deliveryEnabled,
    environment: delivery,
    databaseEnvironment: database,
    senderVerified: exactBoolean(environment, 'RESEND_SENDER_VERIFIED'),
    verifiedDomain: 'threadplane.ai',
    configuredSender: RECIPIENT_EMAIL_SENDER,
    providerTrackingDisabled: exactBoolean(
      environment,
      'RESEND_TRACKING_DISABLED'
    ),
    nonProductionRecipientAllowlist: allowlist,
    ...(redirect ? { nonProductionRedirectTo: redirect } : {}),
  };
}

export function createDefaultLifecycleJobDependencies(
  environment: RuntimeEnvironment = process.env
): LifecycleJobDependencies {
  const runtime = loadLifecycleRuntimeConfiguration(environment);
  const now = (): Date => new Date();
  let cachedMailRuntime:
    | {
        founderNotificationEmail: string;
        recipientPolicy: RecipientDeliveryPolicy;
        publicActionOrigin: string;
        resend: Resend;
        tokenKey: GrowthTokenKey;
      }
    | undefined;
  const mailRuntime = () => {
    if (cachedMailRuntime) return cachedMailRuntime;
    const apiKey = requiredEnvironmentText(environment, 'RESEND_API_KEY');
    const founderNotificationEmail = normalizeRecipientEmail(
      requiredEnvironmentText(environment, 'FOUNDER_NOTIFICATION_EMAIL')
    );
    const recipientPolicy = recipientPolicyFromEnvironment(
      environment,
      runtime
    );
    assertRecipientDeliveryPolicy(recipientPolicy);
    if (
      recipientPolicy.environment !== 'production' &&
      !recipientPolicy.nonProductionRecipientAllowlist
        .map((email) => normalizeRecipientEmail(email))
        .includes(founderNotificationEmail)
    ) {
      throw new Error(
        'The configured founder notification address must be on the non-production allowlist'
      );
    }
    const publicActionOrigin = normalizeGrowthPublicActionOrigin(
      requiredEnvironmentCanonicalValue(
        environment,
        'GROWTH_PUBLIC_ACTION_ORIGIN'
      )
    );
    cachedMailRuntime = {
      founderNotificationEmail,
      recipientPolicy,
      publicActionOrigin,
      resend: new Resend(apiKey),
      tokenKey: loadGrowthTokenKeyring(environment).active,
    };
    return cachedMailRuntime;
  };

  return {
    now,
    readJobContext: readLifecycleJobContext,
    createUnsubscribeUrl: (input, key) =>
      createUnsubscribeActionUrl(input, key, mailRuntime().publicActionOrigin),
    sendRecipient: (executor, input, policy) => {
      const { resend } = mailRuntime();
      return sendRecipientEmail(executor, input, policy, {
        now,
        resend,
        authorizeLeasedJobForSubmission,
        recordProviderAcceptance,
        markProviderAcceptanceUnknown,
        markProviderRejection,
      });
    },
    deferJob: deferLeasedJob,
    completeJob: completeLeasedJob,
    cancelJob: cancelLeasedJob,
    claimInternalNotification: claimInternalNotificationSubmission,
    markInternalNotificationUnknown,
    failJob: failLeasedJob,
    async sendInternalNotification(input) {
      const { founderNotificationEmail, recipientPolicy, resend } =
        mailRuntime();
      if (normalizeRecipientEmail(input.to) !== founderNotificationEmail) {
        throw new Error('Internal notification recipient is not the founder');
      }
      try {
        const response = await resend.emails.send(
          {
            from: RECIPIENT_EMAIL_SENDER,
            to: founderNotificationEmail,
            subject: input.subject,
            text: input.text,
            tags: [
              { name: 'environment', value: recipientPolicy.environment },
              { name: 'job_kind', value: input.kind ?? 'notify' },
            ],
          },
          { idempotencyKey: `internal:${input.idempotencyKey}` }
        );
        if (response.error === null) {
          const providerId = response.data?.id;
          return typeof providerId === 'string' &&
            /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(providerId)
            ? { outcome: 'accepted' as const }
            : { outcome: 'unknown' as const };
        }
        return {
          outcome: classifyResendProviderError(response.error),
        };
      } catch {
        return { outcome: 'unknown' as const };
      }
    },
    readInstallDigestCandidates,
    readInstallDigestContext,
    markInstallDigestReported,
    get publicActionOrigin() {
      return mailRuntime().publicActionOrigin;
    },
    get founderNotificationEmail() {
      return mailRuntime().founderNotificationEmail;
    },
    get recipientPolicy() {
      return mailRuntime().recipientPolicy;
    },
    get tokenKey() {
      return mailRuntime().tokenKey;
    },
  };
}

export function createLifecycleAppJobHandlers(
  dependenciesFactory: () => LifecycleJobDependencies = () =>
    createDefaultLifecycleJobDependencies(),
  options: {
    environment?: Record<string, string | undefined>;
    dawnDependenciesFactory?: () => DawnJobDependencies;
  } = {}
) {
  const dawn = createDawnJobHandlers(options.dawnDependenciesFactory);
  const handler = (
    executor: SqlExecutor,
    job: GrowthJob,
    context: { signal?: AbortSignal }
  ) =>
    dispatchLifecycleAppOwnedJob(executor, job, context, dependenciesFactory());
  return {
    fulfill: handler,
    enrich: async (
      executor: SqlExecutor,
      job: GrowthJob,
      context: { signal?: AbortSignal }
    ): Promise<GrowthDispatchResult> => {
      if (
        (options.environment ?? process.env)[
          'GROWTH_DAWN_ENRICHMENT_ENABLED'
        ] !== 'false' ||
        'research_attempt' in job.payload
      )
        return dawn.enrich(executor, job, context);
      const leaseToken = requireLease(job);
      context.signal?.throwIfAborted();
      const dependencies = dependenciesFactory();
      const now = dependencies.now();
      await dependencies.deferJob(executor, {
        jobId: job.id,
        leaseToken,
        now,
        availableAt: new Date(now.getTime() + RETRY_DELAY_MS),
        errorCode: 'dawn_enrichment_paused',
      });
      return 'deferred';
    },
    research_cleanup: dawn.research_cleanup,
    notify: handler,
    digest: handler,
    send_step: handler,
  };
}
