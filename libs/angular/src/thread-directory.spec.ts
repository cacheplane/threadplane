import {
  createEnvironmentInjector,
  effect,
  EnvironmentInjector,
  inject,
  InjectionToken,
  isSignal,
  runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ThreadDirectory, ThreadEntry } from '@threadplane/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createThreadDirectoryView,
  injectThreadDirectory,
  provideAgentClientOptions,
  provideThreadDirectory,
  ɵAGENT_OPERATION_FAILURE_REPORTER,
  type ThreadDirectoryConfig,
} from './public-api';
import {
  entry,
  scriptedDirectory,
  type ScriptedDirectory,
} from './testing/scripted-directory';

const injectors: EnvironmentInjector[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const injector of injectors.splice(0))
    if (!injector.destroyed) injector.destroy();
  TestBed.resetTestingModule();
});

function context(
  providers: Parameters<typeof createEnvironmentInjector>[0] = []
) {
  const injector = createEnvironmentInjector(
    providers,
    TestBed.inject(EnvironmentInjector)
  );
  injectors.push(injector);
  return injector;
}

/** A view over a scripted directory. */
function scripted(
  initial: Parameters<typeof scriptedDirectory>[0] = {},
  config: Omit<ThreadDirectoryConfig<ScriptedDirectory>, 'createDirectory'> = {}
) {
  const { directory, control } = scriptedDirectory(initial);
  const injector = context();
  const view = runInInjectionContext(injector, () =>
    createThreadDirectoryView<ScriptedDirectory>({
      ...config,
      createDirectory: () => directory,
    })
  );
  return { view, directory, control, injector };
}

/** A view over a directory with only the required members. */
function minimal(
  extra: object = {},
  config: Omit<ThreadDirectoryConfig, 'createDirectory'> = {}
) {
  const { directory, control } = scriptedDirectory();
  const bare: ThreadDirectory = {
    getSnapshot: directory.getSnapshot,
    subscribe: directory.subscribe,
    refresh: (options) => directory.refresh(options),
    dispose: directory.dispose,
    ...extra,
  };
  const view = runInInjectionContext(context(), () =>
    createThreadDirectoryView({ ...config, createDirectory: () => bare })
  );
  return { view, control };
}

/** Counts how often a signal notifies a consumer. */
function notifications(injector: EnvironmentInjector, read: () => unknown) {
  let count = 0;
  runInInjectionContext(injector, () =>
    effect(() => {
      read();
      count++;
    })
  );
  TestBed.tick();
  return () => {
    TestBed.tick();
    return count;
  };
}

