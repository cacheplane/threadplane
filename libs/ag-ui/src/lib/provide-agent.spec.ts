import { describe, it, expect, vi } from 'vitest';
import { Observable } from 'rxjs';
import type { BaseEvent } from '@ag-ui/client';
import type { RunAgentInput } from '@ag-ui/core';
import { InjectionToken, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createAgentRef } from '@threadplane/chat';
import { provideAgent, injectAgent, AGENT } from './provide-agent';
import {
  createRuntimeProtectedFetch,
  ɵAG_UI_RUNTIME_OPERATION_REPORTER,
} from './runtime-operation-reporter';

/**
 * Minimal stub that satisfies the AbstractAgent shape for provider testing.
 */
class StubAgent {
  agentId?: string;
  threadId?: string;
  url: string;
  headers: Record<string, string>;

  private readonly _subscribers: Array<{
    onEvent?: (p: { event: BaseEvent }) => void;
    onRunFailed?: (p: { error: Error }) => void;
  }> = [];

  constructor(config: {
    url: string;
    agentId?: string;
    threadId?: string;
    headers?: Record<string, string>;
  }) {
    this.url = config.url;
    this.agentId = config.agentId;
    this.threadId = config.threadId;
    this.headers = config.headers || {};
  }

  subscribe(sub: {
    onEvent?: (p: { event: BaseEvent }) => void;
    onRunFailed?: (p: { error: Error }) => void;
  }) {
    this._subscribers.push(sub);
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    return { unsubscribe: () => {} };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async runAgent() {
    return { result: undefined, newMessages: [] };
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  abortRun() {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  addMessage(_msg: unknown) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable();
  }
}

describe('provideAgent', () => {
  it('disposes the adapter when its injector is destroyed', async () => {
    TestBed.configureTestingModule({ providers: [provideAgent({ url: 'http://test.invalid', telemetry: false })] });
    const ref = TestBed.runInInjectionContext(() => injectAgent());
    const dispose = vi.spyOn(ref, 'dispose');
    TestBed.resetTestingModule();
    expect(dispose).toHaveBeenCalledOnce();
    await expect(ref.submit({ message: 'too late' })).rejects.toThrow(/disposed/);
  });

  it('rejects a hostile signal before invoking fetch without reporting', async () => {
    const reportOperationFailure = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const nativeSignal = new AbortController().signal;
    const hostileSignal = new Proxy(nativeSignal, {
      get() {
        throw Object.assign(new Error('test-key-redact-me'), { status: 401 });
      },
      getOwnPropertyDescriptor(target, property) {
        if (property === 'status') {
          return { configurable: true, enumerable: false, writable: false, value: 401 };
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const protectedFetch = createRuntimeProtectedFetch(reportOperationFailure);

    const error = await protectedFetch('https://agent.example/run', { signal: hostileSignal })
      .catch((reason: unknown) => reason);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(reportOperationFailure).not.toHaveBeenCalled();
    expect(error).toMatchObject({ message: 'The runtime request failed.' });
    expect(error).not.toHaveProperty('cause');
    vi.unstubAllGlobals();
  });

  it('preserves already-aborted and race-aborted native signals without reporting', async () => {
    const reportOperationFailure = vi.fn();
    const protectedFetch = createRuntimeProtectedFetch(reportOperationFailure);
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const alreadyAbortedError = await protectedFetch(
      'https://agent.example/run',
      { signal: alreadyAborted.signal },
    ).catch((reason: unknown) => reason);

    const race = new AbortController();
    fetchMock.mockImplementationOnce(() => {
      race.abort();
      return Promise.reject(new Error('test-key-redact-me'));
    });
    const raceError = await protectedFetch(
      'https://agent.example/run',
      { signal: race.signal },
    ).catch((reason: unknown) => reason);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reportOperationFailure).not.toHaveBeenCalled();
    expect(alreadyAbortedError).toMatchObject({ name: 'AbortError' });
    expect(raceError).toMatchObject({ name: 'AbortError' });
    expect(JSON.stringify(raceError)).not.toContain('test-key-redact-me');
    vi.unstubAllGlobals();
  });

  it.each([401, 403])('reports installed-client HTTP %s without retaining response secrets', async status => {
    const reportOperationFailure = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('test-key-redact-me', { status })));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideAgent({ url: 'https://agent.example/run' }),
        {
          provide: ɵAG_UI_RUNTIME_OPERATION_REPORTER,
          useValue: reportOperationFailure,
        },
      ],
    });

    await TestBed.runInInjectionContext(() => injectAgent().submit({ message: 'hello' }));

    expect(reportOperationFailure).toHaveBeenCalledExactlyOnceWith('unauthorized');
    expect(JSON.stringify(reportOperationFailure.mock.calls)).not.toContain('test-key-redact-me');
    const runtime = TestBed.runInInjectionContext(() => injectAgent());
    expect(runtime.error()).toMatchObject({ message: 'The server ran into an error. You can try again.' });
    expect(runtime.error()?.cause).toBeUndefined();
    expect(JSON.stringify(runtime.error())).not.toContain('test-key-redact-me');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('test-key-redact-me');
    errorSpy.mockRestore();
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('reports only an actual installed-client fetch rejection as network_blocked', async () => {
    const reportOperationFailure = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('test-key-redact-me')));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideAgent({ url: 'https://agent.example/run' }),
        { provide: ɵAG_UI_RUNTIME_OPERATION_REPORTER, useValue: reportOperationFailure },
      ],
    });

