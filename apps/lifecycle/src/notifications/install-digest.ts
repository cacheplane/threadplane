import { z } from 'zod';

import {
  INSTALL_DIGEST_MAX_PACKAGES,
  normalizeGrowthPublicActionOrigin,
} from '../growth.js';

const APPROVE_INSTALL_PATH = '/api/growth/approve-install';
const APPROVE_TOKEN_PATTERN = /^[A-Za-z0-9._-]+$/u;

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function safeText(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !containsControlCharacter(value), {
      message: 'field must not contain control or newline characters',
    });
}

const CandidateSchema = z.object({
  email: safeText(320),
  companyDomain: safeText(253),
  gitDisplayName: safeText(160).nullable(),
  repositoryProvider: safeText(32).nullable(),
  repositoryOwner: safeText(100).nullable(),
  gitConfigOrigin: z.enum(['local', 'global']),
  packages: z
    .array(z.object({ packageName: safeText(214), packageVersion: safeText(64) }))
    .max(INSTALL_DIGEST_MAX_PACKAGES),
  installCount: z.number().int().min(1),
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
  // Validated against the configured origin by the input-level refinement below.
  approveUrl: z.string().min(1).max(2_048),
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

/** Mirrors FounderStopUrlSchema in templates.ts, parameterized by origin. */
function validApproveUrl(value: string, publicActionOrigin: string): boolean {
  try {
    const url = new URL(value);
    const entries = [...url.searchParams.entries()];
    const token = entries[0]?.[1] ?? '';
    return (
      url.protocol === 'https:' &&
      url.origin === publicActionOrigin &&
      url.pathname === APPROVE_INSTALL_PATH &&
      url.username === '' &&
      url.password === '' &&
      url.hash === '' &&
      entries.length === 1 &&
      entries[0]?.[0] === 'token' &&
      APPROVE_TOKEN_PATTERN.test(token) &&
      !/[\r\n]/u.test(value)
    );
  } catch {
    return false;
  }
}

const InstallDigestInputSchema = z
  .object({
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    publicActionOrigin: PublicActionOriginSchema,
    candidates: z.array(CandidateSchema).min(1).max(200),
    context: z.object({
      since: z.date(),
      anonymousInstallSubjects: z.number().int().min(0),
      ciInstallSubjects: z.number().int().min(0),
    }),
  })
  .superRefine((input, context) => {
    input.candidates.forEach((candidate, index) => {
      if (!validApproveUrl(candidate.approveUrl, input.publicActionOrigin)) {
        context.addIssue({
          code: 'custom',
          path: ['candidates', index, 'approveUrl'],
          message:
            'approveUrl must be an https approve-install link on publicActionOrigin with a single token parameter',
        });
      }
    });
  });

export type InstallDigestInput = z.input<typeof InstallDigestInputSchema>;

function block(candidate: z.infer<typeof CandidateSchema>): string {
  const name = candidate.gitDisplayName ? ` (${candidate.gitDisplayName})` : '';
  const lines = [`${candidate.email}${name} — ${candidate.companyDomain}`];
  if (candidate.repositoryProvider && candidate.repositoryOwner) {
    lines.push(
      `Repository: ${candidate.repositoryProvider}/${candidate.repositoryOwner}`
    );
  }
  lines.push(
    `Packages: ${candidate.packages
      .map((packageEntry) => `${packageEntry.packageName}@${packageEntry.packageVersion}`)
      .join(', ')}`,
    `Installs: ${candidate.installCount}, first ${candidate.firstSeenAt.toISOString()}, last ${candidate.lastSeenAt.toISOString()}`,
    `Git identity: ${
      candidate.gitConfigOrigin === 'local'
        ? 'repository-local config'
        : 'global config'
    }`,
    'Approve outreach (valid 7 days):',
    candidate.approveUrl
  );
  return lines.join('\n');
}

/** Plain-text founder digest. Never sent to the identities it lists. */
export function renderInstallDigest(candidate: unknown): string {
  const input = InstallDigestInputSchema.parse(candidate);
  const count = input.candidates.length;
  return [
    `Threadplane install digest for ${input.businessDate}`,
    `${count} new install ${
      count === 1 ? 'identity' : 'identities'
    } with a work-email domain and no contact record.`,
    'This digest does not authorize or schedule any recipient email.',
    'Clicking an approve link creates the contact and enrolls them in the founder sequence.',
    '',
    input.candidates.map(block).join('\n\n'),
    '',
    `Not reported: ${input.context.anonymousInstallSubjects} install subjects without identity, ${input.context.ciInstallSubjects} CI install subjects since ${input.context.since.toISOString()}.`,
  ].join('\n');
}
