import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  injectAgent,
  injectThreadDirectory,
  provideAgent,
  provideThreadDirectory,
  refreshOnRunEnd,
} from './public-api';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Only this integration spec composes the private runtime; production imports core only.
import {
  createLangGraphThreadDirectory,
  type LangGraphThreadDirectory,
} from '../../langgraph/src/runtime/thread-directory';
import { ɵAGENT_OPERATION_FAILURE_REPORTER } from './agent-tokens';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Test-only threads API from the private runtime.
import {
  createFakeThreadsClient,
  type FakeThread,
} from '../../langgraph/src/runtime/testing/fake-threads-client';
import { scriptedSession } from './testing/scripted-session';

afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

const inContext = <T>(run: () => T) => TestBed.runInInjectionContext(run);

/** The view over the real LangGraph directory and an in-memory threads API. */
function setup(seed: readonly FakeThread[] = [], projects = false) {
  const client = createFakeThreadsClient(seed);
  TestBed.configureTestingModule({
    providers: [
      provideThreadDirectory({
        createDirectory: () =>
          createLangGraphThreadDirectory({
            client,
            ...(projects ? {} : { projects: false as const }),
          }),
        // An app's own reader, which the view prefers to the directory's `get`
        // (covered below, without a reader). Missing and malformed ids answer
        // null; anything else rejects.
        getThread: async (threadId) => {
          const found = client
            .stored()
            .find((thread) => thread.thread_id === threadId);
          if (threadId === 'offline') throw new Error('offline');
          return found
            ? {
                id: found.thread_id,
                title: String(found.metadata?.['title'] ?? 'New chat'),
                pinned: found.metadata?.['pinned'] === true,
                archived: found.metadata?.['archived'] === true,
                projectId: null,
              }
            : null;
        },
      }),
    ],
  });
  return { client, threads: inContext(() => injectThreadDirectory()) };
}

const ids = (list: readonly { id: string }[]) => list.map((item) => item.id);

