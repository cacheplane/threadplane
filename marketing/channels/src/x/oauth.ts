// One-time OAuth 2.0 flow for the X adapter. Tokens are stored in Neon by
// marketing/queue/src/cli/x-auth.ts (npm run marketing:channels:x:auth).

import http from 'node:http';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';

const PORT = 8723;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = 'tweet.read tweet.write users.read offline.access media.write';
const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const USERS_ME_URL = 'https://api.x.com/2/users/me';
const TIMEOUT_MS = 5 * 60 * 1000;

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

export async function runXOAuth(): Promise<{
  accessToken: string;
  refreshToken: string;
  userHandle: string;
}> {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
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
    throw new Error(`Token exchange failed: HTTP ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
  };

  const meRes = await fetch(USERS_ME_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meRes.ok) {
    throw new Error(`Failed to fetch /users/me: HTTP ${meRes.status}`);
  }
  const me = (await meRes.json()) as { data: { username: string } };

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    userHandle: me.data.username,
  };
}
