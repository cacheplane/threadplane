const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

/** Trim and truncate a string to the given length (200 by default), returning undefined for nonstrings or blanks. */
export function toSafeAnalyticsString(value: unknown, maxLength = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

/**
 * Extract a lowercase domain after the last `@` after trimming and truncating the input to 320 characters.
 * Returns null without a nonempty local part or a domain containing a dot; this is not full email validation.
 */
export function getEmailDomain(email: unknown): string | null {
  const value = toSafeAnalyticsString(email, 320);
  if (!value) return null;

  const atIndex = value.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === value.length - 1) return null;

  const domain = value.slice(atIndex + 1).toLowerCase();
  return domain.includes('.') ? domain : null;
}

/**
 * Return a trimmed path beginning with `/`, or the path, query, and fragment of an absolute URL.
 * Input is truncated to 2,000 characters; missing or unparseable input returns `/`.
 */
export function getSourcePage(value: unknown): string {
  const source = toSafeAnalyticsString(value, 2000);
  if (!source) return '/';

  if (source.startsWith('/')) return source;

  try {
    const url = new URL(source);
    return `${url.pathname}${url.search}${url.hash}` || '/';
  } catch {
    return '/';
  }
}

/**
 * Trim whitespace, truncate a host to 500 characters, and remove one trailing slash, defaulting to the US PostHog ingest host.
 * Missing or blank inputs use the default; supplied strings are not validated as URLs.
 */
export function normalizePostHogHost(host: unknown): string {
  const value = toSafeAnalyticsString(host, 500);
  if (!value) return DEFAULT_POSTHOG_HOST;
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
