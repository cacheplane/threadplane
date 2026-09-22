import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../..'
);

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createLifecycleCronRoute } from './route';

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/cron/lifecycle', () => {
  it.each([undefined, '', 'Bearer wrong', 'bearer cron-secret'])(
    'rejects a missing or wrong Vercel cron token: %s',
    async (authorization) => {
      const invoke = vi.fn();
      const route = createLifecycleCronRoute({ invoke });
      vi.stubEnv('CRON_SECRET', 'cron-secret');
      const response = await route(
        new Request('https://threadplane.ai/api/cron/lifecycle', {
          headers: authorization ? { authorization } : {},
        })
      );

      expect(response.status).toBe(401);
      expect(invoke).not.toHaveBeenCalled();
    }
  );

  it('invokes Dawn with server-only configuration and returns a bounded result', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.stubEnv('LIFECYCLE_CRON_ENABLED', 'true');
    vi.stubEnv('LIFECYCLE_DAWN_URL', 'https://lifecycle.example');
    vi.stubEnv('LIFECYCLE_SERVICE_SECRET', 'service-secret');
    const invoke = vi.fn().mockResolvedValue({
      operatorAlerts: [],
      threadId: '00000000-0000-4000-8000-000000000001',
    });
    const route = createLifecycleCronRoute({ invoke });

    const response = await route(
      new Request('https://threadplane.ai/api/cron/lifecycle', {
        headers: { authorization: 'Bearer cron-secret' },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accepted: true,
      operator_alerts: [],
    });
    expect(invoke).toHaveBeenCalledWith({
      baseUrl: 'https://lifecycle.example',
      serviceSecret: 'service-secret',
      timeoutMs: 15_000,
      trigger: 'cron',
    });
  });

  it('surfaces only the closed recovery alert to operators', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.stubEnv('LIFECYCLE_CRON_ENABLED', 'true');
    vi.stubEnv('LIFECYCLE_DAWN_URL', 'https://lifecycle.example');
    vi.stubEnv('LIFECYCLE_SERVICE_SECRET', 'service-secret');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const route = createLifecycleCronRoute({
      invoke: vi.fn().mockResolvedValue({
        operatorAlerts: ['mailbox_recovery_required'],
        threadId: '00000000-0000-4000-8000-000000000001',
      }),
    });

    const response = await route(
      new Request('https://threadplane.ai/api/cron/lifecycle', {
        headers: { authorization: 'Bearer cron-secret' },
      })
    );

    expect(await response.json()).toEqual({
      accepted: true,
      operator_alerts: ['mailbox_recovery_required'],
    });
    expect(warn).toHaveBeenCalledWith(
      '[lifecycle-operator-alert]',
      'mailbox_recovery_required'
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      '00000000-0000-4000-8000-000000000001'
    );
    warn.mockRestore();
  });

  it('fails closed on missing service configuration or a bounded upstream error', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.stubEnv('LIFECYCLE_CRON_ENABLED', 'true');
    const route = createLifecycleCronRoute({
      invoke: vi.fn().mockRejectedValue(new Error('upstream secret detail')),
    });
    const response = await route(
      new Request('https://threadplane.ai/api/cron/lifecycle', {
        headers: { authorization: 'Bearer cron-secret' },
      })
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ accepted: false });
  });

  it('keeps cron dispatch disabled until the dogfood gate is explicitly enabled', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.stubEnv('LIFECYCLE_DAWN_URL', 'https://lifecycle.example');
    vi.stubEnv('LIFECYCLE_SERVICE_SECRET', 'service-secret');
    const invoke = vi.fn();
    const route = createLifecycleCronRoute({ invoke });

    const response = await route(
      new Request('https://threadplane.ai/api/cron/lifecycle', {
        headers: { authorization: 'Bearer cron-secret' },
      })
    );

    expect(response.status).toBe(503);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('registers one fifteen-minute fallback cron so idle Dawn computes can suspend', () => {
    const config = JSON.parse(
      readFileSync(resolve(REPOSITORY_ROOT, 'vercel.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(config['crons']).toEqual([
      { path: '/api/cron/lifecycle', schedule: '*/15 * * * *' },
    ]);
    expect(JSON.stringify(config)).not.toMatch(
      /NEXT_PUBLIC_(?:CRON|LIFECYCLE)/u
    );
  });
});