describe('ThreadDirectoryView over the LangGraph thread directory', () => {
  it('lists threads after a refresh, with loading and the fallback title', async () => {
    const { client, threads } = setup([
      { thread_id: 'a', updated_at: '2030-01-01T00:00:01.000Z' },
      {
        thread_id: 'b',
        updated_at: '2030-01-01T00:00:02.000Z',
        metadata: { title: 'Trip' },
      },
      {
        thread_id: 'z',
        updated_at: '2030-01-01T00:00:03.000Z',
        metadata: { archived: true },
      },
    ]);
    expect(threads.threads()).toEqual([]);
    expect(threads.status()).toBe('idle');

    const release = client.hold('threads.search');
    const loading = threads.refresh();
    expect(threads.status()).toBe('loading');
    expect(threads.isLoading()).toBe(true);
    release();
    await loading;

    expect(threads.status()).toBe('idle');
    expect(threads.isLoading()).toBe(false);
    expect(ids(threads.threads())).toEqual(['b', 'a']);
    expect(threads.threads().map((thread) => thread.title)).toEqual([
      'Trip',
      'New chat',
    ]);
    expect(threads.threads()[0].status).toBe('active');
    expect(threads.threads()[0].updatedAt).toBe(
      Date.parse('2030-01-01T00:00:02.000Z')
    );
    expect(ids(threads.archivedThreads())).toEqual(['z']);
    expect(threads.archivedThreads()[0].status).toBe('archived');
    expect(threads.projects()).toBeUndefined();
  });

  it('publishes a failed load and recovers on the next one', async () => {
    const { client, threads } = setup([{ thread_id: 'a' }]);
    client.failNext('threads.search', 500);
    await expect(threads.refresh()).resolves.toBeUndefined();
    expect(threads.status()).toBe('error');
    expect(threads.error()).toMatchObject({ kind: 'server', retryable: true });
    await threads.refresh();
    expect(threads.status()).toBe('idle');
    expect(threads.error()).toBeUndefined();
    expect(ids(threads.threads())).toEqual(['a']);
  });

  it('shows a row command at once and keeps it once the server confirms', async () => {
    const { client, threads } = setup([{ thread_id: 'a' }, { thread_id: 'b' }]);
    await threads.refresh();

    const release = client.hold('threads.update');
    const renamed = threads.rename?.('a', 'Renamed');
    expect(threads.threads().find((t) => t.id === 'a')?.title).toBe('Renamed');
    release();
    await renamed;
    expect(threads.threads().find((t) => t.id === 'a')?.title).toBe('Renamed');

    await threads.pin?.('b');
    expect(ids(threads.threads())[0]).toBe('b');
    expect(threads.threads()[0].pinned).toBe(true);
    await threads.unpin?.('b');
    expect(threads.threads().every((thread) => !thread.pinned)).toBe(true);

    await threads.archive?.('a');
    expect(ids(threads.threads())).toEqual(['b']);
    expect(ids(threads.archivedThreads())).toEqual(['a']);
    await threads.unarchive?.('a');
    expect(ids(threads.archivedThreads())).toEqual([]);

    await threads.delete?.('a');
    expect(ids(threads.threads())).toEqual(['b']);
    expect(client.stored().map((thread) => thread.thread_id)).toEqual(['b']);
  });

  it('rolls a failed row command back and rejects', async () => {
    const { client, threads } = setup([
      { thread_id: 'a', metadata: { title: 'Before' } },
    ]);
    await threads.refresh();
    client.failNext('threads.update', 500);
    const renamed = threads.rename?.('a', 'After');
    expect(threads.threads()[0].title).toBe('After');
    await expect(renamed).rejects.toThrow();
    expect(threads.threads()[0].title).toBe('Before');
  });

  it('reorders pinned threads', async () => {
    const { threads } = setup([
      { thread_id: 'a', metadata: { pinned: true, pinnedOrder: 0 } },
      { thread_id: 'b', metadata: { pinned: true, pinnedOrder: 1 } },
      { thread_id: 'c', metadata: { pinned: true, pinnedOrder: 2 } },
    ]);
    await threads.refresh();
    expect(ids(threads.threads())).toEqual(['a', 'b', 'c']);
    await threads.reorderPinned?.('c', 'a');
    expect(ids(threads.threads())).toEqual(['c', 'a', 'b']);
    await threads.reorderPinned?.('c', null);
    expect(ids(threads.threads())).toEqual(['a', 'b', 'c']);
  });

  it('creates a thread, lists it and resolves null when creation fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client, threads } = setup();
    const id = await threads.create?.({ source: 'sidebar' });
    expect(id).toBe('thread-1');
    expect(ids(threads.threads())).toEqual(['thread-1']);
    expect(client.stored()[0].metadata).toEqual({ source: 'sidebar' });

    client.failNext('threads.create', 500);
    await expect(threads.create?.()).resolves.toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(ids(threads.threads())).toEqual(['thread-1']);
  });

  it('manages projects through the Store API and moves threads between them', async () => {
    const { threads } = setup([{ thread_id: 'a' }], true);
    await threads.refresh();
    expect(threads.projects()).toEqual([]);
    const project = await threads.createProject?.('Trips');
    expect(threads.projects()).toEqual([{ id: project?.id, name: 'Trips' }]);
    await threads.moveToProject?.('a', project?.id ?? null);
    expect(threads.threads()[0].projectId).toBe(project?.id);
    await threads.renameProject?.(project?.id ?? '', 'Travel');
    expect(threads.projects()?.[0].name).toBe('Travel');
    await threads.removeProject?.(project?.id ?? '');
    expect(threads.projects()).toEqual([]);
    expect(threads.threads()[0].projectId).toBeNull();
  });

  it('offers no project command when projects are off', () => {
    const { threads } = setup();
    expect(threads.createProject).toBeUndefined();
    expect(threads.renameProject).toBeUndefined();
    expect(threads.removeProject).toBeUndefined();
    expect(threads.moveToProject).toBeTypeOf('function');
  });

  it('reads one thread through the configured reader: found, missing, unreachable', async () => {
    const { threads } = setup([
      { thread_id: 'a', metadata: { title: 'Trip', archived: true } },
    ]);
    await expect(threads.getThread('a')).resolves.toMatchObject({
      id: 'a',
      title: 'Trip',
      status: 'archived',
    });
    await expect(threads.getThread('missing')).resolves.toBeNull();
    await expect(threads.getThread('offline')).rejects.toThrow('offline');
  });

  it('is the directory a thread sidebar takes, and is disposed with the injector', async () => {
    const { threads } = setup([{ thread_id: 'a' }]);
    const notify = vi.fn();
    threads.directory.subscribe(notify);
    await threads.refresh();
    expect(notify).toHaveBeenCalled();
    expect(ids(threads.directory.getSnapshot().threads)).toEqual(['a']);

    TestBed.resetTestingModule();
    await expect(threads.directory.rename?.('a', 'x')).rejects.toThrow();
    expect(ids(threads.threads())).toEqual(['a']);
  });

  it('refreshes when a run of the injected agent ends', async () => {
    const client = createFakeThreadsClient([{ thread_id: 'a' }]);
    let publish: ((patch: { status: 'idle' | 'running' }) => void) | undefined;
    TestBed.configureTestingModule({
      providers: [
        provideThreadDirectory({
          createDirectory: () =>
            createLangGraphThreadDirectory({ client, projects: false }),
        }),
        provideAgent({
          createSession: (context) => {
            const { session, control } = scriptedSession(context);
            publish = control.publish;
            return session;
          },
        }),
      ],
    });
    const threads = inContext(() => {
      const view = injectThreadDirectory();
      refreshOnRunEnd(injectAgent(), view);
      return view;
    });
    TestBed.tick();
    expect(client.calls).toEqual([]);
    publish?.({ status: 'running' });
    TestBed.tick();
    publish?.({ status: 'idle' });
    TestBed.tick();
    await vi.waitFor(() => expect(ids(threads.threads())).toEqual(['a']));
    expect(client.calls).toEqual(['threads.search']);
  });
});

