import { useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createA2uiSurfaces, type A2uiActionMessage, type A2uiSurfaces, type A2uiValidationErrorMessage } from '@threadplane/content/a2ui';
import { A2uiSurface, type A2uiSurfaceProps } from '../index';

afterEach(cleanup);

type Message = Parameters<A2uiSurfaces['apply']>[0];
function store(components: readonly Record<string, unknown>[], data: unknown = {}) {
  const surfaces = createA2uiSurfaces();
  for (const message of [
    { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'basic' } },
    { version: 'v0.9', updateComponents: { surfaceId: 's', components } },
    { version: 'v0.9', updateDataModel: { surfaceId: 's', value: data } },
  ])
    surfaces.apply(message as unknown as Message);
  return surfaces;
}
function Host({ surfaces, ...props }: { surfaces: A2uiSurfaces } & Omit<A2uiSurfaceProps, 'surface' | 'surfaces'>) {
  const snapshot = useSyncExternalStore(surfaces.subscribe, surfaces.getSnapshot, surfaces.getSnapshot);
  return <A2uiSurface surface={snapshot.surfaces[0]} surfaces={surfaces} {...props} />;
}
const set = (surfaces: A2uiSurfaces, path: string, value: unknown) =>
  act(() => surfaces.apply({ version: 'v0.9', updateDataModel: { surfaceId: 's', path, value } } as unknown as Message));
const legs: readonly Record<string, unknown>[] = [
  { id: 'root', component: 'Column', children: ['title', 'list', 'send'] },
  { id: 'title', component: 'Text', text: 'Legs' },
  { id: 'list', component: 'List', children: { path: '/legs', componentId: 'leg' } },
  { id: 'leg', component: 'Row', children: ['line', 'seat', 'pick', 'open'] },
  { id: 'line', component: 'Text', text: { call: 'formatString', args: { value: '${from} to ${to} (${/carrier})' } } },
  {
    id: 'seat',
    component: 'TextField',
    label: { path: 'from' },
    value: { path: 'seat' },
    checks: [{ condition: { call: 'required', args: { value: { path: 'seat' } } }, message: 'Pick a seat' }],
  },
  { id: 'pick', component: 'Button', child: 'pick-label', action: { event: { name: 'pick', context: { from: { path: 'from' }, seat: { path: 'seat' } } } } },
  { id: 'pick-label', component: 'Text', text: { path: 'to' } },
  { id: 'open', component: 'Button', child: 'open-label', action: { functionCall: { call: 'show', args: { leg: { path: '' }, to: { path: 'to' } } } } },
  { id: 'open-label', component: 'Text', text: 'Details' },
  { id: 'send', component: 'Button', child: 'send-label', action: { event: { name: 'send' } } },
  { id: 'send-label', component: 'Text', text: 'Send' },
];
const data = () => ({
  carrier: 'TGV',
  legs: [
    { from: 'Paris', to: 'Lyon', seat: '12A' },
    { from: 'Lyon', to: 'Nice', seat: '' },
  ],
});
function mount(components = legs, model: unknown = data()) {
  const surfaces = store(components, model);
  const onAction = vi.fn<(message: A2uiActionMessage) => void>();
  const onValidationError = vi.fn<(error: A2uiValidationErrorMessage) => void>();
  const show = vi.fn();
  const view = render(<Host surfaces={surfaces} onAction={onAction} onValidationError={onValidationError} functions={{ show }} />);
  return { surfaces, onAction, onValidationError, show, view };
}

