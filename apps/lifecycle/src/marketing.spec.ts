import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMarketingDependencies,
  createMarketingDispatch,
} from './marketing.js';
import type { SqlExecutor } from './growth.js';

const queue = vi.hoisted(() => ({
  loadAdapterOptions: vi.fn(),
  claimAlert: vi.fn(),
  releaseAlertClaim: vi.fn(),
  dispatchMarketingPosts: vi.fn(),
}));

vi.mock('../../../marketing/queue/src/index.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../marketing/queue/src/index.ts')
  >()),
  ...queue,
}));

const executor = {
  execute: vi.fn(),
  transaction: vi.fn(),
} as unknown as SqlExecutor;

beforeEach(async () => {
  vi.clearAllMocks();
  const actual = await vi.importActual<
    typeof import('../../../marketing/queue/src/index.ts')
  >('../../../marketing/queue/src/index.ts');
  queue.loadAdapterOptions.mockImplementation(actual.loadAdapterOptions);
  queue.claimAlert.mockResolvedValue(true);
  queue.releaseAlertClaim.mockResolvedValue(undefined);
});

function build(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = vi.fn() as unknown as typeof fetch
) {
  return createMarketingDependencies(executor, env, { fetch: fetchImpl });
}

describe('createMarketingDispatch', () => {
  it('returns a dispatcher function without reading the environment eagerly', () => {
    expect(typeof createMarketingDispatch({})).toBe('function');
  });
});

describe('createMarketingDependencies', () => {
  it('loads the credentials key lazily so a missing key rejects only when used', async () => {
    const deps = build({});
    await expect(deps.loadAdapterOptions()).rejects.toThrow(
      /MARKETING_CREDENTIALS_KEY|key/iu
    );
  });

  it('fetches media as a Buffer', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const media = await build(
      {},
      fetchImpl as unknown as typeof fetch
    ).fetchMedia('https://blob.test/a.png');
    expect(Buffer.isBuffer(media)).toBe(true);
    expect([...media]).toEqual([1, 2, 3]);
  });

  it('rejects when media cannot be fetched', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('no', { status: 404 }));
    await expect(
      build({}, fetchImpl as unknown as typeof fetch).fetchMedia(
        'https://blob.test/a.png'
      )
    ).rejects.toThrow(/404/u);
  });

  it('treats only a 200 as live, following redirects with a timeout', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(new Response('x', { status: 404 }));
    const deps = build({}, fetchImpl as unknown as typeof fetch);
    expect(await deps.checkLive('https://threadplane.ai/blog/a')).toBe(true);
    expect(await deps.checkLive('https://threadplane.ai/blog/b')).toBe(false);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe('follow');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('triggers the deploy hook and requires it to be configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    await build(
      { MARKETING_WEBSITE_DEPLOY_HOOK_URL: 'https://hook.test/deploy' },
      fetchImpl as unknown as typeof fetch
    ).triggerDeploy();
    expect(fetchImpl.mock.calls[0][0]).toBe('https://hook.test/deploy');
    expect((fetchImpl.mock.calls[0][1] as RequestInit).method).toBe('POST');
    await expect(build({}).triggerDeploy()).rejects.toThrow(
      'MARKETING_WEBSITE_DEPLOY_HOOK_URL'
    );
  });
});

