import { act } from 'react';
import { afterEach, beforeAll, afterAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createMessageContent } from '@threadplane/content/messages';
import { createThreadsApplication, type ThreadsSnapshot } from './application';
import { createThreadsClient } from './connection';
vi.mock('./application', () => ({ createThreadsApplication: vi.fn() }));
vi.mock('./connection', () => ({ createThreadsClient: vi.fn() }));
import { ThreadsDemo, renderMessage } from './app';
const environment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
let old: boolean | undefined;
beforeAll(() => {
  old = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = old;
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function fakeApp() {
  let state: ThreadsSnapshot = {
    selectedKey: 'local-1',
    threadId: null,
    conversations: [],
    rows: [],
    draft: '',
    activity: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
    viewGeneration: 0,
    confirmation: null,
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<ThreadsSnapshot>, notify = true) => {
    state = { ...state, ...patch };
    if (notify) for (const listener of listeners) listener();
  };
  const app = {
    getSnapshot: () => state,
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    setDraft: vi.fn((view: number, text: string) => {
      if (view === state.viewGeneration) update({ draft: text });
    }),
    submit: vi.fn<(text: string) => Promise<void>>(async () => {
      update({ draft: '', busy: true, canSubmit: false, activity: 'running' });
    }),
    select: vi.fn<(key: string) => Promise<void>>(async () => undefined),
    newConversation: vi.fn(async () => {
      update({
        selectedKey: 'local-2',
        draft: '',
        rows: [],
        viewGeneration: state.viewGeneration + 1,
      });
    }),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  return { app, update };
}
function composition() {
  const h = fakeApp(),
    onReady = vi.fn();
  vi.mocked(createThreadsApplication).mockReturnValue(h.app);
  const connection = { apiUrl: 'https://authored.invalid', headers: {} };
  const view = render(
    <ThreadsDemo connection={connection} onReady={onReady} />
  );
  const box = () =>
    view.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
  return { ...h, view, box, onReady, connection };
}
it('renders the native text, reasoning, citations and Markdown composition', () => {
  const content = createMessageContent(),
    rows = content.project({
      status: 'idle',
      toolCalls: [],
      messages: [
        { id: 'u', role: 'user', content: 'Question' },
        {
          id: 'a',
          role: 'assistant',
          content: '```typescript\nconst answer = 42;\n```',
          reasoning: 'A short explanation',
          citations: [
            {
              id: 'source',
              index: 1,
              url: 'https://example.com',
              title: 'Source',
            },
          ],
        },
      ].map((m) => ({
        ...m,
        role: m.role as 'user' | 'assistant',
        delivery: { generation: m.id, phase: 'complete', outcome: 'success' },
      })),
    });
  try {
    const view = render(
      <>
        {rows.map((row) => (
          <div key={row.id}>{renderMessage(row)}</div>
        ))}
      </>
    );
    expect(view.getAllByRole('article')).toHaveLength(2);
    expect(view.container.querySelector('pre code')?.textContent).toBe(
      'const answer = 42;'
    );
    expect(view.getByRole('link', { name: /Source/ })).toBeTruthy();
  } finally {
    content.dispose();
  }
});
it('mounts ready and fills a draft without remote execution', () => {
  const h = composition();
  expect(h.onReady).toHaveBeenCalledOnce();
  expect(createThreadsClient).toHaveBeenCalledWith(h.connection);
  expect(h.view.getByRole('status').textContent).toBe('Ready.');
  fireEvent.click(h.view.getByRole('button', { name: 'Try a question' }));
  expect(h.box().value).toBe(
    'Explain how saved conversations work in two sentences.'
  );
  expect(h.app.submit).not.toHaveBeenCalled();
  expect(h.view.getByText(/list and drafts last/i)).toBeTruthy();
  fireEvent.keyDown(h.box(), { key: 'Enter' });
  expect(h.app.submit).toHaveBeenCalledExactlyOnceWith(
    'Explain how saved conversations work in two sentences.'
  );
  expect(h.box().value).toBe('');
});
it('renders literal optional titles and marks unavailable records clearly', () => {
  const h = composition(),
    base = {
      ordinal: 1,
      draft: '',
      canonical: null,
      generations: [],
      version: 0,
    };
  act(() =>
    h.update({
      selectedKey: 'a',
      threadId: 'A',
      conversations: [
        {
          ...base,
          key: 'a',
          threadId: 'A',
          label: '<b>Literal title</b>',
          availability: 'available',
        },
        {
          ...base,
          key: 'b',
          threadId: 'B',
          label: 'Conversation 2',
          availability: 'unavailable',
        },
      ],
    })
  );
  const selected = h.view.getByRole('button', { name: '<b>Literal title</b>' });
  expect(selected.getAttribute('aria-pressed')).toBe('true');
  expect(selected.querySelector('b')).toBeNull();
  expect(
    (
      h.view.getByRole('button', {
        name: 'Conversation 2 (unavailable)',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
});
it('uses known local record keys for selection and preserves the controlled draft', () => {
  const h = composition(),
    entry = {
      key: 'a',
      threadId: 'A',
      ordinal: 1,
      label: 'Conversation 1',
      availability: 'available' as const,
      draft: 'A draft',
      canonical: null,
      generations: [],
      version: 0,
    };
  act(() => h.update({ conversations: [entry], draft: 'B draft' }));
  fireEvent.click(h.view.getByRole('button', { name: 'Conversation 1' }));
  expect(h.app.select).toHaveBeenCalledExactlyOnceWith('a');
  act(() =>
    h.update({
      selectedKey: 'a',
      threadId: 'A',
      draft: 'A draft',
      viewGeneration: 1,
      confirmation: 'loaded',
      outcome: 'success',
    })
  );
  expect(h.box().value).toBe('A draft');
  expect(h.view.getByRole('status').textContent).toBe('Conversation loaded.');
});
it('keeps Stop available while loading and prevents changing the selected record', () => {
  const h = composition();
  act(() => h.update({ busy: true, canSubmit: false, activity: 'loading' }));
  expect(h.box().disabled).toBe(true);
  expect(
    (
      h.view.getByRole('button', {
        name: 'New conversation',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  fireEvent.click(h.view.getByRole('button', { name: 'Stop' }));
  expect(h.app.stop).toHaveBeenCalledOnce();
});
it('allows a next draft during confirmation and does not clear it on completion', () => {
  const h = composition();
  act(() => h.update({ busy: true, canSubmit: false, activity: 'confirming' }));
  expect(h.box().disabled).toBe(false);
  fireEvent.change(h.box(), { target: { value: 'Next draft' } });
  act(() =>
    h.update({
      busy: false,
      canSubmit: true,
      activity: 'idle',
      confirmation: 'saved',
      outcome: 'success',
    })
  );
  expect(h.box().value).toBe('Next draft');
  expect(h.view.getByRole('status').textContent).toBe('Response saved.');
});
it('rejects stale UI submission and retains its text', () => {
  const h = composition();
  fireEvent.change(h.box(), { target: { value: 'Keep me' } });
  h.update({ canSubmit: false }, false);
  fireEvent.keyDown(h.box(), { key: 'Enter' });
  expect(h.app.submit).not.toHaveBeenCalled();
  expect(h.box().value).toBe('Keep me');
});
it('creates a fresh application lifetime when the runtime target changes', () => {
  const h = composition();
  fireEvent.change(h.box(), { target: { value: 'Old target draft' } });
  const next = fakeApp();
  vi.mocked(createThreadsApplication).mockReturnValue(next.app);
  h.view.rerender(
    <ThreadsDemo
      connection={{
        apiUrl: h.connection.apiUrl,
        headers: { 'x-api-key': 'fictional-next' },
      }}
      onReady={h.onReady}
    />
  );
  expect(h.app.dispose).toHaveBeenCalledOnce();
  expect(h.box().value).toBe('');
  expect(createThreadsApplication).toHaveBeenCalledTimes(2);
  expect(h.view.container.textContent).not.toContain('fictional-next');
  h.view.unmount();
  expect(next.app.dispose).toHaveBeenCalledOnce();
});
