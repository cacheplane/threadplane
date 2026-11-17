import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRenderState } from '@threadplane/content/render-state';
import {
  RenderSpec,
  type ReactRenderRegistry,
  type RenderEvent,
  type RenderSpecData,
  type RenderViewProps,
} from './index';

afterEach(cleanup);

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
const Button = ({ props, emit }: RenderViewProps) => (
  <button onClick={() => emit?.('press')}>
    {String(props['label'] ?? '')}
  </button>
);
const Box = ({ children }: RenderViewProps) => <section>{children}</section>;
const registry: ReactRenderRegistry = { Box, Button, Field, Text };

function form(state?: RenderSpecData['state']): RenderSpecData {
  return {
    root: 'box',
    elements: {
      box: { type: 'Box', props: {}, children: ['name', 'echo', 'save'] },
      name: {
        type: 'Field',
        props: { label: 'Name', value: { $bindState: '/name' } },
      },
      echo: { type: 'Text', props: { text: { $state: '/status' } } },
      save: {
        type: 'Button',
        props: { label: 'Save' },
        on: { press: { action: 'save', onSuccess: { set: { '/status': 'Saved' } } } },
      },
    },
    ...(state === undefined ? {} : { state }),
  };
}

const field = (view: ReturnType<typeof render>) =>
  view.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;

describe('RenderSpec state carried by the spec', () => {
  it('seeds a writable store from spec.state when no state or store is passed', () => {
    const events: RenderEvent[] = [];
    const view = render(
      <RenderSpec
        spec={form({ name: 'Ada', status: 'Draft' })}
        registry={registry}
        handlers={{ save: () => undefined }}
        onEvent={(event) => events.push(event)}
      />
    );
    expect(field(view).value).toBe('Ada');
    expect(field(view).readOnly).toBe(false);
    fireEvent.change(field(view), { target: { value: 'Grace' } });
    expect(field(view).value).toBe('Grace');
    expect(events).toContainEqual({
      type: 'stateChange',
      path: '/name',
      value: 'Grace',
      snapshot: { name: 'Grace', status: 'Draft' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Save' }));
    expect(view.getByText('Saved')).toBeTruthy();
  });

  it('keeps the seeded store when a later spec carries different state', () => {
    const view = render(
      <RenderSpec spec={form({ name: 'Ada' })} registry={registry} />
    );
    fireEvent.change(field(view), { target: { value: 'Grace' } });
    view.rerender(
      <RenderSpec spec={form({ name: 'Linus' })} registry={registry} />
    );
    expect(field(view).value).toBe('Grace');
  });

  it('seeds the store when state first appears in a later spec', () => {
    const view = render(<RenderSpec spec={form()} registry={registry} />);
    expect(field(view).readOnly).toBe(true);
    view.rerender(
      <RenderSpec spec={form({ name: 'Ada' })} registry={registry} />
    );
    expect(field(view).value).toBe('Ada');
    expect(field(view).readOnly).toBe(false);
  });

  it('stays read-only for a spec without state', () => {
    const view = render(<RenderSpec spec={form()} registry={registry} />);
    expect(field(view).value).toBe('');
    expect(field(view).readOnly).toBe(true);
  });

  it('lets the state prop win, read-only, over spec.state', () => {
    const view = render(
      <RenderSpec
        spec={form({ name: 'Ada' })}
        registry={registry}
        state={{ name: 'Prop' }}
      />
    );
    expect(field(view).value).toBe('Prop');
    expect(field(view).readOnly).toBe(true);
  });

  it('lets a supplied store win over spec.state', () => {
    const store = createRenderState({ name: 'Store' });
    const view = render(
      <RenderSpec
        spec={form({ name: 'Ada' })}
        registry={registry}
        store={store}
      />
    );
    expect(field(view).value).toBe('Store');
    fireEvent.change(field(view), { target: { value: 'Grace' } });
    expect(store.getSnapshot()).toEqual({ name: 'Grace' });
  });

  it('does not write into the spec object it was given', () => {
    const spec = form({ name: 'Ada' });
    const view = render(<RenderSpec spec={spec} registry={registry} />);
    fireEvent.change(field(view), { target: { value: 'Grace' } });
    expect(spec.state).toEqual({ name: 'Ada' });
  });
});
