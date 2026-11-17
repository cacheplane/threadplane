import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  LangGraphThreadsAdapter,
  LANGGRAPH_THREADS_CONFIG,
  LANGGRAPH_CLIENT,
} from './threads-adapter';
import type { Client } from '@langchain/langgraph-sdk';
import {
  createLangGraphClient,
  ɵcreateProtectedLangGraphClient,
} from '../client/create-langgraph-client';
import { LANGGRAPH_CLIENT_OPTIONS } from '../client/client-options';
import { ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER } from '../runtime-operation-reporter';

vi.mock('../client/create-langgraph-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client/create-langgraph-client')>();
  return {
    ...actual,
    createLangGraphClient: vi.fn(actual.createLangGraphClient),
    ɵcreateProtectedLangGraphClient: vi.fn(
      actual.ɵcreateProtectedLangGraphClient
    ),
  };
});

function mockClient(searchReturn: unknown[] = []): {
  client: Client;
  search: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
} {
  const search = vi.fn().mockResolvedValue(searchReturn);
  const update = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockResolvedValue(undefined);
  const create = vi.fn().mockResolvedValue({ thread_id: 'new-thread' });
  const get = vi.fn();
  return {
    client: { threads: { search, update, delete: del, create, get } } as unknown as Client,
    search, update, del, create, get,
  };
}

function configure(client: Client): LangGraphThreadsAdapter {
  TestBed.configureTestingModule({
    providers: [
      { provide: LANGGRAPH_THREADS_CONFIG, useValue: { apiUrl: 'http://x' } },
      { provide: LANGGRAPH_CLIENT, useValue: client },
    ],
  });
  return TestBed.inject(LangGraphThreadsAdapter);
}

describe('LangGraphThreadsAdapter', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('maps SDK threads via metadata.title', async () => {
    const { client } = mockClient([
      {
        thread_id: 't1',
        updated_at: '2026-05-20T00:00:00Z',
        metadata: { title: 'Capital of Japan' },
      },
    ]);
    const svc = configure(client);
    await svc.refresh();
    expect(svc.threads()).toEqual([
      expect.objectContaining({ id: 't1', title: 'Capital of Japan', status: 'active', pinned: false }),
    ]);
  });

  it('falls back to "Untitled" when title metadata is missing', async () => {
    const { client } = mockClient([{ thread_id: 't1', metadata: {} }]);
    const svc = configure(client);
    await svc.refresh();
    expect(svc.threads()[0].title).toBe('Untitled');
  });

  it('partitions archived threads into archivedThreads()', async () => {
    const { client } = mockClient([
      { thread_id: 'a', metadata: {} },
      { thread_id: 'b', metadata: { archived: true } },
    ]);
    const svc = configure(client);
    await svc.refresh();
    expect(svc.threads().map(t => t.id)).toEqual(['a']);
    expect(svc.archivedThreads().map(t => t.id)).toEqual(['b']);
  });

  it('sorts pinned threads first (with pinnedOrder secondary sort)', async () => {
    const { client } = mockClient([
      { thread_id: 'unp', metadata: {} },
      { thread_id: 'p2', metadata: { pinned: true, pinnedOrder: 1 } },
      { thread_id: 'p1', metadata: { pinned: true, pinnedOrder: 0 } },
    ]);
    const svc = configure(client);
    await svc.refresh();
    expect(svc.threads().map(t => t.id)).toEqual(['p1', 'p2', 'unp']);
  });

  it('rename() writes metadata.title', async () => {
    const m = mockClient();
    const svc = configure(m.client);
    await svc.rename('t1', 'New title');
    expect(m.update).toHaveBeenCalledWith('t1', { metadata: { title: 'New title' } });
  });

  it('getThread() returns a mapped Thread when the SDK resolves', async () => {
    const m = mockClient();
    m.get.mockResolvedValue({
      thread_id: 'tx',
      updated_at: '2026-05-20T00:00:00Z',
      metadata: { title: 'hello' },
    });
    const svc = configure(m.client);
    const result = await svc.getThread('tx');
    expect(m.get).toHaveBeenCalledWith('tx');
    expect(result).toEqual(expect.objectContaining({ id: 'tx', title: 'hello' }));
  });

  it('getThread() returns null when the SDK throws a 404', async () => {
    const m = mockClient();
    const err = Object.assign(new Error('not found'), { status: 404 });
    m.get.mockRejectedValue(err);
    const svc = configure(m.client);
    expect(await svc.getThread('missing')).toBeNull();
  });

  it('getThread() returns null when 404 lives on response.status', async () => {
    const m = mockClient();
    const err = Object.assign(new Error('not found'), { response: { status: 404 } });
    m.get.mockRejectedValue(err);
    const svc = configure(m.client);
    expect(await svc.getThread('missing')).toBeNull();
  });

  it('getThread() rethrows non-404 errors so transport failures are visible', async () => {
    const m = mockClient();
    const err = Object.assign(new Error('server exploded'), { status: 500 });
    m.get.mockRejectedValue(err);
    const svc = configure(m.client);
    await expect(svc.getThread('any')).rejects.toThrow('server exploded');
  });

  it('logs but does not throw when refresh() fails', async () => {
    const search = vi.fn().mockRejectedValue(new Error('boom'));
    const client = { threads: { search } } as unknown as Client;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const svc = configure(client);
    await expect(svc.refresh()).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      '[LangGraphThreadsAdapter.refresh] failed:',
      expect.objectContaining({ message: 'boom' }),
    );
    errSpy.mockRestore();
  });
});

