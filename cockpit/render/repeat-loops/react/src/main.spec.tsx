import { act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { RenderState } from '@threadplane/content/render-state';
import type { RepeatDemo } from './app';
import { createItems } from './items';

const observed = vi.hoisted(() => ({
  events: [] as string[],
  owners: [] as RenderState[],
  factories: vi.fn(),
  render: vi.fn(),
  unmount: vi.fn(),
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
      const playback = actual.createPlayback(...args),
        dispose = playback.dispose;
      playback.dispose = () => {
        observed.events.push('playback');
        dispose();
      };
      return playback;
    },
  };
});
vi.mock('react-dom/client', () => ({
  createRoot: () => ({
    render: observed.render,
    unmount: () => {
      observed.events.push('unmount');
      observed.unmount();
    },
  }),
}));
vi.mock('../../../../../libs/cockpit-runtime-bridge/src/index', () => ({
  installRuntimeBridge: () => ({
    markReady: vi.fn(),
    dispose: () => observed.events.push('bridge'),
  }),
}));

it('the actual entry owns one external seed, forwards stable borrowing and commands, and disposes once in order', async () => {
  vi.resetModules();
  const element = document.createElement('div');
  element.id = 'root';
  document.body.append(element);
  const add = vi.spyOn(window, 'addEventListener');
  try {
    await import('./main');
    expect(observed.factories).toHaveBeenCalledExactlyOnceWith(createItems());
    expect(observed.render).toHaveBeenCalledTimes(1);
    const owner = observed.owners[0];
    const app = observed.render.mock.calls[0][0] as ReactElement<
      Parameters<typeof RepeatDemo>[0]
    >;
    expect(app.props.renderState.getSnapshot).toBe(owner.getSnapshot);
    expect(app.props.renderState.subscribe).toBe(owner.subscribe);
    expect(app.props.renderState.getSnapshot()).toBe(owner.getSnapshot());
    const notify = vi.fn();
    const release = app.props.renderState.subscribe(notify);
    owner.update({
      '/items': [{ id: 'external', label: 'External' }],
      '/nextId': 7,
    });
    expect(app.props.renderState.getSnapshot()).toBe(owner.getSnapshot());
    app.props.commands.add();
    expect(owner.getSnapshot()).toEqual({
      items: [
        { id: 'external', label: 'External' },
        { id: 'item-7', label: 'Item 7' },
      ],
      nextId: 8,
    });
    app.props.commands.reverse();
    app.props.commands.remove('external');
    expect(owner.getSnapshot()).toEqual({
      items: [{ id: 'item-7', label: 'Item 7' }],
      nextId: 8,
    });
    expect(notify).toHaveBeenCalledTimes(4);
    release();
    act(() => window.dispatchEvent(new Event('pagehide')));
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(observed.events).toEqual(['playback', 'unmount', 'owner', 'bridge']);
    expect(observed.unmount).toHaveBeenCalledTimes(1);
    expect(() => owner.set('/nextId', 9)).toThrow('disposed');
  } finally {
    act(() => window.dispatchEvent(new Event('pagehide')));
    for (const [type, listener, options] of add.mock.calls)
      if (type === 'pagehide')
        window.removeEventListener(type, listener, options);
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
