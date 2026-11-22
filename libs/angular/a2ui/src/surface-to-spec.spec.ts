import { describe, it, expect } from 'vitest';
import type { A2uiSurface, A2uiComponent } from '@threadplane/a2ui';
import { surfaceToSpec } from './surface-to-spec';

function makeSurface(components: A2uiComponent[], dataModel: Record<string, unknown> = {}): A2uiSurface {
  const map = new Map<string, A2uiComponent>();
  for (const c of components) map.set(c.id, c);
  return { surfaceId: 's1', catalogId: 'basic', components: map, dataModel };
}

const c = (comp: Record<string, unknown>): A2uiComponent => comp as unknown as A2uiComponent;

describe('surfaceToSpec (v0.9)', () => {
  it('resolves bare literal prop', () => {
    const surface = makeSurface([
      c({ id: 'root', component: 'Text', text: 'Hi' }),
    ]);
    const spec = surfaceToSpec(surface)!;
    expect(spec.elements['root'].props['text']).toBe('Hi');
  });

  it('leaves path prop as $bindState marker for json-render', () => {
    // Path refs preserve their dynamic resolution: surface-to-spec emits
    // a `$bindState` marker so json-render reads the current value from
    // its state store on every render. This is what enables user input
    // (TextField, ChoicePicker, etc.) to call host.set(path, value)
    // via injectRenderHost() and have the UI reflect those writes
    // immediately.
    const surface = makeSurface(
      [c({ id: 'root', component: 'Text', text: { path: '/greeting' } })],
      { greeting: 'Hello World' },
    );
    const spec = surfaceToSpec(surface)!;
    expect(spec.elements['root'].props['text']).toEqual({ $bindState: '/greeting' });
    // Spec.state seeds the json-render store with the initial value.
    expect(spec.state).toEqual({ greeting: 'Hello World' });
  });

  it('resolves function-call props through the standard registry', () => {
    const surface = makeSurface(
      [c({ id: 'root', component: 'Text', text: { call: 'formatString', args: { value: 'Total: ${/total}' } } })],
      { total: 42 },
    );
    const spec = surfaceToSpec(surface)!;
    expect(spec.elements['root'].props['text']).toBe('Total: 42');
  });

  it('resolves formatCurrency props against the data model', () => {
    const surface = makeSurface(
      [c({ id: 'root', component: 'Text', text: { call: 'formatCurrency', args: { value: { path: '/price' }, currency: 'USD' } } })],
      { price: 10 },
    );
    const spec = surfaceToSpec(surface)!;
    expect(spec.elements['root'].props['text'])
      .toBe(new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(10));
  });

  it('omits props whose function call is unknown', () => {
    const surface = makeSurface([
      c({ id: 'root', component: 'Text', text: { call: 'mysteryFn', args: {} } }),
    ]);
    const spec = surfaceToSpec(surface)!;
    expect('text' in spec.elements['root'].props).toBe(false);
  });

  it('strips protocol base keys from props', () => {
    const surface = makeSurface([
      c({ id: 'root', component: 'Text', text: 'Hi', weight: 2, checks: [{ call: 'required' }] }),
    ]);
    const spec = surfaceToSpec(surface)!;
    expect(spec.elements['root'].props['id']).toBeUndefined();
    expect(spec.elements['root'].props['component']).toBeUndefined();
    expect(spec.elements['root'].props['weight']).toBeUndefined();
    expect(spec.elements['root'].props['checks']).toBeUndefined();
  });

  it('returns null when surface has no components', () => {
    const surface = makeSurface([]);
    expect(surfaceToSpec(surface)).toBeNull();
  });

  it('Card: single child rendered as length-1 children array', () => {
    const surface = makeSurface([
      c({ id: 'root', component: 'Card', child: 'inner' }),
      c({ id: 'inner', component: 'Text', text: 'body' }),
    ]);
    const spec = surfaceToSpec(surface)!;
    expect(spec.elements['root'].children).toEqual(['inner']);
  });

  it('Button: child rendered as length-1 children array', () => {
    const surface = makeSurface([
      c({ id: 'root', component: 'Button', child: 'lbl', action: { event: { name: 'click' } } }),
      c({ id: 'lbl', component: 'Text', text: 'OK' }),
    ]);
    const spec = surfaceToSpec(surface)!;
    expect(spec.elements['root'].children).toEqual(['lbl']);
  });

  it('Column: static children array', () => {
    const surface = makeSurface([
      c({ id: 'root', component: 'Column', children: ['a', 'b'] }),
      c({ id: 'a', component: 'Text', text: 'A' }),
      c({ id: 'b', component: 'Text', text: 'B' }),
    ]);
    const spec = surfaceToSpec(surface)!;
    expect(spec.elements['root'].children).toEqual(['a', 'b']);
  });

  it('List: template expansion over dataModel array', () => {
    const surface = makeSurface(
      [
        c({ id: 'root', component: 'List', children: { componentId: 'item', path: '/items' } }),
        // Relative path 'name' is resolved against each item's basePath (/items/0, /items/1)
        c({ id: 'item', component: 'Text', text: { path: 'name' } }),
      ],
      { items: [{ name: 'Alice' }, { name: 'Bob' }] },
    );
    const spec = surfaceToSpec(surface)!;
    expect(spec.elements['root'].children).toEqual(['item__0', 'item__1']);
    expect(spec.elements['item__0'].props['text']).toBe('Alice');
    expect(spec.elements['item__1'].props['text']).toBe('Bob');
  });

  it('Modal: trigger + content as children array', () => {
    const surface = makeSurface([
      c({ id: 'root', component: 'Modal', trigger: 'trigger', content: 'body' }),
      c({ id: 'trigger', component: 'Button', child: 'lbl', action: { event: { name: 'open' } } }),
      c({ id: 'body', component: 'Text', text: 'content' }),
      c({ id: 'lbl', component: 'Text', text: 'Open' }),
    ]);
    const spec = surfaceToSpec(surface)!;
    expect(spec.elements['root'].children).toEqual(['trigger', 'body']);
  });

  it('Tabs: tabs[].child children + resolved tabTitles', () => {
    const surface = makeSurface([
      c({ id: 'root', component: 'Tabs', tabs: [
        { title: 'Tab 1', child: 'panel1' },
        { title: 'Tab 2', child: 'panel2' },
      ] }),
      c({ id: 'panel1', component: 'Text', text: 'Panel 1' }),
      c({ id: 'panel2', component: 'Text', text: 'Panel 2' }),
    ]);
    const spec = surfaceToSpec(surface)!;
    expect(spec.elements['root'].children).toEqual(['panel1', 'panel2']);
    expect(spec.elements['root'].props['tabTitles']).toEqual(['Tab 1', 'Tab 2']);
  });

  it('maps Button event action to spec on.click binding', () => {
    const surface = makeSurface([
      c({ id: 'root', component: 'Column', children: ['btn'] }),
      c({
        id: 'btn', component: 'Button', child: 'lbl',
        action: { event: { name: 'formSubmit', context: { formId: 'signup' } } },
      }),
      c({ id: 'lbl', component: 'Text', text: 'Submit' }),
    ]);
    const spec = surfaceToSpec(surface)!;
    const btnElement = spec.elements['btn'];
    expect(btnElement.on).toBeDefined();
    expect(btnElement.on!['click']).toEqual({
      action: 'a2ui:event',
      params: { surfaceId: 's1', sourceComponentId: 'btn', name: 'formSubmit', context: { formId: 'signup' } },
    });
  });

  it('keeps action context path bindings as live $bindState markers', () => {
    // The surface component substitutes the CURRENT store value at dispatch
    // time so user edits reach the agent (build-time resolution would freeze
    // the agent-seeded snapshot).
    const surface = makeSurface(
      [
        c({ id: 'root', component: 'Column', children: ['btn'] }),
        c({
          id: 'btn', component: 'Button', child: 'lbl',
          action: { event: { name: 'submit', context: { email: { path: '/email' }, formId: 'signup' } } },
        }),
        c({ id: 'lbl', component: 'Text', text: 'Go' }),
      ],
      { email: 'alice@example.com' },
    );
    const spec = surfaceToSpec(surface)!;
    const params = spec.elements['btn'].on!['click'].params;
    expect(params['context']).toEqual({ email: { $bindState: '/email' }, formId: 'signup' });
  });

  it('adds errorText bindings + state seeds for checkable components', () => {
    const surface = makeSurface(
      [c({
        id: 'root', component: 'TextField', label: 'Email', value: { path: '/email' },
        checks: [{ condition: { call: 'email', args: { value: { path: '/email' } } }, message: 'Invalid email' }],
      })],
      { email: '' },
    );
    const spec = surfaceToSpec(surface)!;
    expect(spec.elements['root'].props['errorText']).toEqual({ $bindState: '/_a2uiChecks/root' });
    expect((spec.state as Record<string, Record<string, unknown>>)['_a2uiChecks']).toEqual({ root: '' });
  });

  it('functionCall actions wire to the local-action handler', () => {
    const surface = makeSurface([
      c({ id: 'root', component: 'Button', child: 'lbl',
        action: { functionCall: { call: 'openUrl', args: { url: 'https://x' } } } }),
      c({ id: 'lbl', component: 'Text', text: 'Open' }),
    ]);
    const spec = surfaceToSpec(surface)!;
    expect(spec.elements['root'].on!['click']).toEqual({
      action: 'a2ui:localAction',
      params: { call: 'openUrl', args: { url: 'https://x' } },
    });
  });

  it('passes through elements without actions unchanged', () => {
    const surface = makeSurface([
      c({ id: 'root', component: 'Text', text: 'Hello' }),
    ]);
    const spec = surfaceToSpec(surface)!;
    expect(spec.elements['root'].on).toBeUndefined();
  });

  it('initializes spec state from surface dataModel', () => {
    const surface = makeSurface(
      [c({ id: 'root', component: 'Text', text: 'Hi' })],
      { count: 0, name: 'test' },
    );
    const spec = surfaceToSpec(surface)!;
    expect(spec.state).toEqual({ count: 0, name: 'test' });
  });

  it('attaches _bindings prop for path ref values', () => {
    const surface = makeSurface(
      [c({ id: 'root', component: 'TextField', label: 'Name', value: { path: '/name' } })],
      { name: 'Alice' },
    );
    const spec = surfaceToSpec(surface)!;
    // Path refs become $bindState markers (see "leaves path prop" test
    // above). _bindings still maps prop name → path so catalog components
    // can call host.set(path, value) via injectRenderHost() on user input.
    expect(spec.elements['root'].props['value']).toEqual({ $bindState: '/name' });
    expect(spec.elements['root'].props['_bindings']).toEqual({ value: '/name' });
  });

  it('does not attach _bindings for literal values', () => {
    const surface = makeSurface([
      c({ id: 'root', component: 'Text', text: 'Hello' }),
    ]);
    const spec = surfaceToSpec(surface)!;
    expect(spec.elements['root'].props['_bindings']).toBeUndefined();
  });

  it('ChoicePicker: options labels resolved to plain strings', () => {
    const surface = makeSurface(
      [c({ id: 'root', component: 'ChoicePicker', value: { path: '/picked' }, options: [
        { label: 'A', value: 'a' },
        { label: { path: '/labels/b' }, value: 'b' },
      ] })],
      { picked: [], labels: { b: 'Bee' } },
    );
    const spec = surfaceToSpec(surface)!;
    expect(spec.elements['root'].props['options']).toEqual([
      { label: 'A', value: 'a' },
      { label: 'Bee', value: 'b' },
    ]);
  });

  it('uses first component as root when no root component exists', () => {
    const surface = makeSurface([
      c({ id: 'child', component: 'Text', text: 'No root' }),
    ]);
    const spec = surfaceToSpec(surface)!;
    expect(spec.root).toBe('child');
  });
});
