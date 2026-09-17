import { z } from 'zod';

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
    .max(20),
  installCount: z.number().int().min(1),
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
  approveUrl: z
    .string()
    .max(2_048)
    .regex(
      /^https:\/\/threadplane\.ai\/api\/growth\/approve-install\?token=[A-Za-z0-9._-]+$/u
    ),
});

const InstallDigestInputSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  candidates: z.array(CandidateSchema).min(1).max(200),
  context: z.object({
    since: z.date(),
    anonymousInstallSubjects: z.number().int().min(0),
    ciInstallSubjects: z.number().int().min(0),
  }),
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
