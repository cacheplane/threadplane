import { expect, test, vi } from 'vitest';

import { createResendInboundRoute } from './route';

const headers = {
  'svix-id': 'msg_1',
  'svix-timestamp': '1760000000',
  'svix-signature': 'v1,test',
};
const config = {
  enabled: true as const,
  address: 'brian@threadplane.ai',
  startedAt: new Date('2026-10-22T00:00:00Z'),
};

function setup(overrides: Record<string, unknown> = {}) {
  const admit = vi.fn(async () => 'incoming-1');
  const process = vi.fn(async () => 'stopped');
  const close = vi.fn(async () => undefined);
  const verify = vi.fn(() => ({
    type: 'email.received',
    data: { email_id: 'incoming-1', to: [config.address] },
  }));
  const route = createResendInboundRoute({
    loadConfig: () => config,
    loadSecret: () => 'whsec_test',
    verify,
    createDatabase: () => ({ close }),
    admit,
    process,
    loadLinkedInConfig: () => ({ enabled: false }),
    admitLinkedIn: vi.fn(async () => null),
    processLinkedIn: vi.fn(async () => 'parsed'),
    forwardLinkedIn: vi.fn(async () => null),
    ...overrides,
  } as never);
  return { route, admit, process, close, verify };
}

test('inbound endpoint verifies the raw signature before opening the database', async () => {
  const createDatabase = vi.fn();
  const { route } = setup({
    verify: () => {
      throw new Error('bad signature');
    },
    createDatabase,
  });

  const response = await route.POST(
    new Request('https://threadplane.ai/_/webhooks/resend-inbound', {
      method: 'POST',
      headers,
      body: '{}',
    })
  );

  expect(response.status).toBe(400);
  expect(createDatabase).not.toHaveBeenCalled();
});

test('unconfigured receiving refuses mail and oversize payloads are rejected', async () => {
  const disabled = setup({ loadConfig: () => ({ enabled: false }) });
  const enabled = setup();

  expect(
    (
      await disabled.route.POST(
        new Request('https://threadplane.ai', {
          method: 'POST',
          headers,
          body: '{}',
        })
      )
    ).status
  ).toBe(503);
  expect(
    (
      await enabled.route.POST(
        new Request('https://threadplane.ai', {
          method: 'POST',
          headers,
          body: 'x'.repeat(65537),
        })
      )
    ).status
  ).toBe(413);
});

test('a durable early reply is accepted for recovery and the database is closed', async () => {
  const process = vi.fn(async () => 'pending');
  const { route, admit, close } = setup({ process });

  const response = await route.POST(
    new Request('https://threadplane.ai', {
      method: 'POST',
      headers,
      body: '{}',
    })
  );

  expect(response.status).toBe(200);
  expect(admit).toHaveBeenCalled();
  expect(process).toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});

test('a database admission failure requests provider retry', async () => {
  const { route, close } = setup({
    admit: async () => {
      throw new Error('unavailable');
    },
  });

  expect(
    (
      await route.POST(
        new Request('https://threadplane.ai', {
          method: 'POST',
          headers,
          body: '{}',
        })
      )
    ).status
  ).toBe(503);
  expect(close).toHaveBeenCalledOnce();
});

test.each(['stopped', 'ignored', 'pending'])(
  'inbound forwards admitted %s mail',
  async (status) => {
    const forwardReceipt = vi.fn(async () => 'forward-id');
    const { route } = setup({
      process: vi.fn(async () => status),
      forwardReceipt,
    });

    const response = await route.POST(
      new Request('https://threadplane.ai', {
        method: 'POST',
        headers,
        body: '{}',
      })
    );

    expect(response.status).toBe(200);
    expect(forwardReceipt).toHaveBeenCalledWith(
      expect.anything(),
      'incoming-1'
    );
  }
);

test('inbound still forwards after reply processing fails and requests retry', async () => {
  const forwardReceipt = vi.fn(async () => 'forward-id');
  const { route, close } = setup({
    process: vi.fn().mockRejectedValue(new Error('stop failed')),
    forwardReceipt,
  });

  const response = await route.POST(
    new Request('https://threadplane.ai', {
      method: 'POST',
      headers,
      body: '{}',
    })
  );

  expect(response.status).toBe(503);
  expect(forwardReceipt).toHaveBeenCalledWith(expect.anything(), 'incoming-1');
  expect(close).toHaveBeenCalledOnce();
});

