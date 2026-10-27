// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { startA2uiDemo } from './main';
import { createA2uiApplication, type A2uiApplication } from './application';
function fixture() {
  const calls: string[] = [];
  let resolve!: (c: unknown) => void, reject!: (e: unknown) => void;
  const pending = new Promise<unknown>((r, j) => {
    resolve = r;
    reject = j;
  });
  const bridge = {
    awaitConfiguration: () => pending,
    markReady: vi.fn(),
    markError: vi.fn(),
    dispose: vi.fn(() => {
      calls.push('bridge');
    }),
  };
  const root = {
    render: vi.fn<(node: ReactNode) => void>(() => {
      calls.push('render');
    }),
    unmount: vi.fn(() => {
      calls.push('unmount');
    }),
  };
  const app = {
    revoke: vi.fn(() => {
      calls.push('revoke');
    }),
    dispose: vi.fn(async () => {
      calls.push('dispose');
    }),
  } as unknown as A2uiApplication;
  const createApplication = vi.fn(() => app);
  const element = document.createElement('div');
  const lifetime = startA2uiDemo(element, {
    bridge: bridge as never,
    root,
    createApplication,
  });
  return {
    calls,
    bridge,
    root,
    app,
    createApplication,
    resolve,
    reject,
    lifetime,
  };
}
it('awaits bridge configuration and creates the application outside React render', async () => {
  const f = fixture();
  expect(f.root.render).not.toHaveBeenCalled();
  expect(f.createApplication).not.toHaveBeenCalled();
  f.resolve({ status: 'default' });
  await f.lifetime.ready;
  expect(f.createApplication).toHaveBeenCalledWith({
    apiUrl: new URL('/api', window.location.origin).href,
    headers: {},
  });
  expect(f.root.render).toHaveBeenCalledTimes(1);
  await f.lifetime.dispose();
});
it('revokes before unmount and disposes owners then bridge once on repeated pagehide', async () => {
  const f = fixture();
  f.resolve({ status: 'default' });
  await f.lifetime.ready;
  f.calls.length = 0;
  window.dispatchEvent(new Event('pagehide'));
  window.dispatchEvent(new Event('pagehide'));
  await f.lifetime.dispose();
  expect(f.calls).toEqual(['revoke', 'unmount', 'dispose', 'bridge']);
  expect(f.bridge.dispose).toHaveBeenCalledTimes(1);
});
it('pagehide while configuration is pending forbids later render or application creation', async () => {
  const f = fixture();
  window.dispatchEvent(new Event('pagehide'));
  f.resolve({ status: 'default' });
  await f.lifetime.ready;
  await f.lifetime.dispose();
  expect(f.root.render).not.toHaveBeenCalled();
  expect(f.createApplication).not.toHaveBeenCalled();
  expect(f.bridge.dispose).toHaveBeenCalledTimes(1);
});
it('makes configuration failure visible and reports it to the bridge', async () => {
  const f = fixture();
  f.reject(Error('private diagnostic'));
  await f.lifetime.ready;
  expect(f.bridge.markError).toHaveBeenCalledWith('bootstrap_failed');
  expect(f.root.render).toHaveBeenCalledTimes(1);
  expect(f.createApplication).not.toHaveBeenCalled();
  const node = f.root.render.mock.calls[0][0] as any;
  expect(node.props.role).toBe('alert');
  expect(node.props.children).toContain('could not start');
  await f.lifetime.dispose();
});
it('a resolved incompatible configuration also produces a visible failure', async () => {
  const f = fixture();
  f.resolve({ status: 'error' });
  await f.lifetime.ready;
  expect(f.bridge.markError).toHaveBeenCalledTimes(1);
  expect(f.createApplication).not.toHaveBeenCalled();
  await f.lifetime.dispose();
});

it('actual busy application stops before borrowed unmount and disposes its session once afterward', async () => {
  const calls: string[] = [],
    listeners = new Set<() => void>();
  let finish!: (v: string) => void;
  const running = new Promise<string>((r) => {
    finish = r;
  });
  const session = {
    getSnapshot: () => ({
      status: 'idle',
      messages: [],
      toolCalls: [],
      interrupts: [],
      subgraphs: [],
    }),
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    submit: () => running,
    load: async () => undefined,
    stop: vi.fn(async () => {
      calls.push('stop');
    }),
    dispose: vi.fn(async () => {
      calls.push('session');
    }),
  };
  const app = createA2uiApplication({
    createThread: async () => 'thread',
    sessionFactory: () => session as never,
    readCheckpoint: async () => undefined,
  });
  const bridge = {
    awaitConfiguration: async () => ({ status: 'default' as const }),
    markReady: vi.fn(),
    markError: vi.fn(),
    dispose: () => {
      calls.push('bridge');
    },
  };
  const lifetime = startA2uiDemo(document.createElement('div'), {
    bridge,
    root: {
      render: () => undefined,
      unmount: () => {
        calls.push('unmount');
      },
    },
    createApplication: () => app,
  });
  await lifetime.ready;
  const pending = app.submit('request');
  await Promise.resolve();
  window.dispatchEvent(new Event('pagehide'));
  await lifetime.dispose();
  finish('success');
  await pending;
  expect(calls).toEqual(['stop', 'unmount', 'session', 'bridge']);
  expect(listeners.size).toBe(0);
  expect(session.stop).toHaveBeenCalledTimes(1);
  expect(session.dispose).toHaveBeenCalledTimes(1);
});
