import { StrictMode, useSyncExternalStore } from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createA2uiSurfaces,
  type A2uiActionMessage,
  type A2uiSurfaces,
} from '@threadplane/content/a2ui';
import { A2uiSurface } from '../index';

type Message = Parameters<A2uiSurfaces['apply']>[0];
function store(components: readonly Record<string, unknown>[], data: unknown = {}, sendDataModel = false) {
  const surfaces = createA2uiSurfaces();
  for (const message of [
    { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'basic', sendDataModel } },
    { version: 'v0.9', updateComponents: { surfaceId: 's', components } },
    { version: 'v0.9', updateDataModel: { surfaceId: 's', value: data } },
  ])
    surfaces.apply(message as unknown as Message);
  return surfaces;
}
function Host({ surfaces, onAction }: { surfaces: A2uiSurfaces; onAction?: (message: A2uiActionMessage) => void }) {
  const snapshot = useSyncExternalStore(surfaces.subscribe, surfaces.getSnapshot, surfaces.getSnapshot);
  return <A2uiSurface surface={snapshot.surfaces[0]} surfaces={surfaces} onAction={onAction} />;
}
const form = [
  { id: 'root', component: 'Column', children: ['name', 'go'] },
  { id: 'name', component: 'TextField', label: 'Name', value: { path: '/name' } },
  { id: 'go', component: 'Button', child: 'label', variant: 'primary', action: { event: { name: 'book', context: { guest: { path: '/name' }, source: 'form' } } } },
  { id: 'label', component: 'Text', text: 'Book <b>now</b>' },
];

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
});
afterEach(cleanup);