    const runtime = TestBed.runInInjectionContext(() => injectAgent());
    await runtime.submit({ message: 'hello' });

    expect(reportOperationFailure).toHaveBeenCalledExactlyOnceWith('network_blocked');
    expect(runtime.error()).toMatchObject({ message: 'The server ran into an error. You can try again.' });
    expect(runtime.error()?.cause).toBeUndefined();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('test-key-redact-me');
    errorSpy.mockRestore();
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('keeps unknown installed-client HTTP failures local while still sanitizing them', async () => {
    const reportOperationFailure = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('test-key-redact-me', { status: 500 }),
    ));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideAgent({ url: 'https://agent.example/run' }),
        { provide: ɵAG_UI_RUNTIME_OPERATION_REPORTER, useValue: reportOperationFailure },
      ],
    });

    const runtime = TestBed.runInInjectionContext(() => injectAgent());
    await runtime.submit({ message: 'hello' });

    expect(reportOperationFailure).not.toHaveBeenCalled();
    expect(JSON.stringify(runtime.error())).not.toContain('test-key-redact-me');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('test-key-redact-me');
    errorSpy.mockRestore();
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('returns a provider array', () => {
    const providers = provideAgent({ url: 'http://example.test/agent' });
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
  });

  it('provides Agent under the internal AGENT token', () => {
    const providers = provideAgent({ url: 'http://example.test/agent' });
    const agentProvider = providers[0];
    expect(agentProvider).toBeDefined();
    expect(agentProvider.provide).toBe(AGENT);
  });

  it('factory creates agent with all methods', () => {
    // Mock HttpAgent to be our stub
    vi.doMock('@ag-ui/client', async () => {
      const actual = await vi.importActual('@ag-ui/client');
      return {
        ...actual,
        HttpAgent: StubAgent,
      };
    });

    const providers = provideAgent({ url: 'http://example.test/agent' });
    const agentProvider = providers[0] as any;
    TestBed.configureTestingModule({});
    const agent = TestBed.runInInjectionContext(() => agentProvider.useFactory());

    expect(agent).toBeDefined();
    expect(typeof agent.submit).toBe('function');
    expect(typeof agent.stop).toBe('function');
    expect(agent.messages).toBeDefined();
    expect(agent.status).toBeDefined();
    expect(agent.isLoading).toBeDefined();
    expect(agent.error).toBeDefined();
    expect(agent.toolCalls).toBeDefined();
    expect(agent.state).toBeDefined();
    expect(agent.events$).toBeDefined();

    vi.doUnmock('@ag-ui/client');
    TestBed.resetTestingModule();
  });

  it('passes config fields to HttpAgent constructor', () => {
    const config = {
      url: 'http://test.example/agent',
      agentId: 'test-agent-123',
      threadId: 'thread-456',
      headers: { Authorization: 'Bearer token' },
    };

    const providers = provideAgent(config);
    const agentProvider = providers[0] as any;

    // We can't easily test the actual HttpAgent call without mocking,
    // but we verify the provider structure is correct.
    expect(agentProvider.provide).toBe(AGENT);
    expect(typeof agentProvider.useFactory).toBe('function');
  });

  it('handles optional config fields', () => {
    const providers = provideAgent({ url: 'http://example.test/agent' });
    const agentProvider = providers[0] as any;

    expect(agentProvider.provide).toBe(AGENT);
    expect(typeof agentProvider.useFactory).toBe('function');
  });

  describe('AgentRef isolation', () => {
    it('gives each ref its own agent and its own config in ONE providers array', async () => {
      const REF_A = createAgentRef<Record<string, unknown>>('ref-a');
      const REF_B = createAgentRef<Record<string, unknown>>('ref-b');
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response('', { status: 500 }));
      vi.stubGlobal('fetch', fetchMock);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      TestBed.configureTestingModule({
        providers: [
          provideAgent(REF_A, { url: 'http://a.example/agent' }),
          provideAgent(REF_B, { url: 'http://b.example/agent' }),
        ],
      });

      const agentA = TestBed.runInInjectionContext(() => injectAgent(REF_A));
      const agentB = TestBed.runInInjectionContext(() => injectAgent(REF_B));

      // Distinct instances...
      expect(agentA).not.toBe(agentB);
      // ...each wired to ITS OWN config, not to the last one registered.
      await agentA.submit({ message: 'to-a' });
      await agentB.submit({ message: 'to-b' });
      const urls = fetchMock.mock.calls.map(([input]) => String(input));
      expect(urls).toEqual(['http://a.example/agent', 'http://b.example/agent']);

      errorSpy.mockRestore();
      TestBed.resetTestingModule();
      vi.unstubAllGlobals();
    });

    it('keeps single-ref behaviour identical: injectAgent() resolves the same instance', () => {
      const REF = createAgentRef<Record<string, unknown>>('single');
      TestBed.configureTestingModule({
        providers: [provideAgent(REF, { url: 'http://single.example/agent' })],
      });

      const byRef = TestBed.runInInjectionContext(() => injectAgent(REF));
      const bare = TestBed.runInInjectionContext(() => injectAgent());
      expect(bare).toBe(byRef);
      expect(TestBed.inject(AGENT)).toBe(byRef);
      TestBed.resetTestingModule();
    });

    it('resolves a ref config factory lazily inside an injection context, exactly once', async () => {
      const REF = createAgentRef<Record<string, unknown>>('lazy');
      const AGENT_URL = new InjectionToken<string>('AGENT_URL');
      const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
      vi.stubGlobal('fetch', fetchMock);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      let calls = 0;
      TestBed.configureTestingModule({
        providers: [
          { provide: AGENT_URL, useValue: 'http://from-di.example/agent' },
          provideAgent(REF, () => {
            calls += 1;
            // Only legal if the factory runs in an injection context.
            return { url: inject(AGENT_URL) };
          }),
        ],
      });
      // Not run at decoration time.
      expect(calls).toBe(0);

      const agent = TestBed.runInInjectionContext(() => injectAgent(REF));
      expect(calls).toBe(1);
      // The DI-read url reached the underlying HttpAgent.
      await agent.submit({ message: 'hello' });
      expect(String(fetchMock.mock.calls[0][0])).toBe('http://from-di.example/agent');
      // The bare token aliases the ref token, so no second evaluation.
      expect(TestBed.runInInjectionContext(() => injectAgent())).toBe(agent);
      expect(calls).toBe(1);
      errorSpy.mockRestore();
      TestBed.resetTestingModule();
      vi.unstubAllGlobals();
    });
  });
});

