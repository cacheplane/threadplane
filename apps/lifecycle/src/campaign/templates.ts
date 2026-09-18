import { z } from 'zod';

export interface CampaignDraft {
  readonly subject: string;
  readonly body: string;
}

export type CampaignStep = 'immediate' | 'day-3' | 'day-8';
export type CampaignEvidenceAngle =
  | 'streaming_foundation'
  | 'debugging_layers'
  | 'event_state_boundary';

const CampaignStepSchema = z.enum(['immediate', 'day-3', 'day-8']);

/**
 * Brian's Google Calendar appointment-schedule booking page. This is the only
 * scheduling link recipient copy may carry; every other calendar host or path
 * is still rejected by the draft checks below.
 */
export const FOUNDER_BOOKING_URL =
  'https://calendar.app.google/nK961tWHZd21izKR6';

/**
 * Every link recipient copy may carry, across campaign steps and fulfillment
 * mail. The four PDFs are the whitepaper fulfillment deliverables.
 */
const APPROVED_CAMPAIGN_LINKS = new Set([
  'https://threadplane.ai/docs',
  'https://threadplane.ai/pilot-to-prod',
  'https://threadplane.ai/whitepaper.pdf',
  'https://threadplane.ai/whitepapers/angular.pdf',
  'https://threadplane.ai/whitepapers/render.pdf',
  'https://threadplane.ai/whitepapers/chat.pdf',
  FOUNDER_BOOKING_URL,
]);
const URL_PATTERN = /https?:\/\/[^\s<>()"'“”‘’\]}]+/giu;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const HTML_PATTERN = /(?:<\/?[a-z][^>]*>|<!doctype\b[^>]*>|<!--[\s\S]*?-->)/iu;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\([^)]*\)/u;
const MARKDOWN_LINK_PATTERN = /\[[^\]]+\]\([^)]*\)/u;
const HEADER_PATTERN = /^[ \t]*(?:bcc|cc|from|reply-to|subject|to):/imu;
const SURVEILLANCE_PATTERN =
  /\b(?:I saw you|we saw you|I noticed you|we noticed|we observed you|based on your activity|your activity|tracking|telemetry|page[ -]?view|analytics event|your (?:product )?(?:usage|behavior|activity|signals?) (?:show(?:s|ed)?|reveal(?:s|ed)?|indicate(?:s|d)?|suggest(?:s|ed)?))\b/iu;
const CALENDAR_PATTERN =
  /(?:calendly\.com|cal\.com|calendar\.google\.com|\/(?:book|calendar|meeting|schedule)(?:\/|\?|$))/iu;
const TRACKING_PATTERN =
  /(?:pixel|beacon|open\.gif|utm_(?:campaign|content|medium|source)|\/(?:click|redirect|track)(?:\/|\?|$))/iu;
const PROTOCOL_RELATIVE_LINK_PATTERN =
  /(?:^|[^A-Za-z0-9/:])\/\/[^\s)\]}'"”’]+/u;
const DOT_RELATIVE_LINK_PATTERN =
  /(?:^|[^A-Za-z0-9])\.{1,2}\/[a-z0-9][^\s)\]}'"”’]*/iu;
const RELATIVE_LINK_PATTERN =
  /(?:^|[^A-Za-z0-9/:])\/(?!\/)[a-z0-9][^\s)\]}'"”’]*/iu;
const UNSUPPORTED_SCHEME_PATTERN =
  /(?:^|[^A-Za-z0-9])(?!(?:https?):)[a-z][a-z0-9+.-]*:[^\s)\]}'"”’]+/iu;

function normalizeSubject(subject: string): string {
  return subject.trim().replace(/[ \t]+/gu, ' ');
}

