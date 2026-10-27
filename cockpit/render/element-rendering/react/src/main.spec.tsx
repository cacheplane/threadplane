import { act, fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { RenderState } from '@threadplane/content/render-state';

const observed = vi.hoisted(() => ({
  events: [] as string[],
  owners: [] as RenderState[],
  writes: vi.fn(),
  ownerDispose: vi.fn(),
  playbackDispose: vi.fn(),
  bridgeDispose: vi.fn(),
  unmount: vi.fn(),
}));
vi.mock('@threadplane/content/render-state', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@threadplane/content/render-state')>();
  return {
    ...actual,
    createRenderState: (...args: Parameters<typeof actual.createRenderState>) => {
      const owner = actual.createRenderState(...args);
      const instrumented: RenderState = {
        ...owner,
        set: (...writes) => {
          observed.writes(...writes);
          owner.set(...writes);
        },
        update: (...writes) => {
          observed.writes(...writes);
          owner.update(...writes);
        },
        dispose: () => {
          observed.events.push('owner');
          observed.ownerDispose();
          owner.dispose();
        },
      };
      observed.owners.push(instrumented);
      return instrumented;
    },
  };
});
vi.mock('./playback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./playback')>();
  return {
    ...actual,
    createPlayback: (...args: Parameters<typeof actual.createPlayback>) => {
      const playback = actual.createPlayback(...args);
      const dispose = playback.dispose;
      playback.dispose = () => {
        observed.events.push('playback');
        observed.playbackDispose();
        dispose();
      };
      return playback;
    },
  };
});
vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args);
      const unmount = root.unmount.bind(root);
      root.unmount = () => {
        observed.events.push('unmount');
        observed.unmount();
        unmount();
      };
      return root;
    },
  };
});
vi.mock('../../../../../libs/cockpit-runtime-bridge/src/index', () => ({
  installRuntimeBridge: () => ({
    markReady: vi.fn(),
    dispose: () => {
      observed.events.push('bridge');
      observed.bridgeDispose();
    },
  }),
}));

it('the actual entrypoint owns state and disposes it once after unmount on pagehide', async () => {
  vi.resetModules();
  const element = document.createElement('div');
  element.id = 'root';
  document.body.append(element);
  const add = vi.spyOn(window, 'addEventListener');
  try {
    await act(async () => {
      await import('./main');
    });
    expect(observed.owners).toHaveLength(1);
    const owner = observed.owners[0];
    expect(owner.getSnapshot()).toEqual({ showDetail: true });
    expect(observed.writes).not.toHaveBeenCalled();
    const checkbox = screen.getByRole('checkbox', {
      name: 'Show detail',
    }) as HTMLInputElement;
    act(() => owner.set('/showDetail', false));
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(owner.getSnapshot().showDetail).toBe(true);
    observed.writes.mockClear();
    act(() => window.dispatchEvent(new Event('pagehide')));
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(element.childNodes).toHaveLength(0);
    expect(observed.unmount).toHaveBeenCalledTimes(1);
    expect(observed.ownerDispose).toHaveBeenCalledTimes(1);
    expect(observed.playbackDispose).toHaveBeenCalledTimes(1);
    expect(observed.bridgeDispose).toHaveBeenCalledTimes(1);
    expect(observed.events).toEqual(['playback', 'unmount', 'owner', 'bridge']);
    expect(observed.writes).not.toHaveBeenCalled();
    expect(() => owner.set('/showDetail', false)).toThrow('disposed');
  } finally {
    act(() => window.dispatchEvent(new Event('pagehide')));
    for (const [type, listener, options] of add.mock.calls) {
      if (type === 'pagehide') window.removeEventListener(type, listener, options);
    }
    add.mockRestore();
    element.remove();
    vi.restoreAllMocks();
    vi.doUnmock('@threadplane/content/render-state');
    vi.doUnmock('./playback');
    vi.doUnmock('react-dom/client');
    vi.doUnmock('../../../../../libs/cockpit-runtime-bridge/src/index');
    vi.resetModules();
  }
});
