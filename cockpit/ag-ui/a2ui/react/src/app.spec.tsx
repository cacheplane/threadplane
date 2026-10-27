// @vitest-environment jsdom
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Session } from '@threadplane/ag-ui';
import { A2uiDemo } from './app';
import { createA2uiApplication } from './application';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('StrictMode presentation, suggestion and unmount do not create a native owner or send work', async () => {
  const factory = vi.fn(),
    uuid = vi.spyOn(crypto, 'randomUUID');
  const application = createA2uiApplication({ sessionFactory: factory });
  const view = render(
    <StrictMode>
      <A2uiDemo application={application} onReady={() => undefined} />
    </StrictMode>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Try a flight request' }));
  expect(
    (screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement)
      .value
  ).toContain('LAX');
  expect(factory).not.toHaveBeenCalled();
  expect(uuid).not.toHaveBeenCalled();
  view.unmount();
  expect(application.getSnapshot().canSubmit).toBe(true);
  await application.dispose();
});
it('shows bounded escaped unconfirmed native observations without confirmed transcript or controls', async () => {
  // Fake transport control: successful-looking native snapshot, rejected original submit outcome.
  const unconfirmed =
    'PRIVATE_UNCONFIRMED <img src=x onerror=alert(1)> ' + 'x'.repeat(120000);
  const callbacks = new Set<() => void>();
  let state: {
    status: string;
    transcript: readonly Record<string, unknown>[];
    state: object;
    subagents: readonly unknown[];
    run?: unknown;
  } = { status: 'idle', transcript: [], state: {}, subagents: [] };
  const submit = vi.fn(async (text: string) => {
    const user = { id: 'native-user', role: 'user', content: text };
    state = {
      ...state,
      status: 'running',
      transcript: [user],
      run: { id: 'native-run' },
    };
    for (const notify of callbacks) notify();
    state = {
      ...state,
      status: 'idle',
      transcript: [
        user,
        { id: 'native-assistant', role: 'assistant', content: unconfirmed },
      ],
      run: {
        id: 'native-run',
        outcome: 'success',
        terminal: {
          type: 'RUN_FINISHED',
          threadId: 'foreign-thread',
          runId: 'native-run',
        },
      },
    };
    for (const notify of callbacks) notify();
    return 'error';
  });
  const session = {
    getSnapshot: () => state,
    subscribe(notify: () => void) {
      callbacks.add(notify);
      return () => {
        callbacks.delete(notify);
      };
    },
    submit,
    resume: vi.fn(),
    stop: async () => undefined,
    dispose: async () => undefined,
  } as unknown as Session;
  const application = createA2uiApplication({ sessionFactory: () => session });
  expect(await application.submit('flight please')).toBe(false);
  expect(application.getSnapshot().messages).toEqual([]);
  expect(application.getSnapshot().surfaces).toEqual([]);
  const view = render(
    <A2uiDemo application={application} onReady={() => undefined} />
  );
  expect(screen.getByText('Unconfirmed response details')).toBeTruthy();
  const plain = view.container.querySelector('details pre')?.textContent;
  expect(plain).toContain('PRIVATE_UNCONFIRMED');
  expect(plain).toContain('<img');
  expect(plain?.length).toBeLessThanOrEqual(100000);
  expect(view.container.querySelector('img')).toBeNull();
  expect(view.container.querySelectorAll('article')).toHaveLength(0);
  expect(
    (screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement)
      .disabled
  ).toBe(true);
  expect(submit).toHaveBeenCalledTimes(1);
  await application.dispose();
});
