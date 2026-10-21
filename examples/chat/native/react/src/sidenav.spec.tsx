import { StrictMode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createReactApplication } from './application';
import { applicationFixture } from './application-fixture';
import { App } from './app';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function navigationFixture(narrow = false) {
  const fixture = applicationFixture();
  const listeners = new Set<() => void>();
  const media = {
    matches: narrow,
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
    resize(matches: boolean) {
      media.matches = matches;
      for (const listener of listeners) listener();
    },
  };
  vi.stubGlobal('matchMedia', () => media);
  const rows = [
    { id: 'a', title: 'Alpha notes' },
    { id: 'b', title: 'Beta notes' },
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
  return { fixture, media, listeners, io, application };
}

it('sidenav mode changes retain the filter, conversation draft and owners and clean up media listeners', async () => {
  const { fixture, media, listeners, io, application } = navigationFixture();
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
    const nav = view.getByRole('navigation', { name: 'Conversations' });
    const filter = view.getByRole('searchbox') as HTMLInputElement;
    const input = view.getByRole('textbox', {
      name: 'Message',
    }) as HTMLTextAreaElement;
    const conversation = view.container.querySelector('.conversation');
    fireEvent.change(filter, { target: { value: 'notes' } });
    fireEvent.change(input, { target: { value: 'Retain this draft.' } });
    const work = { counters: { ...fixture.counters }, io: { ...io } };
    fireEvent.click(
      view.getByRole('button', { name: 'Collapse conversations' })
    );
    expect(view.queryByRole('searchbox')).toBeNull();
    expect(filter.isConnected).toBe(true);
    fireEvent.click(view.getByRole('button', { name: 'Expand conversations' }));
    expect(view.getByRole('searchbox')).toBe(filter);
    expect(filter.value).toBe('notes');
    act(() => media.resize(true));
    expect(view.queryByRole('navigation')).toBeNull();
    const launcher = view.getByRole('button', { name: 'Open conversations' });
    fireEvent.click(launcher);
    expect(view.getByRole('navigation')).toBe(nav);
    fireEvent.click(view.getByRole('button', { name: 'Close conversations' }));
    expect(document.activeElement).toBe(launcher);
    act(() => media.resize(false));
    fireEvent.click(
      view.getByRole('button', { name: 'Collapse conversations' })
    );
    act(() => media.resize(true));
    act(() => media.resize(false));
    expect(
      view.getByRole('button', { name: 'Expand conversations' })
    ).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Expand conversations' }));
    expect(view.getByRole('searchbox')).toBe(filter);
    expect(filter.value).toBe('notes');
    expect(view.getByRole('textbox', { name: 'Message' })).toBe(input);
    expect(input.value).toBe('Retain this draft.');
    expect(view.container.querySelector('.conversation')).toBe(conversation);
    expect({ counters: fixture.counters, io }).toEqual(work);
    expect(listeners.size).toBe(1);
    view.unmount();
    expect(listeners.size).toBe(0);
    expect({ counters: fixture.counters, io }).toEqual(work);
  } finally {
    application.dispose();
  }
  expect(fixture.counters.disposals).toBe(fixture.counters.owners);
});

it('explicit sidenav selection updates the application and closes the drawer, resetting only the selected composer', async () => {
  const { fixture, io, application } = navigationFixture(true);
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
    const oldInput = view.getByRole('textbox', { name: 'Message' });
    fireEvent.change(oldInput, { target: { value: 'A draft' } });
    fireEvent.click(view.getByRole('button', { name: 'Open conversations' }));
    const nav = view.getByRole('navigation');
    fireEvent.click(view.getByRole('button', { name: 'Beta notes' }));
    await waitFor(() => {
      expect(application.getSnapshot().selection.id).toBe('b');
      expect(application.getSnapshot().selection.status).toBe('ready');
      expect(view.queryByRole('navigation')).toBeNull();
    });
    expect(nav.querySelector('[aria-current="true"]')?.textContent).toBe(
      'Beta notes'
    );
    expect(view.getByRole('textbox', { name: 'Message' })).not.toBe(oldInput);
    expect(
      (view.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement)
        .value
    ).toBe('');
    expect(io).toEqual({ list: 1, get: 2, create: 0 });
    expect(fixture.counters.commands).toBe(0);
  } finally {
    application.dispose();
  }
  expect(fixture.counters.disposals).toBe(fixture.counters.owners);
});
