import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderState } from '@threadplane/content/render-state';
import {
  createRenderLifecycle,
  RenderSpec,
  type ReactRenderRegistry,
  type RenderEvent,
  type RenderLifecycleEvent,
  type RenderSpecData,
  type RenderViewProps,
} from './index';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const Text = ({ props }: RenderViewProps) => (
  <p>{String(props['text'] ?? '')}</p>
);
const Note = ({ props }: RenderViewProps) => (
  <em>{String(props['text'] ?? '')}</em>
);
const Box = ({ children }: RenderViewProps) => <section>{children}</section>;
const Button = ({ props, emit }: RenderViewProps) => (
  <button onClick={() => emit?.('press')}>
    {String(props['label'] ?? '')}
  </button>
);
const registry: ReactRenderRegistry = { Box, Button, Note, Text };

const lifecycle = (events: RenderEvent[]) =>
  events
    .filter((event): event is RenderLifecycleEvent => event.type === 'lifecycle')
    .map(({ event, scope, elementKey, elementType }) =>
      scope === 'spec'
        ? `${event} spec`
        : `${event} ${elementKey}:${elementType}`
    );

const page: RenderSpecData = {
  root: 'box',
  elements: {
    box: { type: 'Box', props: {}, children: ['title', 'body'] },
    title: { type: 'Text', props: { text: 'Title' } },
    body: { type: 'Text', props: { text: 'Body' } },
  },
};

describe('RenderSpec lifecycle events', () => {
  it('reports each element and then the tree mounting', () => {
    const events: RenderEvent[] = [];
    render(
      <RenderSpec
        spec={page}
        registry={registry}
        onEvent={(event) => events.push(event)}
      />
    );
    expect(lifecycle(events)).toEqual([
      'mounted title:Text',
      'mounted body:Text',
      'mounted box:Box',
      'mounted spec',
    ]);
  });

  it('reports the tree and every element leaving when it unmounts', () => {
    const events: RenderEvent[] = [];
    const view = render(
      <RenderSpec
        spec={page}
        registry={registry}
        onEvent={(event) => events.push(event)}
      />
    );
    events.length = 0;
    view.unmount();
    expect(lifecycle(events).sort()).toEqual(
      [
        'destroyed spec',
        'destroyed box:Box',
        'destroyed title:Text',
        'destroyed body:Text',
      ].sort()
    );
  });

  it('mounts a hidden element only when it becomes visible, and reports it leaving when hidden again', () => {
    const events: RenderEvent[] = [];
    const store = createRenderState({ show: false });
    const spec: RenderSpecData = {
      root: 'box',
      elements: {
        box: { type: 'Box', props: {}, children: ['detail'] },
        detail: {
          type: 'Text',
          props: { text: 'Detail' },
          visible: { $state: '/show' },
        },
      },
    };
    render(
      <RenderSpec
        spec={spec}
        registry={registry}
        store={store}
        onEvent={(event) => events.push(event)}
      />
    );
    expect(lifecycle(events)).toEqual(['mounted box:Box', 'mounted spec']);
    events.length = 0;
    act(() => store.set('/show', true));
    expect(lifecycle(events)).toEqual(['mounted detail:Text']);
    events.length = 0;
    act(() => store.set('/show', false));
    expect(lifecycle(events)).toEqual(['destroyed detail:Text']);
  });

  it('reports a replaced element type as one leaving and another mounting', () => {
    const events: RenderEvent[] = [];
    const first: RenderSpecData = {
      root: 'item',
      elements: { item: { type: 'Text', props: { text: 'A' } } },
    };
    const second: RenderSpecData = {
      root: 'item',
      elements: { item: { type: 'Note', props: { text: 'B' } } },
    };
    const view = render(
      <RenderSpec
        spec={first}
        registry={registry}
        onEvent={(event) => events.push(event)}
      />
    );
    events.length = 0;
    view.rerender(
      <RenderSpec
        spec={second}
        registry={registry}
        onEvent={(event) => events.push(event)}
      />
    );
    expect(lifecycle(events)).toEqual([
      'destroyed item:Text',
      'mounted item:Note',
    ]);
  });

  it('reports one mount for each repeated row', () => {
    const events: RenderEvent[] = [];
    const spec: RenderSpecData = {
      root: 'list',
      elements: {
        list: {
          type: 'Box',
          props: {},
          repeat: { statePath: '/items', key: 'id' },
          children: ['row'],
        },
        row: { type: 'Text', props: { text: { $item: 'name' } } },
      },
    };
    render(
      <RenderSpec
        spec={spec}
        registry={registry}
        state={{ items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }}
        onEvent={(event) => events.push(event)}
      />
    );
    expect(lifecycle(events).filter((entry) => entry.includes('row'))).toEqual(
      ['mounted row:Text', 'mounted row:Text']
    );
  });

  it('does not report a mount for an unregistered element type', () => {
    const events: RenderEvent[] = [];
    render(
      <RenderSpec
        spec={{
          root: 'missing',
          elements: { missing: { type: 'Unknown', props: {} } },
        }}
        registry={registry}
        onEvent={(event) => events.push(event)}
      />
    );
    expect(lifecycle(events)).toEqual(['mounted spec']);
  });
});