describe('A2UI Button', () => {
  it('renders a native button around its literal child', () => {
    const view = render(<Host surfaces={store(form, { name: 'Ada' })} onAction={() => undefined} />);
    const button = view.getByRole('button', { name: 'Book <b>now</b>' }) as HTMLButtonElement;
    expect(button.type).toBe('button');
    expect(button.className).toBe('a2ui-btn a2ui-btn--primary');
    expect(button.disabled).toBe(false);
    expect(button.querySelector('b')).toBeNull();
    expect(view.container.querySelector('[data-a2ui-unsupported]')).toBeNull();
  });

  it('sends one action with context read from the store at the moment of the press', () => {
    const surfaces = store(form, { name: 'Ada' });
    const onAction = vi.fn();
    const view = render(<Host surfaces={surfaces} onAction={onAction} />);
    fireEvent.change(view.getByRole('textbox', { name: 'Name' }), { target: { value: 'Grace' } });
    fireEvent.click(view.getByRole('button'));
    expect(onAction).toHaveBeenCalledTimes(1);
    const message = onAction.mock.calls[0][0] as A2uiActionMessage;
    expect(message.version).toBe('v0.9');
    expect(message.action).toMatchObject({
      name: 'book', surfaceId: 's', sourceComponentId: 'go', label: 'Book <b>now</b>',
      context: { guest: 'Grace', source: 'form' },
    });
    expect(Number.isNaN(Date.parse(message.action.timestamp))).toBe(false);
    expect(message.metadata).toBeUndefined();
    // The press changes nothing in the store.
    expect(surfaces.getSnapshot().surfaces[0].dataModel).toEqual({ name: 'Grace' });
  });

  it('attaches the edited data model when the surface asked for it', () => {
    const surfaces = store(form, { name: 'Ada', kept: 1 }, true);
    const onAction = vi.fn();
    const view = render(<Host surfaces={surfaces} onAction={onAction} />);
    fireEvent.change(view.getByRole('textbox', { name: 'Name' }), { target: { value: 'Grace' } });
    fireEvent.click(view.getByRole('button'));
    expect(onAction.mock.calls[0][0].metadata).toEqual({
      a2uiClientDataModel: { surfaces: { s: { name: 'Grace', kept: 1 } } },
    });
  });

  it('uses the handler and snapshot of the latest render', () => {
    const surfaces = store(form, { name: 'Ada' });
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<Host surfaces={surfaces} onAction={first} />);
    const button = view.getByRole('button');
    view.rerender(<Host surfaces={surfaces} onAction={second} />);
    surfaces.apply({ version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/name', value: 'Agent' } } as unknown as Message);
    view.rerender(<Host surfaces={surfaces} onAction={second} />);
    expect(view.getByRole('button')).toBe(button);
    fireEvent.click(button);
    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls[0][0].action.context.guest).toBe('Agent');
  });

  it('sends once per press under StrictMode', () => {
    const onAction = vi.fn();
    const view = render(
      <StrictMode>
        <Host surfaces={store(form, { name: 'Ada' })} onAction={onAction} />
      </StrictMode>
    );
    fireEvent.click(view.getByRole('button'));
    fireEvent.click(view.getByRole('button'));
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it('is disabled without a handler, without an event action, or when disabled', () => {
    const none = render(<Host surfaces={store(form, { name: 'Ada' })} />);
    expect((none.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const onAction = vi.fn();
    const view = render(
      <Host
        onAction={onAction}
        surfaces={store(
          [
            { id: 'root', component: 'Column', children: ['plain', 'local', 'off', 'bound'] },
            { id: 'plain', component: 'Button', child: 'a' },
            { id: 'a', component: 'Text', text: 'No action' },
            { id: 'local', component: 'Button', child: 'b', action: { functionCall: { call: 'openUrl', args: { url: 'https://example.test' } } } },
            { id: 'b', component: 'Text', text: 'Local' },
            { id: 'off', component: 'Button', child: 'c', disabled: true, action: { event: { name: 'x' } } },
            { id: 'c', component: 'Text', text: 'Off' },
            { id: 'bound', component: 'Button', child: 'd', disabled: { path: '/busy' }, action: { event: { name: 'y' } } },
            { id: 'd', component: 'Text', text: 'Bound' },
          ],
          { busy: true }
        )}
      />
    );
    for (const name of ['No action', 'Local', 'Off', 'Bound']) {
      const button = view.getByRole('button', { name }) as HTMLButtonElement;
      expect(button.disabled, name).toBe(true);
      fireEvent.click(button);
    }
    expect(onAction).not.toHaveBeenCalled();
  });

  it('maps variants and falls back to the default', () => {
    const view = render(
      <Host
        onAction={() => undefined}
        surfaces={store([
          { id: 'root', component: 'Row', children: ['a', 'b', 'c', 'd'] },
          ...['borderless', 'default', 'constructor', 5].map((variant, index) => ({
            id: 'abcd'[index], component: 'Button', variant, action: { event: { name: 'n' } },
          })),
        ])}
      />
    );
    expect(view.getAllByRole('button').map((button) => button.className)).toEqual([
      'a2ui-btn a2ui-btn--borderless',
      'a2ui-btn a2ui-btn--default',
      'a2ui-btn a2ui-btn--default',
      'a2ui-btn a2ui-btn--default',
    ]);
  });

  it('server renders an enabled button when a handler is given', () => {
    const html = renderToString(<Host surfaces={store(form, { name: 'Ada' })} onAction={() => undefined} />);
    expect(html).toContain('class="a2ui-btn a2ui-btn--primary"');
    expect(html).not.toContain('disabled');
  });
});

describe('A2UI Button as a Modal trigger', () => {
  const modal = (button: Record<string, unknown> = {}) => [
    { id: 'root', component: 'Modal', trigger: 'open', content: 'body' },
    { id: 'open', component: 'Button', child: 'label', ...button },
    { id: 'label', component: 'Text', text: 'Details' },
    { id: 'body', component: 'Text', text: 'Fare rules' },
  ];

  it('is the only control, opens the modal without an action, and reports its state', () => {
    const view = render(<Host surfaces={store(modal())} />);
    const buttons = view.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    const button = buttons[0] as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    const wrapper = view.container.querySelector('.a2ui-modal__trigger') as HTMLElement;
    expect(wrapper.hasAttribute('role')).toBe(false);
    expect(wrapper.hasAttribute('tabindex')).toBe(false);
    fireEvent.click(button);
    expect(view.container.querySelector('dialog')?.textContent).toContain('Fare rules');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
  });

  it('sends its action and opens the modal on one press', () => {
    const onAction = vi.fn();
    const view = render(<Host surfaces={store(modal({ action: { event: { name: 'viewed' } } }))} onAction={onAction} />);
    fireEvent.click(view.getByRole('button', { name: 'Details' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('dialog')).toBeTruthy();
  });

  it('stays disabled, and opens nothing, when its disabled prop is true', () => {
    const view = render(<Host surfaces={store(modal({ disabled: true }))} />);
    const button = view.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(view.container.querySelector('dialog')).toBeNull();
  });

  it('claims the trigger once under StrictMode and releases it on unmount', () => {
    const surfaces = store(modal());
    const view = render(
      <StrictMode>
        <Host surfaces={surfaces} />
      </StrictMode>
    );
    expect(view.container.querySelector('.a2ui-modal__trigger')?.hasAttribute('role')).toBe(false);
    // The trigger becomes plain text: the wrapper is the control again.
    surfaces.apply({ version: 'v0.9', updateComponents: { surfaceId: 's', components: [{ id: 'open', component: 'Text', text: 'Details' }] } } as unknown as Message);
    view.rerender(
      <StrictMode>
        <Host surfaces={surfaces} />
      </StrictMode>
    );
    const wrapper = view.getByRole('button', { name: 'Details' });
    expect(wrapper.className).toBe('a2ui-modal__trigger');
    expect(wrapper.tabIndex).toBe(0);
  });
});
