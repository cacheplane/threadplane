import { cleanup, fireEvent, render, act } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ConversationActions,
  type RenameEditorRequest,
} from './conversation-actions';
beforeEach(() =>
  vi
    .spyOn(HTMLElement.prototype, 'getClientRects')
    .mockReturnValue([{}] as unknown as DOMRectList)
);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup(rename = vi.fn(async () => false), pending = false) {
  function Host() {
    const [editor, setEditor] = useState<RenameEditorRequest | null>(null);
    return (
      <>
        <button>Outside</button>
        <ConversationActions
          id="a"
          title="Old"
          canRename
          pending={pending}
          rename={rename}
          editor={editor}
          onRename={(target) =>
            setEditor({ id: 'a', token: Date.now(), returnFocusTo: target })
          }
          onClose={(request) =>
            setEditor((latest) => (latest === request ? null : latest))
          }
        />
      </>
    );
  }
  return { ...render(<Host />), rename };
}
function open(v: ReturnType<typeof setup>) {
  fireEvent.click(v.getByRole('button', { name: /Actions for/ }));
  fireEvent.click(v.getByRole('menuitem', { name: /Rename conversation for/ }));
}

async function pinOccurrenceFixture() {
  const { createReactApplication } = await import('./application');
  const { applicationFixture } = await import('./application-fixture');
  const fixture = applicationFixture();
  let settle!: (
    value:
      | { kind: 'ready'; value: { id: string; title: string; pinned: boolean } }
      | { kind: 'failed' }
  ) => void;
  const application = createReactApplication({
    ...fixture.options,
    directory: {
      ...fixture.options.directory,
      list: async () => ({
        kind: 'ready',
        value: [
          { id: 'a', title: 'Alpha' },
          { id: 'b', title: 'Beta' },
        ],
      }),
      setPinned: () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    },
  });
  application.start();
  await act(async () => {});
  function Host({ id }: { id: string | null }) {
    const snapshot = useSyncExternalStore(
      application.subscribe,
      application.getSnapshot
    );
    const row = snapshot.list.rows.find((row) => row.id === id);
    return (
      <>
        <button>Outside</button>
        {row && (
          <ConversationActions
            id={row.id}
            title={row.title}
            pinned={row.pinned}
            canSetPinned
            setPinned={application.setPinned}
            pinState={snapshot.pins[row.id]}
            canRename
            pending={false}
            rename={application.rename}
            editor={null}
            onRename={() => {}}
            onClose={() => {}}
          />
        )}
      </>
    );
  }
  const view = render(<Host id="a" />);
  fireEvent.click(view.getByRole('button', { name: /Actions for/ }));
  fireEvent.click(
    view.getByRole('menuitem', { name: 'Pin conversation for Alpha (a)' })
  );
  return {
    ...view,
    application,
    show: (id: string | null) => view.rerender(<Host id={id} />),
    settle: async (success: boolean) =>
      act(async () =>
        settle(
          success
            ? {
                kind: 'ready',
                value: { id: 'a', title: 'Alpha', pinned: true },
              }
            : { kind: 'failed' }
        )
      ),
  };
}