describe('createRenderLifecycle', () => {
  it('records the first mount, mount count and latest mount time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const recorder = createRenderLifecycle();
    expect(recorder.getSnapshot()).toEqual({
      firstMountAt: null,
      mountCount: 0,
      lastMountAt: null,
      lastStateChangeAt: null,
      lastHandlerInvokedAt: null,
    });
    const view = render(
      <RenderSpec spec={page} registry={registry} onEvent={recorder.onEvent} />
    );
    expect(recorder.getSnapshot()).toMatchObject({
      firstMountAt: { kind: 'element', elementType: 'Text', at: 1000 },
      mountCount: 4,
      lastMountAt: 1000,
    });
    vi.setSystemTime(2000);
    view.unmount();
    expect(recorder.getSnapshot()).toMatchObject({
      mountCount: 4,
      lastMountAt: 1000,
    });
    expect(Object.isFrozen(recorder.getSnapshot())).toBe(true);
  });

  it('records the latest state change and action', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const recorder = createRenderLifecycle();
    const store = createRenderState({ count: 0 });
    const view = render(
      <RenderSpec
        spec={{
          root: 'add',
          elements: {
            add: {
              type: 'Button',
              props: { label: 'Add' },
              on: {
                press: {
                  action: 'add',
                  onSuccess: { set: { '/count': 1 } },
                },
              },
            },
          },
        }}
        registry={registry}
        store={store}
        handlers={{ add: () => undefined }}
        onEvent={recorder.onEvent}
      />
    );
    vi.setSystemTime(5000);
    fireEvent.click(view.getByRole('button', { name: 'Add' }));
    expect(recorder.getSnapshot()).toMatchObject({
      lastHandlerInvokedAt: { action: 'add', at: 5000 },
      lastStateChangeAt: 5000,
    });
  });

  it('notifies subscribers on a change and stops after unsubscribe', () => {
    const recorder = createRenderLifecycle();
    const listener = vi.fn();
    const stop = recorder.subscribe(listener);
    const before = recorder.getSnapshot();
    recorder.onEvent({ type: 'lifecycle', event: 'mounted', scope: 'spec' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(recorder.getSnapshot()).not.toBe(before);
    recorder.onEvent({ type: 'lifecycle', event: 'destroyed', scope: 'spec' });
    recorder.onEvent({ type: 'result', value: 1, elementKey: 'x' });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    recorder.onEvent({ type: 'lifecycle', event: 'mounted', scope: 'spec' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(recorder.getSnapshot().mountCount).toBe(2);
  });
});
