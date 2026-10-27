import { StrictMode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createReactApplication } from './application';
import { applicationFixture } from './application-fixture';
import { App } from './app';
import { projectThreads } from '../../shared/projection';
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('requests creation through ThreadList and disables only its New action while pending', async () => {
  const fixture = applicationFixture();
  let finish!: (value: { kind: 'failed' }) => void;
  const create = vi.fn(
    () =>
      new Promise<{ kind: 'failed' }>((resolve) => {
        finish = resolve;
      })
  );
  const application = createReactApplication({
    ...fixture.options,
    directory: {
      ...fixture.options.directory,
      async list() {
        return { kind: 'ready', value: [{ id: 'a', title: 'Alpha' }] };
      },
      create,
    },
  });
  try {
    application.start();
    await waitFor(() =>
      expect(application.getSnapshot().selection.status).toBe('ready')
    );
    const view = render(<App application={application} presentation="page" />);
    const list = view.getByRole('list', { name: 'Loaded conversations' });
    const action = view.getByRole('button', {
      name: 'New',
      exact: true,
    }) as HTMLButtonElement;
    const alpha = within(list).getByRole('button', {
      name: 'Alpha',
    }) as HTMLButtonElement;
    expect(action.classList.contains('tp-thread-list__new')).toBe(true);
    expect(list.contains(action)).toBe(false);
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(action);
    await waitFor(() => expect(action.disabled).toBe(true));
    expect(view.getByText('Creating conversation…')).toBeTruthy();
    expect(alpha.disabled).toBe(false);
    expect(application.getSnapshot().selection.id).toBe('a');
    fireEvent.click(action);
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ kind: 'failed' });
    });
    await waitFor(() => expect(action.disabled).toBe(false));
    expect(view.getByRole('alert').textContent).toContain(
      'Creation could not be confirmed'
    );
    expect(within(list).getByRole('button', { name: 'Alpha' })).toBe(alpha);
    expect(application.getSnapshot().selection.id).toBe('a');
  } finally {
    application.dispose();
  }
});

