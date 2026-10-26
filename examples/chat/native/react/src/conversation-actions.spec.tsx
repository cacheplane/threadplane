import { cleanup, fireEvent, render, act } from '@testing-library/react';
import { useState } from 'react';
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