describe('ThreadDirectoryView signals', () => {
  it('exposes the snapshot as read-only signals that follow the directory', () => {
    const { view, control } = scripted();
    expect(view.threads()).toEqual([]);
    expect(view.archivedThreads()).toEqual([]);
    expect(view.projects()).toBeUndefined();
    expect(view.status()).toBe('idle');
    expect(view.error()).toBeUndefined();
    expect(view.isLoading()).toBe(false);
    for (const key of [
      'threads',
      'archivedThreads',
      'projects',
      'status',
      'error',
      'isLoading',
    ] as const) {
      expect(isSignal(view[key])).toBe(true);
      expect('set' in view[key]).toBe(false);
    }

    control.publish({ status: 'loading' });
    expect(view.status()).toBe('loading');
    expect(view.isLoading()).toBe(true);

    const projects = Object.freeze([{ id: 'p', name: 'Trips' }]);
    control.publish({
      threads: [entry('a', { pinned: true, updatedAt: 5, projectId: 'p' })],
      archived: [entry('z', { archived: true, title: 'Old' })],
      projects,
      status: 'idle',
    });
    expect(view.threads()).toEqual([
      {
        id: 'a',
        title: 'Thread a',
        updatedAt: 5,
        status: 'active',
        pinned: true,
        archived: false,
        projectId: 'p',
      },
    ]);
    expect(view.archivedThreads()).toEqual([
      {
        id: 'z',
        title: 'Old',
        status: 'archived',
        pinned: false,
        archived: true,
        projectId: null,
      },
    ]);
    expect('updatedAt' in view.archivedThreads()[0]).toBe(false);
    expect(view.projects()).toBe(projects);
    expect(view.isLoading()).toBe(false);
  });

  it('publishes a load failure and clears it with the next good load', () => {
    const { view, control } = scripted();
    const error = {
      kind: 'server',
      message: 'The request failed.',
      retryable: true,
      recovery: 'retry',
    } as const;
    control.publish({ status: 'error', error });
    expect(view.status()).toBe('error');
    expect(view.error()).toBe(error);
    expect(view.isLoading()).toBe(false);
    control.publish({ status: 'idle', error: undefined });
    expect(view.error()).toBeUndefined();
  });

  it('keeps the item of an entry that did not change', () => {
    const a = entry('a');
    const b = entry('b');
    const { view, control } = scripted({ threads: [a, b] });
    const [itemA, itemB] = view.threads();
    control.publish({ threads: [a, entry('b', { title: 'Renamed' })] });
    expect(view.threads()[0]).toBe(itemA);
    expect(view.threads()[1]).not.toBe(itemB);
    expect(view.threads()[1].title).toBe('Renamed');
    // The same entry moving to the other list keeps its item too.
    control.publish({ threads: [a], archived: [b] });
    expect(view.archivedThreads()[0]).toBe(itemB);
  });

  it('notifies a list only when its own array changed', () => {
    const threads = Object.freeze([entry('a')]);
    const { view, control, injector } = scripted({ threads });
    const listed = notifications(injector, view.threads);
    const archived = notifications(injector, view.archivedThreads);
    const status = notifications(injector, view.status);
    control.publish({ status: 'loading' });
    expect(listed()).toBe(1);
    expect(archived()).toBe(1);
    expect(status()).toBe(2);
    control.publish({ archived: [entry('z', { archived: true })] });
    expect(listed()).toBe(1);
    expect(archived()).toBe(2);
    control.publish({ threads: [entry('a'), entry('b')] });
    expect(listed()).toBe(2);
  });

  it('gives each read a list a caller may hold as mutable', () => {
    const { view } = scripted({ threads: [entry('a')] });
    const list: { id: string }[] = view.threads();
    expect(list).toHaveLength(1);
    expect(Object.isFrozen(list[0])).toBe(true);
  });
});