it('uses ThreadList while refresh, loaded-title filtering and navigation retain the selected draft and owners', async () => {
  const now = Date.parse('2026-09-28T00:02:01.000Z');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const fixture = applicationFixture();
  const io = { list: 0, get: 0 };
  const rows = [
    { id: 'a', title: 'Alpha notes', updatedAt: now - 120000, pinned: false },
    { id: 'b', title: 'Beta notes', updatedAt: now - 86400000, pinned: true },
  ];
  const application = createReactApplication({
    ...fixture.options,
    directory: {
      ...fixture.options.directory,
      async list() {
        io.list++;
        return {
          kind: 'ready',
          value: projectThreads(
            rows.map(
              (row) =>
                ({
                  thread_id: row.id,
                  metadata: { title: row.title, pinned: row.pinned },
                  updated_at: new Date(row.updatedAt).toISOString(),
                } as Parameters<typeof projectThreads>[0][number])
            )
          ),
        };
      },
      async get(id) {
        io.get++;
        return {
          kind: 'ready',
          value: { ...rows.find((row) => row.id === id)! },
        };
      },
    },
  });
  try {
    application.start();
    await waitFor(() =>
      expect(application.getSnapshot().selection.status).toBe('ready')
    );
    const view = render(
      <StrictMode>
        <App application={application} presentation="sidenav" />
      </StrictMode>
    );
    expect(
      view.container.querySelectorAll(
        '.conversation-list--compact .native-compact-thread'
      )
    ).toHaveLength(2);
    const list = view.getByRole('list', { name: 'Loaded conversations' });
    expect(list.classList.contains('tp-thread-list')).toBe(true);
    expect(list.classList.contains('conversation-list')).toBe(true);
    const alpha = within(list).getByRole('button', { name: 'Alpha notes' });
    const beta = within(list).getByRole('button', { name: 'Beta notes' });
    expect(
      within(list).getByRole('button', {
        name: 'Alpha notes',
        description: '2 min ago',
      })
    ).toBe(alpha);
    expect(alpha.querySelector('time')?.dateTime).toBe(
      '2026-09-28T00:00:01.000Z'
    );
    expect(
      within(list).getByRole('button', {
        name: 'Beta notes',
        description: 'Pinned conversation 1 day ago',
      })
    ).toBe(beta);
    expect(alpha.getAttribute('aria-current')).toBe('true');
    expect(beta.hasAttribute('aria-current')).toBe(false);
    const draft = view.getByRole('textbox', {
      name: 'Message',
    }) as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: 'Unsent draft' } });
    const copy = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      get: () => ({ writeText: copy }),
    });
    const beforeCopy = { ...fixture.counters };
    const beforeCopyIo = { ...io };
    fireEvent.click(
      within(list).getByRole('button', {
        name: 'Actions for Beta notes (b)',
      })
    );
    fireEvent.click(
      view.getByRole('menuitem', {
        name: 'Copy conversation ID for Beta notes (b)',
      })
    );
    await act(async () => {});
    expect(copy.mock.calls).toEqual([['b']]);
    expect(application.getSnapshot().selection.id).toBe('a');
    expect(draft.value).toBe('Unsent draft');
    expect(fixture.counters).toEqual(beforeCopy);
    expect(io).toEqual(beforeCopyIo);
    const counters = { ...fixture.counters };
    alpha.focus();
    const alphaRow = alpha.parentElement;
    rows[0].updatedAt = now - 60000;
    rows[0].pinned = true;
    rows[1].pinned = false;
    await act(async () => {
      application.refresh();
    });
    await waitFor(() =>
      expect(application.getSnapshot().list.status).toBe('ready')
    );
    expect(within(list).getByRole('button', { name: 'Alpha notes' })).toBe(
      alpha
    );
    expect(document.activeElement).toBe(alpha);
    expect(
      within(list).getByRole('button', {
        name: 'Alpha notes',
        description: 'Pinned conversation 1 min ago',
      })
    ).toBe(alpha);
    expect(alpha.querySelector('time')?.dateTime).toBe(
      '2026-09-28T00:01:01.000Z'
    );
    expect(alpha.parentElement).toBe(alphaRow);
    expect(
      Array.from(list.querySelectorAll('.tp-thread-list__button'))
    ).toEqual([alpha, beta]);
    expect(alpha.querySelectorAll('.tp-thread-list__pin')).toHaveLength(1);
    expect(beta.querySelector('.tp-thread-list__pin')).toBeNull();
    expect(
      within(list).getByRole('button', {
        name: 'Beta notes',
        description: '1 day ago',
      })
    ).toBe(beta);
    const filter = view.getByRole('searchbox');
    fireEvent.change(filter, { target: { value: 'Alpha' } });
    expect(
      Array.from(list.querySelectorAll('.tp-thread-list__button'))
    ).toEqual([alpha]);
    expect(within(list).getByRole('button', { name: 'Alpha notes' })).toBe(
      alpha
    );
    expect(alpha.querySelector('mark')?.textContent).toBe('Alpha');
    expect(alpha.getAttribute('title')).toBe('Alpha notes');
    expect(document.activeElement).toBe(alpha);
    fireEvent.change(filter, { target: { value: ' notes ' } });
    expect(
      within(list).getByRole('button', {
        name: 'Alpha notes',
        description: 'Pinned conversation 1 min ago',
      })
    ).toBe(alpha);
    expect(alpha.querySelector('mark')?.textContent).toBe('notes');
    expect(document.activeElement).toBe(alpha);
    expect(draft.value).toBe('Unsent draft');
    expect(fixture.counters).toEqual(counters);
    expect(io).toEqual({ list: 2, get: 1 });
    fireEvent.change(filter, { target: { value: 'not a loaded title' } });
    expect(list.childElementCount).toBe(0);
    expect(view.getByText('No loaded conversations match.')).toBeTruthy();
    expect(application.getSnapshot().selection.id).toBe('a');
    fireEvent.change(filter, { target: { value: 'notes' } });
    const retainedAlpha = within(list).getByRole('button', {
      name: 'Alpha notes',
    });
    fireEvent.click(
      view.getByRole('button', { name: 'Collapse conversations' })
    );
    fireEvent.click(view.getByRole('button', { name: 'Expand conversations' }));
    expect(view.getByRole('list', { name: 'Loaded conversations' })).toBe(list);
    expect(within(list).getByRole('button', { name: 'Alpha notes' })).toBe(
      retainedAlpha
    );
    expect(view.getByRole('textbox', { name: 'Message' })).toBe(draft);
    expect(draft.value).toBe('Unsent draft');
    expect(fixture.counters).toEqual(counters);
    expect(io).toEqual({ list: 2, get: 1 });
    fireEvent.click(within(list).getByRole('button', { name: 'Beta notes' }));
    await waitFor(() =>
      expect(application.getSnapshot().selection.status).toBe('ready')
    );
    expect(application.getSnapshot().selection.id).toBe('b');
    expect(
      within(list)
        .getByRole('button', { name: 'Beta notes' })
        .getAttribute('aria-current')
    ).toBe('true');
    expect(view.getByRole('textbox', { name: 'Message' })).not.toBe(draft);
    expect(
      (view.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement)
        .value
    ).toBe('');
    expect(io).toEqual({ list: 2, get: 2 });
  } finally {
    application.dispose();
  }
  expect(fixture.counters.disposals).toBe(fixture.counters.owners);
});