describe('ThreadDirectoryView over the LangGraph thread directory, with no configured reader', () => {
  /** Typed by the directory, so every command is called without `?.`. */
  function setupTyped(seed: readonly FakeThread[] = []) {
    const client = createFakeThreadsClient(seed);
    TestBed.configureTestingModule({
      providers: [
        provideThreadDirectory({
          createDirectory: () => createLangGraphThreadDirectory({ client }),
        }),
      ],
    });
    return {
      client,
      threads: inContext(() =>
        injectThreadDirectory<LangGraphThreadDirectory>()
      ),
    };
  }

  it('reads one thread the list does not hold through the directory', async () => {
    const { client, threads } = setupTyped([
      { thread_id: 'a', metadata: { title: 'Trip', archived: true } },
    ]);

    await expect(threads.getThread('a')).resolves.toEqual({
      id: 'a',
      title: 'Trip',
      updatedAt: undefined,
      status: 'archived',
      pinned: false,
      archived: true,
      projectId: null,
    });
    // One request for one thread: the list is not read.
    expect(client.calls).toEqual(['threads.get']);
    expect(threads.threads()).toEqual([]);
  });

  it('answers null for a missing or malformed id, and rejects when it cannot tell', async () => {
    const { client, threads } = setupTyped([{ thread_id: 'a' }]);

    await expect(threads.getThread('missing')).resolves.toBeNull();
    client.failNext('threads.get', 422);
    await expect(threads.getThread('not-a-uuid')).resolves.toBeNull();
    client.failNext('threads.get', 500);
    await expect(threads.getThread('a')).rejects.toThrow(
      'The LangGraph request failed.'
    );
    expect(client.calls).toEqual(['threads.get', 'threads.get', 'threads.get']);
  });

  it('answers a listed, unchanged thread with the item the list shows', async () => {
    const { threads } = setupTyped([{ thread_id: 'a' }]);
    await threads.refresh();

    await expect(threads.getThread('a')).resolves.toBe(threads.threads()[0]);
  });

  it('carries the saved pin rank on list items and on a thread read alone', async () => {
    const { threads } = setupTyped([
      { thread_id: 'a', metadata: { pinned: true, pinnedOrder: 1 } },
      { thread_id: 'b', metadata: { pinned: true, pinnedOrder: 0 } },
      { thread_id: 'c', metadata: { pinned: true } },
      { thread_id: 'd' },
    ]);
    await expect(threads.getThread('a')).resolves.toMatchObject({
      id: 'a',
      pinnedOrder: 1,
    });
    await threads.refresh();

    expect(
      threads.threads().map((thread) => [thread.id, thread.pinnedOrder])
    ).toEqual([
      ['b', 0],
      ['a', 1],
      ['c', undefined],
      ['d', undefined],
    ]);
    expect('pinnedOrder' in threads.threads()[3]).toBe(false);

    await threads.reorderPinned('a', 'b');
    expect(
      threads.threads().map((thread) => [thread.id, thread.pinnedOrder])
    ).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', undefined],
    ]);
  });

  it('calls every command the directory has without an optional call', async () => {
    const { threads } = setupTyped([{ thread_id: 'a' }]);
    await threads.refresh();

    const created = await threads.create({ source: 'test' });
    await threads.rename('a', 'Trip');
    await threads.pin('a');
    await threads.unpin('a');
    await threads.archive('a');
    await threads.unarchive('a');
    const project = await threads.createProject('Trips');
    await threads.moveToProject('a', project.id);
    await threads.renameProject(project.id, 'Journeys');

    expect(threads.threads().find((t) => t.id === 'a')).toMatchObject({
      title: 'Trip',
      projectId: project.id,
    });
    expect(threads.projects()).toEqual([{ id: project.id, name: 'Journeys' }]);
    await threads.removeProject(project.id);
    await threads.delete('a');
    expect(ids(threads.threads())).toEqual([created]);
    expect(threads.directory.pinnedOrderOf(threads.threads()[0])).toBeUndefined();
  });
});

describe('ThreadDirectoryView over a LangGraph directory that owns its client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes the host reporter through, so a rejected credential is reported once', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input instanceof Request ? input.url : input));
        return new Response(null, { status: 401 });
      })
    );
    const report = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: ɵAGENT_OPERATION_FAILURE_REPORTER, useValue: report },
        provideThreadDirectory({
          createDirectory: ({ clientOptions, reportOperationFailure }) =>
            createLangGraphThreadDirectory({
              apiUrl: 'https://app.test/api',
              clientOptions,
              reportOperationFailure,
            }),
        }),
      ],
    });
    const threads = inContext(() => injectThreadDirectory());

    await threads.refresh();

    expect(threads.status()).toBe('error');
    expect(report.mock.calls).toEqual([['unauthorized']]);
    expect(requests).toHaveLength(1);
  });
});
