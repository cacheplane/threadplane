import { expect, test, vi } from 'vitest';

import { createInboxResendClient } from './inbox-resend.ts';

test('received message enumeration follows every page without skipping same-timestamp mail', async () => {
  const urls: string[] = [];
  const client = createInboxResendClient('re_test', async (input) => {
    urls.push(String(input));
    return Response.json(
      urls.length === 1
        ? {
            data: [
              {
                id: 'first',
                to: ['brian@threadplane.ai'],
                created_at: '2026-10-22T01:00:00Z',
              },
            ],
            has_more: true,
          }
        : {
            data: [
              {
                id: 'second',
                to: ['brian@threadplane.ai'],
                created_at: '2026-10-22T01:00:00Z',
              },
            ],
            has_more: false,
          }
    );
  });

  const ids: string[] = [];
  for await (const message of client.listReceived()) ids.push(message.id);

  expect(ids).toEqual(['first', 'second']);
  expect(urls[1]).toContain('after=first');
});

test('provider failures expose no response body or credentials', async () => {
  const client = createInboxResendClient(
    're_secret',
    async () => new Response('private email body', { status: 403 })
  );

  await expect(client.getReceived('incoming-1')).rejects.toThrow(
    'Resend read failed (403)'
  );
});

test('rate limits retry without advancing recovery work', async () => {
  let attempts = 0;
  const delays: number[] = [];
  const client = createInboxResendClient(
    're_test',
    async () =>
      ++attempts === 1
        ? new Response('', { status: 429, headers: { 'retry-after': '1' } })
        : Response.json({ message_id: '<sent@resend.com>' }),
    async (delay) => {
      delays.push(delay);
    }
  );

  expect(await client.getSent('outgoing-1')).toEqual({
    message_id: '<sent@resend.com>',
  });
  expect(attempts).toBe(2);
  expect(delays).toEqual([1000]);
});

test('a looping or incomplete pagination response fails instead of reporting healthy', async () => {
  const client = createInboxResendClient('re_test', async () =>
    Response.json({ data: [], has_more: true })
  );

  await expect(
    (async () => {
      for await (const message of client.listReceived()) void message;
    })()
  ).rejects.toThrow();
});

test('provider IDs are bounded path components', async () => {
  const client = createInboxResendClient('re_test', async () => {
    throw new Error('must not fetch');
  });

  await expect(client.getReceived('../api-keys')).rejects.toThrow('identifier');
});

test('malformed receiving JSON and transport failures do not expose provider content', async () => {
  for (const fetcher of [
    async () => new Response('sensitive subject body'),
    async () => {
      throw new Error('sensitive subject body');
    },
  ]) {
    const client = createInboxResendClient('read-key', fetcher as typeof fetch);
    await expect(client.getReceived('incoming-1')).rejects.toThrow(
      /^Resend read failed$/
    );
  }
});

test('receiving enumeration resumes only after a validated saved provider cursor', async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ data: [], has_more: false })
  );
  const client = createInboxResendClient('key', fetcher);
  for await (const item of client.listReceived('saved-1')) void item;
  expect(fetcher.mock.calls[0]?.[0]).toContain('after=saved-1');
  await expect(
    (async () => {
      for await (const item of client.listReceived('../secret')) void item;
    })()
  ).rejects.toThrow('identifier');
  expect(fetcher).toHaveBeenCalledOnce();
});