describe('LangGraphThreadsAdapter directory view', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('sets status error and keeps refresh resolving on failure', async () => {
    const search = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([{ thread_id: 'a', metadata: { title: 'A' } }]);
    const client = { threads: { search } } as unknown as Client;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const svc = configure(client);

    await expect(svc.refresh()).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalledWith(
      '[LangGraphThreadsAdapter.refresh] failed:',
      expect.objectContaining({ message: 'boom' }),
    );
    expect(svc.status()).toBe('error');
    expect(svc.error()).toEqual({
      kind: 'server',
      message: 'The LangGraph request failed.',
      retryable: true,
      recovery: 'retry',
    });
    expect(svc.directory.getSnapshot().status).toBe('error');
    expect(JSON.stringify(svc.error())).not.toContain('boom');

    await svc.refresh();

    expect(svc.status()).toBe('idle');
    expect(svc.error()).toBeUndefined();
    expect(svc.threads().map((t) => t.id)).toEqual(['a']);
    errSpy.mockRestore();
  });

  it('keeps create returning null on failure', async () => {
    const m = mockClient();
    m.create.mockRejectedValue(new Error('nope'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const svc = configure(m.client);

    await expect(svc.create({ title: 'x' })).resolves.toBeNull();
    await expect(svc.directory.create?.()).rejects.toThrow(
      'The LangGraph request failed.',
    );
    expect(errSpy).toHaveBeenCalledWith(
      '[LangGraphThreadsAdapter.create] failed:',
      expect.objectContaining({ message: 'nope' }),
    );
    errSpy.mockRestore();
  });

  it('keeps rethrowing the original error from adapter methods', async () => {
    const m = mockClient([{ thread_id: 'a', metadata: { title: 'A' } }]);
    m.update.mockRejectedValue(new Error('ordinary app failure'));
    const svc = configure(m.client);
    await svc.refresh();

    await expect(svc.rename('a', 'Trip')).rejects.toThrow('ordinary app failure');
    expect(svc.threads()[0].title).toBe('A');
  });

  it('lists threads without a store client and reports no projects', async () => {
    const m = mockClient([{ thread_id: 'a', metadata: { title: 'A' } }]);
    const svc = configure(m.client);

    await svc.refresh();

    expect(svc.threads().map((t) => t.id)).toEqual(['a']);
    expect(svc.status()).toBe('idle');
    expect(svc.projects()).toEqual([]);
    expect(svc.directory.getSnapshot().projects).toEqual([]);
  });

  it('turns projects off with projects: false', async () => {
    const searchItems = vi.fn().mockResolvedValue({ items: [] });
    const m = mockClient([{ thread_id: 'a', metadata: { title: 'A' } }]);
    (m.client as unknown as { store: unknown }).store = { searchItems };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: LANGGRAPH_THREADS_CONFIG,
          useValue: { apiUrl: 'http://x', projects: false },
        },
        { provide: LANGGRAPH_CLIENT, useValue: m.client },
      ],
    });
    const svc = TestBed.inject(LangGraphThreadsAdapter);

    await svc.refresh();

    expect(searchItems).not.toHaveBeenCalled();
    expect(svc.projects()).toBeUndefined();
    expect('projects' in svc.directory.getSnapshot()).toBe(false);
    expect(svc.directory.createProject).toBeUndefined();
  });

  it('reads projects from a custom namespace', async () => {
    const searchItems = vi.fn().mockResolvedValue({
      items: [{ key: 'p1', value: { name: ' Work ' } }],
    });
    const m = mockClient();
    (m.client as unknown as { store: unknown }).store = { searchItems };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: LANGGRAPH_THREADS_CONFIG,
          useValue: { apiUrl: 'http://x', projects: { namespace: ['app', 'groups'] } },
        },
        { provide: LANGGRAPH_CLIENT, useValue: m.client },
      ],
    });
    const svc = TestBed.inject(LangGraphThreadsAdapter);

    await svc.refresh();

    expect(searchItems).toHaveBeenCalledWith(['app', 'groups'], { limit: 100 });
    expect(svc.projects()).toEqual([{ id: 'p1', name: 'Work' }]);
  });

  it('notifies directory listeners outside an injection context and stops after dispose', async () => {
    const m = mockClient([{ thread_id: 'a', metadata: { title: 'A' } }]);
    const svc = configure(m.client);
    const notify = vi.fn();
    svc.directory.subscribe(notify);

    await svc.refresh();
    const snapshot = svc.directory.getSnapshot();

    expect(notify).toHaveBeenCalled();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.threads.map((t) => t.id)).toEqual(['a']);

    svc.directory.dispose();
    notify.mockClear();
    m.search.mockResolvedValue([{ thread_id: 'b', metadata: {} }]);
    await svc.refresh();

    expect(notify).not.toHaveBeenCalled();
    expect(svc.directory.getSnapshot()).toBe(snapshot);
    // The adapter itself keeps working for its signals.
    expect(svc.threads().map((t) => t.id)).toEqual(['b']);
    await expect(svc.directory.rename?.('b', 'B')).rejects.toThrow(
      'The LangGraph request failed.',
    );
  });

  it('shows a rename in threads() before the server answers', async () => {
    const m = mockClient([{ thread_id: 'a', metadata: { title: 'A' } }]);
    const svc = configure(m.client);
    await svc.refresh();
    let release!: () => void;
    m.update.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    m.search.mockResolvedValue([{ thread_id: 'a', metadata: { title: 'Trip' } }]);

    const renaming = svc.rename('a', 'Trip');

    expect(svc.threads()[0].title).toBe('Trip');
    release();
    await renaming;
    expect(svc.threads()[0].title).toBe('Trip');
  });
});

