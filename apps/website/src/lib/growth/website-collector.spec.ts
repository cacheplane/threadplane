import { randomUUID } from 'node:crypto';
import { createWebsiteCollector, sendWebsiteBatch } from './website-collector';
import type { WebsiteCatalog } from './website-metadata';

function setup(enabled = true) {
  const send = vi.fn(
    async (_events: Parameters<typeof sendWebsiteBatch>[0]) => ({ status: 200 })
  );
  let time = Date.parse('2026-09-04T12:00:00Z');
  const schedule = vi.fn();
  const session = { id: randomUUID(), scope: 'session' as const };
  const catalog: WebsiteCatalog = Object.fromEntries(
    Array.from({ length: 80 }, (_, i) => [
      `/page-${i}`,
      { contentId: `page-${i}`, topic: 'other' },
    ])
  );
  const collector = createWebsiteCollector({
    enabled,
    catalog,
    session: () => session,
    now: () => new Date(time),
    uuid: randomUUID,
    send,
    schedule,
    context: () => ({
      search: '?utm_source=newsletter&secret=private',
      referrer: 'https://example.org/private?token=secret',
    }),
  });
  return {
    collector,
    send,
    schedule,
    session,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
describe('bounded website collection', () => {
  it('honors Retry-After when a new event queued an immediate timer during the request', async () => {
    const timers: { callback: () => void; delay: number }[] = [];
    let resolve!: (value: { status: number; retryAfterMs: number }) => void;
    const send = vi.fn(
      () =>
        new Promise<{ status: number; retryAfterMs: number }>((done) => {
          resolve = done;
        })
    );
    const collector = createWebsiteCollector({
      enabled: true,
      catalog: {
        '/a': { contentId: 'a', topic: 'other' },
        '/b': { contentId: 'b', topic: 'other' },
      },
      session: () => ({
        id: '11111111-1111-4111-8111-111111111111',
        scope: 'session',
      }),
      now: () => new Date('2026-09-04T12:00:00Z'),
      uuid: randomUUID,
      context: () => ({ search: '', referrer: '' }),
      send,
      schedule: (callback, delay) => {
        timers.push({ callback, delay });
      },
    });
    collector.view('/a');
    timers.shift()!.callback();
    collector.view('/b');
    resolve({ status: 429, retryAfterMs: 60000 });
    await Promise.resolve();
    await Promise.resolve();
    timers.shift()!.callback();
    expect(send).toHaveBeenCalledTimes(1);
    expect(timers.at(-1)?.delay).toBe(60000);
  });
  it('shares session context, deduplicates page/copy signals and sends only metadata', async () => {
    const { collector, send, session } = setup();
    collector.view('/page-0');
    collector.view('/page-0');
    collector.copied('npm i @threadplane/angular');
    collector.copied('npm i @threadplane/angular');
    await collector.flush();
    const events = send.mock.calls[0][0];
    expect(events.map((event) => event.kind)).toEqual([
      'website.session_started',
      'website.content_viewed',
      'website.install_command_copied',
    ]);
    expect(events.every((event) => event.subject.id === session.id)).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/private|secret|token|npm i/);
  });
  it('retains event UUIDs during a bounded retry', async () => {
    const { collector, send, advance } = setup();
    send.mockResolvedValueOnce({ status: 503 });
    collector.view('/page-1');
    await collector.flush();
    advance(1000);
    await collector.flush();
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('bounds event volume and stops retrying after three attempts', async () => {
    const { collector, send, advance } = setup();
    send.mockResolvedValue({ status: 503 });
    for (let i = 0; i < 80; i++) collector.view(`/page-${i}`);
    for (let i = 0; i < 10; i++) {
      await collector.flush();
      advance(60000);
    }
    expect(send).toHaveBeenCalledTimes(6);
    expect(send.mock.calls.every(([events]) => events.length <= 20)).toBe(true);
  });
  it('does nothing while disabled', async () => {
    const { collector, send, schedule } = setup(false);
    collector.view('/page-1');
    collector.copied('npm i @threadplane/angular');
    await collector.flush();
    expect(send).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });
  it('treats a malformed acknowledgement as retryable and omits credentials', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response('{}', { status: 200 })
    );
    expect((await sendWebsiteBatch([], fetcher)).status).toBe(503);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: 'omit',
      keepalive: true,
    });
  });
});