test('inbound forward failure requests retry after durable reply processing', async () => {
  const forwardReceipt = vi.fn().mockRejectedValue(new Error('send failed'));
  const { route, process, close } = setup({ forwardReceipt });

  const response = await route.POST(
    new Request('https://threadplane.ai', {
      method: 'POST',
      headers,
      body: '{}',
    })
  );

  expect(response.status).toBe(503);
  expect(process).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});

const linkedInConfig = {
  enabled: true as const,
  address: 'linkedin@threadplane.ai',
  forwardNotifications: false,
};
const post = () =>
  new Request('https://threadplane.ai', {
    method: 'POST',
    headers,
    body: '{}',
  });

test('mail for the LinkedIn ingest address is admitted, processed and forwarded', async () => {
  const admitLinkedIn = vi.fn(async () => 'li-1');
  const processLinkedIn = vi.fn(async () => 'unparsed');
  const forwardLinkedIn = vi.fn(async () => 'fwd-1');
  const admit = vi.fn(async () => null);
  const { route } = setup({
    admit,
    loadLinkedInConfig: () => linkedInConfig,
    admitLinkedIn,
    processLinkedIn,
    forwardLinkedIn,
  });

  expect((await route.POST(post())).status).toBe(200);
  expect(admit).toHaveBeenCalled();
  expect(admitLinkedIn).toHaveBeenCalled();
  expect(processLinkedIn).toHaveBeenCalledWith(
    expect.anything(),
    'li-1',
    linkedInConfig
  );
  expect(forwardLinkedIn).toHaveBeenCalledWith(expect.anything(), 'li-1');
});

test('a LinkedIn forward failure asks the provider to retry', async () => {
  const processLinkedIn = vi.fn(async () => 'parsed');
  const { route, close } = setup({
    admit: vi.fn(async () => null),
    loadLinkedInConfig: () => linkedInConfig,
    admitLinkedIn: vi.fn(async () => 'li-1'),
    processLinkedIn,
    forwardLinkedIn: vi.fn().mockRejectedValue(new Error('send failed')),
  });

  expect((await route.POST(post())).status).toBe(503);
  expect(processLinkedIn).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});

test('a LinkedIn processing failure still forwards and asks for retry', async () => {
  const forwardLinkedIn = vi.fn(async () => 'fwd-1');
  const { route } = setup({
    admit: vi.fn(async () => null),
    loadLinkedInConfig: () => linkedInConfig,
    admitLinkedIn: vi.fn(async () => 'li-1'),
    processLinkedIn: vi.fn().mockRejectedValue(new Error('parse failed')),
    forwardLinkedIn,
  });

  expect((await route.POST(post())).status).toBe(503);
  expect(forwardLinkedIn).toHaveBeenCalledWith(expect.anything(), 'li-1');
});

test('the LinkedIn branch is skipped when ingest is disabled', async () => {
  const admitLinkedIn = vi.fn(async () => 'li-1');
  const { route } = setup({
    admit: vi.fn(async () => null),
    loadLinkedInConfig: () => ({ enabled: false }),
    admitLinkedIn,
  });

  expect((await route.POST(post())).status).toBe(200);
  expect(admitLinkedIn).not.toHaveBeenCalled();
});

test('reply-inbox mail never reaches the LinkedIn branch', async () => {
  const admitLinkedIn = vi.fn(async () => 'li-1');
  const { route } = setup({
    loadLinkedInConfig: () => linkedInConfig,
    admitLinkedIn,
  });

  expect((await route.POST(post())).status).toBe(200);
  expect(admitLinkedIn).not.toHaveBeenCalled();
});

test('a LinkedIn config failure refuses the request before the database', async () => {
  const createDatabase = vi.fn();
  const { route } = setup({
    loadLinkedInConfig: () => {
      throw new Error('bad config');
    },
    createDatabase,
  });

  expect((await route.POST(post())).status).toBe(503);
  expect(createDatabase).not.toHaveBeenCalled();
});
