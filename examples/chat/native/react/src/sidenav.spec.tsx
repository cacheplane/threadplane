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
import { NativeNavigation } from './native-navigation';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function navigationFixture(
  narrow = false,
  rows = [
    { id: 'a', title: 'Alpha notes' },
    { id: 'b', title: 'Beta notes' },
  ]
) {
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
    expect(
      view.queryByRole('button', {
        name: 'Close conversation navigation backdrop',
      })
    ).toBeNull();
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
    const scrim = view.getByRole('button', {
      name: 'Close conversation navigation backdrop',
    });
    scrim.focus();
    fireEvent.click(scrim);
    expect(view.queryByRole('navigation')).toBeNull();
    expect(document.activeElement).toBe(launcher);
    fireEvent.click(launcher);
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

it.each(['expanded', 'collapsed'] as const)(
  'returns focused scrim removal to the %s desktop toggle and keeps external focus',
  (desktopMode) => {
    const { media, listeners, application } = navigationFixture();
    const view = render(
      <StrictMode>
        <button>Outside</button>
        <NativeNavigation selectedId="a">
          <input aria-label="Local filter" />
        </NativeNavigation>
      </StrictMode>
    );
    if (desktopMode === 'collapsed')
      fireEvent.click(
        view.getByRole('button', { name: 'Collapse conversations' })
      );
    act(() => media.resize(true));
    fireEvent.click(view.getByRole('button', { name: 'Open conversations' }));
    view
      .getByRole('button', { name: 'Close conversation navigation backdrop' })
      .focus();
    act(() => media.resize(false));
    expect(
      view.queryByRole('button', {
        name: 'Close conversation navigation backdrop',
      })
    ).toBeNull();
    expect(document.activeElement).toBe(
      view.getByRole('button', {
        name:
          desktopMode === 'expanded'
            ? 'Collapse conversations'
            : 'Expand conversations',
      })
    );
    act(() => media.resize(true));
    fireEvent.click(view.getByRole('button', { name: 'Open conversations' }));
    view
      .getByRole('button', { name: 'Close conversation navigation backdrop' })
      .focus();
    const outside = view.getByRole('button', { name: 'Outside' });
    outside.focus();
    act(() => media.resize(false));
    expect(document.activeElement).toBe(outside);
    // A real transfer clears ownership even if the external control later blurs.
    act(() => media.resize(true));
    fireEvent.click(view.getByRole('button', { name: 'Open conversations' }));
    view
      .getByRole('button', { name: 'Close conversation navigation backdrop' })
      .focus();
    outside.focus();
    outside.blur();
    act(() => media.resize(false));
    expect(document.activeElement).toBe(document.body);
    view.unmount();
    expect(listeners.size).toBe(0);
    application.dispose();
  }
);

it('returns focused scrim removal on accepted selection to the local launcher', () => {
  const { application } = navigationFixture(true);
  const shell = (selectedId: string) => (
    <StrictMode>
      <NativeNavigation selectedId={selectedId}>Rows</NativeNavigation>
    </StrictMode>
  );
  const view = render(shell('a'));
  fireEvent.click(view.getByRole('button', { name: 'Open conversations' }));
  view
    .getByRole('button', { name: 'Close conversation navigation backdrop' })
    .focus();
  view.rerender(shell('b'));
  expect(document.activeElement).toBe(
    view.getByRole('button', { name: 'Open conversations' })
  );
  expect(
    view.queryByRole('button', {
      name: 'Close conversation navigation backdrop',
    })
  ).toBeNull();
  application.dispose();
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

it('uses filtered compact initials with full names and controlled application selection', async () => {
  const { application, io } = navigationFixture();
  try {
    application.start();
    await waitFor(() =>
      expect(application.getSnapshot().selection.status).toBe('ready')
    );
    const view = render(
      <App application={application} presentation="sidenav" />
    );
    const filter = view.getByRole('searchbox');
    fireEvent.change(filter, { target: { value: 'Beta' } });
    fireEvent.click(
      view.getByRole('button', { name: 'Collapse conversations' })
    );
    const beta = view.getByRole('button', { name: 'Beta notes' });
    expect(beta.textContent).toBe('B');
    expect(beta.getAttribute('title')).toBe('Beta notes');
    expect(view.queryByRole('button', { name: 'Alpha notes' })).toBeNull();
    expect(view.queryByRole('button', { name: 'New', exact: true })).toBeNull();
    expect(
      view.queryByRole('button', { name: 'Refresh', exact: true })
    ).toBeNull();
    fireEvent.click(beta);
    await waitFor(() =>
      expect(application.getSnapshot().selection.id).toBe('b')
    );
    expect(beta.getAttribute('aria-current')).toBe('true');
    fireEvent.click(view.getByRole('button', { name: 'Expand conversations' }));
    expect(view.getByRole('searchbox')).toBe(filter);
    expect((filter as HTMLInputElement).value).toBe('Beta');
    expect(
      view
        .getByRole('button', { name: 'Beta notes' })
        .getAttribute('aria-current')
    ).toBe('true');
    expect(io).toEqual({ list: 1, get: 2, create: 0 });
  } finally {
    application.dispose();
  }
});

it('renders compact Unicode initials and the empty fallback from original titles or IDs', async () => {
  const { application } = navigationFixture(false, [
    { id: 'a', title: '  élan  ' },
    { id: 'b', title: ' 🛰 launch' },
    { id: 'charlie', title: '' },
    { id: 'd', title: '   ' },
  ]);
  try {
    application.start();
    await waitFor(() =>
      expect(application.getSnapshot().selection.status).toBe('ready')
    );
    const view = render(
      <App application={application} presentation="sidenav" />
    );
    fireEvent.click(
      view.getByRole('button', { name: 'Collapse conversations' })
    );
    for (const [title, initial] of [
      ['élan', 'É'],
      ['🛰 launch', '🛰'],
      ['charlie', 'C'],
      ['d', '?'],
    ]) {
      const button =
        title === 'd'
          ? view.container.querySelector(
              '.conversation-list--compact button[title="   "]'
            )!
          : view.getByRole('button', { name: title });
      expect(button.textContent).toBe(initial);
    }
  } finally {
    application.dispose();
  }
});
