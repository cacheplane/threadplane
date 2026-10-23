// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createConnectedApplication } from './connection';
import type { PlanningApplicationSnapshot } from './application';
vi.mock('./connection', () => ({ createConnectedApplication: vi.fn() }));
import { PlanningDemo, connectionFingerprint } from './app';
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function harness() {
  let snapshot: PlanningApplicationSnapshot = {
    threadId: null,
    rows: [],
    messages: [],
    toolCalls: [],
    observedPlan: { kind: 'missing' },
    savedPlan: { kind: 'missing' },
    phase: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    notice: null,
    error: null,
    viewGeneration: 0,
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<PlanningApplicationSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((fn) => fn());
  };
  const app = {
    getSnapshot: () => snapshot,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    submit: vi.fn(async () => {
      update({ busy: true, phase: 'working' });
      return true;
    }),
    stop: vi.fn(async () => undefined),
    newConversation: vi.fn(async () => {
      update({
        viewGeneration: snapshot.viewGeneration + 1,
        busy: false,
        phase: 'idle',
        rows: [],
      });
    }),
    dispose: vi.fn(async () => undefined),
  };
  vi.mocked(createConnectedApplication).mockReturnValue(app);
  const onReady = vi.fn();
  const connection = { apiUrl: 'https://authored.invalid', headers: {} };
  const view = render(
    <PlanningDemo connection={connection} onReady={onReady} />
  );
  return { app, update, view, onReady, connection };
}
it('inert mount and suggestion are draft-only; keyboard send and New remain available', () => {
  const h = harness();
  expect(h.onReady).toHaveBeenCalledOnce();
  expect(h.app.submit).not.toHaveBeenCalled();
  fireEvent.click(
    h.view.getByRole('button', { name: 'Dispatch brief: KSFO to KASE' })
  );
  const box = h.view.getByRole('textbox', {
    name: 'Message',
  }) as HTMLTextAreaElement;
  expect(box.value).toMatch(/KSFO to KASE/);
  expect(h.app.submit).not.toHaveBeenCalled();
  fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' });
  expect(h.app.submit).toHaveBeenCalledOnce();
  expect(box.value).toBe('');
  fireEvent.click(h.view.getByRole('button', { name: 'Stop' }));
  expect(h.app.stop).toHaveBeenCalledOnce();
  fireEvent.click(h.view.getByRole('button', { name: 'New conversation' }));
  expect(h.app.newConversation).toHaveBeenCalledOnce();
});
it('connection fingerprint normalizes header order and replaces/disposes old owner on value change', () => {
  expect(
    connectionFingerprint({ apiUrl: 'a', headers: { z: '1', a: '2' } })
  ).toBe(connectionFingerprint({ apiUrl: 'a', headers: { a: '2', z: '1' } }));
  const h = harness();
  h.view.rerender(
    <PlanningDemo
      connection={{ apiUrl: 'https://other.invalid', headers: {} }}
      onReady={h.onReady}
    />
  );
  expect(h.app.dispose).toHaveBeenCalledOnce();
  expect(createConnectedApplication).toHaveBeenCalledTimes(2);
});
it('saved phase still shows unfinished rows and does not claim all tasks completed', () => {
  const h = harness();
  act(() =>
    h.update({
      phase: 'saved',
      observedPlan: {
        kind: 'valid',
        items: [{ content: 'Still unfinished', status: 'in_progress' }],
      },
      savedPlan: {
        kind: 'valid',
        items: [{ content: 'Still unfinished', status: 'in_progress' }],
      },
    })
  );
  expect(h.view.getByText('Still unfinished')).toBeTruthy();
  expect(h.view.getByText('0 of 1 completed')).toBeTruthy();
  expect(h.view.getByText('Response saved.')).toBeTruthy();
});