for (const success of [true, false]) {
  for (const replacement of ['filter', 'aba'] as const) {
    it(`does not replay retained ${
      success ? 'success' : 'failure'
    } after ${replacement} row replacement`, async () => {
      const v = await pinOccurrenceFixture();
      try {
        await v.settle(success);
        const message = success
          ? 'Conversation pinned.'
          : 'Could not pin conversation. Try again.';
        expect(v.getByText(message)).toBeTruthy();
        const retained = v.application.getSnapshot().pins['a'];
        v.show(replacement === 'filter' ? null : 'b');
        v.show('a');
        expect(v.application.getSnapshot().pins['a']).toBe(retained);
        expect(v.queryByText(message)).toBeNull();
      } finally {
        v.application.dispose();
      }
    });
    it(`pending ${replacement} replacement retains suppression without announcing old ${
      success ? 'success' : 'failure'
    }`, async () => {
      const v = await pinOccurrenceFixture();
      try {
        v.show(replacement === 'filter' ? null : 'b');
        v.show('a');
        expect(v.getByText('Pinning conversation…')).toBeTruthy();
        fireEvent.click(v.getByRole('button', { name: /Actions for/ }));
        expect(
          v.getByRole('menuitem', { name: 'Pin conversation for Alpha (a)' })
        ).toHaveProperty('disabled', true);
        const outside = v.getByRole('button', { name: 'Outside' });
        outside.focus();
        await v.settle(success);
        expect(v.queryByText('Pinning conversation…')).toBeNull();
        expect(
          v.queryByText(
            success
              ? 'Conversation pinned.'
              : 'Could not pin conversation. Try again.'
          )
        ).toBeNull();
        expect(document.activeElement).toBe(outside);
      } finally {
        v.application.dispose();
      }
    });
  }
}
for (const mode of ['throw', 'reject'] as const) {
  it(`contains a ${mode}ing pin callback and permits explicit retry`, async () => {
    let calls = 0;
    const setPinned = vi.fn(() => {
      if (++calls > 1) return Promise.resolve(true);
      if (mode === 'throw') throw new Error('hostile');
      return Promise.reject(new Error('hostile'));
    });
    const v = render(
      <ConversationActions
        id="a"
        title="Alpha"
        canSetPinned
        setPinned={setPinned}
        canRename
        pending={false}
        rename={async () => false}
        editor={null}
        onRename={() => {}}
        onClose={() => {}}
      />
    );
    const activate = () => {
      fireEvent.click(v.getByRole('button', { name: /Actions for/ }));
      fireEvent.click(
        v.getByRole('menuitem', { name: 'Pin conversation for Alpha (a)' })
      );
      expect(v.queryByRole('menu')).toBeNull();
    };
    activate();
    await act(async () => {});
    expect(
      v.getAllByText('Could not pin conversation. Try again.')
    ).toHaveLength(1);
    activate();
    await act(async () => {});
    expect(v.getByText('Conversation pinned.')).toBeTruthy();
    expect(setPinned).toHaveBeenCalledTimes(2);
  });
}
it('offers the optional pin command and closes its menu synchronously', () => {
  const setPinned = vi.fn(() => new Promise<boolean>(() => {}));
  const v = render(
    <ConversationActions
      id="a"
      title="Old"
      canRename
      pending={false}
      rename={async () => false}
      editor={null}
      onRename={() => {}}
      onClose={() => {}}
      {...{ canSetPinned: true, pinned: false, setPinned }}
    />
  );
  fireEvent.click(v.getByRole('button', { name: /Actions for/ }));
  fireEvent.click(
    v.getByRole('menuitem', { name: 'Pin conversation for Old (a)' })
  );
  expect(setPinned).toHaveBeenCalledWith('a', true);
  expect(v.queryByRole('menu')).toBeNull();
});
it('pin pending disables only its command; feedback belongs to the initiating row and never steals focus', async () => {
  const setPinned = vi.fn(async () => false);
  const props = {
    id: 'a',
    title: 'Alpha',
    canRename: true,
    pending: false,
    rename: async () => false,
    editor: null,
    onRename: () => {},
    onClose: () => {},
    canSetPinned: true,
    pinned: false,
    setPinned,
  };
  const v = render(
    <>
      <button>Outside</button>
      <ConversationActions
        {...props}
        pinState={{ status: 'pending', pinned: true }}
      />
    </>
  );
  expect(v.getByText('Pinning conversation…')).toBeTruthy();
  fireEvent.click(v.getByRole('button', { name: /Actions for/ }));
  expect(
    v.getByRole('menuitem', { name: 'Pin conversation for Alpha (a)' })
  ).toHaveProperty('disabled', true);
  expect(v.getByRole('menuitem', { name: /Copy conversation/ })).toHaveProperty(
    'disabled',
    false
  );
  expect(
    v.getByRole('menuitem', { name: /Rename conversation/ })
  ).toHaveProperty('disabled', false);
  const outside = v.getByRole('button', { name: 'Outside' });
  outside.focus();
  v.rerender(
    <>
      <button>Outside</button>
      <ConversationActions
        {...props}
        pinState={{ status: 'failed', pinned: true }}
      />
    </>
  );
  expect(v.queryByText('Could not pin conversation. Try again.')).toBeNull();
  expect(document.activeElement).toBe(outside);
  fireEvent.click(v.getByRole('button', { name: /Actions for/ }));
  fireEvent.click(
    v.getByRole('menuitem', { name: 'Pin conversation for Alpha (a)' })
  );
  expect(setPinned).toHaveBeenCalledWith('a', true);
  await act(async () => {});
  expect(v.getAllByText('Could not pin conversation. Try again.')).toHaveLength(
    1
  );
  v.rerender(
    <>
      <button>Outside</button>
      <ConversationActions {...props} id="b" title="Beta" pinned />
    </>
  );
  expect(v.queryByText('Could not pin conversation. Try again.')).toBeNull();
  fireEvent.click(v.getByRole('button', { name: /Actions for/ }));
  fireEvent.click(
    v.getByRole('menuitem', { name: 'Unpin conversation for Beta (b)' })
  );
  expect(setPinned).toHaveBeenLastCalledWith('b', false);
});
it('opens labelled editor without a write, blank/unchanged/Cancel no write and failure retry retains draft', async () => {
  const v = setup();
  open(v);
  const input = v.getByRole('textbox', { name: 'Conversation title' });
  fireEvent.click(v.getByRole('button', { name: 'Save' }));
  expect(v.rename).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '  ' } });
  expect(v.getByRole('button', { name: 'Save' })).toHaveProperty(
    'disabled',
    true
  );
  fireEvent.change(input, { target: { value: ' New ' } });
  fireEvent.click(v.getByRole('button', { name: 'Save' }));
  await act(async () => {});
  expect(v.rename).toHaveBeenCalledWith('a', 'New');
  expect(input).toHaveProperty('value', ' New ');
  expect(v.getByRole('alert').textContent).toBe(
    'Could not rename conversation. Try again.'
  );
  fireEvent.click(v.getByRole('button', { name: 'Cancel' }));
  expect(v.queryByRole('textbox')).toBeNull();
});
it('pending Cancel ends editor interest and old completion cannot close reopened editor or focus it', async () => {
  let settle!: (v: boolean) => void;
  const v = setup(
    vi.fn(() => new Promise<boolean>((resolve) => (settle = resolve)))
  );
  open(v);
  fireEvent.change(v.getByRole('textbox'), { target: { value: 'New' } });
  fireEvent.click(v.getByRole('button', { name: 'Save' }));
  fireEvent.click(v.getByRole('button', { name: 'Cancel' }));
  open(v);
  const next = v.getByRole('textbox');
  v.getByRole('button', { name: 'Outside' }).focus();
  await act(async () => settle(true));
  expect(v.getByRole('textbox')).toBe(next);
  expect(document.activeElement).toBe(
    v.getByRole('button', { name: 'Outside' })
  );
});
it('reopened application-owned pending editor disables input and Save but Cancel stays available', () => {
  const v = setup(undefined, true);
  open(v);
  expect(v.getByRole('textbox')).toHaveProperty('disabled', true);
  expect(v.getByRole('button', { name: 'Save' })).toHaveProperty(
    'disabled',
    true
  );
  expect(v.getByRole('button', { name: 'Cancel' })).toHaveProperty(
    'disabled',
    false
  );
  expect(document.activeElement).toBe(
    v.getByRole('button', { name: 'Cancel' })
  );
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(v.queryByRole('textbox')).toBeNull();
  expect(v.rename).not.toHaveBeenCalled();
});

