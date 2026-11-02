/*
 * LinkedIn notification parser.
 *
 * This is a stub. The real parser is written test-first against redacted
 * `.eml` fixtures under `libs/growth/src/lib/linkedin/fixtures/` once Brian
 * supplies samples. Fixture redaction rules: names, profile slugs, comment
 * text, and tracking parameters are replaced with stable placeholders.
 *
 * `LINKEDIN_UNSUPPORTED_KINDS` is currently all five kinds, so no mail can be
 * classified as parsed yet. Until the real parser lands, every trusted receipt
 * is `no_fixtures_yet`, which is stored headers-only (no raw subject or body)
 * and forwarded to the operator.
 */
import { inboxSenderAddress } from '../inbox-replies.ts';

export type LinkedInNotificationKind =
  | 'comment'
  | 'reply'
  | 'reaction'
  | 'repost'
  | 'mention';

/**
 * Why a receipt was not parsed. Only `unsupported_kind` and `no_actor` keep
 * the raw subject and body; the rest are stored headers-only.
 * - `untrusted_sender`: not from linkedin.com with passing SPF and DKIM.
 * - `unsupported_kind`: an engagement notification of a kind with no fixture.
 * - `no_actor`: an engagement notification that named no individual actor.
 * - `no_fixtures_yet`: the stub parser cannot classify trusted mail yet.
 * - `not_notification`: trusted LinkedIn mail that is not an engagement
 *   notification (sign-in codes, verification, digests).
 */
export type LinkedInUnparsedReason =
  | 'untrusted_sender'
  | 'unsupported_kind'
  | 'no_actor'
  | 'no_fixtures_yet'
  | 'not_notification';

/** A member who engaged with a post. */
export interface LinkedInActor {
  displayName: string;
  /** Empty when the notification carries none. */
  headline: string;
  /** Already normalized. */
  profileUrl: string;
  /** Comments and replies only. */
  commentText: string | null;
}

/** The post a notification refers to; at least one field is expected. */
export interface LinkedInPostReference {
  urn: string | null;
  url: string | null;
}

/** A received email, as handed to the parser. */
export interface LinkedInParserInput {
  /** Raw From header value. */
  from: string;
  subject: string | null;
  text: string | null;
  html: string | null;
  /** Lowercased keys. */
  headers: Record<string, string>;
}

export type LinkedInParseResult =
  | {
      outcome: 'parsed';
      kind: LinkedInNotificationKind;
      actors: LinkedInActor[];
      post: LinkedInPostReference;
      aggregateCount: number | null;
    }
  | { outcome: 'unparsed'; reason: LinkedInUnparsedReason };

export type LinkedInParser = (
  input: LinkedInParserInput
) => LinkedInParseResult;

/** Kinds with no redacted fixture yet. Mail of these kinds is `unsupported_kind`. */
export const LINKEDIN_UNSUPPORTED_KINDS: readonly LinkedInNotificationKind[] = [
  'comment',
  'reply',
  'reaction',
  'repost',
  'mention',
];

/**
 * True only when the From address is on linkedin.com (or a subdomain) and the
 * receiving server recorded passing SPF and DKIM. Anything else is untrusted.
 */
export function isTrustedLinkedInSender(
  input: Pick<LinkedInParserInput, 'from' | 'headers'>
): boolean {
  let address: string;
  try {
    address = inboxSenderAddress(input.from);
  } catch {
    return false;
  }
  const domain = address.slice(address.lastIndexOf('@') + 1);
  if (domain !== 'linkedin.com' && !domain.endsWith('.linkedin.com'))
    return false;
  const results = (input.headers['authentication-results'] ?? '').toLowerCase();
  return results.includes('spf=pass') && results.includes('dkim=pass');
}

/** Stub parser: classifies sender trust only, until fixtures define the formats. */
export const parseLinkedInNotification: LinkedInParser = (input) =>
  isTrustedLinkedInSender(input)
    ? { outcome: 'unparsed', reason: 'no_fixtures_yet' }
    : { outcome: 'unparsed', reason: 'untrusted_sender' };
