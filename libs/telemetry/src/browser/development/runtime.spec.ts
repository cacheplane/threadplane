// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mode = vi.hoisted(() => ({ development: true }));
vi.mock('@angular/core', async (original) => ({
  ...(await original<typeof import('@angular/core')>()),
  isDevMode: () => mode.development,
}));

const config = {
  integration: 'langgraph' as const,
  packageName: '@threadplane/langgraph' as const,
  packageVersion: '0.0.65',
};
const disabledWindow = () =>
  window as Window & { __THREADPLANE_TELEMETRY_DISABLED__?: boolean };
let api: typeof import('../public-api');
let fetcher: ReturnType<typeof vi.fn>;
const sent = (index = 0) => JSON.parse(fetcher.mock.calls[index][1].body);
const advance = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-04T12:00:00Z'));
  mode.development = true;
  localStorage.clear();
  delete disabledWindow().__THREADPLANE_TELEMETRY_DISABLED__;
  fetcher = vi.fn(
    async (_url, options) =>
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          events: JSON.parse(options.body).events.map(
            (e: { eventId: string }) => ({
              eventId: e.eventId,
              disposition: 'accepted',
            })
          ),
          announcements: [],
        })
      )
  );
  vi.stubGlobal('fetch', fetcher);
  api = await import('../public-api');
});
afterEach(() => {
  api.setDevelopmentCollectionEnabled?.(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('automatic development runtime', () => {
  it('keeps each package token on its own immutable envelope and rotates same-version reinstall IDs', async () => {
    const firstToken = '10000000-0000-4000-8000-000000000001';
    const secondToken = '10000000-0000-4000-8000-000000000002';
    const renderToken = '10000000-0000-4000-8000-000000000003';
    fetcher.mockImplementationOnce(
      async () => new Response('{}', { status: 503 })
    );
    api
      .createDevelopmentRuntime({ ...config, installationToken: firstToken })
      .touch();
    await advance();
    const old = sent().events[0];
    expect(old.installationToken).toBe(firstToken);
    api
      .createDevelopmentRuntime({ ...config, installationToken: secondToken })
      .touch();
    api
      .createDevelopmentRuntime({
        integration: 'render',
        packageName: '@threadplane/angular',
        packageVersion: config.packageVersion,
        installationToken: renderToken,
      })
      .milestone('generative_ui.rendered');
    await advance(10000);
    expect(
      sent(1).events.find((e: { eventId: string }) => e.eventId === old.eventId)
    ).toEqual(old);
    const replacement = sent(1).events.find(
      (e: { installationToken: string }) => e.installationToken === secondToken
    );
    expect(replacement.eventId).not.toBe(old.eventId);
    const rendered = sent(1).events.filter(
      (e: { properties: { integration: string } }) =>
        e.properties.integration === 'render'
    );
    expect(rendered).toHaveLength(2);
    expect(
      rendered.every(
        (e: { installationToken: string }) =>
          e.installationToken === renderToken
      )
    ).toBe(true);
    expect(localStorage.getItem('threadplane.growth.session.v1')).toContain(
      secondToken
    );
    expect(
      sent(1).events.every(
        (e: { properties: object }) => !('installationToken' in e.properties)
      )
    ).toBe(true);
    api.setDevelopmentCollectionEnabled(false);
    vi.resetModules();
    api = await import('../public-api');
    api
      .createDevelopmentRuntime({ ...config, installationToken: secondToken })
      .touch();
    await advance();
    expect(sent(2).events[0]).toEqual(replacement);
  });
  it('omits malformed tokens and rotates a previously linked initialization when the bridge becomes null', async () => {
    const token = '10000000-0000-4000-8000-000000000001';
    api
      .createDevelopmentRuntime({ ...config, installationToken: token })
      .touch();
    await advance();
    api
      .createDevelopmentRuntime({ ...config, installationToken: null })
      .touch();
    await advance(10000);
    expect(sent(1).events[0].eventId).not.toBe(sent().events[0].eventId);
    expect(sent(1).events[0]).not.toHaveProperty('installationToken');
    api
      .createDevelopmentRuntime({
        integration: 'render',
        packageName: '@threadplane/angular',
        packageVersion: config.packageVersion,
        installationToken: 'invalid',
      })
      .touch();
    await advance(10000);
    expect(sent(2).events[0]).not.toHaveProperty('installationToken');
  });
  it('exports a lazy collector without import or construction side effects', async () => {
    expect(api.createDevelopmentRuntime).toBeTypeOf('function');
    const storage = vi.spyOn(Storage.prototype, 'getItem');
    api.createDevelopmentRuntime(config);
    await advance(300000);
    expect(storage).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['production', 'runtime', 'global', 'window', 'storage', 'ssr', 'automation'])(
    'is inert when disabled by %s',
    async (reason) => {
      if (reason === 'production') mode.development = false;
      if (reason === 'global') api.setDevelopmentCollectionEnabled(false);
      if (reason === 'automation')
        vi.stubGlobal('navigator', { webdriver: true });
      if (reason === 'window')
        disabledWindow().__THREADPLANE_TELEMETRY_DISABLED__ = true;
      if (reason === 'storage')
        localStorage.setItem('THREADPLANE_TELEMETRY_DISABLED', '1');
      const reads = vi.spyOn(Storage.prototype, 'getItem');
      if (reason === 'ssr') vi.stubGlobal('window', undefined);
      const handle = api.createDevelopmentRuntime({
        ...config,
        enabled: () => reason !== 'runtime',
      });
      handle.touch();
      handle.milestone('transport.connected');
      await advance(300000);
      expect(fetcher).not.toHaveBeenCalled();
      if (reason === 'automation') expect(reads).not.toHaveBeenCalled();
      expect(
        reads.mock.calls.every(
          ([key]) => key === 'THREADPLANE_TELEMETRY_DISABLED'
        )
      ).toBe(true);
    }
  );

  it('shares browser identity and dedupes session milestones across runtimes', async () => {
    const a = api.createDevelopmentRuntime(config);
    const b = api.createDevelopmentRuntime(config);
    a.touch();
    b.touch();
    a.milestone('transport.connected');
    b.milestone('transport.connected');
    await advance();
    expect(sent().events.map((e: { kind: string }) => e.kind)).toEqual([
      'runtime.session_started',
      'transport.connected',
    ]);
    expect(sent().events[0].subject.scope).toBe('persistent');
    expect(sent().events[0].subject.id).toBe(sent().events[1].subject.id);
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://threadplane.ai/api/growth/collect/v1/runtime'
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    const oldSession = sent().events[0].sessionId;
    await advance(30 * 60000);
    b.milestone('transport.connected');
    await advance();
    expect(sent(1).events[0].sessionId).not.toBe(oldSession);
    expect(sent(1).events[0].subject.id).toBe(sent().events[0].subject.id);
  });

  it('falls back to memory when identity storage fails', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const handle = api.createDevelopmentRuntime(config);
    handle.touch();
    await advance();
    expect(sent().events[0].subject.scope).toBe('memory');
  });

  it('coalesces new milestones with ten-second spacing and only refreshes on active use', async () => {
    const handle = api.createDevelopmentRuntime(config);
    handle.touch();
    await advance();
    handle.milestone('transport.connected');
    handle.milestone('runtime.first_stream_completed', 1500);
    await advance(9999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sent(1).events[1].properties.durationBucket).toBe('1s_to_5s');
    await advance(300000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    handle.touch();
    await advance();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sent(2).events[0].eventId).toBe(sent(1).events[1].eventId);
  });

  it('retries stable IDs at most three times and honors Retry-After', async () => {
    fetcher.mockImplementation(
      async () =>
        new Response('{}', { status: 429, headers: { 'Retry-After': '60' } })
    );
    api.createDevelopmentRuntime(config).touch();
    await advance();
    await advance(59999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(sent(1)).toEqual(sent());
    await advance(60000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await advance(300000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(api.getDevelopmentCollectionDiagnostics().discarded).toBe(1);
  });

  it('times out an unresponsive body and never acknowledges malformed responses', async () => {
    fetcher.mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start() {
              /* never finishes */
            },
          })
        )
    );
    api.createDevelopmentRuntime(config).touch();
    await advance();
    const signal = fetcher.mock.calls[0][1].signal;
    await advance(3000);
    expect(signal.aborted).toBe(true);
    await advance(7000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sent(1)).toEqual(sent());
  });

  it('cancels a scheduled send when disabled or disposed', async () => {
    const handle = api.createDevelopmentRuntime(config);
    handle.touch();
    handle.dispose();
    await advance();
    expect(fetcher).not.toHaveBeenCalled();
    const other = api.createDevelopmentRuntime(config);
    other.touch();
    api.setDevelopmentCollectionEnabled(false);
    await advance(300000);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('collects nothing for an integration reported under another package', async () => {
    // The renderer ships in `@threadplane/angular`; the retired
    // `@threadplane/render` name, a backend's name under another integration,
    // and an inherited key are all mismatches.
    for (const mismatch of [
      { integration: 'render', packageName: '@threadplane/render' },
      { integration: 'langgraph', packageName: '@threadplane/angular' },
      { integration: 'constructor', packageName: '@threadplane/angular' },
    ])
      api
        .createDevelopmentRuntime({
          ...config,
          ...(mismatch as Pick<typeof config, 'integration' | 'packageName'>),
        })
        .touch();
    await advance(300000);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('inherits runtime policy without changing custom agents or emitting events', () => {
    const agent = {};
    expect(api.isDevelopmentRuntimeEnabled(agent)).toBe(false);
    expect(api.registerDevelopmentRuntimePolicy(agent, () => true)).toBe(agent);
    expect(api.isDevelopmentRuntimeEnabled(agent)).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts only IDs from a valid acknowledgment and retries missing IDs', async () => {
    fetcher.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            events: [{ eventId: 'foreign', disposition: 'accepted' }],
            announcements: [],
          })
        )
    );
    const handle = api.createDevelopmentRuntime(config);
    handle.touch();
    await advance();
    expect(api.getDevelopmentCollectionDiagnostics().acknowledged).toBe(0);
    await advance(10000);
    expect(sent(1)).toEqual(sent());
    expect(api.getDevelopmentCollectionDiagnostics().acknowledged).toBe(1);
  });

  it('discards permanent failures and expired retries without sending old events', async () => {
    fetcher.mockImplementationOnce(
      async () => new Response('{}', { status: 400 })
    );
    const handle = api.createDevelopmentRuntime(config);
    handle.touch();
    await advance(60000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockImplementationOnce(
      async () =>
        new Response('{}', { status: 503, headers: { 'Retry-After': '90000' } })
    );
    handle.milestone('transport.connected');
    await advance();
    await advance(90000 * 1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(api.getDevelopmentCollectionDiagnostics().pending).toBe(0);
  });

  it('does not let a late disabled response display announcements or acknowledge dropped work', async () => {
    let resolve!: (value: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        })
    );
    api.createDevelopmentRuntime(config).touch();
    await advance();
    api.setDevelopmentCollectionEnabled(false);
    resolve(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          events: [
            { eventId: sent().events[0].eventId, disposition: 'accepted' },
          ],
        })
      )
    );
    await advance();
    expect(api.getDevelopmentCollectionDiagnostics()).toMatchObject({
      acknowledged: 0,
      pending: 0,
    });
  });

  it('recovers the identical initialization envelope after a page reload in the same session', async () => {
    api.createDevelopmentRuntime(config).touch();
    await advance();
    const initial = sent();
    await advance(10000);
    vi.resetModules();
    api = await import('../public-api');
    api.createDevelopmentRuntime(config).touch();
    await advance();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sent(1)).toEqual(initial);
  });

  it('recovers initialization when its first owner is disposed before sending', async () => {
    const first = api.createDevelopmentRuntime(config);
    first.touch();
    first.dispose();
    const second = api.createDevelopmentRuntime(config);
    second.touch();
    await advance();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sent().events[0].kind).toBe('runtime.session_started');
  });

  it('refreshes announcements using the actively used integration after the original owner is disposed', async () => {
    const original = api.createDevelopmentRuntime(config);
    original.touch();
    await advance();
    api
      .createDevelopmentRuntime({
        ...config,
        integration: 'render',
        packageName: '@threadplane/angular',
      })
      .touch();
    await advance(10000);
    original.dispose();
    await advance(300000);
    api.createDevelopmentRuntime(config).touch();
    await advance();
    expect(sent(2).events[0].properties.integration).toBe('langgraph');
    expect(sent(2).events[0].eventId).toBe(sent().events[0].eventId);
  });

  it('ignores Retry-After from a response that arrives after disable', async () => {
    let resolve!: (value: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        })
    );
    const handle = api.createDevelopmentRuntime(config);
    handle.touch();
    await advance();
    api.setDevelopmentCollectionEnabled(false);
    resolve(
      new Response('{}', { status: 429, headers: { 'Retry-After': '90000' } })
    );
    await advance();
    api.setDevelopmentCollectionEnabled(true);
    handle.milestone('transport.connected');
    await advance(10000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('resumes an initialization exchange after programmatic re-enable in the same session', async () => {
    const handle = api.createDevelopmentRuntime(config);
    handle.touch();
    await advance();
    api.setDevelopmentCollectionEnabled(false);
    api.setDevelopmentCollectionEnabled(true);
    handle.touch();
    await advance(10000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sent(1)).toEqual(sent());
  });

  it('bounds pending work across many sessions while a server asks it to back off', async () => {
    fetcher.mockImplementation(
      async () =>
        new Response('{}', { status: 429, headers: { 'Retry-After': '90000' } })
    );
    const handle = api.createDevelopmentRuntime(config);
    handle.touch();
    await advance();
    for (let i = 0; i < 25; i++) {
      await advance(31 * 60000);
      handle.milestone('transport.connected');
      handle.milestone('runtime.first_stream_completed');
      handle.milestone('thread.persisted');
    }
    expect(
      api.getDevelopmentCollectionDiagnostics().pending
    ).toBeLessThanOrEqual(50);
    expect(api.getDevelopmentCollectionDiagnostics().discarded).toBeGreaterThan(
      40
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('exchange acknowledgment boundaries', () => {
  it('removes only committed IDs from a partial acknowledgment', async () => {
    fetcher.mockImplementationOnce(
      async (_url, options) =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            events: [
              {
                eventId: JSON.parse(options.body).events[0].eventId,
                disposition: 'accepted',
              },
            ],
            announcements: [],
          })
        )
    );
    const handle = api.createDevelopmentRuntime(config);
    handle.milestone('transport.connected');
    await advance();
    expect(api.getDevelopmentCollectionDiagnostics()).toMatchObject({
      acknowledged: 1,
      pending: 1,
    });
    await advance(10000);
    expect(sent(1).events).toEqual([sent().events[1]]);
    expect(api.getDevelopmentCollectionDiagnostics()).toMatchObject({
      acknowledged: 2,
      pending: 0,
    });
  });

  it('does not acknowledge an oversized response', async () => {
    fetcher.mockImplementationOnce(
      async (_url, options) =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            events: [
              {
                eventId: JSON.parse(options.body).events[0].eventId,
                disposition: 'accepted',
              },
            ],
            padding: 'x'.repeat(32768),
          })
        )
    );
    api.createDevelopmentRuntime(config).touch();
    await advance();
    expect(api.getDevelopmentCollectionDiagnostics()).toMatchObject({
      acknowledged: 0,
      pending: 1,
    });
    await advance(10000);
    expect(sent(1)).toEqual(sent());
  });
});

