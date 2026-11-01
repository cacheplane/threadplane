/**
 * Normalizes a LinkedIn profile link to `https://www.linkedin.com/in/<slug>`,
 * or null when the value is not a LinkedIn member profile.
 */
export function normalizeLinkedInProfileUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !/^[a-z0-9-]+\.linkedin\.com$/.test(host))
    return null;
  const match = /^\/in\/([^/?#]+)\/?$/i.exec(url.pathname);
  if (!match) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return null;
  }
  return slug
    ? `https://www.linkedin.com/in/${encodeURIComponent(slug)}`
    : null;
}

const LEGAL_SUFFIXES = new Set([
  'inc',
  'llc',
  'ltd',
  'limited',
  'gmbh',
  'corp',
  'corporation',
  'co',
  'plc',
  'ag',
  'sa',
  'bv',
]);

/** Lowercases a company name, collapses punctuation, and drops trailing legal suffixes. */
export function normalizeCompanyName(value: string): string {
  const words = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]))
    words.pop();
  return words.join(' ');
}

const FORMER_BEFORE_AT =
  /(?:^|[^\p{L}\p{N}])(?:ex[- ]|former|formerly|previously|prev\.)\s*$/iu;

/**
 * Reads the current company from a headline ("Role at Company"). Returns null
 * for former-employer phrasing or when no company phrase is present.
 */
export function companyNameFromHeadline(headline: string): string | null {
  const marker = / (?:at|@) /i.exec(headline);
  if (!marker) return null;
  if (FORMER_BEFORE_AT.test(headline.slice(0, marker.index))) return null;
  const rest = headline.slice(marker.index + marker[0].length);
  const company = rest.split(/[|,•·—-]/)[0].trim();
  return company || null;
}

/** Hostnames mentioned in free text, lowercased and unique, excluding LinkedIn's own. */
export function domainsInText(value: string): string[] {
  const found = new Set<string>();
  for (const match of value.matchAll(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/gi)) {
    const host = match[0].toLowerCase();
    if (
      host === 'linkedin.com' ||
      host.endsWith('.linkedin.com') ||
      host === 'lnkd.in'
    )
      continue;
    found.add(host);
  }
  return [...found];
}

/** Headline terms that suggest a prospect for the product. Matched as whole words. */
export const LINKEDIN_ICP_KEYWORDS: readonly string[] = [
  'angular',
  'langgraph',
  'ag-ui',
  'a2ui',
  'frontend',
  'front-end',
  'front end',
  'staff',
  'principal',
  'cto',
  'vp engineering',
  'vp of engineering',
  'head of engineering',
  'engineering manager',
  'architect',
  'fintech',
  'insurance',
  'healthcare',
];

/** Headline terms that suggest the profile is not a prospect. Matched as whole words. */
export const LINKEDIN_NEGATIVE_KEYWORDS: readonly string[] = [
  'recruiter',
  'recruiting',
  'talent acquisition',
  'headhunter',
  'staffing',
  'sourcing',
  'agency',
  'growth hacker',
  'lead generation',
  'lead gen',
  'appointment setting',
];

function containsWholeWord(text: string, keywords: readonly string[]): boolean {
  const haystack = text.toLowerCase();
  return keywords.some((keyword) =>
    new RegExp(
      `(?<![\\p{L}\\p{N}])${keyword.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      )}(?![\\p{L}\\p{N}])`,
      'u'
    ).test(haystack)
  );
}

/** Classifies a headline; a negative keyword outweighs any ICP keyword. */
export function headlineSignal(
  headline: string
): 'icp' | 'negative' | 'neutral' {
  if (containsWholeWord(headline, LINKEDIN_NEGATIVE_KEYWORDS))
    return 'negative';
  if (containsWholeWord(headline, LINKEDIN_ICP_KEYWORDS)) return 'icp';
  return 'neutral';
}
