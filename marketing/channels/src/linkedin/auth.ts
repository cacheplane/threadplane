const REQUIRED_ENV = ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_AUTHOR_URN'] as const;

const AUTHOR_URN_RE = /^urn:li:person:[A-Za-z0-9_-]+$/;
const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

export const REAUTH_HINT = 're-run `npm run marketing:channels:linkedin:auth`';

// LinkedIn's self-serve "Share on LinkedIn" product issues 60-day access tokens
// with no refresh token, so there is no refresh path: an expired token means
// running the bootstrapper again.
export class LinkedInAuth {
  public readonly accessToken: string;
  public readonly authorUrn: string;
  public readonly expiresAt?: Date;

  constructor() {
    const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(`LinkedIn adapter missing env vars: ${missing.join(', ')}`);
    }
    this.accessToken = process.env.LINKEDIN_ACCESS_TOKEN!;
    this.authorUrn = process.env.LINKEDIN_AUTHOR_URN!;
    if (!AUTHOR_URN_RE.test(this.authorUrn)) {
      throw new Error(
        `LINKEDIN_AUTHOR_URN must look like urn:li:person:<id> (got "${this.authorUrn}"); ${REAUTH_HINT}.`,
      );
    }

    const rawExpiry = process.env.LINKEDIN_TOKEN_EXPIRES_AT;
    if (rawExpiry) {
      const expiresAt = new Date(rawExpiry);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new Error(`LINKEDIN_TOKEN_EXPIRES_AT is not a valid date: "${rawExpiry}".`);
      }
      this.expiresAt = expiresAt;
    }
  }

  /** Throws when the token has expired; warns on stderr when it expires within 7 days. */
  assertUsable(now: Date = new Date()): void {
    if (!this.expiresAt) return;
    const remaining = this.expiresAt.getTime() - now.getTime();
    if (remaining <= 0) {
      throw new Error(
        `LinkedIn access token expired at ${this.expiresAt.toISOString()}; ${REAUTH_HINT}.`,
      );
    }
    if (remaining < EXPIRY_WARNING_MS) {
      process.stderr.write(
        `\n! LinkedIn access token expires ${this.expiresAt.toISOString()}; ${REAUTH_HINT} soon.\n`,
      );
    }
  }
}
