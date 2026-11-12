import { StrictMode, useSyncExternalStore } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createA2uiSurfaces,
  type A2uiActionMessage,
  type A2uiSurfaces,
  type A2uiValidationErrorMessage,
} from '@threadplane/content/a2ui';
import { A2uiSurface } from '../index';

afterEach(cleanup);

type Message = Parameters<A2uiSurfaces['apply']>[0];
function store(components: readonly Record<string, unknown>[], data: unknown = {}, surfaceId = 's') {
  const surfaces = createA2uiSurfaces();
  for (const message of [
    { version: 'v0.9', createSurface: { surfaceId, catalogId: 'basic' } },
    { version: 'v0.9', updateComponents: { surfaceId, components } },
    { version: 'v0.9', updateDataModel: { surfaceId, value: data } },
  ])
    surfaces.apply(message as unknown as Message);
  return surfaces;
}
function Host(props: {
  surfaces: A2uiSurfaces;
  onAction?: (message: A2uiActionMessage) => void;
  onValidationError?: (error: A2uiValidationErrorMessage) => void;
}) {
  const snapshot = useSyncExternalStore(props.surfaces.subscribe, props.surfaces.getSnapshot, props.surfaces.getSnapshot);
  return <A2uiSurface surface={snapshot.surfaces[0]} {...props} />;
}
const required = (path: string, message: string) => ({
  condition: { call: 'required', args: { value: { path } } },
  message,
});
const form: readonly Record<string, unknown>[] = [
  { id: 'root', component: 'Column', children: ['name', 'mail', 'go'] },
  { id: 'name', component: 'TextField', label: 'Name', value: { path: '/name' }, checks: [required('/name', 'Name is required')] },
  {
    id: 'mail',
    component: 'TextField',
    label: 'Email',
    value: { path: '/mail' },
    checks: [{ condition: { call: 'email', args: { value: { path: '/mail' } } }, message: 'Enter an email' }],
  },
  { id: 'go', component: 'Button', child: 'label', action: { event: { name: 'book', context: { name: { path: '/name' } } } } },
  { id: 'label', component: 'Text', text: 'Book' },
];
function mount(components = form, data: unknown = { name: '', mail: 'ada' }) {
  const surfaces = store(components, data);
  const onAction = vi.fn<(message: A2uiActionMessage) => void>();
  const onValidationError = vi.fn<(error: A2uiValidationErrorMessage) => void>();
  const view = render(<Host surfaces={surfaces} onAction={onAction} onValidationError={onValidationError} />);
  return { surfaces, onAction, onValidationError, view };
}

