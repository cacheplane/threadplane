import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http as mswHttp, HttpResponse } from 'msw';
import { http } from './http.ts';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('http()', () => {
  it('returns parsed JSON on 2xx', async () => {
    server.use(
      mswHttp.get('https://api.example.test/ping', () =>
        HttpResponse.json({ ok: true }),
      ),
    );
    const result = await http<{ ok: boolean }>({
      method: 'GET',
      url: 'https://api.example.test/ping',
    });
    expect(result).toEqual({ ok: true });
  });

  it('retries on 5xx then succeeds', async () => {
    let calls = 0;
    server.use(
      mswHttp.get('https://api.example.test/flaky', () => {
        calls++;
        if (calls < 2) return new HttpResponse(null, { status: 503 });
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await http<{ ok: boolean }>({
      method: 'GET',
      url: 'https://api.example.test/flaky',
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('exhausts retries on persistent 5xx and throws', async () => {
    let calls = 0;
    server.use(
      mswHttp.get('https://api.example.test/dead', () => {
        calls++;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    await expect(
      http({ method: 'GET', url: 'https://api.example.test/dead' }),
    ).rejects.toThrow(/HTTP 500/);
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('calls on401 hook and retries when hook returns retry: true', async () => {
    let calls = 0;
    let hookCalled = 0;
    server.use(
      mswHttp.get('https://api.example.test/auth', () => {
        calls++;
        if (calls === 1) return new HttpResponse(null, { status: 401 });
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await http<{ ok: boolean }>({
      method: 'GET',
      url: 'https://api.example.test/auth',
      on401: async () => {
        hookCalled++;
        return { retry: true };
      },
    });
    expect(result).toEqual({ ok: true });
    expect(hookCalled).toBe(1);
    expect(calls).toBe(2);
  });

  it('throws when on401 hook returns retry: false', async () => {
    server.use(
      mswHttp.get('https://api.example.test/auth2', () =>
        new HttpResponse(null, { status: 401 }),
      ),
    );
    await expect(
      http({
        method: 'GET',
        url: 'https://api.example.test/auth2',
        on401: async () => ({ retry: false }),
      }),
    ).rejects.toThrow(/HTTP 401/);
  });

  it('throws on non-JSON response with non-2xx', async () => {
    server.use(
      mswHttp.get('https://api.example.test/html', () =>
        new HttpResponse('<html>error</html>', { status: 500 }),
      ),
    );
    await expect(
      http({
        method: 'GET',
        url: 'https://api.example.test/html',
        retryOn5xx: false,
      }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('respects timeoutMs', async () => {
    server.use(
      mswHttp.get('https://api.example.test/slow', async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json({ ok: true });
      }),
    );
    await expect(
      http({
        method: 'GET',
        url: 'https://api.example.test/slow',
        timeoutMs: 50,
        retryOn5xx: false,
      }),
    ).rejects.toThrow(/aborted|timeout/i);
  });
});