describe('A2UI child templates', () => {
  it('stamps the template once per item, in list order, reading each item', () => {
    const { view } = mount();
    expect(view.getByText('Paris to Lyon (TGV)')).toBeTruthy();
    expect(view.getByText('Lyon to Nice (TGV)')).toBeTruthy();
    expect(view.getAllByRole('textbox').map((node) => (node as HTMLInputElement).value)).toEqual(['12A', '']);
    expect(view.getByRole('textbox', { name: 'Paris' })).toBeTruthy();
    expect(view.getAllByRole('button').map((node) => node.textContent)).toEqual(['Lyon', 'Details', 'Nice', 'Details', 'Send']);
  });

  it('writes an edit to its own item and leaves the others', () => {
    const { view, surfaces } = mount();
    const second = view.getByRole('textbox', { name: 'Lyon' });
    fireEvent.change(second, { target: { value: '4C' } });
    expect(surfaces.getSnapshot().surfaces[0].dataModel).toEqual({
      carrier: 'TGV',
      legs: [
        { from: 'Paris', to: 'Lyon', seat: '12A' },
        { from: 'Lyon', to: 'Nice', seat: '4C' },
      ],
    });
    // The edited input is the same element after the store publishes.
    expect(view.getByRole('textbox', { name: 'Lyon' })).toBe(second);
    expect((view.getByRole('textbox', { name: 'Paris' }) as HTMLInputElement).value).toBe('12A');
  });

  it('follows the list as the agent adds, changes and removes items, keeping earlier rows mounted', () => {
    const { view, surfaces } = mount();
    const first = view.getByRole('textbox', { name: 'Paris' });
    set(surfaces, '/legs/2', { from: 'Nice', to: 'Rome', seat: '1A' });
    expect(view.getAllByRole('textbox')).toHaveLength(3);
    expect(view.getByText('Nice to Rome (TGV)')).toBeTruthy();
    expect(view.getByRole('textbox', { name: 'Paris' })).toBe(first);
    set(surfaces, '/carrier', 'ICE');
    expect(view.getByText('Paris to Lyon (ICE)')).toBeTruthy();
    set(surfaces, '/legs', [{ from: 'Paris', to: 'Lyon', seat: '12A' }]);
    expect(view.getAllByRole('textbox')).toHaveLength(1);
    set(surfaces, '/legs', []);
    expect(view.queryAllByRole('textbox')).toHaveLength(0);
    expect(view.getByText('Legs')).toBeTruthy();
    set(surfaces, '/legs', 'not a list');
    expect(view.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('sends an action with context from the pressed item, named for the template component', () => {
    const { view, onAction } = mount(legs, { carrier: 'TGV', legs: [{ from: 'Paris', to: 'Lyon', seat: '12A' }, { from: 'Lyon', to: 'Nice', seat: '4C' }] });
    fireEvent.click(view.getByRole('button', { name: 'Nice' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0].action).toMatchObject({ name: 'pick', sourceComponentId: 'pick', context: { from: 'Lyon', seat: '4C' } });
    fireEvent.change(view.getByRole('textbox', { name: 'Paris' }), { target: { value: '9F' } });
    fireEvent.click(view.getByRole('button', { name: 'Lyon' }));
    expect(onAction.mock.calls[1][0].action.context).toEqual({ from: 'Paris', seat: '9F' });
  });

  it('runs a function-call action with arguments from the pressed item', () => {
    const { view, show } = mount();
    fireEvent.click(view.getAllByRole('button', { name: 'Details' })[1]);
    expect(show.mock.calls).toEqual([[{ leg: { from: 'Lyon', to: 'Nice', seat: '' }, to: 'Nice' }]]);
  });

  it('blocks a press on a failing item and shows the message on that row only', () => {
    const { view, onAction, onValidationError } = mount();
    fireEvent.click(view.getByRole('button', { name: 'Send' }));
    expect(onAction).not.toHaveBeenCalled();
    expect(onValidationError.mock.calls).toEqual([
      [{ version: 'v0.9', error: { code: 'VALIDATION_FAILED', surfaceId: 's', path: '/legs/1/seat', message: 'Pick a seat' } }],
    ]);
    expect(view.getAllByRole('alert').map((node) => node.textContent)).toEqual(['Pick a seat']);
    const failing = view.getByRole('textbox', { name: 'Lyon' });
    expect(failing.getAttribute('aria-invalid')).toBe('true');
    expect(view.getByRole('textbox', { name: 'Paris' }).hasAttribute('aria-invalid')).toBe(false);
    fireEvent.change(failing, { target: { value: '4C' } });
    expect(view.queryAllByRole('alert')).toHaveLength(0);
    fireEvent.click(view.getByRole('button', { name: 'Send' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('does not let template content outside an item block a press when the list is empty', () => {
    const { view, onAction } = mount(legs, { carrier: 'TGV', legs: [] });
    fireEvent.click(view.getByRole('button', { name: 'Send' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('stamps a list of plain values and nested templates', () => {
    const view = render(
      <Host
        surfaces={store(
          [
            { id: 'root', component: 'Column', children: { path: '/days', componentId: 'day' } },
            { id: 'day', component: 'Card', child: 'body' },
            { id: 'body', component: 'Column', children: ['name', 'stops'] },
            { id: 'name', component: 'Text', text: { path: 'name' }, variant: 'h3' },
            { id: 'stops', component: 'Row', children: { path: 'stops', componentId: 'stop' } },
            { id: 'stop', component: 'Text', text: { path: '.' } },
          ],
          { days: [{ name: 'Mon', stops: ['Paris', 'Lyon'] }, { name: 'Tue', stops: ['Nice'] }, { name: 'Wed' }] }
        )}
      />
    );
    const cards = [...view.container.querySelectorAll('.a2ui-card')] as HTMLElement[];
    expect(cards).toHaveLength(3);
    expect(within(cards[0]).getByRole('heading', { name: 'Mon' })).toBeTruthy();
    expect(within(cards[0]).getByText('Paris')).toBeTruthy();
    expect(within(cards[0]).getByText('Lyon')).toBeTruthy();
    expect(within(cards[1]).getByText('Nice')).toBeTruthy();
    expect(within(cards[1]).queryByText('Paris')).toBeNull();
    expect(within(cards[2]).getByRole('heading', { name: 'Wed' })).toBeTruthy();
  });

  it('ends a template that names itself, and one over a missing component', () => {
    const view = render(
      <Host
        surfaces={store(
          [
            { id: 'root', component: 'Column', children: ['tree', 'loop', 'gone'] },
            { id: 'tree', component: 'Column', children: { path: '/tree', componentId: 'node' } },
            { id: 'node', component: 'Column', children: { path: 'kids', componentId: 'node' }, gap: 'small' },
            { id: 'loop', component: 'Column', children: { path: '/tree', componentId: 'loop' } },
            { id: 'gone', component: 'Column', children: { path: '/tree', componentId: 'missing' } },
          ],
          { tree: [{ kids: [{ kids: [{}] }, {}] }] }
        )}
      />
    );
    // tree, loop, gone, four nodes, and one loop per tree item.
    expect(view.container.querySelectorAll('.a2ui-col')).toHaveLength(1 + 3 + 4 + 1);
  });
});