describe('ThreadDirectoryView commands', () => {
  it('exposes the directory itself, stable for the life of the view', () => {
    const { view, directory } = scripted();
    expect(view.directory).toBe(directory);
    expect(Object.isFrozen(view)).toBe(true);
  });

  it('refreshes through the directory, passing the abort signal', async () => {
    const { view, control } = scripted();
    control.onRefresh = { threads: [entry('a')] };
    const signal = new AbortController().signal;
    await view.refresh({ signal });
    expect(control.calls).toEqual([['refresh', 'scripted', { signal }]]);
    expect(view.threads().map((thread) => thread.id)).toEqual(['a']);
  });

  it('loads nothing until refresh is called', () => {
    const { control } = scripted();
    expect(control.calls).toEqual([]);
  });

  it('maps each row command onto the directory command', async () => {
    const { view, control } = scripted();
    await view.rename('a', 'Title');
    await view.delete('a');
    await view.archive('a');
    await view.unarchive('a');
    await view.pin('a');
    await view.unpin('a');
    await view.moveToProject('a', 'p');
    await view.moveToProject('a', null);
    await view.reorderPinned('a', 'b');
    await view.reorderPinned('a', null);
    expect(control.calls).toEqual([
      ['rename', 'a', 'Title'],
      ['remove', 'a'],
      ['setArchived', 'a', true],
      ['setArchived', 'a', false],
      ['setPinned', 'a', true],
      ['setPinned', 'a', false],
      ['setProject', 'a', 'p'],
      ['setProject', 'a', null],
      ['reorderPinned', 'a', 'b'],
      ['reorderPinned', 'a', null],
    ]);
  });

  it('maps the project commands and returns the new project id', async () => {
    const { view, control } = scripted();
    await expect(view.createProject('Trips')).resolves.toEqual({
      id: 'project',
    });
    await view.renameProject('project', 'Travel');
    await view.removeProject('project');
    expect(control.calls).toEqual([
      ['createProject', 'Trips'],
      ['renameProject', 'project', 'Travel'],
      ['removeProject', 'project'],
    ]);
  });

  it('rejects a failed row command with the directory error', async () => {
    const { view, control } = scripted();
    const failure = new Error('The request failed.');
    control.failNext = failure;
    await expect(view.rename('a', 'Title')).rejects.toBe(failure);
    control.failNext = failure;
    await expect(view.delete('a')).rejects.toBe(failure);
    control.failNext = failure;
    await expect(view.createProject('Trips')).rejects.toBe(failure);
  });

  it('works when a command is detached from the view', async () => {
    const { view, control } = scripted();
    const { rename, refresh, archive } = view;
    await rename('a', 'Title');
    await archive('a');
    await refresh();
    expect(control.calls.map((call) => call[0])).toEqual([
      'rename',
      'setArchived',
      'refresh',
    ]);
  });

  it('creates a thread and resolves with its id', async () => {
    const { view, control } = scripted();
    await expect(view.create()).resolves.toBe('created');
    await expect(view.create({ source: 'sidebar' })).resolves.toBe('created');
    expect(control.calls).toEqual([
      ['create', { metadata: {} }],
      ['create', { metadata: { source: 'sidebar' } }],
    ]);
  });

  it('resolves create with null, and logs, when the request fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { view, control } = scripted();
    const failure = new Error('The request failed.');
    control.failNext = failure;
    await expect(view.create()).resolves.toBeNull();
    expect(logged).toHaveBeenCalledWith(
      '[ThreadDirectoryView.create] failed:',
      failure
    );
  });

  it('leaves a command undefined when the directory does not offer it', () => {
    const { view } = minimal();
    for (const key of [
      'create',
      'rename',
      'delete',
      'archive',
      'unarchive',
      'pin',
      'unpin',
      'moveToProject',
      'reorderPinned',
      'createProject',
      'renameProject',
      'removeProject',
    ] as const)
      expect(view[key]).toBeUndefined();
    expect(view.refresh).toBeTypeOf('function');
    expect(view.getThread).toBeTypeOf('function');
  });

  it('offers exactly the commands a partial directory has', () => {
    const { view } = minimal({ setArchived: async () => undefined });
    expect(view.archive).toBeTypeOf('function');
    expect(view.unarchive).toBeTypeOf('function');
    expect(view.pin).toBeUndefined();
    expect(view.rename).toBeUndefined();
  });
});

