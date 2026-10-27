// @vitest-environment jsdom
import { StrictMode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { A2uiDemo } from './app';
import type { A2uiApplication, A2uiSnapshot } from './application';
afterEach(cleanup);
function fixture() {
  let state: A2uiSnapshot = {
    threadId: null,
    messages: [],
    surfaces: [],
    activeSurface: null,
    activity: 'idle',
    busy: false,
    canSubmit: true,
    error: null,
    viewGeneration: 0,
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<A2uiSnapshot>) => {
    state = { ...state, ...patch };
    for (const f of [...listeners]) f();
  };
  let resolveSubmit!: (b: boolean) => void, resolveReset!: () => void;
  const submitted = new Promise<boolean>((r) => {
    resolveSubmit = r;
  });
  const reset = new Promise<void>((r) => {
    resolveReset = r;
  });
  const app = {
    getSnapshot: () => state,
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    submit: vi.fn(() => {
      update({ busy: true, canSubmit: false, activity: 'running' });
      return submitted;
    }),
    stop: vi.fn(async () =>
      update({ busy: false, canSubmit: false, activity: 'idle' })
    ),
    newConversation: vi.fn(async () => {
      update({
        busy: true,
        canSubmit: false,
        activity: 'replacing',
        viewGeneration: state.viewGeneration + 1,
      });
      await reset;
      update({ busy: false, canSubmit: true, activity: 'idle' });
    }),
    revoke: vi.fn(),
    dispose: vi.fn(async () => undefined),
  } as A2uiApplication;
  return { app, update, resolveSubmit, resolveReset, listeners };
}
it('mount, StrictMode, suggestions and borrowed unmount issue zero owner commands', () => {
  const f = fixture(),
    ready = vi.fn();
  const v = render(
    <StrictMode>
      <A2uiDemo application={f.app} onReady={ready} />
    </StrictMode>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Try a flight request' }));
  expect(
    (screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement)
      .value
  ).toContain('LAX');
  expect(f.app.submit).not.toHaveBeenCalled();
  expect(f.app.newConversation).not.toHaveBeenCalled();
  v.unmount();
  expect(f.app.dispose).not.toHaveBeenCalled();
  expect(f.app.revoke).not.toHaveBeenCalled();
  expect(f.listeners.size).toBe(0);
});
it('clears admitted text synchronously and preserves a newer draft during running and confirmation', async () => {
  const f = fixture();
  render(<A2uiDemo application={f.app} onReady={() => undefined} />);
  const box = () =>
    screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
  fireEvent.change(box(), { target: { value: '  exact request  ' } });
  fireEvent.keyDown(box(), { key: 'Enter' });
  expect(f.app.submit).toHaveBeenCalledWith('  exact request  ');
  expect(box().value).toBe('');
  fireEvent.change(box(), { target: { value: 'new draft' } });
  act(() => f.update({ activity: 'confirming' }));
  await act(async () => {
    f.resolveSubmit(true);
    await Promise.resolve();
    f.update({ busy: false, canSubmit: true, activity: 'idle' });
  });
  expect(box().value).toBe('new draft');
});
it('New clears the old draft before cleanup and preserves text typed during cleanup', async () => {
  const f = fixture();
  render(<A2uiDemo application={f.app} onReady={() => undefined} />);
  const box = () =>
    screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
  fireEvent.change(box(), { target: { value: 'old' } });
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
  expect(box().value).toBe('');
  fireEvent.change(box(), { target: { value: 'during cleanup' } });
  await act(async () => {
    f.resolveReset();
    await Promise.resolve();
  });
  expect(box().value).toBe('during cleanup');
});
it('uses application status to block sends and show Stop plus visible recovery errors', () => {
  const f = fixture();
  render(<A2uiDemo application={f.app} onReady={() => undefined} />);
  act(() => f.update({ busy: true, canSubmit: false, activity: 'confirming' }));
  expect(screen.getByRole('status').textContent).toContain('Confirming');
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(f.app.stop).toHaveBeenCalledTimes(1);
  act(() =>
    f.update({
      busy: false,
      canSubmit: false,
      error: 'Start a new conversation.',
    })
  );
  expect(screen.getByRole('alert').textContent).toBe(
    'Start a new conversation.'
  );
  expect(
    (screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement)
      .disabled
  ).toBe(true);
});
it('shows unsupported saved prose separately from inert JSON details without HTML', () => {
  const f = fixture();
  f.update({
    messages: [
      {
        id: 'a',
        role: 'assistant',
        content: 'Safe prose\n---a2ui_JSON---\n<img src=x onerror=alert(1)>',
        delivery: { generation: 'a', phase: 'complete', outcome: 'success' },
      },
    ],
  });
  const v = render(<A2uiDemo application={f.app} onReady={() => undefined} />);
  expect(screen.getByText('Safe prose')).toBeTruthy();
  expect(v.container.querySelector('pre')?.textContent).toContain('<img');
  expect(v.container.querySelector('img')).toBeNull();
});
