import { describe, expect, it, test, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { invokeLifecycle } from './lifecycle-client';

const VALID_CRON_STATE = JSON.stringify({
  trigger: 'cron',
  result: {
    dispatched: 0,
    leased: 0,
    operatorAlerts: [],
    recoveryPaused: false,
  },
});
const REDIRECT_CASES = ([301, 302, 307, 308] as const).flatMap((status) => [
  { location: 'https://lifecycle.example/redirected', status },
  { location: 'https://other.example/redirected', status },
]);

function streamedResponse(
  chunks: readonly Uint8Array[],
  options: {
    headers?: HeadersInit;
    status?: number;
    onCancel?: () => void;
    failAfterChunks?: Error;
  } = {}
): Response {
  const queued = [...chunks];
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = queued.shift();
        if (chunk) {
          controller.enqueue(chunk);
          return;
        }
        if (options.failAfterChunks) {
          controller.error(options.failAfterChunks);
          return;
        }
        controller.close();
      },
      cancel() {
        options.onCancel?.();
      },
    }),
    { headers: options.headers, status: options.status }
  );
}

describe('invokeLifecycle', () => {
  it('uses a unique UUID thread, exact workflow route, and service bearer token', async () => {
    const fetch = vi.fn().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as {
        input: Record<string, unknown>;
      };
      return new Response(
        JSON.stringify({
          ...request.input,
          result: {
            dispatched: 1,
            leased: 1,
            operatorAlerts: [],
            recoveryPaused: false,
          },
        })
      );
    });

    const first = await invokeLifecycle(
      {
        baseUrl: 'https://lifecycle.example/',
        serviceSecret: 'service-secret',
        trigger: 'cron',
      },
      { fetch }
    );
    const second = await invokeLifecycle(
      {
        baseUrl: 'https://lifecycle.example',
        serviceSecret: 'service-secret',
        submissionId: '00000000-0000-4000-8000-000000000001',
        trigger: 'nudge',
      },
      { fetch }
    );

    expect(first.threadId).not.toBe(second.threadId);
    expect(first.threadId).toMatch(/^[0-9a-f-]{36}$/u);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://lifecycle.example/threads/${first.threadId}/runs/wait`
    );
    expect(init.headers).toEqual({
      authorization: 'Bearer service-secret',
      'content-type': 'application/json',
    });
    expect(init.redirect).toBe('error');
    expect(JSON.parse(String(init.body))).toEqual({
      route: '/dispatch#workflow',
      input: { trigger: 'cron' },
    });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      route: '/dispatch#workflow',
      input: {
        submission_id: '00000000-0000-4000-8000-000000000001',
        trigger: 'nudge',
      },
    });
    expect(first.operatorAlerts).toEqual([]);
  });

  it.each(REDIRECT_CASES)(
    'refuses $status authenticated redirects to $location',
    async ({ location, status }) => {
      const fetch = vi.fn().mockImplementation(async (_url, init) => {
        if (init?.redirect === 'error') {
          throw new TypeError('redirect refused');
        }
        return new Response(VALID_CRON_STATE);
      });

      let message = '';
      try {
        await invokeLifecycle(
          {
            baseUrl: 'https://lifecycle.example',
            serviceSecret: 'synthetic-secret',
            trigger: 'cron',
          },
          { fetch }
        );
      } catch (error) {
        message = String(error);
      }

      expect(status).toBeGreaterThanOrEqual(301);
      expect(location).toMatch(/^https:\/\//u);
      expect(message).toBe('Error: Lifecycle dispatch request failed');
      expect(message).not.toContain('synthetic-secret');
      expect(message).not.toContain(location);
    }
  );

  it.each(REDIRECT_CASES)(
    'rejects an surfaced $status redirect response to $location',
    async ({ location, status }) => {
      const response = new Response(null, {
        headers: { location },
        status,
      });
      let message = '';
      try {
        await invokeLifecycle(
          {
            baseUrl: 'https://lifecycle.example',
            serviceSecret: 'synthetic-secret',
            trigger: 'cron',
          },
          { fetch: vi.fn().mockResolvedValue(response) }
        );
      } catch (error) {
        message = String(error);
      }

      expect(message).toBe('Error: Lifecycle dispatch was not accepted');
      expect(message).not.toContain('synthetic-secret');
      expect(message).not.toContain(location);
    }
  );

  it('returns only the closed mailbox recovery alert from Dawn state', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          trigger: 'cron',
          result: {
            dispatched: 0,
            leased: 0,
            operatorAlerts: ['mailbox_recovery_required'],
            recoveryPaused: true,
          },
        })
      )
    );

    const result = await invokeLifecycle(
      {
        baseUrl: 'https://lifecycle.example',
        serviceSecret: 'service-secret',
        trigger: 'cron',
      },
      { fetch }
    );

    expect(result.operatorAlerts).toEqual(['mailbox_recovery_required']);
  });

  it.each(['65537', '-1', 'not-a-number'])(
    'rejects and cancels an invalid or oversized declared response length: %s',
    async (contentLength) => {
      let cancelled = false;
      const response = streamedResponse(
        [new TextEncoder().encode(VALID_CRON_STATE)],
        {
          headers: { 'content-length': contentLength },
          onCancel: () => {
            cancelled = true;
          },
        }
      );

      await expect(
        invokeLifecycle(
          {
            baseUrl: 'https://lifecycle.example',
            serviceSecret: 'secret',
            trigger: 'cron',
          },
          { fetch: vi.fn().mockResolvedValue(response) }
        )
      ).rejects.toThrow('Lifecycle dispatch returned invalid state');
      expect(cancelled).toBe(true);
      expect(response.body?.locked).toBe(false);
    }
  );

  it('rejects an understated chunked response once actual bytes exceed the cap', async () => {
    let cancelled = false;
    const oversizedValidJson = `${' '.repeat(65_537)}${VALID_CRON_STATE}`;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(oversizedValidJson.slice(0, 40_000))
          );
          controller.enqueue(
            new TextEncoder().encode(oversizedValidJson.slice(40_000))
          );
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { 'content-length': '1' } }
    );

    await expect(
      invokeLifecycle(
        {
          baseUrl: 'https://lifecycle.example',
          serviceSecret: 'secret',
          trigger: 'cron',
        },
        { fetch: vi.fn().mockResolvedValue(response) }
      )
    ).rejects.toThrow('Lifecycle dispatch returned invalid state');
    expect(cancelled).toBe(true);
    expect(response.body?.locked).toBe(false);
  });

  it('rejects malformed UTF-8 with a closed error and releases the reader', async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0xc3, 0x28]));
        },
        cancel() {
          cancelled = true;
        },
      })
    );

    await expect(
      invokeLifecycle(
        {
          baseUrl: 'https://lifecycle.example',
          serviceSecret: 'secret',
          trigger: 'cron',
        },
        { fetch: vi.fn().mockResolvedValue(response) }
      )
    ).rejects.toThrow('Lifecycle dispatch returned invalid state');
    expect(cancelled).toBe(true);
    expect(response.body?.locked).toBe(false);
  });

  it('rejects malformed JSON with a closed error and leaves the stream terminal', async () => {
    const response = streamedResponse([new TextEncoder().encode('{')]);

    await expect(
      invokeLifecycle(
        {
          baseUrl: 'https://lifecycle.example',
          serviceSecret: 'secret',
          trigger: 'cron',
        },
        { fetch: vi.fn().mockResolvedValue(response) }
      )
    ).rejects.toThrow('Lifecycle dispatch returned invalid state');
    expect(response.bodyUsed).toBe(true);
    expect(response.body?.locked).toBe(false);
  });

  it('closes stream read failures without leaking details and releases the reader', async () => {
    const response = streamedResponse([], {
      failAfterChunks: new Error('private stream detail'),
    });

    await expect(
      invokeLifecycle(
        {
          baseUrl: 'https://lifecycle.example',
          serviceSecret: 'secret',
          trigger: 'cron',
        },
        { fetch: vi.fn().mockResolvedValue(response) }
      )
    ).rejects.toThrow('Lifecycle dispatch returned invalid state');
    expect(response.body?.locked).toBe(false);
  });

  it('keeps the request timeout active while streaming the response body', async () => {
    let response: Response | undefined;
    const fetch = vi
      .fn()
      .mockImplementation(async (_url, init?: RequestInit) => {
        response = new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener('abort', () => {
                controller.error(new Error('private abort detail'));
              });
            },
          })
        );
        return response;
      });

    await expect(
      invokeLifecycle(
        {
          baseUrl: 'https://lifecycle.example',
          serviceSecret: 'secret',
          timeoutMs: 250,
          trigger: 'cron',
        },
        { fetch }
      )
    ).rejects.toThrow('Lifecycle dispatch returned invalid state');
    expect(response?.body?.locked).toBe(false);
  });

  it('cancels an unread non-success response before returning a closed error', async () => {
    let cancelled = false;
    const response = streamedResponse(
      [new TextEncoder().encode('private body')],
      {
        onCancel: () => {
          cancelled = true;
        },
        status: 503,
      }
    );

    await expect(
      invokeLifecycle(
        {
          baseUrl: 'https://lifecycle.example',
          serviceSecret: 'secret',
          trigger: 'cron',
        },
        { fetch: vi.fn().mockResolvedValue(response) }
      )
    ).rejects.toThrow('Lifecycle dispatch was not accepted');
    expect(cancelled).toBe(true);
    expect(response.body?.locked).toBe(false);
  });

  it.each([
    '{}',
    '{"trigger":"cron","result":{"operatorAlerts":["unknown"]}}',
    '{"trigger":"cron","result":{"operatorAlerts":[],"recoveryPaused":false,"leased":0,"dispatched":0},"extra":"unsafe"}',
  ])('fails closed on unsupported Dawn state: %s', async (body) => {
    await expect(
      invokeLifecycle(
        {
          baseUrl: 'https://lifecycle.example',
          serviceSecret: 'service-secret',
          trigger: 'cron',
        },
        { fetch: vi.fn().mockResolvedValue(new Response(body)) }
      )
    ).rejects.toThrow('Lifecycle dispatch returned invalid state');
  });

  it('uses a bounded timeout and rejects non-success without exposing the secret', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response('provider detail', { status: 503 }));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(
      invokeLifecycle(
        {
          baseUrl: 'https://lifecycle.example',
          serviceSecret: 'do-not-log-this',
          timeoutMs: 1_000,
          trigger: 'cron',
        },
        { fetch }
      )
    ).rejects.toThrow('Lifecycle dispatch was not accepted');
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      'do-not-log-this'
    );
    consoleError.mockRestore();
  });

  it('aborts a stalled lifecycle request at the configured timeout', async () => {
    const fetch = vi.fn().mockImplementation(
      async (_url: string, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        })
    );

    await expect(
      invokeLifecycle(
        {
          baseUrl: 'https://lifecycle.example',
          serviceSecret: 'do-not-log-this',
          timeoutMs: 250,
          trigger: 'cron',
        },
        { fetch }
      )
    ).rejects.toThrow('Lifecycle dispatch request failed');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects an unsafe generated thread ID before making a request', async () => {
    const fetch = vi.fn();

    await expect(
      invokeLifecycle(
        {
          baseUrl: 'https://lifecycle.example',
          serviceSecret: 'secret',
          trigger: 'cron',
        },
        { fetch, randomUUID: () => '../unsafe' }
      )
    ).rejects.toThrow(/thread ID/u);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never includes caller-provided PII fields in a nudge payload', async () => {
    const fetch = vi.fn().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as {
        input: Record<string, unknown>;
      };
      return new Response(
        JSON.stringify({
          ...request.input,
          result: {
            dispatched: 0,
            leased: 0,
            operatorAlerts: [],
            recoveryPaused: false,
          },
        })
      );
    });

    await invokeLifecycle(
      {
        baseUrl: 'https://lifecycle.example',
        serviceSecret: 'secret',
        submissionId: '00000000-0000-4000-8000-000000000001',
        trigger: 'nudge',
        email: 'private@example.com',
        name: 'Private Name',
        message: 'Private message',
      } as Parameters<typeof invokeLifecycle>[0],
      {
        fetch,
        randomUUID: () => '00000000-0000-4000-8000-000000000002',
      }
    );

    const body = String(fetch.mock.calls[0]?.[1]?.body);
    expect(body).toContain('00000000-0000-4000-8000-000000000001');
    expect(body).not.toContain('private@example.com');
    expect(body).not.toContain('Private Name');
    expect(body).not.toContain('Private message');
  });

  it.each(['', 'ftp://example.test', 'https://example.test/path?secret=value'])(
    'rejects an unsafe lifecycle base URL: %s',
    async (baseUrl) => {
      await expect(
        invokeLifecycle(
          { baseUrl, serviceSecret: 'secret', trigger: 'cron' },
          { fetch: vi.fn() }
        )
      ).rejects.toThrow(/base URL/u);
    }
  );
});

test('accepts the cron bridge deadline needed to finish a bounded dispatcher tick', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(VALID_CRON_STATE));

  const result = await invokeLifecycle(
    {
      baseUrl: 'https://lifecycle.example',
      serviceSecret: 'secret',
      timeoutMs: 55_000,
      trigger: 'cron',
    },
    { fetch }
  );

  expect(result.operatorAlerts).toEqual([]);
  expect(fetch).toHaveBeenCalledOnce();
});