describe('ThreadDirectoryView getThread', () => {
  it('reads one thread through the configured reader', async () => {
    const getThread = vi.fn(async (id: string): Promise<ThreadEntry | null> =>
      id === 'gone' ? null : entry(id, { archived: true })
    );
    const { view, directory, control } = scripted({}, { getThread });
    await expect(view.getThread('a')).resolves.toEqual({
      id: 'a',
      title: 'Thread a',
      status: 'archived',
      pinned: false,
      archived: true,
      projectId: null,
    });
    expect(getThread).toHaveBeenCalledWith('a', directory);
    await expect(view.getThread('gone')).resolves.toBeNull();
    // The reader is the answer: the list is not consulted or reloaded.
    expect(control.calls).toEqual([]);
  });

  it('rejects when the reader could not ask the backend', async () => {
    const failure = new Error('offline');
    const { view } = scripted({}, { getThread: () => Promise.reject(failure) });
    await expect(view.getThread('a')).rejects.toBe(failure);
  });

  it("uses the directory's own get when it has one", async () => {
    const calls: unknown[] = [];
    const { view } = minimal({
      label: 'own',
      async get(this: { label: string }, id: string) {
        calls.push([this.label, id]);
        return id === 'gone' ? null : entry(id);
      },
    });
    await expect(view.getThread('a')).resolves.toMatchObject({ id: 'a' });
    await expect(view.getThread('gone')).resolves.toBeNull();
    expect(calls).toEqual([
      ['own', 'a'],
      ['own', 'gone'],
    ]);
  });

  it('prefers the configured reader over the directory get', async () => {
    const own = vi.fn(async () => entry('own'));
    const { view } = minimal(
      { get: own },
      { getThread: async () => entry('configured') }
    );
    await expect(view.getThread('a')).resolves.toMatchObject({
      id: 'configured',
    });
    expect(own).not.toHaveBeenCalled();
  });

  it("puts the directory's pin rank on an item, and no field when it has none", async () => {
    const ranked = entry('a', { pinned: true });
    const calls: unknown[] = [];
    const { view } = minimal({
      label: 'own',
      get: async (id: string) => (id === 'a' ? ranked : entry(id)),
      pinnedOrderOf(this: { label: string }, asked: ThreadEntry) {
        calls.push([this.label, asked.id]);
        return asked === ranked ? 4 : undefined;
      },
    });
    const first = await view.getThread('a');
    expect(first).toEqual({
      id: 'a',
      title: 'Thread a',
      status: 'active',
      pinned: true,
      pinnedOrder: 4,
      archived: false,
      projectId: null,
    });
    const other = await view.getThread('b');
    expect(other && 'pinnedOrder' in other).toBe(false);
    // The rank is asked once per entry, on the directory.
    await expect(view.getThread('a')).resolves.toBe(first);
    expect(calls).toEqual([
      ['own', 'a'],
      ['own', 'b'],
    ]);
  });

  it('answers for a listed thread without a request, from either list', async () => {
    const { view, control } = scripted({
      threads: [entry('a')],
      archived: [entry('z', { archived: true })],
    });
    await expect(view.getThread('a')).resolves.toBe(view.threads()[0]);
    await expect(view.getThread('z')).resolves.toBe(view.archivedThreads()[0]);
    expect(control.calls).toEqual([]);
  });

  it('reads the list once for a thread that is not in it', async () => {
    const { view, control } = scripted();
    control.onRefresh = { threads: [entry('a')] };
    await expect(view.getThread('a')).resolves.toMatchObject({ id: 'a' });
    expect(control.calls.map((call) => call[0])).toEqual(['refresh']);
  });

  it('rejects, rather than answer missing, for a thread no list can prove absent', async () => {
    const { view, control } = scripted({ threads: [entry('a')] });
    await expect(view.getThread('other')).rejects.toThrow(
      'cannot read a single thread'
    );
    expect(control.calls.map((call) => call[0])).toEqual(['refresh']);
  });
});