describe('development announcements', () => {
  const announcement = {
    id: 'welcome-v1',
    packageNames: ['@threadplane/langgraph'],
    minVersion: '0.0.60',
    maxVersion: '0.1.0',
    expiresAt: '2026-12-01T00:00:00Z',
    text: 'Try a tool view. %c<script>plain text</script>',
    documentationUrl: 'https://threadplane.ai/docs',
  };
  function respond(announcements: unknown) {
    fetcher.mockImplementation(
      async (_url, options) =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            events: JSON.parse(options.body).events.map(
              (e: { eventId: string }) => ({
                eventId: e.eventId,
                disposition: 'accepted',
              })
            ),
            announcements,
          })
        )
    );
  }
  it('displays once per browser identity with a fixed console format and persists dedupe', async () => {
    const output = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    respond([announcement]);
    const handle = api.createDevelopmentRuntime(config);
    handle.touch();
    await advance();
    expect(output).toHaveBeenCalledWith(
      '[Threadplane] %s',
      `${announcement.text}\n${announcement.documentationUrl}`
    );
    handle.milestone('transport.connected');
    await advance(10000);
    expect(output).toHaveBeenCalledTimes(1);
    const identity = sent().events[0].subject.id;
    expect(
      localStorage.getItem(`threadplane.growth.announcements.v1:${identity}`)
    ).toContain('welcome-v1');
  });
  it('rejects expired, mismatched, oversized and unsafe announcements', async () => {
    const output = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const bad = [
      { ...announcement, expiresAt: '2026-01-01T00:00:00Z' },
      { ...announcement, packageNames: ['@threadplane/render'] },
      { ...announcement, minVersion: '0.1.0' },
      {
        ...announcement,
        documentationUrl: 'https://threadplane.ai.evil.invalid/docs',
      },
      {
        ...announcement,
        documentationUrl: 'https://threadplane.ai/docs?identity=secret',
      },
      { ...announcement, text: 'x'.repeat(501) },
    ];
    const handle = api.createDevelopmentRuntime(config);
    for (let i = 0; i < bad.length; i++) {
      respond([bad[i]]);
      handle.touch();
      await advance();
      await advance(300000);
    }
    expect(output).not.toHaveBeenCalled();
    expect(api.getDevelopmentCollectionDiagnostics().acknowledged).toBe(6);
  });
  it('retains acknowledgment even if console and persistence throw', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('console');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage');
    });
    respond([announcement]);
    api.createDevelopmentRuntime(config).touch();
    await advance();
    expect(api.getDevelopmentCollectionDiagnostics()).toMatchObject({
      acknowledged: 1,
      pending: 0,
      failures: 0,
    });
  });
  it('merges announcement dedupe written by another already-open tab', async () => {
    const { DevelopmentAnnouncements } = await import('./announcements');
    respond([]);
    api.createDevelopmentRuntime(config).touch();
    await advance();
    const output = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const tabA = new DevelopmentAnnouncements();
    const tabB = new DevelopmentAnnouncements();
    tabA.display([], sent().events);
    tabB.display([], sent().events);
    tabA.display([announcement], sent().events);
    tabB.display([announcement], sent().events);
    expect(output).toHaveBeenCalledTimes(1);
  });
});
