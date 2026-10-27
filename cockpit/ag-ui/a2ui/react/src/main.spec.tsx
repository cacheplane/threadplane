// @vitest-environment jsdom
import { StrictMode } from 'react';
import { expect, it, vi } from 'vitest';
import { startA2uiDemo } from './main';
import { createA2uiApplication, type A2uiApplication } from './application';
function fixture() {
  const calls: string[] = [];
  let resolve!: (configuration: unknown) => void;
  const pending = new Promise<unknown>((r) => {
    resolve = r;
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
    render: vi.fn(),
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
  const dependencies = { bridge: bridge as never, root, createApplication };
  return { calls, bridge, root, app, createApplication, dependencies, resolve };
}
it('waits for configuration, creates once outside StrictMode and reports ready once', async () => {
  const f = fixture();
  const lifetime = startA2uiDemo(document.createElement('div'), f.dependencies);
  expect(f.createApplication).not.toHaveBeenCalled();
  expect(f.root.render).not.toHaveBeenCalled();
  f.resolve({ status: 'default' });
  await lifetime.ready;
  expect(f.createApplication).toHaveBeenCalledTimes(1);
  expect(f.createApplication).toHaveBeenCalledWith({
    url: new URL('/ag-ui/a2ui/agent', window.location.origin).href,
    label: 'Shared runtime',
  });
  const tree = f.root.render.mock.calls[0][0];
  expect(tree.type).toBe(StrictMode);
  tree.props.children.props.onReady();
  tree.props.children.props.onReady();
  expect(f.bridge.markReady).toHaveBeenCalledTimes(1);
  await lifetime.dispose();
});
it('keeps actual application construction network and UUID inert', async () => {
  const f = fixture(),
    factory = vi.fn(),
    uuid = vi.spyOn(crypto, 'randomUUID'),
    fetch = vi.spyOn(globalThis, 'fetch');
  const application = createA2uiApplication({ sessionFactory: factory });
  const lifetime = startA2uiDemo(document.createElement('div'), {
    ...f.dependencies,
    createApplication: () => application,
  });
  f.resolve({ status: 'default' });
  await lifetime.ready;
  expect(factory).not.toHaveBeenCalled();
  expect(uuid).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  await lifetime.dispose();
  uuid.mockRestore();
  fetch.mockRestore();
});
it('revokes before unmount and closes application then bridge exactly once', async () => {
  const f = fixture(),
    lifetime = startA2uiDemo(document.createElement('div'), f.dependencies);
  f.resolve({ status: 'default' });
  await lifetime.ready;
  window.dispatchEvent(new Event('pagehide'));
  window.dispatchEvent(new Event('pagehide'));
  await lifetime.dispose();
  expect(f.calls).toEqual(['revoke', 'unmount', 'dispose', 'bridge']);
});
it('closes a bridge when root acquisition fails', () => {
  const f = fixture();
  expect(() =>
    startA2uiDemo(null as unknown as HTMLElement, { bridge: f.bridge as never })
  ).toThrow();
  expect(f.bridge.dispose).toHaveBeenCalledTimes(1);
});
it('continues application and bridge cleanup when unmount throws', async () => {
  const f = fixture(),
    lifetime = startA2uiDemo(document.createElement('div'), f.dependencies);
  f.resolve({ status: 'default' });
  await lifetime.ready;
  f.root.unmount.mockImplementation(() => {
    f.calls.push('unmount');
    throw Error('unmount failed');
  });
  await expect(
    Promise.resolve().then(() => lifetime.dispose())
  ).resolves.toBeUndefined();
  expect(f.calls).toEqual(['revoke', 'unmount', 'dispose', 'bridge']);
});
it('revokes and closes acquired resources when rendering fails', async () => {
  const f = fixture();
  f.root.render.mockImplementation(() => {
    throw Error('render failed');
  });
  const lifetime = startA2uiDemo(document.createElement('div'), f.dependencies);
  f.resolve({ status: 'default' });
  await expect(lifetime.ready).resolves.toBeUndefined();
  expect(f.bridge.markError).toHaveBeenCalledWith('bootstrap_failed');
  expect(f.app.revoke).toHaveBeenCalledTimes(1);
  expect(f.app.dispose).toHaveBeenCalledTimes(1);
  expect(f.bridge.dispose).toHaveBeenCalledTimes(1);
  await lifetime.dispose();
});
it('pagehide before configuration prevents later construction and rendering', async () => {
  const f = fixture(),
    lifetime = startA2uiDemo(document.createElement('div'), f.dependencies);
  window.dispatchEvent(new Event('pagehide'));
  f.resolve({ status: 'default' });
  await lifetime.ready;
  await lifetime.dispose();
  expect(f.createApplication).not.toHaveBeenCalled();
  expect(f.root.render).not.toHaveBeenCalled();
  expect(f.bridge.dispose).toHaveBeenCalledTimes(1);
});
