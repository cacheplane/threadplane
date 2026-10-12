import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import {
  injectAgent,
  ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER,
} from '@threadplane/langgraph';
import { COCKPIT_RUNTIME_CONNECTION } from '@threadplane/cockpit-telemetry';
import { beforeEach, describe, it, expect, vi } from 'vitest';
const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  stream: vi.fn(),
  queued: vi.fn(),
  history: vi.fn(),
  join: vi.fn(),
  cancel: vi.fn(),
  ctor: vi.fn(),
}));
vi.mock('@langchain/langgraph-sdk', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  Client: class {
    constructor(options: any) {
      sdk.ctor(options);
    }
    threads = { create: sdk.create, getHistory: sdk.history };
    runs = {
      stream: sdk.stream,
      create: sdk.queued,
      joinStream: sdk.join,
      cancel: sdk.cancel,
    };
  },
}));
import { submitMessage } from '@threadplane/chat';
import { MemoryComponent } from './memory.component';
import { appConfig } from './app.config';
import { MEMORY_SCOPE_OPTIONS } from './memory-scope';
const scope = '12345678-1234-4234-8234-123456789abc';
async function* stream() {
  yield {
    event: 'metadata',
    data: { run_id: 'run-1', thread_id: 'actual-thread' },
  };
  yield { event: 'values', data: { messages: [] } };
}
describe('Memory provideAgent integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('threadplane.deep-agents-memory.scope.v1', scope);
    sdk.create.mockResolvedValue({ thread_id: 'actual-thread' });
    sdk.stream.mockImplementation(stream);
    sdk.history.mockResolvedValue([]);
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        {
          provide: COCKPIT_RUNTIME_CONNECTION,
          useValue: {
            adapter: 'langgraph',
            apiUrl: 'http://memory.test.invalid/api',
            assistantId: 'da-memory',
            clientOptions: {
              defaultHeaders: { 'x-fixture-session': 'synthetic' },
            },
          },
        },
      ],
    });
  });
  function agent() {
    return TestBed.runInInjectionContext(() => injectAgent());
  }
  it('reuses actual created thread on two submissions with immutable scoped context', async () => {
    const a = agent();
    await a.submit(
      { message: 'one' },
      { context: { memory_scope: 'caller' }, metadata: { label: 'retained' } }
    );
    TestBed.tick();
    await a.submit({ message: 'two' });
    expect(sdk.create).toHaveBeenCalledTimes(1);
    expect(sdk.stream.mock.calls.map((c) => c[0])).toEqual([
      'actual-thread',
      'actual-thread',
    ]);
    expect(sdk.stream.mock.calls[0][2]).toMatchObject({
      context: { memory_scope: scope },
      metadata: { label: 'retained' },
    });
    expect(sdk.ctor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiUrl: 'http://memory.test.invalid/api',
        defaultHeaders: { 'x-fixture-session': 'synthetic' },
        callerOptions: expect.objectContaining({ maxRetries: 0 }),
      })
    );
  });
  it('refuses corrupted storage before any SDK create or run', async () => {
    localStorage.setItem('threadplane.deep-agents-memory.scope.v1', 'corrupt');
    const a = agent();
    await a.submit({ message: 'blocked' });
    expect(sdk.create).not.toHaveBeenCalled();
    expect(sdk.stream).not.toHaveBeenCalled();
  });
  it.each(['corrupt', null])(
    'blocks actual composer and suggestion with zero SDK creates/runs after storage becomes %s',
    async (value) => {
      const c = TestBed.runInInjectionContext(
        () => new MemoryComponent()
      ) as any;
      if (value === null)
        localStorage.removeItem('threadplane.deep-agents-memory.scope.v1');
      else
        localStorage.setItem('threadplane.deep-agents-memory.scope.v1', value);
      submitMessage(c.agent, 'ordinary composer');
      c.send('older suggestion');
      await Promise.resolve();
      expect(sdk.create).not.toHaveBeenCalled();
      expect(sdk.stream).not.toHaveBeenCalled();
      expect(c.agent.isInputBlocked()).toBe(true);
      expect(c.scopeWarning()).toContain('changed');
    }
  );
  it('passes the optional DI operation reporter into the actual protected transport boundary', async () => {
    const reporter = vi.fn();
    TestBed.overrideProvider(ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER, {
      useValue: reporter,
    });
    const a = agent();
    const requestFetch = sdk.ctor.mock.calls.at(-1)![0].callerOptions.fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('synthetic failure'));
    try {
      const failed = await requestFetch('http://memory.test.invalid/api').catch(
        (error: unknown) => error
      );
      sdk.create.mockRejectedValueOnce(failed);
      await a.submit({ message: 'synthetic failed create' });
      expect(reporter).toHaveBeenCalledWith('network_blocked');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it('blocks the ordinary composer and suggestion with a visible setup warning when storage access fails', async () => {
    TestBed.overrideProvider(MEMORY_SCOPE_OPTIONS, {
      useValue: {
        storage: () => {
          throw new Error('synthetic unavailable storage');
        },
        uuid: () => {
          throw new Error('must not generate');
        },
      },
    });
    const c = TestBed.runInInjectionContext(() => new MemoryComponent()) as any;
    expect(submitMessage(c.agent, 'ordinary composer')).toBeNull();
    c.send('older suggestion');
    await Promise.resolve();
    expect(sdk.create).not.toHaveBeenCalled();
    expect(sdk.stream).not.toHaveBeenCalled();
    expect(c.scopeWarning()).toContain('setup is unavailable');
    expect(c.memorySource()).toBe('unavailable');
  });
});
