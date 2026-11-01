import { z } from 'zod';

import { normalizeGrowthPublicActionOrigin } from '../growth.js';

const LINKEDIN_DECIDE_PATH = '/api/growth/linkedin-decide';
const DECIDE_TOKEN_PATTERN = /^[A-Za-z0-9._-]+$/u;
const COMMENT_TEXT_MAX = 500;

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function safeText(max: number, min = 1) {
  return z
    .string()
    .min(min)
    .max(max)
    .refine((value) => !containsControlCharacter(value), {
      message: 'field must not contain control or newline characters',
    });
}

function validProfileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.host === 'www.linkedin.com' &&
      /^\/in\/[^/]+\/?$/u.test(url.pathname) &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

const EngagementSchema = z.object({
  kind: z.enum(['comment', 'reply', 'reaction', 'repost', 'mention']),
  // Any length is accepted; the renderer truncates to COMMENT_TEXT_MAX.
  commentText: safeText(Number.MAX_SAFE_INTEGER).nullable(),
  postUrl: safeText(2_048).nullable(),
  postUrn: safeText(512).nullable(),
  occurredAt: z.date(),
});

const LeadSchema = z.object({
  displayName: safeText(200),
  headline: safeText(500, 0),
  profileUrl: safeText(2_048).refine(validProfileUrl, {
    message: 'profileUrl must be an https://www.linkedin.com/in/ profile link',
  }),
  companyName: safeText(200).nullable(),
  score: z.number().int(),
  previouslyRejected: z.boolean(),
  engagements: z.array(EngagementSchema).max(200),
  // Validated against the configured origin by the input-level refinement below.
  rejectUrl: z.string().min(1).max(2_048),
  denyUrl: z.string().min(1).max(2_048),
});

const PublicActionOriginSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        return normalizeGrowthPublicActionOrigin(value) === value;
      } catch {
        return false;
      }
    },
    { message: 'publicActionOrigin must be a bare HTTPS origin' }
  );

/** Same shape as validApproveUrl in install-digest.ts, for the decide route. */
function validDecideUrl(value: string, publicActionOrigin: string): boolean {
  try {
    const url = new URL(value);
    const entries = [...url.searchParams.entries()];
    const token = entries[0]?.[1] ?? '';
    return (
      url.protocol === 'https:' &&
      url.origin === publicActionOrigin &&
      url.pathname === LINKEDIN_DECIDE_PATH &&
      url.username === '' &&
      url.password === '' &&
      url.hash === '' &&
      entries.length === 1 &&
      entries[0]?.[0] === 'token' &&
      DECIDE_TOKEN_PATTERN.test(token) &&
      !/[\r\n]/u.test(value)
    );
  } catch {
    return false;
  }
}

const LinkedInDigestInputSchema = z
  .object({
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    publicActionOrigin: PublicActionOriginSchema,
    leads: z.array(LeadSchema).max(200),
    context: z.object({
      unparsedCount: z.number().int().min(0),
      dropCount: z.number().int().min(0),
      ingestCount: z.number().int().min(0),
    }),
  })
  .superRefine((input, context) => {
    input.leads.forEach((lead, index) => {
      for (const field of ['rejectUrl', 'denyUrl'] as const) {
        if (!validDecideUrl(lead[field], input.publicActionOrigin)) {
          context.addIssue({
            code: 'custom',
            path: ['leads', index, field],
            message: `${field} must be an https linkedin-decide link on publicActionOrigin with a single token parameter`,
          });
        }
      }
    });
  });

export type LinkedInDigestInput = z.input<typeof LinkedInDigestInputSchema>;

type Engagement = z.infer<typeof EngagementSchema>;
type Lead = z.infer<typeof LeadSchema>;

function quoted(text: string | null): string {
  const value = text ?? '';
  const clipped =
    value.length > COMMENT_TEXT_MAX
      ? `${value.slice(0, COMMENT_TEXT_MAX)}…`
      : value;
  return `"${clipped}"`;
}

function engagementLine(engagement: Engagement): string {
  const action = {
    comment: `commented: ${quoted(engagement.commentText)}`,
    reply: `replied: ${quoted(engagement.commentText)}`,
    reaction: 'reacted',
    repost: 'reposted',
    mention: 'mentioned you',
  }[engagement.kind];
  const post = engagement.postUrl ?? engagement.postUrn ?? 'an unknown post';
  return `${action} on ${post} ${engagement.occurredAt.toISOString()}`;
}

function block(lead: Lead): string {
  const lines = [
    lead.headline ? `${lead.displayName} — ${lead.headline}` : lead.displayName,
  ];
  if (lead.companyName) lines.push(`Company: ${lead.companyName}`);
  lines.push(`Profile: ${lead.profileUrl}`, `Score: ${lead.score}`);
  if (lead.previouslyRejected) lines.push('previously rejected');
  lines.push(
    ...lead.engagements.map(engagementLine),
    'Reject (valid 7 days):',
    lead.rejectUrl,
    'Deny forever (valid 7 days):',
    lead.denyUrl
  );
  return lines.join('\n');
}

/** Plain-text founder heads-up. Never sent to the leads it lists. */
export function renderLinkedInDigest(candidate: unknown): string {
  const input = LinkedInDigestInputSchema.parse(candidate);
  const count = input.leads.length;
  return [
    `Threadplane LinkedIn leads for ${input.businessDate}`,
    `${count} ${count === 1 ? 'lead' : 'leads'} engaged with your LinkedIn posts.`,
    'This digest sends nothing to any lead.',
    'No approve link: approvals happen in the /week session.',
    '',
    count === 0 ? 'No new leads.' : input.leads.map(block).join('\n\n'),
    '',
    `Since last digest: ${input.context.ingestCount} received, ${input.context.unparsedCount} unparsed, ${input.context.dropCount} dropped by the deny list.`,
  ].join('\n');
}
