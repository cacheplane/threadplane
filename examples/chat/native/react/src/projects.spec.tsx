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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('filters loaded active, archived and compact rows by exact project without changing selection, draft or commands', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const fixture = applicationFixture();
  let rows: readonly ThreadRow[] = [
    { id: 'a', title: 'Alpha notes', projectId: ' p/b ' },
    { id: 'b', title: 'Beta notes', projectId: '<Project>' },
    { id: 'c', title: 'Archived notes', archived: true, projectId: ' p/b ' },
    { id: 'd', title: 'Unassigned notes' },
    {
      id: 'e',
      title: 'Only archived',
      archived: true,
      projectId: 'archive-only',
    },
    { id: 'f', title: 'Another beta', projectId: '<Project>' },
  ];
  const io = { list: 0, get: 0, create: 0 };
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
    const session = application.getSnapshot().runtime;
    const before = { io: { ...io }, counters: { ...fixture.counters } };
    const projects = view.getByRole('list', { name: 'Loaded projects' });
    expect(
      within(projects)
        .getAllByRole('button')
        .map((el) => el.textContent)
    ).toEqual([' p/b ', '<Project>', 'archive-only']);
    fireEvent.click(
      within(projects).getByRole('button', { name: '<Project>' })
    );
    const list = view.getByRole('list', { name: 'Loaded conversations' });
    expect(
      within(list).queryByRole('button', { name: 'Alpha notes' })
    ).toBeNull();
    expect(
      within(list).getByRole('button', { name: 'Beta notes' })
    ).toBeTruthy();
    expect(
      view.container.querySelectorAll('.native-compact-thread')
    ).toHaveLength(2);
    expect(view.getByRole('textbox', { name: 'Message' })).toBe(input);
    expect(input.value).toBe('Keep draft');
    expect(application.getSnapshot().selection.id).toBe('a');
    expect(application.getSnapshot().runtime).toBe(session);
    fireEvent.change(view.getByRole('searchbox'), {
      target: { value: 'Alpha' },
    });
    expect(within(list).queryByRole('button')).toBeNull();
    expect(within(projects).getAllByRole('button')).toHaveLength(3);
    fireEvent.change(view.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.click(
      within(projects).getByRole('button', { name: 'archive-only' })
    );
    expect(within(list).queryByRole('button')).toBeNull();
    expect(
      within(
        view.getByRole('list', {
          name: 'Archived loaded conversations',
          hidden: true,
        })
      ).getByText('Only archived')
    ).toBeTruthy();
    fireEvent.click(within(projects).getByRole('button', { name: 'p/b' }));
    const archive = view.container.querySelector('details')!;
    archive.open = true;
    fireEvent(archive, new Event('toggle'));
    expect(
      within(
        view.getByRole('list', {
          name: 'Archived loaded conversations',
          hidden: true,
        })
      ).getByText('Archived notes')
    ).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'All conversations' }));
    expect(
      within(list).getByRole('button', { name: 'Unassigned notes' })
    ).toBeTruthy();
    expect({ io, counters: fixture.counters }).toEqual(before);
    fireEvent.click(
      within(projects).getByRole('button', { name: '<Project>' })
    );
    rows = [rows[0], rows[2], rows[3]];
    await act(async () => {
      await application.refresh();
    });
    expect(within(list).queryByRole('button')).toBeNull();
    expect(view.getByText('Selected project: <Project>')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'All conversations' }));
    expect(
      within(list).getByRole('button', { name: 'Alpha notes' })
    ).toBeTruthy();
    expect(input.value).toBe('Keep draft');
  } finally {
    application.dispose();
  }
});