describe('devtoHasCanonical', () => {
  const devtoOptions = { devto: { credentials: { apiKey: 'dev-key-123' } } };
  const KEY = Buffer.alloc(32, 1).toString('base64');
  const env = { MARKETING_CREDENTIALS_KEY: KEY };

  it('returns the article url for a matching canonical url and sends the stored api key', async () => {
    queue.loadAdapterOptions.mockResolvedValue(devtoOptions);
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json([
        {
          canonical_url: 'https://threadplane.ai/other',
          url: 'https://dev.to/o',
        },
        { canonical_url: 'https://threadplane.ai/a', url: 'https://dev.to/a' },
      ])
    );
    const url = await build(
      env,
      fetchImpl as unknown as typeof fetch
    ).devtoHasCanonical('https://threadplane.ai/a');
    expect(url).toBe('https://dev.to/a');
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://dev.to/api/articles/me/all?per_page=1000'
    );
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      'api-key': 'dev-key-123',
    });
  });

  it('returns null when no article has that canonical url', async () => {
    queue.loadAdapterOptions.mockResolvedValue(devtoOptions);
    const fetchImpl = vi.fn().mockResolvedValue(Response.json([]));
    await expect(
      build(env, fetchImpl as unknown as typeof fetch).devtoHasCanonical(
        'https://threadplane.ai/a'
      )
    ).resolves.toBeNull();
  });

  it('throws when dev.to answers non-ok', async () => {
    queue.loadAdapterOptions.mockResolvedValue(devtoOptions);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('no', { status: 503 }));
    await expect(
      build(env, fetchImpl as unknown as typeof fetch).devtoHasCanonical(
        'https://threadplane.ai/a'
      )
    ).rejects.toThrow(/503/u);
  });

  it('throws when dev.to credentials are missing', async () => {
    queue.loadAdapterOptions.mockResolvedValue({});
    const fetchImpl = vi.fn();
    await expect(
      build(env, fetchImpl as unknown as typeof fetch).devtoHasCanonical(
        'https://threadplane.ai/a'
      )
    ).rejects.toThrow(/credentials/u);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('alert sender wiring', () => {
  const env = {
    RESEND_API_KEY: 're_test_key',
    MARKETING_ALERT_FROM: 'alerts@threadplane.ai',
    FOUNDER_NOTIFICATION_EMAIL: 'founder@example.com',
  };

  it('claims on the passed executor and sends from/to the configured addresses without an idempotency key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ id: 'em_1' }));
    await build(env, fetchImpl as unknown as typeof fetch).alert(
      'k1',
      'Subject',
      'Body'
    );
    expect(queue.claimAlert).toHaveBeenCalledWith(executor, 'k1');
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      from: 'alerts@threadplane.ai',
      to: 'founder@example.com',
      subject: 'Subject',
      text: 'Body',
    });
    expect(init.headers).not.toHaveProperty('Idempotency-Key');
    expect(queue.releaseAlertClaim).not.toHaveBeenCalled();
  });

  it('releases the claim on the passed executor when the send fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(Response.json({ message: 'down' }, { status: 500 }));
    await expect(
      build(env, fetchImpl as unknown as typeof fetch).alert('k2', 'S', 'B')
    ).rejects.toThrow(/k2/u);
    expect(queue.releaseAlertClaim).toHaveBeenCalledWith(executor, 'k2');
  });

  it('does not send when the claim is already held', async () => {
    queue.claimAlert.mockResolvedValue(false);
    const fetchImpl = vi.fn();
    await build(env, fetchImpl as unknown as typeof fetch).alert(
      'k3',
      'S',
      'B'
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('createMarketingDispatch wiring', () => {
  it('loadAdapterOptions receives the root executor, limit 5 and the step signal', async () => {
    queue.dispatchMarketingPosts.mockResolvedValue({
      posted: 0,
      waiting: 0,
      failed: 0,
      alerts: [],
      alertErrors: [],
    });
    queue.loadAdapterOptions.mockResolvedValue({});
    const env = {
      MARKETING_CREDENTIALS_KEY: Buffer.alloc(32, 1).toString('base64'),
    };
    const signal = new AbortController().signal;
    await createMarketingDispatch(env)(executor, signal);
    const [ex, input, deps] = queue.dispatchMarketingPosts.mock.calls[0];
    expect(ex).toBe(executor);
    expect(input).toEqual({ limit: 5, signal });
    await deps.loadAdapterOptions();
    expect(queue.loadAdapterOptions.mock.calls[0][0]).toBe(executor);
  });

  it('aborts real requests when the step signal aborts', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason)
          )
        )
    );
    const pending = createMarketingDependencies(
      executor,
      {},
      { fetch: fetchImpl as unknown as typeof fetch, signal: controller.signal }
    ).checkLive('https://threadplane.ai/x');
    controller.abort(new Error('step budget'));
    await expect(pending).rejects.toThrow('step budget');
  });
});
