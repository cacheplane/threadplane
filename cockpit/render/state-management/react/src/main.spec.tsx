import { act, fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { RenderState } from '@threadplane/content/render-state';

const observed = vi.hoisted(() => ({
  events: [] as string[],
  owners: [] as RenderState[],
  factories: vi.fn(),
  writes: vi.fn(),
}));
vi.mock('@threadplane/content/render-state', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@threadplane/content/render-state')
  >();
  return {
    ...actual,
    createRenderState: (
      ...args: Parameters<typeof actual.createRenderState>
    ) => {
      observed.factories(...args);
      const owner = actual.createRenderState(...args);
      const instrumented: RenderState = {
        ...owner,
        set: (...args) => {
          observed.writes(...args);
          owner.set(...args);
        },
        update: (...args) => {
          observed.writes(...args);
          owner.update(...args);
        },
        dispose: () => {
          observed.events.push('owner');
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
        unmount();
      };
      return root;
    },
  };
});
vi.mock('../../../../../libs/cockpit-runtime-bridge/src/index', () => ({
  installRuntimeBridge: () => ({
    markReady: vi.fn(),
    dispose: () => observed.events.push('bridge'),
  }),
}));

it('the actual entry creates one owner and tears down once in application order', async () => {
  vi.resetModules();
  const element = document.createElement('div');
  element.id = 'root';
  document.body.append(element);
  const add = vi.spyOn(window, 'addEventListener');
  try {
    await act(async () => {
      await import('./main');
    });
    expect(observed.factories).toHaveBeenCalledTimes(1);
    expect(observed.owners).toHaveLength(1);
    const owner = observed.owners[0];
    expect(owner.getSnapshot()).toEqual({
      user: { name: 'Alice', age: 30 },
      settings: { theme: 'dark' },
    });
    expect(observed.writes).not.toHaveBeenCalled();
    act(() => {
      owner.set('/user/age', 42);
      owner.set('/user/name', 'External');
    });
    const age = screen.getByRole('spinbutton', {
      name: 'Age',
    }) as HTMLInputElement;
    expect(age.value).toBe('42');
    expect(
      (screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value
    ).toBe('External');
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(
      screen.getByRole('region', { name: 'Render output' }).textContent
    ).toContain('External');
    fireEvent.change(age, { target: { value: '043' } });
    expect(owner.get('/user/age')).toBe(43);
    expect(observed.writes).toHaveBeenLastCalledWith('/user/age', 43);
    observed.writes.mockClear();
    fireEvent.change(age, { target: { value: '151' } });
    expect(owner.get('/user/age')).toBe(43);
    expect(observed.writes).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new Event('pagehide')));
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(element.childNodes).toHaveLength(0);
    expect(observed.events).toEqual(['playback', 'unmount', 'owner', 'bridge']);
    expect(observed.writes).not.toHaveBeenCalled();
    expect(() => owner.set('/user/age', 44)).toThrow('disposed');
  } finally {
    act(() => window.dispatchEvent(new Event('pagehide')));
    for (const [type, listener, options] of add.mock.calls) {
      if (type === 'pagehide')
        window.removeEventListener(type, listener, options);
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
