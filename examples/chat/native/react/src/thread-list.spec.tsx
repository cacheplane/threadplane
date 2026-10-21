import { StrictMode } from 'react';
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('uses ThreadList while refresh, loaded-title filtering and navigation retain the selected draft and owners', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const fixture = applicationFixture();
  const io = { list: 0, get: 0 };
  const rows = [
    { id: 'a', title: 'Alpha notes' },
    { id: 'b', title: 'Beta notes' },
  ];
  const application = createReactApplication({
    ...fixture.options,
    directory: {
      ...fixture.options.directory,
      async list() {
        io.list++;
        return { kind: 'ready', value: rows.map((row) => ({ ...row })) };
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
    const list = view.getByRole('list', { name: 'Loaded conversations' });
    expect(list.classList.contains('tp-thread-list')).toBe(true);
    expect(list.classList.contains('conversation-list')).toBe(true);
    const alpha = within(list).getByRole('button', { name: 'Alpha notes' });
    const beta = within(list).getByRole('button', { name: 'Beta notes' });
    expect(alpha.getAttribute('aria-current')).toBe('true');
    expect(beta.hasAttribute('aria-current')).toBe(false);
    const draft = view.getByRole('textbox', {
      name: 'Message',
    }) as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: 'Unsent draft' } });
    const counters = { ...fixture.counters };
    alpha.focus();
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
    const filter = view.getByRole('searchbox');
    fireEvent.change(filter, { target: { value: 'Alpha' } });
    expect(within(list).getAllByRole('button')).toEqual([alpha]);
    expect(within(list).getByRole('button', { name: 'Alpha notes' })).toBe(
      alpha
    );
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
