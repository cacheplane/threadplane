import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderState } from '@threadplane/content/render-state';
import {
  RenderSpec,
  type ReactRenderRegistry,
  type RenderEvent,
  type RenderSpecData,
  type RenderViewProps,
} from './index';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const Button = ({ props, emit }: RenderViewProps) => (
  <button onClick={() => emit?.('press')}>
    {String(props['label'] ?? '')}
  </button>
);
const Field = ({ props, bindings, set }: RenderViewProps) => (
  <input
    aria-label={String(props['label'] ?? '')}
    value={String(props['value'] ?? '')}
    readOnly={set === undefined}
    onChange={(event) => {
      const path = bindings?.['value'];
      if (path) set?.(path, event.target.value);
    }}
  />
);
const Text = ({ props }: RenderViewProps) => (
  <p>{String(props['text'] ?? '')}</p>
);
const Box = ({ children }: RenderViewProps) => <section>{children}</section>;
const registry: ReactRenderRegistry = { Box, Button, Field, Text };
const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

describe('RenderSpec interaction', () => {
  it('dispatches an element action to the named handler with resolved params', () => {
    const save = vi.fn((_params: object) => 'saved');
    const events: RenderEvent[] = [];
    const spec: RenderSpecData = {
      root: 'save',
      elements: {
        save: {
          type: 'Button',
          props: { label: 'Save' },
          on: {
            press: {
              action: 'save',
              params: { name: { $state: '/name' }, fixed: 1 },
            },
          },
        },
      },
    };
    const view = render(
      <RenderSpec
        spec={spec}
        registry={registry}
        state={{ name: 'Ada' }}
        handlers={{ save }}
        onEvent={(event) => events.push(event)}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith({ name: 'Ada', fixed: 1 });
    expect(Object.isFrozen(save.mock.calls[0][0])).toBe(true);
    expect(events).toEqual([
      {
        type: 'handler',
        action: 'save',
        params: { name: 'Ada', fixed: 1 },
        result: 'saved',
      },
    ]);
  });

  it('does nothing for an event with no binding or an action the application did not supply', () => {
    const known = vi.fn();
    const spec: RenderSpecData = {
      root: 'box',
      elements: {
        box: { type: 'Box', props: {}, children: ['a', 'b'] },
        a: { type: 'Button', props: { label: 'Unbound' } },
        b: {
          type: 'Button',
          props: { label: 'Unknown' },
          on: { press: { action: 'missing' } },
        },
      },
    };
    const view = render(
      <RenderSpec spec={spec} registry={registry} handlers={{ known }} />
    );
    fireEvent.click(view.getByRole('button', { name: 'Unbound' }));
    fireEvent.click(view.getByRole('button', { name: 'Unknown' }));
    expect(known).not.toHaveBeenCalled();
  });

  it('resolves $item params in the row that fired and merges the view payload over them', () => {
    const pick = vi.fn();
    const Row = ({ props, emit }: RenderViewProps) => (
      <button onClick={() => emit?.('press', { source: 'row' })}>
        {String(props['text'])}
      </button>
    );
    const spec: RenderSpecData = {
      root: 'rows',
      elements: {
        rows: {
          type: 'Box',
          props: {},
          children: ['row'],
          repeat: { statePath: '/rows', key: 'id' },
        },
        row: {
          type: 'Row',
          props: { text: { $item: 'text' } },
          on: {
            press: {
              action: 'pick',
              params: { id: { $item: 'id' }, source: 'spec' },
            },
          },
        },
      },
    };
    const view = render(
      <RenderSpec
        spec={spec}
        registry={{ ...registry, Row }}
        state={{
          rows: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        }}
        handlers={{ pick }}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'B' }));
    expect(pick).toHaveBeenCalledWith({ id: 'b', source: 'row' });
  });

  it('runs every binding of an event in order', () => {
    const calls: string[] = [];
    const spec: RenderSpecData = {
      root: 'go',
      elements: {
        go: {
          type: 'Button',
          props: { label: 'Go' },
          on: { press: [{ action: 'first' }, { action: 'second' }] },
        },
      },
    };
    const view = render(
      <RenderSpec
        spec={spec}
        registry={registry}
        handlers={{
          first: () => calls.push('first'),
          second: () => calls.push('second'),
        }}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Go' }));
    expect(calls).toEqual(['first', 'second']);
  });

  it('asks before an action with confirm and skips it when the user declines', () => {
    const remove = vi.fn();
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const spec: RenderSpecData = {
      root: 'remove',
      elements: {
        remove: {
          type: 'Button',
          props: { label: 'Remove' },
          on: {
            press: {
              action: 'remove',
              confirm: { title: 'Remove', message: 'Remove it?' },
            },
          },
        },
      },
    };
    const view = render(
      <RenderSpec spec={spec} registry={registry} handlers={{ remove }} />
    );
    fireEvent.click(view.getByRole('button', { name: 'Remove' }));
    expect(confirm).toHaveBeenCalledWith('Remove it?');
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Remove' }));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('writes bound input edits to a store and re-renders from it', () => {
    const store = createRenderState({ name: 'Ada' });
    const events: RenderEvent[] = [];
    const spec: RenderSpecData = {
      root: 'box',
      elements: {
        box: { type: 'Box', props: {}, children: ['field', 'echo'] },
        field: {
          type: 'Field',
          props: { label: 'Name', value: { $bindState: '/name' } },
        },
        echo: { type: 'Text', props: { text: { $state: '/name' } } },
      },
    };
    const view = render(
      <RenderSpec
        spec={spec}
        registry={registry}
        store={store}
        onEvent={(event) => events.push(event)}
      />
    );
    fireEvent.change(view.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Grace' },
    });
    expect(store.get('/name')).toBe('Grace');
    expect(view.getByText('Grace')).not.toBeNull();
    expect(events).toEqual([
      {
        type: 'stateChange',
        path: '/name',
        value: 'Grace',
        snapshot: { name: 'Grace' },
      },
    ]);
  });

  it('gives views no writer without a store', () => {
    const spec: RenderSpecData = {
      root: 'field',
      elements: {
        field: {
          type: 'Field',
          props: { label: 'Name', value: { $bindState: '/name' } },
        },
      },
    };
    const view = render(
      <RenderSpec spec={spec} registry={registry} state={{ name: 'Ada' }} />
    );
    expect(
      view.getByRole('textbox', { name: 'Name' }).hasAttribute('readonly')
    ).toBe(true);
  });

  it('refuses both state and store at once', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const spec: RenderSpecData = {
      root: 't',
      elements: { t: { type: 'Text', props: {} } },
    };
    expect(() =>
      render(
        // @ts-expect-error state and store are alternatives
        <RenderSpec
          spec={spec}
          registry={registry}
          state={{}}
          store={createRenderState()}
        />
      )
    ).toThrow(/state or a store/);
  });

  it('runs onSuccess set after a handler, and onError set with the error message', async () => {
    const store = createRenderState({ status: 'idle', error: '' });
    const spec: RenderSpecData = {
      root: 'box',
      elements: {
        box: { type: 'Box', props: {}, children: ['ok', 'bad'] },
        ok: {
          type: 'Button',
          props: { label: 'Ok' },
          on: {
            press: {
              action: 'work',
              onSuccess: { set: { '/status': 'done' } },
            },
          },
        },
        bad: {
          type: 'Button',
          props: { label: 'Bad' },
          on: {
            press: {
              action: 'fail',
              onError: { set: { '/error': '$error.message' } },
            },
          },
        },
      },
    };
    const view = render(
      <RenderSpec
        spec={spec}
        registry={registry}
        store={store}
        handlers={{
          work: async () => 'ok',
          fail: async () => {
            throw new Error('Network down');
          },
        }}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Ok' }));
    expect(store.get('/status')).toBe('idle');
    await settle();
    expect(store.get('/status')).toBe('done');
    fireEvent.click(view.getByRole('button', { name: 'Bad' }));
    await settle();
    expect(store.get('/error')).toBe('Network down');
  });

  it('reports an async handler result once it settles', async () => {
    const events: RenderEvent[] = [];
    const spec: RenderSpecData = {
      root: 'go',
      elements: {
        go: {
          type: 'Button',
          props: { label: 'Go' },
          on: { press: { action: 'load' } },
        },
      },
    };
    const view = render(
      <RenderSpec
        spec={spec}
        registry={registry}
        handlers={{ load: async () => 42 }}
        onEvent={(event) => events.push(event)}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Go' }));
    expect(events).toEqual([]);
    await settle();
    expect(events).toEqual([
      { type: 'handler', action: 'load', params: {}, result: 42 },
    ]);
  });

  it('runs an onSuccess and onError follow-up action by name', async () => {
    const after = vi.fn();
    const recover = vi.fn();
    const spec: RenderSpecData = {
      root: 'box',
      elements: {
        box: { type: 'Box', props: {}, children: ['a', 'b'] },
        a: {
          type: 'Button',
          props: { label: 'A' },
          on: { press: { action: 'ok', onSuccess: { action: 'after' } } },
        },
        b: {
          type: 'Button',
          props: { label: 'B' },
          on: { press: { action: 'boom', onError: { action: 'recover' } } },
        },
      },
    };
    const view = render(
      <RenderSpec
        spec={spec}
        registry={registry}
        handlers={{
          ok: () => undefined,
          boom: () => {
            throw new Error('x');
          },
          after,
          recover,
        }}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'A' }));
    fireEvent.click(view.getByRole('button', { name: 'B' }));
    expect(after).toHaveBeenCalledWith({});
    expect(recover).toHaveBeenCalledWith({});
  });

  it('rethrows a handler error when the binding has no onError', () => {
    const spec: RenderSpecData = {
      root: 'go',
      elements: {
        go: {
          type: 'Button',
          props: { label: 'Go' },
          on: { press: { action: 'boom' } },
        },
      },
    };
    let caught: unknown;
    const Catching = ({ props, emit }: RenderViewProps) => (
      <button
        onClick={() => {
          try {
            emit?.('press');
          } catch (error) {
            caught = error;
          }
        }}
      >
        {String(props['label'])}
      </button>
    );
    const view = render(
      <RenderSpec
        spec={spec}
        registry={{ Button: Catching }}
        handlers={{
          boom: () => {
            throw new Error('boom');
          },
        }}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Go' }));
    expect((caught as Error).message).toBe('boom');
  });

  it('navigates on success only to a web or relative address', () => {
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      href: 'https://app.test/start',
      assign,
    } as Location);
    const spec: RenderSpecData = {
      root: 'box',
      elements: {
        box: { type: 'Box', props: {}, children: ['a', 'b'] },
        a: {
          type: 'Button',
          props: { label: 'Docs' },
          on: { press: { action: 'ok', onSuccess: { navigate: '/docs' } } },
        },
        b: {
          type: 'Button',
          props: { label: 'Script' },
          on: {
            press: {
              action: 'ok',
              onSuccess: { navigate: 'javascript:alert(1)' },
            },
          },
        },
      },
    };
    const view = render(
      <RenderSpec
        spec={spec}
        registry={registry}
        handlers={{ ok: () => undefined }}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Docs' }));
    fireEvent.click(view.getByRole('button', { name: 'Script' }));
    expect(assign.mock.calls).toEqual([['https://app.test/docs']]);
  });

  it('reports a view result with its element key', () => {
    const events: RenderEvent[] = [];
    const Picker = ({ result }: RenderViewProps) => (
      <button onClick={() => result?.({ choice: 'yes' })}>Pick</button>
    );
    const spec: RenderSpecData = {
      root: 'picker',
      elements: { picker: { type: 'Picker', props: {} } },
    };
    const view = render(
      <RenderSpec
        spec={spec}
        registry={{ Picker }}
        onEvent={(event) => events.push(event)}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Pick' }));
    expect(events).toEqual([
      { type: 'result', value: { choice: 'yes' }, elementKey: 'picker' },
    ]);
  });

  it('rejects a payload that is not plain data', () => {
    const save = vi.fn();
    let caught: unknown;
    const Leaky = ({ emit }: RenderViewProps) => (
      <button
        onClick={(event) => {
          try {
            emit?.('press', { event } as never);
          } catch (error) {
            caught = error;
          }
        }}
      >
        Leak
      </button>
    );
    const spec: RenderSpecData = {
      root: 'b',
      elements: {
        b: { type: 'Leaky', props: {}, on: { press: { action: 'save' } } },
      },
    };
    const view = render(
      <RenderSpec spec={spec} registry={{ Leaky }} handlers={{ save }} />
    );
    fireEvent.click(view.getByRole('button', { name: 'Leak' }));
    expect(caught).toBeInstanceOf(TypeError);
    expect(save).not.toHaveBeenCalled();
  });

  it('uses the latest handlers without remounting views', () => {
    const first = vi.fn();
    const second = vi.fn();
    const spec: RenderSpecData = {
      root: 'go',
      elements: {
        go: {
          type: 'Button',
          props: { label: 'Go' },
          on: { press: { action: 'run' } },
        },
      },
    };
    const view = render(
      <RenderSpec spec={spec} registry={registry} handlers={{ run: first }} />
    );
    const button = view.getByRole('button', { name: 'Go' });
    view.rerender(
      <RenderSpec spec={spec} registry={registry} handlers={{ run: second }} />
    );
    expect(view.getByRole('button', { name: 'Go' })).toBe(button);
    fireEvent.click(button);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('drops async follow-ups and events after the tree unmounts', async () => {
    const store = createRenderState({ status: 'idle' });
    const events: RenderEvent[] = [];
    let resolve!: () => void;
    const spec: RenderSpecData = {
      root: 'go',
      elements: {
        go: {
          type: 'Button',
          props: { label: 'Go' },
          on: {
            press: {
              action: 'slow',
              onSuccess: { set: { '/status': 'done' } },
            },
          },
        },
      },
    };
    const view = render(
      <RenderSpec
        spec={spec}
        registry={registry}
        store={store}
        handlers={{ slow: () => new Promise<void>((done) => (resolve = done)) }}
        onEvent={(event) => events.push(event)}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Go' }));
    view.unmount();
    resolve();
    await settle();
    expect(store.get('/status')).toBe('idle');
    expect(events).toEqual([]);
  });

  it('gives a readiness fallback no way to act', () => {
    const seen: RenderViewProps[] = [];
    const Fallback = (view: RenderViewProps) => {
      seen.push(view);
      return <p>waiting</p>;
    };
    const spec: RenderSpecData = {
      root: 'b',
      elements: {
        b: {
          type: 'Gated',
          props: { label: 'x' },
          on: { press: { action: 'save' } },
        },
      },
    };
    render(
      <RenderSpec
        spec={spec}
        registry={{
          Gated: {
            kind: 'readiness',
            component: Button,
            isReady: () => false,
            fallback: Fallback,
          },
        }}
        store={createRenderState()}
        handlers={{ save: () => undefined }}
      />
    );
    expect(seen.at(-1)?.emit).toBeUndefined();
    expect(seen.at(-1)?.set).toBeUndefined();
    expect(seen.at(-1)?.result).toBeUndefined();
  });
});
