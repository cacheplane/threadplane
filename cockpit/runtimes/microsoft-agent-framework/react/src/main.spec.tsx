import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  unmount: vi.fn(),
  ready: vi.fn(),
  error: vi.fn(),
  dispose: vi.fn(),
  configure: vi.fn(),
}));
vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: mocks.render, unmount: mocks.unmount }),
}));
vi.mock('./app', () => ({ MafDemo: () => null }));
vi.mock('./connection', () => ({
  mafConnection: () => ({
    url: 'https://example.test',
    label: 'Shared runtime',
  }),
}));
vi.mock('../../../../../libs/cockpit-runtime-bridge/src/index', () => ({
  GENERATED_RUNTIME_PARENT_ORIGINS: [],
  installRuntimeBridge: () => ({
    awaitConfiguration: mocks.configure,
    markReady: mocks.ready,
    markError: mocks.error,
    dispose: mocks.dispose,
  }),
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => window.dispatchEvent(new Event('pagehide')));
it('guards the rendered onReady callback after synchronous pagehide cleanup', async () => {
  mocks.configure.mockResolvedValue({ status: 'default' });
  await import('./main');
  await Promise.resolve();
  const rendered = mocks.render.mock.calls[0][0] as {
    props: { onReady: () => void };
  };
  rendered.props.onReady();
  expect(mocks.ready).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('pagehide'));
  expect(mocks.unmount).toHaveBeenCalledTimes(1);
  expect(mocks.dispose).toHaveBeenCalledTimes(1);
  rendered.props.onReady();
  expect(mocks.ready).toHaveBeenCalledTimes(1);
});
it.each(['resolve', 'reject'] as const)(
  'ignores a late bootstrap %s after pagehide',
  async (outcome) => {
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    mocks.configure.mockReturnValue(
      new Promise((done, fail) => {
        resolve = done;
        reject = fail;
      })
    );
    await import('./main');
    window.dispatchEvent(new Event('pagehide'));
    if (outcome === 'resolve') resolve({ status: 'default' });
    else reject(new Error('late'));
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.ready).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  }
);
it('reports an active configuration failure without exposing its details', async () => {
  mocks.configure.mockRejectedValue(new Error('private credential'));
  await import('./main');
  await Promise.resolve();
  await Promise.resolve();
  expect(mocks.error).toHaveBeenCalledWith('bootstrap_failed');
  expect(JSON.stringify(mocks.render.mock.calls[0])).not.toContain(
    'private credential'
  );
});