describe('ThreadDirectoryView lifetime', () => {
  it('disposes the directory and stops following it with its injector', () => {
    const { view, control, injector } = scripted({ threads: [entry('a')] });
    expect(control.subscribers).toBe(1);
    injector.destroy();
    expect(control.disposals).toBe(1);
    expect(control.subscribers).toBe(0);
    control.publish({ threads: [] });
    // Reads keep the final values.
    expect(view.threads().map((thread) => thread.id)).toEqual(['a']);
  });

  it('survives a directory that throws while it is disposed, and ignores what it says later', () => {
    const { directory, control } = scriptedDirectory({ threads: [entry('a')] });
    const injector = context();
    const view = runInInjectionContext(injector, () =>
      createThreadDirectoryView({
        createDirectory: () => ({
          ...directory,
          // The subscription cannot be released, so it keeps notifying.
          subscribe(notify: () => void) {
            directory.subscribe(notify);
            return () => {
              throw new Error('release failed');
            };
          },
          dispose() {
            throw new Error('dispose failed');
          },
        }),
      })
    );
    expect(() => injector.destroy()).not.toThrow();
    expect(control.subscribers).toBe(1);
    control.publish({ threads: [] });
    expect(view.threads().map((thread) => thread.id)).toEqual(['a']);
  });

  it('requires an injection context', () => {
    expect(() =>
      createThreadDirectoryView({
        createDirectory: () => scriptedDirectory().directory,
      })
    ).toThrow();
  });

  it('hands the app-wide client options and failure reporter to the factory', () => {
    const report = vi.fn();
    const clientOptions = { defaultHeaders: { 'x-team': 'a' } };
    const createDirectory = vi.fn(() => scriptedDirectory().directory);
    runInInjectionContext(
      context([
        provideAgentClientOptions(clientOptions),
        { provide: ɵAGENT_OPERATION_FAILURE_REPORTER, useValue: report },
      ]),
      () => createThreadDirectoryView({ createDirectory })
    );
    expect(createDirectory).toHaveBeenCalledWith({
      clientOptions,
      reportOperationFailure: report,
    });

    const bare = vi.fn(() => scriptedDirectory().directory);
    runInInjectionContext(context(), () =>
      createThreadDirectoryView({ createDirectory: bare })
    );
    expect(bare).toHaveBeenCalledWith({
      clientOptions: undefined,
      reportOperationFailure: undefined,
    });
  });
});

describe('provideThreadDirectory', () => {
  const inContext = <T>(run: () => T) => TestBed.runInInjectionContext(run);

  it('provides one view, built on first injection', () => {
    const createDirectory = vi.fn(() => scriptedDirectory().directory);
    TestBed.configureTestingModule({
      providers: [provideThreadDirectory({ createDirectory })],
    });
    expect(createDirectory).not.toHaveBeenCalled();
    const view = inContext(() => injectThreadDirectory());
    expect(createDirectory).toHaveBeenCalledTimes(1);
    expect(inContext(() => injectThreadDirectory())).toBe(view);
    expect(view.status()).toBe('idle');
  });

  it('runs a config factory once, in an injection context', () => {
    const API = new InjectionToken<string>('API');
    const seen: string[] = [];
    const factory = vi.fn(() => {
      const api = inject(API);
      return {
        createDirectory: () => {
          seen.push(`${api}:${inject(API)}`);
          return scriptedDirectory().directory;
        },
      };
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: API, useValue: '/api' },
        provideThreadDirectory(factory),
      ],
    });
    inContext(() => injectThreadDirectory());
    inContext(() => injectThreadDirectory());
    expect(factory).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['/api:/api']);
  });

  it('gives a child injector its own view and disposes it with that injector', () => {
    const root = scriptedDirectory();
    const child = scriptedDirectory();
    TestBed.configureTestingModule({
      providers: [
        provideThreadDirectory({ createDirectory: () => root.directory }),
      ],
    });
    const injector = context([
      provideThreadDirectory({ createDirectory: () => child.directory }),
    ]);
    const rootView = inContext(() => injectThreadDirectory());
    const childView = runInInjectionContext(injector, () =>
      injectThreadDirectory()
    );
    expect(childView).not.toBe(rootView);
    expect(childView.directory).toBe(child.directory);
    injector.destroy();
    expect(child.control.disposals).toBe(1);
    expect(root.control.disposals).toBe(0);
  });

  it('fails clearly without a directory factory, or without a provider', () => {
    TestBed.configureTestingModule({
      providers: [provideThreadDirectory({} as never)],
    });
    expect(() => inContext(() => injectThreadDirectory())).toThrow(
      '`createDirectory` is required'
    );
    TestBed.resetTestingModule();
    expect(() => inContext(() => injectThreadDirectory())).toThrow();
  });
});
