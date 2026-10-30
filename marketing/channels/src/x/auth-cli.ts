// One-time OAuth 2.0 bootstrapper for the X adapter.
// Run via: npm run marketing:channels:x:auth

import http from 'node:http';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { prepareNeonWriter } from '@threadplane-internal/marketing-queue';

const PORT = 8723;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = 'tweet.read tweet.write users.read offline.access media.write';
const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const USERS_ME_URL = 'https://api.x.com/2/users/me';
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
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    fail(
      'X_CLIENT_ID and X_CLIENT_SECRET must be set in your environment.\n' +
        'Create an app at https://developer.x.com/en/portal/dashboard and copy the OAuth 2.0 Client ID and Secret to your .env.',
    );
  }

  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('scope', SCOPES);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

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
      if (returnedState !== state) {
        res.writeHead(400).end('state mismatch');
        clearTimeout(timer);
        server.close();
        reject(new Error('OAuth state parameter mismatch.'));
        return;
      }
      if (!code) {
        res.writeHead(400).end('missing code');
        clearTimeout(timer);
        server.close();
        reject(new Error('OAuth callback missing code parameter.'));
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

  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code: result.code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    client_id: clientId,
  });
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: tokenParams.toString(),
  });
  if (!tokenRes.ok) {
    fail(`Token exchange failed: HTTP ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
  };

  const meRes = await fetch(USERS_ME_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meRes.ok) {
    fail(`Failed to fetch /users/me: HTTP ${meRes.status}`);
  }
  const me = (await meRes.json()) as { data: { username: string } };

  if (writer) {
    const saved = await writer.write('x', {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    });
    if (!saved) fail('Aborted; nothing was written.');
    process.stdout.write(
      `\n✓ Stored X tokens (sealed) in the ${writer.target} database.\n` +
        `Set X_USER_HANDLE=${me.data.username} wherever the dispatcher runs.\n\n`,
    );
    process.exit(0);
  }

  process.stdout.write(
    `\n✓ Got tokens. Add these to .env:\n\n` +
      `X_ACCESS_TOKEN=${tokens.access_token}\n` +
      `X_REFRESH_TOKEN=${tokens.refresh_token}\n` +
      `X_USER_HANDLE=${me.data.username}\n\n`,
  );
  process.exit(0);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
