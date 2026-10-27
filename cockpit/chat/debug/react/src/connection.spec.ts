import { describe, it, expect, vi, beforeEach } from 'vitest';
const f = vi.hoisted(() => ({
  create: vi.fn(),
  state: vi.fn(),
  history: vi.fn(),
  sdk: vi.fn(),
  session: vi.fn(),
}));
vi.mock('@langchain/langgraph-sdk', () => ({
  Client: class {
    threads = { create: f.create, getState: f.state, getHistory: f.history };
    constructor(c: any) {
      f.sdk(c);
    }
  },
}));
vi.mock('@threadplane/langgraph', () => ({
  createSession: (c: any) => f.session(c),
}));
import { createDebugClient, debugConnection } from './connection';
const session = () => ({
  getSnapshot: () => ({
    status: 'idle',
    messages: [],
    toolCalls: [],
    interrupts: [],
    subgraphs: [],
    history: [],
  }),
  subscribe: vi.fn(),
  submit: vi.fn(),
  load: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
  dispose: vi.fn(),
});
beforeEach(() => {
  vi.clearAllMocks();
  f.create.mockImplementation(async (c: any) => ({ thread_id: c.threadId }));
  f.session.mockImplementation(session);
});
describe('private one-target native connection', () => {
  it('captures/freeze configuration once and rejects unsupported bridge targets', () => {
    const source: any = {
      status: 'configured',
      target: {
        kind: 'langsmith',
        apiUrl: 'https://private.invalid/api',
        apiKey: 'secret',
      },
    };
    const c = debugConnection(source);
    source.target.apiKey = 'changed';
    expect(c.headers).toEqual({ 'x-api-key': 'secret' });
    expect(Object.isFrozen(c.headers)).toBe(true);
    expect(Object.isFrozen(c)).toBe(true);
    expect(() =>
      debugConnection({ status: 'error', code: 'incompatible_bridge' })
    ).toThrow();
    expect(() =>
      debugConnection({
        status: 'configured',
        target: { kind: 'ag-ui', endpoint: 'x' },
        generation: 1,
        reportOperationFailure: vi.fn(),
      } as any)
    ).toThrow();
  });
  it('owns immutable same-origin default and configured shared targets', () => {
    for (const configuration of [
      { status: 'default' as const },
      {
        status: 'configured' as const,
        target: { kind: 'shared' as const },
        generation: 1,
        reportOperationFailure: vi.fn(),
      },
    ]) {
      const captured = debugConnection(configuration);
      expect(captured).toEqual({
        apiUrl: new URL('/api', window.location.origin).href,
        headers: {},
      });
      expect(Object.isFrozen(captured)).toBe(true);
      expect(Object.isFrozen(captured.headers)).toBe(true);
    }
    expect(f.sdk).not.toHaveBeenCalled();
    expect(f.session).not.toHaveBeenCalled();
  });
  it('is lazy and creates UUID once with SDK retry/env suppression and registry', async () => {
    const input = {
      apiUrl: 'https://private.invalid',
      headers: { 'x-api-key': 'secret' },
    };
    const c = createDebugClient(input);
    input.headers['x-api-key'] = 'changed';
    expect(f.sdk).not.toHaveBeenCalled();
    const s = new AbortController().signal;
    const id = await c.createThread(s);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.create).toHaveBeenCalledWith({
      threadId: id,
      ifExists: 'raise',
      signal: s,
    });
    expect(f.sdk).toHaveBeenCalledWith({
      apiUrl: input.apiUrl,
      apiKey: null,
      defaultHeaders: { 'x-api-key': 'secret' },
      callerOptions: { maxRetries: 0 },
    });
    await c.sessionFactory(id);
    expect(f.session).toHaveBeenCalledWith({
      assistantId: 'c-debug',
      threadId: id,
      apiUrl: input.apiUrl,
      clientOptions: {
        maxRetries: 0,
        defaultHeaders: { 'x-api-key': 'secret' },
      },
    });
    expect(Object.keys(c)).not.toContain('headers');
    expect(Object.keys(c)).not.toContain('client');
  });
  it('only reads known threads with exact SDK object and signal shapes', async () => {
    const c = createDebugClient({ apiUrl: 'x', headers: {} });
    const signal = new AbortController().signal;
    await expect(c.readCurrent('unknown', signal)).rejects.toThrow();
    await expect(c.readHistory('unknown', signal)).rejects.toThrow();
    const id = await c.createThread(signal);
    await c.readCurrent(id, signal);
    expect(f.state).toHaveBeenLastCalledWith(id, undefined, { signal });
    await c.readHistory(id, signal);
    expect(f.history).toHaveBeenLastCalledWith(id, { limit: 10, signal });
    const cp = {
      thread_id: id,
      checkpoint_ns: '' as const,
      checkpoint_id: 'cp',
      checkpoint_map: { '': 'cp' },
    };
    const promise = c.readCheckpoint(cp, signal);
    cp.checkpoint_id = 'changed';
    await promise;
    expect(f.state).toHaveBeenLastCalledWith(
      id,
      {
        thread_id: id,
        checkpoint_ns: '' as const,
        checkpoint_id: 'cp',
        checkpoint_map: { '': 'cp' },
      },
      { signal }
    );
  });
  it('rejects mismatched thread creation and aborted calls', async () => {
    const c = createDebugClient({ apiUrl: 'x', headers: {} });
    const s = new AbortController();
    f.create.mockResolvedValue({ thread_id: 'wrong' });
    await expect(c.createThread(s.signal)).rejects.toThrow();
    await expect(c.sessionFactory('wrong')).rejects.toThrow();
    s.abort();
    await expect(c.createThread(s.signal)).rejects.toThrow();
  });
  it('awaits rejected session disposal before exposing failure', async () => {
    let release!: () => void;
    const disposed = new Promise<void>((r) => (release = r));
    const bad = {
      ...session(),
      load: undefined,
      dispose: vi.fn(() => disposed),
    };
    f.session.mockReturnValue(bad);
    const c = createDebugClient({ apiUrl: 'x', headers: {} }),
      id = await c.createThread(new AbortController().signal);
    let ended = false;
    const p = c.sessionFactory(id).catch(() => {
      ended = true;
    });
    await Promise.resolve();
    expect(bad.dispose).toHaveBeenCalledOnce();
    expect(ended).toBe(false);
    release();
    await p;
    expect(ended).toBe(true);
  });
  it('rejects checkpoint accessors without invoking them', async () => {
    const c = createDebugClient({ apiUrl: 'x', headers: {} });
    const id = await c.createThread(new AbortController().signal);
    let reads = 0;
    await expect(
      c.readCheckpoint(
        {
          thread_id: id,
          checkpoint_ns: '',
          get checkpoint_id() {
            reads++;
            return 'cp';
          },
        },
        new AbortController().signal
      )
    ).rejects.toThrow();
    expect(reads).toBe(0);
  });
  it('captures methods once in immutable facade and rejects accessors without invoking them', async () => {
    const raw = session();
    f.session.mockReturnValue(raw);
    const c = createDebugClient({ apiUrl: 'x', headers: {} }),
      id = await c.createThread(new AbortController().signal),
      handle = await c.sessionFactory(id);
    const submit = raw.submit;
    raw.submit = vi.fn();
    handle.submit('input');
    expect(submit).toHaveBeenCalledWith('input');
    expect(Object.isFrozen(handle)).toBe(true);
    let reads = 0;
    const bad = {
      ...session(),
      get load() {
        reads++;
        throw Error('method getter');
      },
    };
    f.session.mockReturnValue(bad);
    await expect(c.sessionFactory(id)).rejects.toThrow();
    expect(reads).toBe(0);
    expect(bad.dispose).toHaveBeenCalledOnce();
  });

  it('sanitizes target failures without leaking headers or SDK detail', async () => {
    const c = createDebugClient({
        apiUrl: 'private-url',
        headers: { 'x-api-key': 'secret' },
      }),
      signal = new AbortController().signal,
      id = await c.createThread(signal);
    f.state.mockRejectedValue(Error('secret private-url'));
    await expect(c.readCurrent(id, signal)).rejects.toThrow(
      'Checkpoint read failed.'
    );
  });
});
