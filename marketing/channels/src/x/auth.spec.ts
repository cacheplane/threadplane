import { describe, expect, it, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http as mswHttp, HttpResponse } from 'msw';
import { XAuth } from './auth.ts';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const env = {
  X_CLIENT_ID: 'cid',
  X_CLIENT_SECRET: 'csec',
  X_ACCESS_TOKEN: 'access-1',
  X_REFRESH_TOKEN: 'refresh-1',
  X_USER_HANDLE: 'brian',
};

let origEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  origEnv = { ...process.env };
  Object.assign(process.env, env);
});
afterEach(() => {
  process.env = origEnv;
});

describe('XAuth construction', () => {
  it('reads required env vars', () => {
    const auth = new XAuth();
    expect(auth.userHandle).toBe('brian');
    expect(auth.accessToken).toBe('access-1');
  });

  it('throws with the list of missing env vars', () => {
    delete process.env.X_ACCESS_TOKEN;
    delete process.env.X_USER_HANDLE;
    expect(() => new XAuth()).toThrow(/X_ACCESS_TOKEN, X_USER_HANDLE/);
  });
});

describe('XAuth.refresh', () => {
  it('refreshes on demand and updates in-memory tokens', async () => {
    server.use(
      mswHttp.post('https://api.x.com/2/oauth2/token', async ({ request }) => {
        const body = await request.text();
        expect(body).toContain('grant_type=refresh_token');
        expect(body).toContain('refresh_token=refresh-1');
        const authHeader = request.headers.get('authorization');
        expect(authHeader).toMatch(/^Basic /);
        return HttpResponse.json({
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          token_type: 'bearer',
          expires_in: 7200,
        });
      }),
    );
    const auth = new XAuth();
    await auth.refresh();
    expect(auth.accessToken).toBe('access-2');
    expect(auth.refreshToken).toBe('refresh-2');
  });

  it('reports successful refresh without printing credentials', async () => {
    server.use(
      mswHttp.post('https://api.x.com/2/oauth2/token', () =>
        HttpResponse.json({
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          token_type: 'bearer',
          expires_in: 7200,
        }),
      ),
    );
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const auth = new XAuth();
    await auth.refresh();
    expect(spy).toHaveBeenCalled();
    const written = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('X refresh successful');
    for (const secret of [...Object.values(env).slice(0, 4), 'access-2', 'refresh-2']) {
      expect(written).not.toContain(secret);
    }
    spy.mockRestore();
  });

  it('throws with bootstrapper hint when refresh fails', async () => {
    server.use(
      mswHttp.post('https://api.x.com/2/oauth2/token', () =>
        new HttpResponse('{"error":"invalid_grant"}', { status: 400 }),
      ),
    );
    const auth = new XAuth();
    await expect(auth.refresh()).rejects.toThrow(/marketing:channels:x:auth/);
  });
});

describe('XAuth with injected credentials', () => {
  const credentials = {
    clientId: 'icid',
    clientSecret: 'icsec',
    accessToken: 'i-access',
    refreshToken: 'i-refresh',
    userHandle: 'injected',
  };

  it('ignores env', () => {
    for (const k of Object.keys(env)) delete process.env[k];
    const auth = new XAuth({ credentials });
    expect(auth.accessToken).toBe('i-access');
    expect(auth.userHandle).toBe('injected');
  });

  it('awaits onTokensRotated with the new pair before refresh resolves', async () => {
    server.use(
      mswHttp.post('https://api.x.com/2/oauth2/token', () =>
        HttpResponse.json({
          access_token: 'a2',
          refresh_token: 'r2',
          token_type: 'bearer',
          expires_in: 7200,
        }),
      ),
    );
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let persisted = false;
    const onTokensRotated = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      persisted = true;
    });
    const auth = new XAuth({ credentials, onTokensRotated });
    await auth.refresh();
    expect(persisted).toBe(true);
    expect(onTokensRotated).toHaveBeenCalledTimes(1);
    expect(onTokensRotated).toHaveBeenCalledWith({ accessToken: 'a2', refreshToken: 'r2' });
    expect(auth.accessToken).toBe('a2');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('finishes and persists a refresh even when the caller signal aborts', async () => {
    const controller = new AbortController();
    server.use(
      mswHttp.post('https://api.x.com/2/oauth2/token', async () => {
        // The step budget runs out while X is rotating the token.
        controller.abort();
        await new Promise((r) => setTimeout(r, 5));
        return HttpResponse.json({
          access_token: 'a3',
          refresh_token: 'r3',
          token_type: 'bearer',
          expires_in: 7200,
        });
      }),
    );
    const onTokensRotated = vi.fn(() => Promise.resolve());
    const auth = new XAuth({ credentials, onTokensRotated, signal: controller.signal });
    await auth.refresh();
    expect(onTokensRotated).toHaveBeenCalledWith({ accessToken: 'a3', refreshToken: 'r3' });
    expect(auth.refreshToken).toBe('r3');
  });
});
