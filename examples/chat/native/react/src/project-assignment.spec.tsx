import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createReactApplication } from './application';
import { applicationFixture } from './application-fixture';
import { App } from './app';
import type { ThreadRow } from '../../shared/contracts';
import { PROJECT_CATALOG_KEY } from './project-catalog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
it('moves and removes active/archived membership only on confirmed Save while retaining filtered selection, draft and runtime', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  localStorage.setItem(
    PROJECT_CATALOG_KEY,
    JSON.stringify({
      version: 1,
      projects: [
        { id: ' p/b ', name: 'Local P' },
        { id: '__proto__', name: '<Local Q>' },
      ],
    })
  );
  const fixture = applicationFixture();
  let rows: readonly ThreadRow[] = [
    { id: 'a', title: '<Alpha>', projectId: ' p/b ' },
    { id: 'b', title: 'Beta', projectId: '__proto__' },
    { id: 'c', title: 'Archived', archived: true, projectId: ' p/b ' },
  ];
  const io = {
    list: 0,
    get: 0,
    create: 0,
    moves: [] as [string, string | null][],
  };
  let fail = true;
  const application = createReactApplication({
    ...fixture.options,
    directory: {
      async list() {
        io.list++;
        return { kind: 'ready', value: rows };
      },
      async get(id) {
        io.get++;
        return { kind: 'ready', value: rows.find((row) => row.id === id)! };
      },
      async create() {
        io.create++;
        return { kind: 'failed' };
      },
      async setProject(id, projectId) {
        io.moves.push([id, projectId]);
        if (fail) {
          fail = false;
          return { kind: 'failed' };
        }
        rows = rows.map((row) => {
          if (row.id !== id) return row;
          const { projectId: _previous, ...rest } = row;
          return projectId === null ? rest : { ...rest, projectId };
        });
        return { kind: 'ready', value: { id, projectId } };
      },
    },
  });
  try {
    application.start();
    await waitFor(() =>
      expect(application.getSnapshot().selection.status).toBe('ready')
    );
    const view = render(
      <App application={application} presentation="sidenav" />
    );
    const input = view.getByRole('textbox', {
      name: 'Message',
    }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Keep draft' } });
    const runtime = application.getSnapshot().runtime;
    const messages = application.getSnapshot().messages;
    const before = {
      list: io.list,
      get: io.get,
      create: io.create,
      counters: { ...fixture.counters },
    };
    const projects = view.getByRole('list', { name: 'Projects' });
    fireEvent.click(
      within(projects).getByRole('button', { name: 'Local P', exact: true })
    );
    const active = view.getByRole('list', { name: 'Loaded conversations' });
    const open = (title: string, id: string) => {
      fireEvent.click(
        view.getByRole('button', {
          name: `Actions for ${title} (${id})`,
          exact: true,
        })
      );
      fireEvent.click(
        view.getByRole('menuitem', {
          name: `Move to project for ${title} (${id})`,
          exact: true,
        })
      );
      return within(
        view.getByRole('region', {
          name: `Move conversation: ${title} (${id})`,
        })
      );
    };
    let editor = open('<Alpha>', 'a');
    fireEvent.click(
      editor.getByRole('button', { name: '<Local Q>', exact: true })
    );
    expect(io.moves).toEqual([]);
    await act(async () =>
      fireEvent.click(editor.getByRole('button', { name: 'Save', exact: true }))
    );
    expect(editor.getByRole('alert').textContent).toContain(
      'Could not confirm'
    );
    expect(
      within(active).getByRole('button', { name: '<Alpha>', exact: true })
    ).toBeDefined();
    await act(async () =>
      fireEvent.click(editor.getByRole('button', { name: 'Save', exact: true }))
    );
    expect(
      within(active).queryByRole('button', { name: '<Alpha>', exact: true })
    ).toBeNull();
    expect(
      view.queryByRole('region', { name: /^Move conversation:/ })
    ).toBeNull();
    expect(view.getByText('Selected project: p/b')).toBeDefined();
    expect(view.getByText(/Conversation moved: <Alpha>/)).toBeDefined();
    expect(document.activeElement).toBe(view.getByRole('searchbox'));
    expect(view.getByRole('textbox', { name: 'Message' })).toBe(input);
    expect(input.value).toBe('Keep draft');
    expect(application.getSnapshot().selection.id).toBe('a');
    expect(application.getSnapshot().runtime).toBe(runtime);
    expect(application.getSnapshot().messages).toBe(messages);
    fireEvent.click(
      within(projects).getByRole('button', { name: '<Local Q>', exact: true })
    );
    editor = open('<Alpha>', 'a');
    fireEvent.click(
      editor.getByRole('button', { name: 'No project', exact: true })
    );
    await act(async () =>
      fireEvent.click(editor.getByRole('button', { name: 'Save', exact: true }))
    );
    expect(
      Object.hasOwn(application.getSnapshot().selection.row!, 'projectId')
    ).toBe(false);
    expect(view.getByText('Selected project: __proto__')).toBeDefined();
    fireEvent.click(
      view.getByRole('button', { name: 'All conversations', exact: true })
    );
    const details = view.container.querySelector('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    editor = open('Archived', 'c');
    fireEvent.click(
      editor.getByRole('button', { name: '<Local Q>', exact: true })
    );
    await act(async () =>
      fireEvent.click(editor.getByRole('button', { name: 'Save', exact: true }))
    );
    expect(
      application.getSnapshot().list.rows.find((row) => row.id === 'c')
    ).toMatchObject({ archived: true, projectId: '__proto__' });
    expect(io.moves).toEqual([
      ['a', '__proto__'],
      ['a', '__proto__'],
      ['a', null],
      ['c', '__proto__'],
    ]);
    expect({
      list: io.list,
      get: io.get,
      create: io.create,
      counters: fixture.counters,
    }).toEqual(before);
    expect(input.value).toBe('Keep draft');
    expect(application.getSnapshot().runtime).toBe(runtime);
  } finally {
    application.dispose();
  }
});

it('closes a move editor before opening an archived row context menu', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  const fixture = applicationFixture();
  const rows: readonly ThreadRow[] = [
    { id: 'a', title: 'Alpha' },
    { id: 'c', title: 'Archived', archived: true },
  ];
  const application = createReactApplication({
    ...fixture.options,
    directory: {
      ...fixture.options.directory,
      list: async () => ({ kind: 'ready', value: rows }),
      get: async (id) => ({
        kind: 'ready',
        value: rows.find((row) => row.id === id)!,
      }),
      setProject: async (id, projectId) => ({
        kind: 'ready',
        value: { id, projectId },
      }),
    },
  });
  try {
    application.start();
    await waitFor(() =>
      expect(application.getSnapshot().selection.status).toBe('ready')
    );
    const view = render(
      <App application={application} presentation="sidenav" />
    );
    const details = view.container.querySelector('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    fireEvent.click(
      view.getByRole('button', { name: 'Actions for Alpha (a)', exact: true })
    );
    fireEvent.click(
      view.getByRole('menuitem', {
        name: 'Move to project for Alpha (a)',
        exact: true,
      })
    );
    expect(
      view.getByRole('region', { name: 'Move conversation: Alpha (a)' })
    ).toBeDefined();
    fireEvent.contextMenu(
      within(
        view.getByRole('list', { name: 'Archived loaded conversations' })
      ).getByRole('button', { name: 'Archived', exact: true }),
      { clientX: 10, clientY: 10 }
    );
    expect(
      view.queryByRole('region', { name: /^Move conversation:/ })
    ).toBeNull();
    expect(
      view.getByRole('menuitem', {
        name: 'Move to project for Archived (c)',
        exact: true,
      })
    ).toBeDefined();
  } finally {
    application.dispose();
  }
});