it('application pending reservation survives A to B to A editor replacement, selection and draft remain intact', async () => {
  const { createReactApplication } = await import('./application');
  const { applicationFixture } = await import('./application-fixture');
  const { App } = await import('./app');
  const fixture = applicationFixture();
  let settle!: (value: {
    kind: 'ready';
    value: { id: string; title: string };
  }) => void;
  const rename = vi.fn(
    () =>
      new Promise<{ kind: 'ready'; value: { id: string; title: string } }>(
        (resolve) => (settle = resolve)
      )
  );
  const application = createReactApplication({
    ...fixture.options,
    directory: {
      ...fixture.options.directory,
      list: async () => ({
        kind: 'ready',
        value: [
          { id: 'a', title: 'Alpha' },
          { id: 'b', title: 'Beta' },
        ],
      }),
      rename,
    },
  });
  application.start();
  await act(async () => {});
  const v = render(<App application={application} />);
  const message = v.getByRole('textbox', { name: 'Message' });
  fireEvent.change(message, { target: { value: 'Keep my draft' } });
  const openId = (id: string) => {
    fireEvent.click(
      v.getByRole('button', { name: new RegExp(`Actions for .*\\(${id}\\)`) })
    );
    fireEvent.click(
      v.getByRole('menuitem', { name: /Rename conversation for/ })
    );
  };
  openId('a');
  fireEvent.change(v.getByRole('textbox', { name: 'Conversation title' }), {
    target: { value: 'New Alpha' },
  });
  fireEvent.click(v.getByRole('button', { name: 'Save' }));
  expect(rename).toHaveBeenCalledOnce();
  expect(v.getByRole('textbox', { name: 'Conversation title' })).toHaveProperty(
    'disabled',
    true
  );
  openId('b');
  expect(v.getByRole('textbox', { name: 'Conversation title' })).toHaveProperty(
    'value',
    'Beta'
  );
  openId('a');
  const newEditor = v.getByRole('textbox', { name: 'Conversation title' });
  expect(newEditor).toHaveProperty('disabled', true);
  message.focus();
  await act(async () =>
    settle({ kind: 'ready', value: { id: 'a', title: 'New Alpha' } })
  );
  expect(v.getByRole('textbox', { name: 'Conversation title' })).toBe(
    newEditor
  );
  expect(newEditor).toHaveProperty('value', 'Alpha');
  expect(document.activeElement).toBe(message);
  expect(message).toHaveProperty('value', 'Keep my draft');
  expect(fixture.sessions).toHaveLength(1);
  expect(rename).toHaveBeenCalledOnce();
  expect(application.getSnapshot().selection.id).toBe('a');
  fireEvent.click(v.getByRole('button', { name: 'Cancel' }));
  application.dispose();
});

it('returns focus after pending disables the focused Save, while respecting deliberate outside focus', async () => {
  let settle!: (value: boolean) => void;
  const v = setup(
    vi.fn(() => new Promise<boolean>((resolve) => (settle = resolve)))
  );
  open(v);
  fireEvent.change(v.getByRole('textbox'), { target: { value: 'New' } });
  const save = v.getByRole('button', { name: 'Save' });
  save.focus();
  fireEvent.click(save);
  document.body.setAttribute('tabindex', '-1');
  document.body.focus();
  await act(async () => settle(true));
  expect(document.activeElement).toBe(
    v.getByRole('button', { name: /Actions for/ })
  );
  document.body.removeAttribute('tabindex');
});
