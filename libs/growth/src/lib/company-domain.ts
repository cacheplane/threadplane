/** Lower-case consumer mailbox domains that never identify a company. */
export const PERSONAL_EMAIL_DOMAINS: readonly string[] = [
  'aol.com',
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
  'ymail.com',
];
const PERSONAL_EMAIL_DOMAIN_SET = new Set(PERSONAL_EMAIL_DOMAINS);

export function isPersonalEmailDomain(domain: string): boolean {
  return PERSONAL_EMAIL_DOMAIN_SET.has(domain.toLowerCase());
}

/** An email-derived research candidate, never proof of employment or ownership. */
export function companyDomainFromEmail(email: string): string | null {
  const pieces = email.split('@');
  if (pieces.length !== 2 || !pieces[0] || /\s/u.test(email)) return null;
  const domain = pieces[1].toLowerCase();
  if (
    domain.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      domain
    ) ||
    isPersonalEmailDomain(domain)
  )
    return null;
  return domain;
}
