import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RenderPendingFallback,
  RenderSpec,
  type ReactRenderRegistry,
  type RenderEvent,
  type RenderSpecData,
  type RenderViewProps,
} from './index';

afterEach(cleanup);

const Label = ({ props }: RenderViewProps) => (
  <p data-testid="label">{String(props['text'])}</p>
);
const Box = ({ children }: RenderViewProps) => <section>{children}</section>;
const bound: RenderSpecData = {
  root: 'label',
  elements: {
    label: { type: 'Label', props: { text: { $state: '/title' } } },
  },
};

describe('default readiness', () => {
  it('shows the default placeholder while a bound prop is undefined, then the component', () => {
    const view = render(
      <RenderSpec spec={bound} registry={{ Label }} state={{}} />
    );
    expect(view.queryByTestId('label')).toBeNull();
    const status = view.getByRole('status');
    expect(status.className).toContain('tp-genui-skeleton');
    expect(status.textContent).toContain('Building UI');
    view.rerender(
      <RenderSpec spec={bound} registry={{ Label }} state={{ title: 'Lyon' }} />
    );
    expect(view.queryByRole('status')).toBeNull();
    expect(view.getByTestId('label').textContent).toBe('Lyon');
  });

  it('latches: a ready element never returns to the placeholder', () => {
    const view = render(
      <RenderSpec spec={bound} registry={{ Label }} state={{ title: 'Lyon' }} />
    );
    const label = view.getByTestId('label');
    view.rerender(<RenderSpec spec={bound} registry={{ Label }} state={{}} />);
    expect(view.queryByRole('status')).toBeNull();
    expect(view.getByTestId('label')).toBe(label);
    expect(label.textContent).toBe('undefined');
  });

  it('mounts an element with only literal or defined props at once', () => {
    const spec: RenderSpecData = {
      root: 'label',
      elements: { label: { type: 'Label', props: { text: 'Plain' } } },
    };
    const view = render(<RenderSpec spec={spec} registry={{ Label }} />);
    expect(view.queryByRole('status')).toBeNull();
    expect(view.getByTestId('label').textContent).toBe('Plain');
  });

  it('gates each repeat row on its own props and latches per row', () => {
    const spec: RenderSpecData = {
      root: 'rows',
      elements: {
        rows: {
          type: 'Box',
          props: {},
          children: ['row'],
          repeat: { statePath: '/rows', key: 'id' },
        },
        row: { type: 'Label', props: { text: { $item: 'text' } } },
      },
    };
    const registry = { Box, Label } satisfies ReactRenderRegistry;
    const view = render(
      <RenderSpec
        spec={spec}
        registry={registry}
        state={{ rows: [{ id: 'a', text: 'A' }, { id: 'b' }] }}
      />
    );
    expect(view.getAllByTestId('label').map((el) => el.textContent)).toEqual([
      'A',
    ]);
    expect(view.getAllByRole('status')).toHaveLength(1);
    view.rerender(
      <RenderSpec
        spec={spec}
        registry={registry}
        state={{ rows: [{ id: 'a' }, { id: 'b', text: 'B' }] }}
      />
    );
    expect(view.queryByRole('status')).toBeNull();
    expect(view.getAllByTestId('label').map((el) => el.textContent)).toEqual([
      'undefined',
      'B',
    ]);
  });

  it('uses a custom pendingFallback with the pending view props', () => {
    const Pending = ({ elementKey, props }: RenderViewProps) => (
      <p>
        waiting {elementKey} {String('text' in props)}
      </p>
    );
    const view = render(
      <RenderSpec
        spec={bound}
        registry={{ Label }}
        state={{}}
        pendingFallback={Pending}
      />
    );
    expect(view.getByText('waiting label true')).toBeTruthy();
    expect(view.queryByRole('status')).toBeNull();
  });

  it('opts out for the tree with pendingFallback null', () => {
    const view = render(
      <RenderSpec
        spec={bound}
        registry={{ Label }}
        state={{}}
        pendingFallback={null}
      />
    );
    expect(view.queryByRole('status')).toBeNull();
    expect(view.getByTestId('label').textContent).toBe('undefined');
  });

  it('opts out for one entry with a readiness entry that is always ready', () => {
    const registry = {
      Label: { kind: 'readiness', component: Label, isReady: () => true },
    } satisfies ReactRenderRegistry;
    const view = render(
      <RenderSpec spec={bound} registry={registry} state={{}} />
    );
    expect(view.queryByRole('status')).toBeNull();
    expect(view.getByTestId('label').textContent).toBe('undefined');
  });

  it('does not gate the fallback for unknown types', () => {
    const spec: RenderSpecData = {
      root: 'x',
      elements: { x: { type: 'Unknown', props: { text: { $state: '/t' } } } },
    };
    const view = render(
      <RenderSpec spec={spec} registry={{}} state={{}} fallback={Label} />
    );
    expect(view.getByTestId('label').textContent).toBe('undefined');
  });

  it('reports the element mounted once, while the placeholder shows, as Angular does', () => {
    const events: RenderEvent[] = [];
    const view = render(
      <RenderSpec
        spec={bound}
        registry={{ Label }}
        state={{}}
        onEvent={(event) => events.push(event)}
      />
    );
    view.rerender(
      <RenderSpec
        spec={bound}
        registry={{ Label }}
        state={{ title: 'Lyon' }}
        onEvent={(event) => events.push(event)}
      />
    );
    const mounts = events.filter(
      (event) =>
        event.type === 'lifecycle' &&
        event.scope === 'element' &&
        event.event === 'mounted'
    );
    expect(mounts).toHaveLength(1);
    expect(view.getByTestId('label').textContent).toBe('Lyon');
  });

  it('exports the default placeholder for reuse', () => {
    const view = render(<RenderPendingFallback elementKey="k" props={{}} />);
    expect(view.getByRole('status').textContent).toContain('Building UI');
  });
});
