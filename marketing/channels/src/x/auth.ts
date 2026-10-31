import { http } from '../http.ts';
import type { XCredentials } from '../types.ts';

const TOKEN_URL = 'https://api.x.com/2/oauth2/token';

const REQUIRED_ENV = [
  'X_CLIENT_ID',
  'X_CLIENT_SECRET',
  'X_ACCESS_TOKEN',
  'X_REFRESH_TOKEN',
  'X_USER_HANDLE',
] as const;

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
};

export interface XAuthOptions {
  credentials: XCredentials;
  onTokensRotated?: (t: { accessToken: string; refreshToken: string }) => Promise<void>;
  signal?: AbortSignal;
}

export class XAuth {
  public accessToken: string;
  public refreshToken: string;
  public readonly userHandle: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly onTokensRotated?: XAuthOptions['onTokensRotated'];
  /** Passed to every X request made with this auth. */
  public readonly signal?: AbortSignal;

  constructor(opts?: XAuthOptions) {
    if (opts) {
      const c = opts.credentials;
      this.clientId = c.clientId;
      this.clientSecret = c.clientSecret;
      this.accessToken = c.accessToken;
      this.refreshToken = c.refreshToken;
      this.userHandle = c.userHandle;
      this.onTokensRotated = opts.onTokensRotated;
      this.signal = opts.signal;
      return;
    }
    const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(`X adapter missing env vars: ${missing.join(', ')}`);
    }
    this.clientId = process.env.X_CLIENT_ID!;
    this.clientSecret = process.env.X_CLIENT_SECRET!;
    this.accessToken = process.env.X_ACCESS_TOKEN!;
    this.refreshToken = process.env.X_REFRESH_TOKEN!;
    this.userHandle = process.env.X_USER_HANDLE!;
  }

  async refresh(): Promise<void> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
    });
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    let tokens: TokenResponse;
    try {
      tokens = await http<TokenResponse>({
        method: 'POST',
        url: TOKEN_URL,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
        body: params.toString(),
        // X rotates the refresh token on every refresh; never resend it.
        retryOn5xx: false,
        // No caller signal: aborting after X rotates would lose the new
        // refresh token, and Neon is its only holder. http()'s own timeout
        // still bounds the request.
      });
    } catch (err) {
      throw new Error(
        `X access token expired and refresh failed — re-run \`npm run marketing:channels:x:auth\`. Underlying: ${(err as Error).message}`,
      );
    }
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    if (this.onTokensRotated) {
      await this.onTokensRotated({
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
      });
      return;
    }
    process.stderr.write(
      '\n✓ X refresh successful. Rotated tokens are held in memory only; re-run npm run marketing:channels:x:auth if authentication fails after restart.\n',
    );
  }
}
