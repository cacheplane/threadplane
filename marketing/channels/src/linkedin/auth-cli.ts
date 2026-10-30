// One-time OAuth 2.0 bootstrapper for the LinkedIn adapter.
// Run via: npm run marketing:channels:linkedin:auth
//
// LinkedIn access tokens last 60 days and self-serve apps get no refresh token,
// so re-run this when the adapter reports the token has expired.

import http from 'node:http';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { prepareNeonWriter } from '@threadplane-internal/marketing-queue';

const PORT = 8724;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = 'openid profile w_member_social';
const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const TIMEOUT_MS = 5 * 60 * 1000;

function fail(msg: string): never {
  process.stderr.write(`✗ ${msg}\n`);
  process.exit(1);
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function openInBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {
    /* best-effort; user can copy-paste */
  });
}

async function main(): Promise<void> {
  let writer: ReturnType<typeof prepareNeonWriter>;
  try {
    writer = prepareNeonWriter(process.argv.slice(2), process.env);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    fail(
      'LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set in your environment.\n' +
        'Create an app at https://www.linkedin.com/developers/apps, add the "Share on LinkedIn" and\n' +
        '"Sign In with LinkedIn using OpenID Connect" products, add the redirect URL\n' +
        `${REDIRECT_URI} under Auth, and copy the Client ID and Primary Client Secret to your .env.`,
    );
  }

  const state = b64url(crypto.randomBytes(16));

  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('scope', SCOPES);
  authorizeUrl.searchParams.set('state', state);

  process.stdout.write(`\nOpening browser to authorize Threadplane marketing app...\n${authorizeUrl.toString()}\n\n`);
  openInBrowser(authorizeUrl.toString());

  const result = await new Promise<{ code: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for OAuth callback after 5 minutes.'));
    }, TIMEOUT_MS);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      if (returnedState !== state) {
        res.writeHead(400).end('state mismatch');
        clearTimeout(timer);
        server.close();
        reject(new Error('OAuth state parameter mismatch.'));
        return;
      }
      if (error || !code) {
        res.writeHead(400).end('authorization failed');
        clearTimeout(timer);
        server.close();
        reject(
          new Error(
            `OAuth callback returned ${error ?? 'no code'}: ${url.searchParams.get('error_description') ?? ''}`,
          ),
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(
        '<html><body><h1>Got it — you can close this tab.</h1></body></html>',
      );
      clearTimeout(timer);
      server.close();
      resolve({ code });
    });
    server.listen(PORT);
  });

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: result.code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!tokenRes.ok) {
    fail(`Token exchange failed: HTTP ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const tokens = (await tokenRes.json()) as { access_token: string; expires_in: number };

  const meRes = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meRes.ok) {
    fail(`Failed to fetch /v2/userinfo: HTTP ${meRes.status}`);
  }
  const me = (await meRes.json()) as { sub: string; name?: string };
  const expiresAtDate = new Date(Date.now() + tokens.expires_in * 1000);
  const expiresAt = expiresAtDate.toISOString();

  if (writer) {
    const saved = await writer.write(
      'linkedin',
      {
        accessToken: tokens.access_token,
        authorUrn: `urn:li:person:${me.sub}`,
      },
      expiresAtDate,
    );
    if (!saved) fail('Aborted; nothing was written.');
    process.stdout.write(
      `\n✓ Stored LinkedIn token (sealed) in the ${writer.target} database. Expires ${expiresAt}.\n\n`,
    );
    process.exit(0);
  }

  process.stdout.write(
    `\n✓ Authorized${me.name ? ` as ${me.name}` : ''}. Add these to .env:\n\n` +
      `LINKEDIN_ACCESS_TOKEN=${tokens.access_token}\n` +
      `LINKEDIN_AUTHOR_URN=urn:li:person:${me.sub}\n` +
      `LINKEDIN_TOKEN_EXPIRES_AT=${expiresAt}\n\n`,
  );
  process.exit(0);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
