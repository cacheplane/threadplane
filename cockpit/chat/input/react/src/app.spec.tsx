import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createConnectedApplication } from './connection';
import type { InputSnapshot } from './application';
vi.mock('./connection', () => ({ createConnectedApplication: vi.fn() }));
import { createMessageContent } from '@threadplane/content/messages';
import { InputDemo, renderMessage } from './app';

it('composes labelled user, system and assistant articles with owned Markdown, hiding tool rows', async () => {
  const content = createMessageContent();
  const rows = content.project({
    status: 'idle',
    toolCalls: [],
    messages: [
      { id: 'u', role: 'user', content: 'Question' },
      { id: 's', role: 'system', content: 'System context' },
      {
        id: 'a',
        role: 'assistant',
        content: '```typescript\nconst answer = 42;\n```',
      },
      { id: 't', role: 'tool', content: 'Hidden tool result' },
    ].map((m) => ({
      ...m,
      role: m.role as 'user' | 'system' | 'assistant' | 'tool',
      delivery: { generation: m.id, phase: 'complete', outcome: 'success' },
    })),
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <>
          {rows.map((row) => (
            <div key={row.id}>{renderMessage(row)}</div>
          ))}
        </>
      )
    );
    expect(container.querySelectorAll('article')).toHaveLength(3);
    expect(
      Array.from(container.querySelectorAll('article')).map((el) =>
        el.getAttribute('aria-label')
      )
    ).toEqual(['You', 'System', 'Assistant']);
    expect(container.querySelector('pre code')?.textContent).toBe(
      'const answer = 42;'
    );
    expect(container.textContent).not.toContain('Hidden tool result');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    content.dispose();
  }
});

// Exercise the example's controlled composition independently of transport.
function composition() {
  let state: InputSnapshot = {
    threadId: null,
    rows: [],
    activity: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
    viewGeneration: 0,
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<InputSnapshot>, notify = true) => {
    state = { ...state, ...patch };
    if (notify) for (const listener of listeners) listener();
  };
  let finishReset: () => void = () => undefined;
  const reset = new Promise<void>((resolve) => {
    finishReset = resolve;
  });
  const app = {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    submit: vi.fn<(text: string) => Promise<void>>(async () => {
      update({ busy: true, canSubmit: false, activity: 'running' });
    }),
    stop: vi.fn(async () => {
      update({
        busy: false,
        canSubmit: false,
        activity: 'idle',
        outcome: 'aborted',
      });
    }),
    newConversation: vi.fn(async () => {
      update({ busy: true, canSubmit: false, activity: 'replacing' });
      await reset;
      update({
        busy: false,
        canSubmit: true,
        activity: 'idle',
        outcome: null,
        viewGeneration: state.viewGeneration + 1,
      });
    }),
    dispose: vi.fn(async () => undefined),
  };
  vi.mocked(createConnectedApplication).mockReturnValue(app);
  const view = render(
    <InputDemo
      connection={{ apiUrl: 'http://authored.invalid', headers: {} }}
      onReady={() => undefined}
    />
  );
  const box = () =>
    view.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
  return { app, update, finishReset, view, box };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('changes placeholder and keyboard preference locally, submitting the raw draft only on the selected shortcut', () => {
  const h = composition();
  fireEvent.change(
    h.view.getByRole('textbox', { name: 'Custom placeholder' }),
    { target: { value: 'Your question…' } }
  );
  fireEvent.click(
    h.view.getByRole('checkbox', { name: 'Enter sends a message' })
  );
  expect(h.box().placeholder).toBe('Your question…');
  const raw = '  first line\nsecond line  ';
  fireEvent.change(h.box(), { target: { value: raw } });
  fireEvent.keyDown(h.box(), { key: 'Enter' });
  expect(h.app.submit).not.toHaveBeenCalled();
  expect(h.app.newConversation).not.toHaveBeenCalled();
  expect(h.box().value).toBe(raw);
  expect(
    h.view.getByText('Ctrl/Command+Enter to send. Enter adds a new line.')
  ).toBeTruthy();
  fireEvent.keyDown(h.box(), { key: 'Enter', ctrlKey: true });
  expect(h.app.submit).toHaveBeenCalledExactlyOnceWith(raw);
  expect(h.box().value).toBe('');
});

it('clears the old draft immediately on local reset and preserves a newer draft across delayed cleanup and remount', async () => {
  const h = composition();
  fireEvent.change(h.box(), { target: { value: 'Old draft' } });
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  expect(h.app.newConversation).toHaveBeenCalledOnce();
  expect(h.box().value).toBe('');
  expect(h.box().disabled).toBe(false);
  fireEvent.change(h.box(), {
    target: { value: 'Newer draft during cleanup' },
  });
  await act(async () => {
    h.finishReset();
  });
  expect(h.box().value).toBe('Newer draft during cleanup');
  expect(h.app.submit).not.toHaveBeenCalled();
  expect(h.view.getByRole('status').textContent).toBe('Ready.');
});

it('preserves a new draft through busy and confirming phases without a competing submission', () => {
  const h = composition();
  fireEvent.change(h.box(), { target: { value: 'First turn' } });
  fireEvent.keyDown(h.box(), { key: 'Enter' });
  fireEvent.change(h.box(), { target: { value: 'Draft for the next turn' } });
  fireEvent.keyDown(h.box(), { key: 'Enter', metaKey: true });
  act(() => h.update({ activity: 'confirming' }));
  expect(h.box().disabled).toBe(false);
  expect(h.view.getByRole('button', { name: 'Send' })).toHaveProperty(
    'disabled',
    true
  );
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  expect(h.app.newConversation).not.toHaveBeenCalled();
  act(() =>
    h.update({
      busy: false,
      canSubmit: true,
      activity: 'idle',
      outcome: 'success',
    })
  );
  expect(h.box().value).toBe('Draft for the next turn');
  expect(h.app.submit).toHaveBeenCalledExactlyOnceWith('First turn');
});

it('keeps Stop usable when the local disabled setting blocks the busy composer', () => {
  const h = composition();
  fireEvent.change(h.box(), { target: { value: 'First turn' } });
  fireEvent.keyDown(h.box(), { key: 'Enter' });
  fireEvent.click(
    h.view.getByRole('checkbox', { name: 'Disable message input' })
  );
  expect(h.box().disabled).toBe(true);
  expect(h.view.getByRole('button', { name: 'Send' })).toHaveProperty(
    'disabled',
    true
  );
  fireEvent.click(h.view.getByRole('button', { name: 'Stop' }));
  expect(h.app.stop).toHaveBeenCalledOnce();
  expect(h.app.submit).toHaveBeenCalledOnce();
});

it('preserves a draft when the live owner rejects admission before the rendered state catches up', () => {
  const h = composition();
  fireEvent.change(h.box(), { target: { value: 'Keep this draft' } });
  h.update({ canSubmit: false }, false);
  fireEvent.keyDown(h.box(), { key: 'Enter' });
  expect(h.app.submit).not.toHaveBeenCalled();
  expect(h.box().value).toBe('Keep this draft');
});