describe('LangGraphThreadsAdapter client options', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.mocked(createLangGraphClient).mockClear();
    vi.mocked(ɵcreateProtectedLangGraphClient).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const operation of ['refresh', 'create', 'delete'] as const) {
    for (const status of [401, 403] as const) {
      it(`reports ${status} from adapter-created ${operation} as unauthorized`, async () => {
        const reportOperationFailure = vi.fn();
        const fetchMock = vi.fn().mockResolvedValue(
          new Response('test-key-redact-me-poison-body', { status })
        );
        vi.stubGlobal('fetch', fetchMock);
        TestBed.configureTestingModule({
          providers: [
            {
              provide: LANGGRAPH_THREADS_CONFIG,
              useValue: { apiUrl: 'https://runtime.example/api' },
            },
            {
              provide: LANGGRAPH_CLIENT_OPTIONS,
              useValue: { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 0 },
            },
            {
              provide: ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER,
              useValue: reportOperationFailure,
            },
          ],
        });

        const adapter = TestBed.inject(LangGraphThreadsAdapter);
        if (operation === 'refresh') await adapter.refresh();
        if (operation === 'create') await adapter.create();
        if (operation === 'delete') {
          await adapter.delete('thread-1').catch(() => undefined);
        }

        expect(fetchMock).toHaveBeenCalled();
        expect(reportOperationFailure).toHaveBeenCalledExactlyOnceWith(
          'unauthorized'
        );
      });
    }
  }

  it('reports network_blocked once after adapter-created client retry exhaustion', async () => {
    const reportOperationFailure = vi.fn();
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError('test-key-redact-me'));
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: LANGGRAPH_THREADS_CONFIG,
          useValue: { apiUrl: 'https://runtime.example/api' },
        },
        {
          provide: LANGGRAPH_CLIENT_OPTIONS,
          useValue: { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 1 },
        },
        {
          provide: ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER,
          useValue: reportOperationFailure,
        },
      ],
    });

    await TestBed.inject(LangGraphThreadsAdapter).refresh();

    expect(fetchMock).toHaveBeenCalled();
    expect(reportOperationFailure).toHaveBeenCalledExactlyOnceWith(
      'network_blocked'
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
      'test-key-redact-me'
    );
    errorSpy.mockRestore();
  });

  it('does not classify an arbitrary injected-client error by status', async () => {
    const reportOperationFailure = vi.fn();
    const remoteError = Object.assign(new Error('ordinary app failure'), {
      status: 401,
    });
    const client = {
      threads: { search: vi.fn().mockRejectedValue(remoteError) },
    } as unknown as Client;
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: LANGGRAPH_THREADS_CONFIG, useValue: { apiUrl: 'http://x' } },
        { provide: LANGGRAPH_CLIENT, useValue: client },
        {
          provide: ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER,
          useValue: reportOperationFailure,
        },
      ],
    });

    await TestBed.inject(LangGraphThreadsAdapter).refresh();

    expect(reportOperationFailure).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      '[LangGraphThreadsAdapter.refresh] failed:',
      remoteError
    );
    errorSpy.mockRestore();
  });

  it('threads LANGGRAPH_CLIENT_OPTIONS into createLangGraphClient', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: LANGGRAPH_THREADS_CONFIG, useValue: { apiUrl: 'http://x' } },
        { provide: LANGGRAPH_CLIENT_OPTIONS, useValue: { maxRetries: 0 } },
      ],
    });
    TestBed.inject(LangGraphThreadsAdapter);
    expect(createLangGraphClient).toHaveBeenCalledWith('http://x', { maxRetries: 0 });
  });

  it('passes defaultHeaders to the protected threads SDK client', () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: LANGGRAPH_THREADS_CONFIG,
          useValue: { apiUrl: 'https://runtime.example/api' },
        },
        {
          provide: LANGGRAPH_CLIENT_OPTIONS,
          useValue: { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 0 },
        },
      ],
    });
    TestBed.inject(LangGraphThreadsAdapter);
    expect(ɵcreateProtectedLangGraphClient).toHaveBeenCalledWith(
      'https://runtime.example/api',
      { defaultHeaders: { 'x-api-key': 'test-key-redact-me' }, maxRetries: 0 },
      expect.any(Function)
    );
  });

  it('passes undefined options when the token is absent', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: LANGGRAPH_THREADS_CONFIG, useValue: { apiUrl: 'http://x' } },
      ],
    });
    TestBed.inject(LangGraphThreadsAdapter);
    expect(createLangGraphClient).toHaveBeenCalledWith('http://x', undefined);
  });

  it('does not construct a client when LANGGRAPH_CLIENT is provided (bypass intact)', () => {
    const injected = { threads: {} } as unknown as Client;
    TestBed.configureTestingModule({
      providers: [
        { provide: LANGGRAPH_THREADS_CONFIG, useValue: { apiUrl: 'http://x' } },
        { provide: LANGGRAPH_CLIENT_OPTIONS, useValue: { maxRetries: 0 } },
        { provide: LANGGRAPH_CLIENT, useValue: injected },
      ],
    });
    TestBed.inject(LangGraphThreadsAdapter);
    expect(createLangGraphClient).not.toHaveBeenCalled();
  });

  it('does not retain or log remote error text when defaultHeaders are configured', async () => {
    const remoteError = new Error('remote echoed test-key-redact-me');
    const client = {
      threads: { search: vi.fn().mockRejectedValue(remoteError) },
    } as unknown as Client;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: LANGGRAPH_THREADS_CONFIG,
          useValue: { apiUrl: 'https://runtime.example/api' },
        },
        {
          provide: LANGGRAPH_CLIENT_OPTIONS,
          useValue: { defaultHeaders: { 'x-api-key': 'test-key-redact-me' } },
        },
        { provide: LANGGRAPH_CLIENT, useValue: client },
      ],
    });

    await TestBed.inject(LangGraphThreadsAdapter).refresh();

    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('test-key-redact-me');
    expect(errorSpy).toHaveBeenCalledWith(
      '[LangGraphThreadsAdapter.refresh] failed:',
      expect.objectContaining({ name: 'LangGraphRequestError' }),
    );
    errorSpy.mockRestore();
  });

  it('rethrows a sanitized threads error when defaultHeaders are configured', async () => {
    const client = {
      threads: {
        get: vi.fn().mockRejectedValue(new Error('remote echoed test-key-redact-me')),
      },
    } as unknown as Client;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: LANGGRAPH_THREADS_CONFIG,
          useValue: { apiUrl: 'https://runtime.example/api' },
        },
        {
          provide: LANGGRAPH_CLIENT_OPTIONS,
          useValue: { defaultHeaders: { 'x-api-key': 'test-key-redact-me' } },
        },
        { provide: LANGGRAPH_CLIENT, useValue: client },
      ],
    });

    const error = await TestBed.inject(LangGraphThreadsAdapter)
      .getThread('thread-1')
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      name: 'LangGraphRequestError',
      message: 'The LangGraph request failed.',
    });
    expect(JSON.stringify(error)).not.toContain('test-key-redact-me');
  });

  it('fails closed when getThread receives hostile status/response getters with defaultHeaders', async () => {
    const hostile = new Proxy({}, {
      get() { throw new Error('test-key-redact-me'); },
      getOwnPropertyDescriptor() { throw new Error('test-key-redact-me'); },
    });
    const client = {
      threads: { get: vi.fn().mockRejectedValue(hostile) },
    } as unknown as Client;
    TestBed.configureTestingModule({
      providers: [
        { provide: LANGGRAPH_THREADS_CONFIG, useValue: { apiUrl: 'https://runtime.example/api' } },
        { provide: LANGGRAPH_CLIENT_OPTIONS, useValue: { defaultHeaders: { 'x-api-key': 'test-key-redact-me' } } },
        { provide: LANGGRAPH_CLIENT, useValue: client },
      ],
    });

    const error = await TestBed.inject(LangGraphThreadsAdapter)
      .getThread('thread-1')
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      name: 'LangGraphRequestError',
      message: 'The LangGraph request failed.',
    });
    expect(JSON.stringify(error)).not.toContain('test-key-redact-me');
  });
});
