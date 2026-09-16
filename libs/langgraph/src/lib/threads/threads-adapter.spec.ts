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