describe('A2UI validation checks', () => {
  it('shows no message before a press, even while checks fail', () => {
    const { view } = mount();
    expect(view.queryAllByRole('alert')).toHaveLength(0);
    const name = view.getByRole('textbox', { name: 'Name' });
    expect(name.hasAttribute('aria-invalid')).toBe(false);
    expect(name.hasAttribute('aria-describedby')).toBe(false);
    expect((view.getByRole('button', { name: 'Book' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('blocks the press, reports the first failure and marks each failing input', () => {
    const { view, onAction, onValidationError, surfaces } = mount();
    const before = surfaces.getSnapshot();
    fireEvent.click(view.getByRole('button', { name: 'Book' }));
    expect(onAction).not.toHaveBeenCalled();
    expect(onValidationError.mock.calls).toEqual([
      [{ version: 'v0.9', error: { code: 'VALIDATION_FAILED', surfaceId: 's', path: '/name', message: 'Name is required' } }],
    ]);
    expect(view.getAllByRole('alert').map((node) => node.textContent)).toEqual(['Name is required', 'Enter an email']);
    const name = view.getByRole('textbox', { name: 'Name' });
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(name.getAttribute('aria-describedby') as string)?.textContent).toBe('Name is required');
    // Showing messages stores nothing.
    expect(surfaces.getSnapshot()).toBe(before);
  });

  it('clears each message as its input passes and sends once everything does', () => {
    const { view, onAction, onValidationError } = mount();
    const press = () => fireEvent.click(view.getByRole('button', { name: 'Book' }));
    press();
    const name = view.getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'Ada' } });
    expect(view.getAllByRole('alert').map((node) => node.textContent)).toEqual(['Enter an email']);
    expect(name.hasAttribute('aria-invalid')).toBe(false);
    expect(view.getByRole('textbox', { name: 'Name' })).toBe(name);
    // An input that fails again while messages are showing shows its message again.
    fireEvent.change(name, { target: { value: '' } });
    expect(view.getAllByRole('alert')).toHaveLength(2);
    fireEvent.change(name, { target: { value: 'Ada' } });
    press();
    expect(onValidationError).toHaveBeenCalledTimes(2);
    expect(onValidationError.mock.calls[1][0].error).toMatchObject({ path: '/mail', message: 'Enter an email' });
    fireEvent.change(view.getByRole('textbox', { name: 'Email' }), { target: { value: 'ada@example.com' } });
    expect(view.queryAllByRole('alert')).toHaveLength(0);
    press();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0].action).toMatchObject({ name: 'book', context: { name: 'Ada' } });
    // After a sent action, a new failure stays quiet until the next blocked press.
    fireEvent.change(name, { target: { value: '' } });
    expect(view.queryAllByRole('alert')).toHaveLength(0);
  });

  it('lets an agent update clear a message', () => {
    const { view, surfaces } = mount(form, { name: '', mail: 'ada@example.com' });
    fireEvent.click(view.getByRole('button', { name: 'Book' }));
    expect(view.getAllByRole('alert')).toHaveLength(1);
    surfaces.apply({ version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/name', value: 'Agent' } } as unknown as Message);
    view.rerender(<Host surfaces={surfaces} onAction={() => undefined} />);
    expect(view.queryAllByRole('alert')).toHaveLength(0);
  });

  it('shows messages on every input kind', () => {
    const fails = (id: string) => [{ condition: false, message: `${id} failed` }];
    const { view } = mount(
      [
        { id: 'root', component: 'Column', children: ['t', 'c', 's', 'p', 'd', 'go'] },
        { id: 't', component: 'TextField', label: 'T', value: { path: '/t' }, variant: 'longText', checks: fails('t') },
        { id: 'c', component: 'CheckBox', label: 'C', value: { path: '/c' }, checks: fails('c') },
        { id: 's', component: 'Slider', label: 'S', value: { path: '/s' }, checks: fails('s') },
        { id: 'p', component: 'ChoicePicker', label: 'P', value: { path: '/p' }, options: [{ label: 'One', value: '1' }], checks: fails('p') },
        { id: 'd', component: 'DateTimeInput', label: 'D', value: { path: '/d' }, checks: fails('d') },
        { id: 'go', component: 'Button', child: 'label', action: { event: { name: 'go' } } },
        { id: 'label', component: 'Text', text: 'Go' },
      ],
      { t: '', c: false, s: 1, p: [], d: '' }
    );
    expect(view.container.querySelector('.a2ui-cb-field')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Go' }));
    expect(view.getAllByRole('alert').map((node) => node.textContent)).toEqual(['t failed', 'c failed', 's failed', 'p failed', 'd failed']);
    const described = (element: Element) => document.getElementById(element.getAttribute('aria-describedby') as string)?.textContent;
    expect(described(view.getByRole('textbox', { name: 'T' }))).toBe('t failed');
    expect(described(view.getByRole('checkbox', { name: 'C' }))).toBe('c failed');
    expect(described(view.getByRole('slider'))).toBe('s failed');
    expect(described(view.getByRole('radiogroup', { name: 'P' }))).toBe('p failed');
    expect(described(view.getByLabelText('D'))).toBe('d failed');
    expect(view.container.querySelector('.a2ui-cb-field .a2ui-cb')).not.toBeNull();
  });

  it('applies a TextField validationRegexp as a check', () => {
    const { view, onAction, onValidationError } = mount(
      [
        { id: 'root', component: 'Column', children: ['code', 'go'] },
        { id: 'code', component: 'TextField', label: 'Code', value: { path: '/code' }, validationRegexp: '^[A-Z]{3}$' },
        { id: 'go', component: 'Button', child: 'label', action: { event: { name: 'go' } } },
        { id: 'label', component: 'Text', text: 'Go' },
      ],
      { code: 'lys' }
    );
    fireEvent.click(view.getByRole('button', { name: 'Go' }));
    expect(view.getByRole('alert').textContent).toBe('Invalid format');
    expect(onValidationError).toHaveBeenCalledTimes(1);
    fireEvent.change(view.getByRole('textbox', { name: 'Code' }), { target: { value: 'LYS' } });
    fireEvent.click(view.getByRole('button', { name: 'Go' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("disables a Button whose own checks fail and re-enables it when they pass", () => {
    const { view, onAction, onValidationError } = mount(
      [
        { id: 'root', component: 'Column', children: ['agree', 'go', 'other'] },
        { id: 'agree', component: 'CheckBox', label: 'Agree', value: { path: '/agree' } },
        {
          id: 'go',
          component: 'Button',
          child: 'label',
          action: { event: { name: 'go' } },
          checks: [{ condition: { path: '/agree' }, message: 'Agree first' }],
        },
        { id: 'label', component: 'Text', text: 'Go' },
        { id: 'other', component: 'Button', child: 'otherLabel', action: { event: { name: 'other' } } },
        { id: 'otherLabel', component: 'Text', text: 'Other' },
      ],
      { agree: false }
    );
    const go = view.getByRole('button', { name: 'Go' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    // Another Button is not held back by it, and no message is shown for it.
    fireEvent.click(view.getByRole('button', { name: 'Other' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onValidationError).not.toHaveBeenCalled();
    expect(view.queryAllByRole('alert')).toHaveLength(0);
    fireEvent.click(view.getByRole('checkbox', { name: 'Agree' }));
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it('gates without a store or an error handler, and calls each handler once under StrictMode', () => {
    const surfaces = store(form, { name: '', mail: 'ada@example.com' });
    const onAction = vi.fn();
    const quiet = render(<A2uiSurface surface={surfaces.getSnapshot().surfaces[0]} onAction={onAction} />);
    fireEvent.click(quiet.getByRole('button', { name: 'Book' }));
    expect(onAction).not.toHaveBeenCalled();
    expect(quiet.getByRole('alert').textContent).toBe('Name is required');
    cleanup();
    const onValidationError = vi.fn();
    const strict = render(
      <StrictMode>
        <Host surfaces={surfaces} onAction={onAction} onValidationError={onValidationError} />
      </StrictMode>
    );
    fireEvent.click(strict.getByRole('button', { name: 'Book' }));
    expect(onValidationError).toHaveBeenCalledTimes(1);
    fireEvent.change(strict.getByRole('textbox', { name: 'Name' }), { target: { value: 'Ada' } });
    fireEvent.click(strict.getByRole('button', { name: 'Book' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('does not carry shown messages over to a different surface', () => {
    const first = store(form, { name: '', mail: 'ada@example.com' }, 'a');
    const second = store(form, { name: '', mail: 'ada@example.com' }, 'b');
    const view = render(<Host surfaces={first} onAction={() => undefined} />);
    fireEvent.click(view.getByRole('button', { name: 'Book' }));
    expect(view.getAllByRole('alert')).toHaveLength(1);
    view.rerender(<Host surfaces={second} onAction={() => undefined} />);
    expect(view.queryAllByRole('alert')).toHaveLength(0);
  });

  it('renders message text literally', () => {
    const { view } = mount(
      [
        { id: 'root', component: 'Column', children: ['name', 'go'] },
        { id: 'name', component: 'TextField', label: 'Name', value: { path: '/name' }, checks: [required('/name', '<b>Needed</b>')] },
        { id: 'go', component: 'Button', child: 'label', action: { event: { name: 'go' } } },
        { id: 'label', component: 'Text', text: 'Go' },
      ],
      { name: '' }
    );
    fireEvent.click(view.getByRole('button', { name: 'Go' }));
    expect(view.getByRole('alert').textContent).toBe('<b>Needed</b>');
    expect(view.container.querySelector('b')).toBeNull();
  });
});
