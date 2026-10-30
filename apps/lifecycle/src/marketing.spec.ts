import { describe, expect, it, vi } from 'vitest';

import {
  createMarketingDependencies,
  createMarketingDispatch,
} from './marketing.js';
import type { SqlExecutor } from './growth.js';

const executor = {
  execute: vi.fn(),
  transaction: vi.fn(),
} as unknown as SqlExecutor;

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
