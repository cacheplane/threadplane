import { expect, test, vi } from 'vitest';

import { createInboxRecoveryRoute } from './route';

test('recovery refuses missing or wrong bearer authorization before any work', async () => {
  const recover = vi.fn();
  const route = createInboxRecoveryRoute({
    secret: () => 's'.repeat(32),
    recover,
  });

  expect((await route.GET(new Request('https://threadplane.ai'))).status).toBe(
    401
  );
  expect(
    (
      await route.GET(
        new Request('https://threadplane.ai', {
          headers: { authorization: 'Bearer wrong' },
        })
      )
    ).status
  ).toBe(401);
  expect(recover).not.toHaveBeenCalled();
});

test('recovery failure is generic and cannot masquerade as a successful scan', async () => {
  const route = createInboxRecoveryRoute({
    secret: () => 's'.repeat(32),
    recover: async () => {
      throw new Error('private detail');
    },
  });

  const response = await route.GET(
    new Request('https://threadplane.ai', {
      headers: { authorization: `Bearer ${'s'.repeat(32)}` },
    })
  );

  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private detail');
});

test('authorized recovery returns only aggregate counts', async () => {
  const route = createInboxRecoveryRoute({
    secret: () => 's'.repeat(32),
    recover: async () => ({ received: 2, processed: 1 }),
  });

  const response = await route.GET(
    new Request('https://threadplane.ai', {
      headers: { authorization: `Bearer ${'s'.repeat(32)}` },
    })
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ received: 2, processed: 1 });
});
