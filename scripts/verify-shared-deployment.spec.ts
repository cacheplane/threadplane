import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSmokeAssistantStreamTimeoutMs,
  verifyHealth,
} from './verify-shared-deployment';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('shared deployment health', () => {
  it('allows a free deployment cold start within a bounded single authenticated GET', async () => {
    vi.stubEnv('LANGSMITH_API_KEY', 'test-health-key');
    let budget = 0;
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      budget = milliseconds;
      return new AbortController().signal;
    });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      // A measured 32-second cold start must fit without retrying the request.
      expect(budget).toBeGreaterThan(32000);
      expect(budget).toBeLessThanOrEqual(60000);
      expect(init.headers).toEqual({ 'x-api-key': 'test-health-key' });
      expect(init.method ?? 'GET').toBe('GET');
      return new Response('{"ok":true}');
    });
    vi.stubGlobal('fetch', fetchMock);
    await verifyHealth('https://backend.example');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://backend.example/ok');
  });

  it.each([
    [401, '{"detail":"Unauthorized"}', '401'],
    [503, '{"detail":"Unavailable"}', '503'],
    [200, '{"ok":false}', '/ok returned'],
    [200, 'invalid JSON', 'Expected JSON'],
  ])(
    'fails closed without retries for HTTP %s and body %s',
    async (status, body, message) => {
      const fetchMock = vi.fn(async () => new Response(body, { status }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(verifyHealth('https://backend.example')).rejects.toThrow(
        message
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it('propagates health timeout without replaying a request', async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException('Health timeout', 'TimeoutError');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(verifyHealth('https://backend.example')).rejects.toThrow(
      'Health timeout'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps assistant stream budgets separate from readiness', () => {
    expect(getSmokeAssistantStreamTimeoutMs('streaming')).toBe(30000);
    expect(getSmokeAssistantStreamTimeoutMs('da-planning')).toBe(90000);
    expect(getSmokeAssistantStreamTimeoutMs('c-generative-ui')).toBe(90000);
  });
});