function normalizeBody(body: string): string {
  return body
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function linksIn(value: string): string[] {
  return (value.match(URL_PATTERN) ?? []).map((link) =>
    link.replace(/[.,;:!]+$/u, '')
  );
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

export function campaignDraftViolations(candidate: unknown): string[] {
  const violations: string[] = [];
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    Array.isArray(candidate)
  ) {
    return ['draft must be an object'];
  }

  const record = candidate as Record<string, unknown>;
  const extraFields = Object.keys(record).filter(
    (field) => field !== 'subject' && field !== 'body'
  );
  if (extraFields.length > 0) violations.push('draft contains unknown fields');
  if (typeof record['subject'] !== 'string') {
    violations.push('subject must be a string');
  }
  if (typeof record['body'] !== 'string') {
    violations.push('body must be a string');
  }
  if (
    typeof record['subject'] !== 'string' ||
    typeof record['body'] !== 'string'
  ) {
    return violations;
  }

  const rawSubject = record['subject'];
  const rawBody = record['body'];
  const subject = normalizeSubject(rawSubject);
  const body = normalizeBody(rawBody);
  const message = `${subject}\n${body}`;
  const links = linksIn(message);

  if (subject.trim().length === 0) violations.push('subject is empty');
  if (subject.trim().length > 80)
    violations.push('subject exceeds 80 characters');
  if (body.trim().length === 0) violations.push('body is empty');
  if (rawBody.length > 1_200) violations.push('body exceeds 1200 characters');
  if (/[\r\n]/u.test(rawSubject)) violations.push('subject contains a newline');
  if (linksIn(subject).length > 0) violations.push('subject contains a URL');
  if (wordCount(body) > 120) violations.push('body exceeds 120 words');
  if ((body.match(/\?/gu) ?? []).length > 1) {
    violations.push('body contains more than one question');
  }
  if (links.length > 1) violations.push('message contains more than one link');
  if (links.some((link) => !APPROVED_CAMPAIGN_LINKS.has(link))) {
    violations.push('message contains an unapproved link');
  }
  if (HTML_PATTERN.test(message)) violations.push('message contains HTML');
  if (MARKDOWN_IMAGE_PATTERN.test(message)) {
    violations.push('message contains markdown image markup');
  }
  if (MARKDOWN_LINK_PATTERN.test(message)) {
    violations.push('message contains markdown link markup');
  }
  if (HEADER_PATTERN.test(message)) {
    violations.push('message contains an injected mail header');
  }
  if (EMAIL_PATTERN.test(message)) violations.push('message contains an email');
  if (SURVEILLANCE_PATTERN.test(message)) {
    violations.push('message contains surveillance language');
  }
  if (CALENDAR_PATTERN.test(message)) {
    violations.push('message contains a calendar link');
  }
  if (TRACKING_PATTERN.test(message)) {
    violations.push('message contains tracking or click-wrapper markup');
  }
  if (PROTOCOL_RELATIVE_LINK_PATTERN.test(message)) {
    violations.push('message contains a protocol-relative link');
  }
  if (DOT_RELATIVE_LINK_PATTERN.test(message)) {
    violations.push('message contains a dot-relative link');
  }
  if (RELATIVE_LINK_PATTERN.test(message)) {
    violations.push('message contains a relative link');
  }
  if (UNSUPPORTED_SCHEME_PATTERN.test(message)) {
    violations.push('message contains an unsupported URL scheme');
  }

  return [...new Set(violations)];
}

export function normalizeCampaignDraft(candidate: unknown): CampaignDraft {
  const violations = campaignDraftViolations(candidate);
  if (violations.length > 0) {
    throw new Error(`Invalid campaign draft: ${violations.join('; ')}`);
  }
  const draft = candidate as CampaignDraft;
  return {
    subject: normalizeSubject(draft.subject),
    body: normalizeBody(draft.body),
  };
}

const CAMPAIGN_TEMPLATES: Record<CampaignStep, CampaignDraft> = {
  immediate: {
    subject: 'Engineer to engineer',
    // Step one carries no link at all. A booking URL in a first cold message is
    // a deliverability risk, so the call to action is a reply. This step also
    // says why the recipient is hearing from us; the later steps do not repeat
    // it. Unlike them it uses the founder's conversational register.
    body: `Saw you were checking out threadplane and wanted to drop a quick note.\n\nI'm the founding engineer and I am offering short engineer-to-engineer sessions to think through implementation, unblock technical questions, and avoid the common mistakes. No sales, just getting you going.\n\nLet me know if you're interested.`,
  },
  'day-3': {
    subject: 'Get your agent UI into production',
    body: `Even with agents writing much of our code today, teams still get stuck.\n\nI can help you work through any issue with Threadplane in a 30-minute hands-on session: fix the bug, and get your code working.\n\nNo sales.\nJust a founding engineer meeting with you and your engineering team.\n\nBook a time with me:\n${FOUNDER_BOOKING_URL}`,
  },
  'day-8': {
    subject: 'Free engineering session with the Threadplane founder',
    body: `One last note.\n\nAs the founder of Threadplane, I want to get on a call with you and your team to help you fix any bugs and get your code working.\n\nNo sales.\nJust help, and some feedback for me to improve the product.\n\nGrab some time on my calendar:\n${FOUNDER_BOOKING_URL}\n\nThis is my last automated follow-up.`,
  },
};

const EVIDENCE_TEMPLATES: Record<CampaignEvidenceAngle, CampaignDraft> = {
  streaming_foundation: {
    subject: 'Streaming first, then the rest',
    body: `Most agent UIs go wrong before the first streamed response works end to end.\nGet that boundary solid first, then layer in persistence and interrupts.\n\nI am the founding engineer, and I am happy to work through that sequence with you and your team in a short hands-on session.\n\nNo sales.\nJust engineer to engineer.\n\nGrab a time here:\n${FOUNDER_BOOKING_URL}`,
  },
  debugging_layers: {
    subject: 'Three checks when the UI stalls',
    body: `When an agent UI stalls, I isolate transport, state updates, and rendering, in that order.\nIt turns one vague problem into three small checks.\n\nIf you are stuck on any of them, I can walk through it with you and your team in a 30-minute hands-on session.\n\nNo sales.\nJust a founding engineer helping you get your code working.\n\nBook a time with me:\n${FOUNDER_BOOKING_URL}`,
  },
  event_state_boundary: {
    subject: 'One boundary that makes agent UIs testable',
    body: `A narrow boundary between agent events and UI state makes streaming, retries, and tests much easier to reason about.\n\nAs the founding engineer of Threadplane, I want to get on a call with you and your team to look at that boundary in your code and fix anything in the way.\n\nNo sales.\nJust help, and some feedback for me to improve the product.\n\nGrab some time on my calendar:\n${FOUNDER_BOOKING_URL}`,
  },
};

export function renderCampaignTemplate(step: CampaignStep): CampaignDraft {
  const parsedStep = CampaignStepSchema.parse(step);
  return normalizeCampaignDraft(CAMPAIGN_TEMPLATES[parsedStep]);
}

const FINAL_STEP_NOTICE = 'This is my last automated follow-up.';

export function renderEvidenceCampaignTemplate(
  angle: CampaignEvidenceAngle,
  options: { finalStep?: boolean } = {}
): CampaignDraft {
  const template = EVIDENCE_TEMPLATES[angle];
  return normalizeCampaignDraft(
    options.finalStep
      ? { ...template, body: `${template.body}\n\n${FINAL_STEP_NOTICE}` }
      : template
  );
}