it('retires an open move editor when the application instance changes even for the same thread ID', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  localStorage.setItem(
    PROJECT_CATALOG_KEY,
    JSON.stringify({
      version: 1,
      projects: [{ id: 'project', name: 'Project P' }],
    })
  );
  const make = () => {
    const fixture = applicationFixture();
    const command = vi.fn(async (id: string, projectId: string | null) => ({
      kind: 'ready' as const,
      value: { id, projectId },
    }));
    const application = createReactApplication({
      ...fixture.options,
      directory: {
        ...fixture.options.directory,
        list: async () => ({
          kind: 'ready',
          value: [{ id: 'a', title: 'Alpha' }],
        }),
        setProject: command,
      },
    });
    application.start();
    return { application, command };
  };
  const first = make();
  const second = make();
  try {
    await waitFor(() =>
      expect(first.application.getSnapshot().selection.status).toBe('ready')
    );
    await waitFor(() =>
      expect(second.application.getSnapshot().selection.status).toBe('ready')
    );
    const view = render(
      <App application={first.application} presentation="sidenav" />
    );
    fireEvent.click(view.getByRole('button', { name: /^Actions for.*\(a\)$/ }));
    fireEvent.click(
      view.getByRole('menuitem', { name: /^Move to project.*\(a\)$/ })
    );
    fireEvent.click(
      within(
        view.getByRole('region', { name: /^Move conversation:/ })
      ).getByRole('button', { name: 'Project P', exact: true })
    );
    view.rerender(
      <App application={second.application} presentation="sidenav" />
    );
    expect(
      view.queryByRole('region', { name: /^Move conversation:/ })
    ).toBeNull();
    expect(first.command).not.toHaveBeenCalled();
    expect(second.command).not.toHaveBeenCalled();
    view.rerender(
      <App application={first.application} presentation="sidenav" />
    );
    expect(
      view.queryByRole('region', { name: /^Move conversation:/ })
    ).toBeNull();
  } finally {
    first.application.dispose();
    second.application.dispose();
  }
});

