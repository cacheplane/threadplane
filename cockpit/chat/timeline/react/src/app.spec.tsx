// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { createMessageContent } from '@threadplane/content/messages';
import {
  createTimelineApplication,
  type TimelineSnapshot,
} from './application';
import { createTimelineClient } from './connection';
vi.mock('./application', () => ({ createTimelineApplication: vi.fn() }));
vi.mock('./connection', () => ({ createTimelineClient: vi.fn() }));
import { TimelineDemo } from './app';

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const source = {
  thread_id: 'private-thread',
  checkpoint_ns: '' as const,
  checkpoint_id: 'private-checkpoint',
};
function fakeApp() {
  let state: TimelineSnapshot = {
    threadId: 'private-thread',
    rows: [],
    previewRows: [],
    historyPage: [
      {
        id: source.checkpoint_id,
        namespace: '',
        createdAt: null,
        parentId: null,
        next: [],
        source,
        unavailable: null,
      },
    ],
    selectedSource: null,
    draft: '',
    activity: 'idle',
    busy: false,
    readingHistory: false,
    readingPreview: false,
    canSubmit: true,
    canRefresh: true,
    canFork: false,
    outcome: null,
    error: null,
    historyError: null,
    previewError: null,
    viewGeneration: 0,
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<TimelineSnapshot>, notify = true) => {
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
    setDraft: vi.fn((draft: string) => update({ draft })),
    submit: vi.fn(async (_text?: string) => undefined),
    forkSelected: vi.fn(async (_text?: string) => undefined),
    refreshHistory: vi.fn(async () => undefined),
    selectCheckpoint: vi.fn(async (_index: number) => {
      update({ selectedSource: source, readingPreview: true });
    }),
    cancelPreview: vi.fn(() => undefined),
    clearSelection: vi.fn(() => undefined),
    newConversation: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  return { app, update };
}
function composition() {
  const h = fakeApp(),
    onReady = vi.fn(),
    connection = { apiUrl: 'https://authored.invalid', headers: {} };
  vi.mocked(createTimelineApplication).mockReturnValue(h.app);
  const view = render(
    <TimelineDemo connection={connection} onReady={onReady} />
  );
  const box = () =>
    view.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
  const button = (name: string) =>
    view.getByRole('button', { name }) as HTMLButtonElement;
  return { ...h, view, box, button, connection, onReady };
}
it('remounts the current list and composer without retaining messages or duplicate keys after New', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const content = createMessageContent();
  try {
    const h = composition();
    const rows = content.project({
      status: 'idle',
      toolCalls: [],
      messages: [
        {
          id: 'old-message',
          role: 'user',
          content: 'Old transcript',
          delivery: {
            generation: 'old-turn',
            phase: 'complete',
            outcome: 'success',
          },
        },
      ],
    });
    act(() => h.update({ rows, draft: 'Old draft' }));
    const oldList = h.view.getByRole('region', { name: 'Current messages' });
    const oldComposer = h.box();
    expect(within(oldList).getByText('Old transcript')).toBeTruthy();
    h.app.newConversation.mockImplementation(async () => {
      h.update({ viewGeneration: 1, rows: [], draft: '' });
    });
    fireEvent.click(h.button('New conversation'));
    expect
      .soft(h.view.queryAllByRole('region', { name: 'Current messages' }))
      .toHaveLength(1);
    expect.soft(h.view.queryByText('Old transcript')).toBeNull();
    expect.soft(h.box()).not.toBe(oldComposer);
    expect.soft(h.box().value).toBe('');
    expect.soft(oldList.isConnected).toBe(false);
    const keyWarnings = errors.mock.calls.filter((args) =>
      args.some((arg) => typeof arg === 'string' && arg.includes('same key'))
    );
    expect.soft(keyWarnings).toEqual([]);
  } finally {
    content.dispose();
    errors.mockRestore();
  }
});
it('separates the current composer from the read-only historical preview', () => {
  const h = composition();
  expect(h.onReady).toHaveBeenCalledOnce();
  expect(createTimelineClient).toHaveBeenCalledWith(h.connection);
  expect(
    within(
      h.view.getByRole('region', { name: 'Current conversation' })
    ).getByRole('textbox')
  ).toBeTruthy();
  const preview = within(
    h.view.getByRole('region', { name: 'Historical preview' })
  );
  expect(preview.queryByRole('textbox')).toBeNull();
  expect(preview.getByText(/read-only/i)).toBeTruthy();
  expect(h.view.container.textContent).not.toContain('private-thread');
  expect(h.view.container.textContent).not.toContain('private-checkpoint');
});
it('selection only requests preview and retains composer focus and draft', () => {
  const h = composition();
  fireEvent.change(h.box(), { target: { value: 'Shared draft' } });
  h.box().focus();
  fireEvent.click(h.button('Checkpoint 1'));
  expect(h.app.selectCheckpoint).toHaveBeenCalledExactlyOnceWith(0);
  expect(h.app.submit).not.toHaveBeenCalled();
  expect(h.app.forkSelected).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(h.box());
  expect(h.box().value).toBe('Shared draft');
  expect(h.button('Fork from here').disabled).toBe(true);
  fireEvent.click(h.button('Cancel preview'));
  expect(h.app.cancelPreview).toHaveBeenCalledOnce();
});
it('explicit fork submits the shared draft and ordinary Send stays on its own command', () => {
  const h = composition();
  act(() => h.update({ selectedSource: source, canFork: true }));
  expect(h.button('Fork from here').disabled).toBe(true);
  fireEvent.change(h.box(), { target: { value: 'Branch question' } });
  fireEvent.click(h.button('Fork from here'));
  expect(h.app.forkSelected).toHaveBeenCalledExactlyOnceWith('Branch question');
  expect(h.app.submit).not.toHaveBeenCalled();
  fireEvent.keyDown(h.box(), { key: 'Enter' });
  expect(h.app.submit).toHaveBeenCalledExactlyOnceWith('Branch question');
  fireEvent.click(h.button('Clear selection'));
  expect(h.app.clearSelection).toHaveBeenCalledOnce();
});
it('shows independent errors and disables unavailable checkpoints and busy actions', () => {
  const h = composition();
  act(() =>
    h.update({
      error: 'Current failed',
      historyError: 'History failed',
      previewError: 'Preview failed',
      historyPage: [
        {
          id: null,
          namespace: null,
          createdAt: null,
          parentId: null,
          next: null,
          source: null,
          unavailable: 'unavailable',
        },
      ],
    })
  );
  expect(h.view.getAllByRole('alert')).toHaveLength(3);
  expect(h.button('Checkpoint 1 (unavailable)').disabled).toBe(true);
  act(() =>
    h.update({
      busy: true,
      activity: 'running',
      canFork: false,
      canRefresh: false,
    })
  );
  expect(h.box().disabled).toBe(true);
  expect(h.button('Refresh checkpoints').disabled).toBe(true);
  fireEvent.click(h.button('Stop'));
  expect(h.app.stop).toHaveBeenCalledOnce();
});
it('refreshes history and starts a new conversation through explicit actions', () => {
  const h = composition();
  fireEvent.click(h.button('Refresh checkpoints'));
  expect(h.app.refreshHistory).toHaveBeenCalledOnce();
  fireEvent.click(h.button('New conversation'));
  expect(h.app.newConversation).toHaveBeenCalledOnce();
});
it('fences stale composer events when state changes without a render', () => {
  const h = composition();
  fireEvent.change(h.box(), { target: { value: 'Keep draft' } });
  h.update({ viewGeneration: 1 }, false);
  fireEvent.keyDown(h.box(), { key: 'Enter' });
  expect(h.app.submit).not.toHaveBeenCalled();
  expect(h.box().value).toBe('Keep draft');
  fireEvent.change(h.box(), { target: { value: 'Stale draft' } });
  expect(h.app.setDraft).toHaveBeenCalledTimes(1);
});
it('fences checkpoint and conversation actions from a retired view', () => {
  const h = composition();
  act(() => h.update({ selectedSource: source, canFork: true, draft: 'Keep' }));
  h.update({ viewGeneration: 1 }, false);
  for (const name of [
    'Refresh checkpoints',
    'Clear selection',
    'Fork from here',
    'New conversation',
    'Checkpoint 1',
  ])
    fireEvent.click(h.button(name));
  expect(h.app.selectCheckpoint).not.toHaveBeenCalled();
  expect(h.app.refreshHistory).not.toHaveBeenCalled();
  expect(h.app.clearSelection).not.toHaveBeenCalled();
  expect(h.app.forkSelected).not.toHaveBeenCalled();
  expect(h.app.newConversation).not.toHaveBeenCalled();
});
it('does not select a replacement checkpoint behind an old row button', () => {
  const h = composition();
  const row = h.app.getSnapshot().historyPage![0];
  h.update(
    {
      historyPage: [
        { ...row, source: { ...source, checkpoint_id: 'replacement' } },
      ],
    },
    false
  );
  fireEvent.click(h.button('Checkpoint 1'));
  expect(h.app.selectCheckpoint).not.toHaveBeenCalled();
});
it('does not fork a replacement selection behind an old preview button', () => {
  const h = composition();
  act(() =>
    h.update({ selectedSource: source, canFork: true, draft: 'Question' })
  );
  h.update(
    { selectedSource: { ...source, checkpoint_id: 'replacement' } },
    false
  );
  fireEvent.click(h.button('Fork from here'));
  expect(h.app.forkSelected).not.toHaveBeenCalled();
});
it.each(['headers', 'endpoint'])(
  'replaces the owner on %s changes and disposes an outstanding preview',
  (kind) => {
    const h = composition();
    fireEvent.click(h.button('Checkpoint 1'));
    const next = fakeApp();
    vi.mocked(createTimelineApplication).mockReturnValue(next.app);
    h.view.rerender(
      <TimelineDemo
        connection={
          kind === 'headers'
            ? { ...h.connection, headers: { 'x-api-key': 'fictional-secret' } }
            : { ...h.connection, apiUrl: 'https://next.invalid' }
        }
        onReady={h.onReady}
      />
    );
    expect(h.app.dispose).toHaveBeenCalledOnce();
    expect(createTimelineApplication).toHaveBeenCalledTimes(2);
    expect(h.view.container.outerHTML).not.toContain('fictional-secret');
    h.view.unmount();
    expect(next.app.dispose).toHaveBeenCalledOnce();
  }
);
it('retains ownership when equivalent header entries have a different order', () => {
  const h = composition();
  h.view.rerender(
    <TimelineDemo
      connection={{ ...h.connection, headers: {} }}
      onReady={h.onReady}
    />
  );
  expect(createTimelineApplication).toHaveBeenCalledOnce();
  expect(h.app.dispose).not.toHaveBeenCalled();
});
