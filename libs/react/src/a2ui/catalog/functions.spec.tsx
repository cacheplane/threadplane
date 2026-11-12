import { StrictMode, useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createA2uiSurfaces, type A2uiActionMessage, type A2uiSurfaces, type A2uiValue } from '@threadplane/content/a2ui';
import { A2uiSurface, type A2uiSurfaceProps } from '../index';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
const text = (value: string) => ({ call: 'formatString', args: { value } });
const button = (id: string, label: string, functionCall: unknown, extra: Record<string, unknown> = {}) => [
  { id, component: 'Button', child: `${id}-label`, action: { functionCall }, ...extra },
  { id: `${id}-label`, component: 'Text', text: label },
];
const pressable = (node: HTMLElement) => !(node as HTMLButtonElement).disabled;

describe('A2UI function-call props', () => {
  it('shows a computed prop and follows the data model', () => {
    const surfaces = store(
      [
        { id: 'root', component: 'Column', children: ['line', 'name'] },
        { id: 'line', component: 'Text', text: text("${/n} ${pluralize(value:${/n}, one:'night', other:'nights')} for ${/guest}") },
        { id: 'name', component: 'TextField', label: 'Guest', value: { path: '/guest' } },
      ],
      { n: 1, guest: 'Ada' }
    );
    const view = render(<StrictMode><Host surfaces={surfaces} /></StrictMode>);
    expect(view.getByText('1 night for Ada')).toBeTruthy();
    fireEvent.change(view.getByRole('textbox', { name: 'Guest' }), { target: { value: 'Grace' } });
    expect(view.getByText('1 night for Grace')).toBeTruthy();
    act(() => surfaces.apply({ version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/n', value: 3 } } as unknown as Message));
    expect(view.getByText('3 nights for Grace')).toBeTruthy();
  });

  it('leaves out a prop whose call has no value, and fixes an input given a computed value', () => {
    const surfaces = store(
      [
        { id: 'root', component: 'Column', children: ['ref', 'tabs'] },
        { id: 'ref', component: 'TextField', label: { call: 'launch', args: {} }, placeholder: 'Reference', value: text('LYS-${/n}') },
        { id: 'tabs', component: 'Tabs', tabs: [{ title: text('Leg ${/n}'), child: 'body' }] },
        { id: 'body', component: 'ChoicePicker', label: 'Seat', value: { path: '/seat' }, options: [{ label: text('Row ${/n}'), value: 'a' }] },
      ],
      { n: 7 }
    );
    const view = render(<Host surfaces={surfaces} />);
    const input = view.getByPlaceholderText('Reference') as HTMLInputElement;
    expect(input.value).toBe('LYS-7');
    expect(input.readOnly).toBe(true);
    expect(view.container.querySelector('label')?.textContent ?? '').not.toContain('launch');
    expect(view.getByRole('tab', { name: 'Leg 7' })).toBeTruthy();
    expect(view.getByRole('radio', { name: 'Row 7' })).toBeTruthy();
  });

  it('resolves function calls in an event action context', () => {
    const onAction = vi.fn<(message: A2uiActionMessage) => void>();
    const surfaces = store(
      [
        { id: 'root', component: 'Button', child: 'l', action: { event: { name: 'book', context: { line: text('Hi ${/guest}') } } } },
        { id: 'l', component: 'Text', text: 'Book' },
      ],
      { guest: 'Ada' }
    );
    const view = render(<Host surfaces={surfaces} onAction={onAction} />);
    fireEvent.click(view.getByRole('button', { name: 'Book' }));
    expect(onAction.mock.calls[0][0].action.context).toEqual({ line: 'Hi Ada' });
  });
});

describe('A2UI function-call actions', () => {
  const page = (...buttons: ReturnType<typeof button>[]) => [
    { id: 'root', component: 'Column', children: ['name', ...buttons.map(([item]) => item.id)] },
    { id: 'name', component: 'TextField', label: 'Guest', value: { path: '/guest' }, checks: [{ condition: { call: 'required', args: { value: { path: '/guest' } } }, message: 'Required' }] },
    ...buttons.flat(),
  ];

  it('runs a named function with arguments resolved at the press, and sends nothing', () => {
    const share = vi.fn<(args: { readonly [name: string]: A2uiValue }) => void>();
    const onAction = vi.fn();
    const surfaces = store(page(button('share', 'Share', { call: 'share', args: { guest: { path: '/guest' }, line: text('Hi ${/guest}'), n: 2 } })), { guest: 'Ada' });
    const view = render(<Host surfaces={surfaces} onAction={onAction} functions={{ share }} />);
    fireEvent.change(view.getByRole('textbox', { name: 'Guest' }), { target: { value: 'Grace' } });
    const before = surfaces.getSnapshot();
    fireEvent.click(view.getByRole('button', { name: 'Share' }));
    expect(share.mock.calls).toEqual([[{ guest: 'Grace', line: 'Hi Grace', n: 2 }]]);
    expect(Object.isFrozen(share.mock.calls[0][0])).toBe(true);
    expect(onAction).not.toHaveBeenCalled();
    expect(surfaces.getSnapshot()).toBe(before);
  });

  it('needs no onAction, and calls the function of the latest render', () => {
    const first = vi.fn();
    const second = vi.fn();
    const surfaces = store(page(button('share', 'Share', { call: 'share' })), { guest: 'Ada' });
    const view = render(<Host surfaces={surfaces} functions={{ share: first }} />);
    view.rerender(<Host surfaces={surfaces} functions={{ share: second }} />);
    fireEvent.click(view.getByRole('button', { name: 'Share' }));
    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls).toEqual([[{}]]);
  });

  it('is not held back by failing input checks and shows no messages', () => {
    const share = vi.fn();
    const onValidationError = vi.fn();
    const surfaces = store(page(button('share', 'Share', { call: 'share' })), { guest: '' });
    const view = render(<Host surfaces={surfaces} functions={{ share }} onValidationError={onValidationError} />);
    fireEvent.click(view.getByRole('button', { name: 'Share' }));
    expect(share).toHaveBeenCalledTimes(1);
    expect(onValidationError).not.toHaveBeenCalled();
    expect(view.queryAllByRole('alert')).toHaveLength(0);
  });

  it('disables a Button whose function nothing can run or whose own checks fail', () => {
    const share = vi.fn();
    const failing = { checks: [{ condition: { call: 'required', args: { value: { path: '/guest' } } }, message: 'Required' }] };
    const surfaces = store(
      page(
        button('known', 'Known', { call: 'share' }),
        button('unknown', 'Unknown', { call: 'launch' }),
        button('inherited', 'Inherited', { call: 'toString' }),
        button('gated', 'Gated', { call: 'share' }, failing),
        button('malformed', 'Malformed', { args: {} })
      ),
      { guest: '' }
    );
    const view = render(<Host surfaces={surfaces} functions={{ share }} />);
    const named = (name: string) => view.getByRole('button', { name });
    expect(['Known', 'Unknown', 'Inherited', 'Gated', 'Malformed'].map((name) => pressable(named(name)))).toEqual([true, false, false, false, false]);
    fireEvent.change(view.getByRole('textbox', { name: 'Guest' }), { target: { value: 'Ada' } });
    expect(pressable(named('Gated'))).toBe(true);
  });

  it('opens web, mail and phone addresses with the built-in openUrl, in a new tab without an opener', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const surfaces = store(
      page(
        button('web', 'Web', { call: 'openUrl', args: { url: text('https://example.test/t/${/guest}') } }),
        button('mail', 'Mail', { call: 'openUrl', args: { url: 'mailto:ada@example.test' } }),
        button('tel', 'Tel', { call: 'openUrl', args: { url: 'tel:+15550100' } }),
        button('relative', 'Relative', { call: 'openUrl', args: { url: '/trips' } })
      ),
      { guest: 'ada' }
    );
    const view = render(<Host surfaces={surfaces} />);
    for (const name of ['Web', 'Mail', 'Tel', 'Relative']) fireEvent.click(view.getByRole('button', { name }));
    expect(open.mock.calls).toEqual([
      ['https://example.test/t/ada', '_blank', 'noopener,noreferrer'],
      ['mailto:ada@example.test', '_blank', 'noopener,noreferrer'],
      ['tel:+15550100', '_blank', 'noopener,noreferrer'],
      [new URL('/trips', window.location.href).href, '_blank', 'noopener,noreferrer'],
    ]);
  });

  it('never opens a script, data or missing address', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const urls = ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<p>x</p>', 'vbscript:x', 'file:///etc/hosts', 'http://[bad', '', '  ', 7, { path: '/nope' }];
    const surfaces = store(page(...urls.map((url, index) => button(`u${index}`, `Link ${index}`, { call: 'openUrl', args: { url } }))), { guest: 'Ada' });
    const view = render(<Host surfaces={surfaces} />);
    for (const [index] of urls.entries()) {
      const node = view.getByRole('button', { name: `Link ${index}` });
      expect(pressable(node), String(urls[index])).toBe(false);
      fireEvent.click(node);
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('server renders an openUrl Button enabled, as the browser will', () => {
    const surfaces = store(page(button('web', 'Web', { call: 'openUrl', args: { url: '/trips' } }), button('bad', 'Bad', { call: 'openUrl', args: { url: 'javascript:x' } })), { guest: 'Ada' });
    const html = renderToString(<A2uiSurface surface={surfaces.getSnapshot().surfaces[0]} />);
    expect(html).toMatch(/<button type="button" class="a2ui-btn a2ui-btn--default">(?:<[^>]+>)*Web/);
    expect(html).toMatch(/<button type="button" class="a2ui-btn a2ui-btn--default" disabled="">(?:<[^>]+>)*Bad/);
  });

  it('treats an argument named __proto__ as a plain key', () => {
    const share = vi.fn();
    const surfaces = store(page(button('share', 'Share', JSON.parse('{"call":"share","args":{"__proto__":{"polluted":true},"a":1}}'))), { guest: 'Ada' });
    const view = render(<Host surfaces={surfaces} functions={{ share }} />);
    fireEvent.click(view.getByRole('button', { name: 'Share' }));
    const args = share.mock.calls[0][0];
    expect(Object.keys(args).sort()).toEqual(['__proto__', 'a']);
    expect(args.polluted).toBeUndefined();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('lets the application replace openUrl', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const openUrl = vi.fn();
    const surfaces = store(page(button('web', 'Web', { call: 'openUrl', args: { url: 'javascript:alert(1)' } })), { guest: 'Ada' });
    const view = render(<Host surfaces={surfaces} functions={{ openUrl }} />);
    fireEvent.click(view.getByRole('button', { name: 'Web' }));
    expect(openUrl.mock.calls).toEqual([[{ url: 'javascript:alert(1)' }]]);
    expect(open).not.toHaveBeenCalled();
  });

  it('still opens a Modal when its trigger has a function-call action', () => {
    const share = vi.fn();
    const surfaces = store([
      { id: 'root', component: 'Modal', trigger: 'open', content: 'body' },
      ...button('open', 'Details', { call: 'share' }),
      { id: 'body', component: 'Text', text: 'Inside' },
    ]);
    const view = render(<Host surfaces={surfaces} functions={{ share }} />);
    fireEvent.click(view.getByRole('button', { name: 'Details' }));
    expect(share).toHaveBeenCalledTimes(1);
    expect(view.getByRole('button', { name: 'Details' }).getAttribute('aria-expanded')).toBe('true');
  });
});