it('retires pending UI feedback and late completion on application replacement', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  localStorage.setItem(
    PROJECT_CATALOG_KEY,
    JSON.stringify({
      version: 1,
      projects: [{ id: 'project', name: 'Project P' }],
    })
  );
  const fixture = applicationFixture();
  let finish!: () => void;
  const first = createReactApplication({
    ...fixture.options,
    directory: {
      ...fixture.options.directory,
      list: async () => ({
        kind: 'ready',
        value: [{ id: 'a', title: 'Alpha' }],
      }),
      setProject: (id, projectId) =>
        new Promise((resolve) => {
          finish = () => resolve({ kind: 'ready', value: { id, projectId } });
        }),
    },
  });
  const other = applicationFixture();
  const command = vi.fn();
  const second = createReactApplication({
    ...other.options,
    directory: {
      ...other.options.directory,
      list: async () => ({
        kind: 'ready',
        value: [{ id: 'a', title: 'Alpha' }],
      }),
      setProject: command,
    },
  });
  try {
    first.start();
    second.start();
    await waitFor(() =>
      expect(first.getSnapshot().selection.status).toBe('ready')
    );
    await waitFor(() =>
      expect(second.getSnapshot().selection.status).toBe('ready')
    );
    const view = render(<App application={first} presentation="sidenav" />);
    fireEvent.click(view.getByRole('button', { name: /^Actions for.*\(a\)$/ }));
    fireEvent.click(
      view.getByRole('menuitem', { name: /^Move to project.*\(a\)$/ })
    );
    const editor = within(
      view.getByRole('region', { name: /^Move conversation:/ })
    );
    fireEvent.click(
      editor.getByRole('button', { name: 'Project P', exact: true })
    );
    fireEvent.click(editor.getByRole('button', { name: 'Save', exact: true }));
    expect(first.getSnapshot().projectMoves.a.status).toBe('pending');
    view.rerender(<App application={second} presentation="sidenav" />);
    expect(
      view.queryByRole('region', { name: /^Move conversation:/ })
    ).toBeNull();
    expect(view.queryByText(/^Moving conversation:/)).toBeNull();
    await act(async () => finish());
    expect(view.queryByText(/^Conversation moved:/)).toBeNull();
    expect(command).not.toHaveBeenCalled();
    expect(second.getSnapshot().selection.row?.projectId).toBeUndefined();
  } finally {
    first.dispose();
    second.dispose();
  }
});

it('shows shared pending feedback for a prototype-like thread ID after a root mount', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const fixture = applicationFixture();
  const rows = [
    { id: 'a', title: 'Alpha' },
    { id: '__proto__', title: 'Prototype' },
  ];
  let finish!: () => void;
  const application = createReactApplication({
    ...fixture.options,
    directory: {
      ...fixture.options.directory,
      list: async () => ({ kind: 'ready', value: rows }),
      get: async (id) => ({
        kind: 'ready',
        value: rows.find((row) => row.id === id)!,
      }),
      setProject: (id, projectId) =>
        new Promise((resolve) => {
          finish = () => resolve({ kind: 'ready', value: { id, projectId } });
        }),
    },
  });
  try {
    application.start();
    await waitFor(() =>
      expect(application.getSnapshot().selection.status).toBe('ready')
    );
    const pending = application.setProject('__proto__', 'project');
    const view = render(
      <App application={application} presentation="sidenav" />
    );
    expect(
      view.getByText('Moving conversation: Prototype (__proto__)…', {
        exact: true,
      })
    ).toBeDefined();
    await act(async () => {
      finish();
      expect(await pending).toBe(true);
    });
    expect(
      view.queryByText('Moving conversation: Prototype (__proto__)…', {
        exact: true,
      })
    ).toBeNull();
  } finally {
    application.dispose();
  }
});
