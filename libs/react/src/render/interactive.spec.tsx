import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RenderSpec,
  type ReactRenderRegistry,
  type RenderSpecData,
  type RenderValue,
  type RenderViewProps,
} from './index';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const Button = ({ props, emit }: RenderViewProps) => (
  <button type="button" onClick={() => emit('press', { clicked: true })}>
    {String(props['label'])}
  </button>
);
const Input = ({ props, setValue }: RenderViewProps) => (
  <input
    aria-label="Value"
    value={String(props['value'] ?? '')}
    onChange={(event) => setValue('value', event.target.value)}
  />
);
const Text = ({ props }: RenderViewProps) => <p>{String(props['text'])}</p>;
const List = ({ children }: RenderViewProps) => <ul>{children}</ul>;
const registry: ReactRenderRegistry = { Button, Input, Text, List };
const button = (on: unknown, label = 'Go'): RenderSpecData =>
  ({
    root: 'root',
    elements: { root: { type: 'Button', props: { label }, on } },
  } as unknown as RenderSpecData);
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('interactive RenderSpec', () => {
  it('calls the named handler with resolved params and the payload', () => {
    const save = vi.fn();
    const view = render(
      <RenderSpec
        spec={button({
          press: {
            action: 'save',
            params: { id: { $state: '/item/id' }, clicked: false, fixed: 'x' },
          },
        })}
        registry={registry}
        state={{ item: { id: 7 } }}
        handlers={{ save }}
      />
    );
    fireEvent.click(view.getByRole('button'));
    expect(save).toHaveBeenCalledTimes(1);
    const params = save.mock.calls[0][0];
    expect(params).toEqual({ id: 7, clicked: true, fixed: 'x' });
    expect(Object.isFrozen(params)).toBe(true);
  });

  it('does nothing without handlers, for an unlisted action, or an undeclared event', () => {
    const other = vi.fn();
    const spec = button({ press: { action: 'save' }, hover: { action: 'other' } });
    const plain = render(<RenderSpec spec={spec} registry={registry} />);
    fireEvent.click(plain.getByRole('button'));
    plain.unmount();
    const listed = render(<RenderSpec spec={spec} registry={registry} handlers={{ other }} />);
    fireEvent.click(listed.getByRole('button'));
    expect(other).not.toHaveBeenCalled();
  });

  it('cannot reach inherited names through an action', () => {
    const view = render(
      <RenderSpec
        spec={button([{ action: 'constructor' }, { action: 'toString' }, { action: '__proto__' }])}
        registry={registry}
        handlers={{}}
      />
    );
    expect(() => fireEvent.click(view.getByRole('button'))).not.toThrow();
  });

  it('runs several bindings in order and uses the latest handlers', () => {
    const calls: string[] = [];
    const spec = button({ press: [{ action: 'first' }, { action: 'second' }] });
    const handlers = (tag: string) => ({
      first: () => void calls.push(`first:${tag}`),
      second: () => void calls.push(`second:${tag}`),
    });
    const view = render(<RenderSpec spec={spec} registry={registry} handlers={handlers('a')} />);
    fireEvent.click(view.getByRole('button'));
    view.rerender(<RenderSpec spec={spec} registry={registry} handlers={handlers('b')} />);
    fireEvent.click(view.getByRole('button'));
    expect(calls).toEqual(['first:a', 'second:a', 'first:b', 'second:b']);
  });

  it('resolves params in the repeated row that fired', () => {
    const remove = vi.fn();
    const spec = {
      root: 'list',
      elements: {
        list: { type: 'List', props: {}, repeat: { statePath: '/rows', key: 'id' }, children: ['row'] },
        row: {
          type: 'Button',
          props: { label: { $item: 'name' } },
          on: { press: { action: 'remove', params: { id: { $item: 'id' }, at: { $index: true } } } },
        },
      },
    } as unknown as RenderSpecData;
    const view = render(
      <RenderSpec
        spec={spec}
        registry={registry}
        state={{ rows: [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bo' }] }}
        handlers={{ remove }}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Bo' }));
    expect(remove).toHaveBeenCalledWith({ id: 'b', at: 1, clicked: true });
  });

  it('asks before a binding that needs confirmation', () => {
    const erase = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const view = render(
      <RenderSpec
        spec={button({ press: { action: 'erase', confirm: { title: 'Erase', message: 'Erase everything?' } } })}
        registry={registry}
        handlers={{ erase }}
      />
    );
    fireEvent.click(view.getByRole('button'));
    expect(confirm).toHaveBeenCalledWith('Erase everything?');
    expect(erase).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button'));
    expect(erase).toHaveBeenCalledTimes(1);
  });

  it('writes state after success and the error message after failure', async () => {
    const changes: [string, RenderValue][] = [];
    const onStateChange = (path: string, value: RenderValue) => void changes.push([path, value]);
    const spec = button({
      press: [
        { action: 'ok', onSuccess: { set: { '/status': 'saved', '/count': 2 } } },
        { action: 'later', onSuccess: { set: { '/later': true } } },
        { action: 'bad', onError: { set: { '/error': '$error.message', '/failed': true } } },
        { action: 'rejects', onError: { set: { '/error': '$error.message' } } },
      ],
    });
    const view = render(
      <RenderSpec
        spec={spec}
        registry={registry}
        onStateChange={onStateChange}
        handlers={{
          ok: () => 'done',
          later: async () => 'done',
          bad: () => {
            throw new Error('Out of stock');
          },
          rejects: async () => {
            throw new Error('Offline');
          },
        }}
      />
    );
    fireEvent.click(view.getByRole('button'));
    expect(changes).toEqual([
      ['/status', 'saved'],
      ['/count', 2],
      ['/error', 'Out of stock'],
      ['/failed', true],
    ]);
    await flush();
    expect(changes.slice(4)).toEqual([
      ['/later', true],
      ['/error', 'Offline'],
    ]);
  });

  it('chains a follow-up action and rethrows a failure nobody handles', () => {
    const next = vi.fn();
    const chained = render(
      <RenderSpec
        spec={button({ press: { action: 'first', onSuccess: { action: 'next' } } })}
        registry={registry}
        handlers={{ first: () => 1, next }}
      />
    );
    fireEvent.click(chained.getByRole('button'));
    expect(next).toHaveBeenCalledWith({});
    chained.unmount();
    let thrown: unknown;
    const Catching = ({ props, emit }: RenderViewProps) => (
      <button
        type="button"
        onClick={() => {
          try {
            emit('press');
          } catch (error) {
            thrown = error;
          }
        }}
      >
        {String(props['label'])}
      </button>
    );
    const view = render(
      <RenderSpec
        spec={button({ press: { action: 'bad' } })}
        registry={{ Button: Catching }}
        handlers={{
          bad: () => {
            throw new Error('Unhandled');
          },
        }}
      />
    );
    fireEvent.click(view.getByRole('button'));
    expect((thrown as Error).message).toBe('Unhandled');
  });

  it('navigates after success, and only when a listed handler ran', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const done = vi.fn();
    const spec = button({
      press: [
        { action: 'unlisted', onSuccess: { navigate: 'https://example.test/unlisted' } },
        { action: 'done', onSuccess: { navigate: 'https://example.test/next' } },
      ],
    });
    const plain = render(<RenderSpec spec={spec} registry={registry} />);
    fireEvent.click(plain.getByRole('button'));
    expect(assign).not.toHaveBeenCalled();
    plain.unmount();
    const view = render(<RenderSpec spec={spec} registry={registry} handlers={{ done }} />);
    fireEvent.click(view.getByRole('button'));
    await flush();
    expect(done).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('https://example.test/next');
    vi.unstubAllGlobals();
  });

  it('navigates from an error follow-up and ignores a target that is not a string', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const view = render(
      <RenderSpec
        spec={button({
          press: [
            { action: 'ok', onSuccess: { navigate: 7 } },
            { action: 'bad', onError: { navigate: '/help' } },
          ],
        })}
        registry={registry}
        handlers={{
          ok: () => 1,
          bad: () => {
            throw new Error('Failed');
          },
        }}
      />
    );
    fireEvent.click(view.getByRole('button'));
    expect(assign.mock.calls).toEqual([['/help']]);
    vi.unstubAllGlobals();
  });

  it('drops a follow-up that settles after unmount', async () => {
    const onStateChange = vi.fn();
    let finish!: () => void;
    const view = render(
      <RenderSpec
        spec={button({ press: { action: 'slow', onSuccess: { set: { '/done': true } } } })}
        registry={registry}
        onStateChange={onStateChange}
        handlers={{ slow: () => new Promise<void>((resolve) => (finish = resolve)) }}
      />
    );
    fireEvent.click(view.getByRole('button'));
    view.unmount();
    finish();
    await flush();
    expect(onStateChange).not.toHaveBeenCalled();
  });

  it('lets a view write a bound prop through the app-owned state', () => {
    const seen: [string, RenderValue][] = [];
    const spec = {
      root: 'root',
      elements: {
        root: { type: 'List', props: {}, children: ['field', 'echo'] },
        field: { type: 'Input', props: { value: { $bindState: '/form/name' } } },
        echo: { type: 'Text', props: { text: { $state: '/form/name' } } },
      },
    } as unknown as RenderSpecData;
    function App() {
      const [state, setState] = useState({ form: { name: 'Ada' } });
      return (
        <RenderSpec
          spec={spec}
          registry={registry}
          state={state}
          onStateChange={(path, value) => {
            seen.push([path, value]);
            if (path === '/form/name') setState({ form: { name: String(value) } });
          }}
        />
      );
    }
    const view = render(
      <StrictMode>
        <App />
      </StrictMode>
    );
    fireEvent.change(view.getByLabelText('Value'), { target: { value: 'Grace' } });
    expect(seen).toEqual([['/form/name', 'Grace']]);
    expect((view.getByLabelText('Value') as HTMLInputElement).value).toBe('Grace');
    expect(view.getByText('Grace')).toBeTruthy();
  });

  it('writes nothing for an unbound prop, without a callback, or for data that is not plain', () => {
    const onStateChange = vi.fn();
    let rejected: unknown;
    const Probe = ({ setValue }: RenderViewProps) => (
      <>
        <button type="button" onClick={() => setValue('label', 'x')}>unbound</button>
        <button
          type="button"
          onClick={() => {
            try {
              setValue('value', new Date() as unknown as RenderValue);
            } catch (error) {
              rejected = error;
            }
          }}
        >
          bad
        </button>
        <button type="button" onClick={() => setValue('value', 'ok')}>bound</button>
      </>
    );
    const spec = {
      root: 'root',
      elements: { root: { type: 'Probe', props: { label: 'L', value: { $bindState: '/v' } } } },
    } as unknown as RenderSpecData;
    const silent = render(<RenderSpec spec={spec} registry={{ Probe }} />);
    fireEvent.click(silent.getByRole('button', { name: 'bound' }));
    silent.unmount();
    const view = render(<RenderSpec spec={spec} registry={{ Probe }} onStateChange={onStateChange} />);
    fireEvent.click(view.getByRole('button', { name: 'unbound' }));
    fireEvent.click(view.getByRole('button', { name: 'bad' }));
    expect(rejected).toBeInstanceOf(TypeError);
    expect(onStateChange).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'bound' }));
    expect(onStateChange).toHaveBeenCalledWith('/v', 'ok');
  });
});