it('owns a nonselected row context request without selection, copying or directory work and discards filtered requests', async () => {
  const fixture = applicationFixture();
  const rows = [
    { id: 'a', title: 'Alpha' },
    { id: 'b', title: 'Beta' },
  ];
  const listRows = vi.fn(async () => ({ kind: 'ready' as const, value: rows }));
  const application = createReactApplication({
    ...fixture.options,
    directory: { ...fixture.options.directory, list: listRows },
  });
  const write = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    get: () => ({ writeText: write }),
  });
  try {
    application.start();
    await waitFor(() =>
      expect(application.getSnapshot().selection.status).toBe('ready')
    );
    const view = render(<App application={application} presentation="page" />);
    const list = view.getByRole('list', { name: 'Loaded conversations' });
    const beta = within(list).getByRole('button', { name: 'Beta' });
    const draft = view.getByRole('textbox', { name: 'Message' });
    fireEvent.change(draft, { target: { value: 'Keep my draft' } });
    const counters = { ...fixture.counters };
    const request = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 77,
      clientY: 81,
    });
    fireEvent(beta, request);
    expect(request.defaultPrevented).toBe(true);
    const menu = view.getByRole('menu');
    expect(menu.style.left).toBe('77px');
    expect(menu.style.top).toBe('85px');
    expect(write).not.toHaveBeenCalled();
    expect(application.getSnapshot().selection.id).toBe('a');
    expect(fixture.counters).toEqual(counters);
    expect(listRows).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(view.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(beta);
    for (const key of ['ContextMenu', 'F10']) {
      const request = new KeyboardEvent('keydown', {
        key,
        shiftKey: key === 'F10',
        bubbles: true,
        cancelable: true,
      });
      fireEvent(beta, request);
      expect(request.defaultPrevented).toBe(true);
      fireEvent.keyDown(view.getByRole('menu'), { key: 'Escape' });
      expect(document.activeElement).toBe(beta);
    }
    fireEvent.contextMenu(beta, { button: 2, clientX: 77, clientY: 81 });
    fireEvent.click(
      view.getByRole('menuitem', { name: 'Copy conversation ID for Beta (b)' })
    );
    await act(async () => {});
    expect(write.mock.calls).toEqual([['b']]);
    expect(document.activeElement).toBe(beta);
    expect(view.getByRole('textbox', { name: 'Message' })).toBe(draft);
    expect((draft as HTMLTextAreaElement).value).toBe('Keep my draft');
    expect(application.getSnapshot().selection.id).toBe('a');
    expect(fixture.counters).toEqual(counters);
    fireEvent.contextMenu(beta, { button: 2, clientX: 120, clientY: 130 });
    fireEvent.change(view.getByRole('searchbox'), {
      target: { value: 'Alpha' },
    });
    expect(view.queryByRole('menu')).toBeNull();
    fireEvent.change(view.getByRole('searchbox'), { target: { value: '' } });
    expect(view.queryByRole('menu')).toBeNull();
    const trigger = within(list).getByRole('button', {
      name: 'Actions for Beta (b)',
    });
    fireEvent.click(trigger);
    expect(view.getByRole('menu').style.left).not.toBe('120px');
    fireEvent.keyDown(view.getByRole('menu'), { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  } finally {
    application.dispose();
  }
});