describe('provideAgent — rawEvents$', () => {
  it.each([
    ['unprotected', false],
    ['protected', true],
  ] as const)('emits a server RUN_ERROR exactly once after error() and status() settle (%s)', async (_mode, protectedErrors) => {
    const events = [
      { type: 'RUN_STARTED', threadId: 't', runId: 'r' },
      { type: 'RUN_ERROR', message: 'server failure test-key-redact-me', code: 'test-key-redact-me-code' },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
      { headers: { 'content-type': 'text/event-stream' } },
    )));
    TestBed.configureTestingModule({
      providers: [
        provideAgent({ url: 'https://agent.example/run', telemetry: false }),
        ...(protectedErrors ? [{ provide: ɵAG_UI_RUNTIME_OPERATION_REPORTER, useValue: vi.fn() }] : []),
      ],
    });
    const agent = TestBed.runInInjectionContext(() => injectAgent());
    const seen: Array<{ type: string; status: string; hasError: boolean }> = [];
    const runErrors: BaseEvent[] = [];
    let completed = false;
    agent.rawEvents$.subscribe({
      next: event => {
        seen.push({ type: event.type, status: agent.status(), hasError: agent.error() !== undefined });
        if (event.type === 'RUN_ERROR') runErrors.push(event);
      },
      complete: () => { completed = true; },
    });

    await agent.submit({ message: 'hello' });

    expect(seen).toEqual([
      expect.objectContaining({ type: 'RUN_STARTED' }),
      { type: 'RUN_ERROR', status: 'error', hasError: true },
    ]);
    if (protectedErrors) {
      const generic = 'The server ran into an error. You can try again.';
      expect(agent.error()).toMatchObject({ message: generic });
      // rawEvents$ honours the protection: only the generic message survives.
      expect(runErrors).toEqual([{ type: 'RUN_ERROR', message: generic }]);
      expect(JSON.stringify(runErrors)).not.toContain('test-key-redact-me');
    } else {
      expect(runErrors).toEqual([
        expect.objectContaining({ message: 'server failure test-key-redact-me', code: 'test-key-redact-me-code' }),
      ]);
    }
    TestBed.resetTestingModule();
    expect(completed).toBe(true);
    expect(seen).toHaveLength(2);
    vi.unstubAllGlobals();
  });
});
