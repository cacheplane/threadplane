import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { A2uiSurfaceSnapshot } from '@threadplane/content/a2ui';
import { A2uiSurface } from '../index';
import { a2uiSurfaceSpec } from '../surface-spec';

type Component = A2uiSurfaceSnapshot['components'][number];
const surface = (
  components: readonly Record<string, unknown>[],
  dataModel: A2uiSurfaceSnapshot['dataModel'] = {}
): A2uiSurfaceSnapshot => ({
  surfaceId: 's1',
  catalogId: 'basic',
  components: components as unknown as readonly Component[],
  dataModel,
});
const text = (id: string, value: string) => ({ id, component: 'Text', text: value });
const tabs = (extra: readonly Record<string, unknown>[] = []) =>
  surface(
    [
      {
        id: 'root',
        component: 'Tabs',
        tabs: [
          { title: 'Plan', child: 'a' },
          { title: { path: '/second' }, child: 'b' },
          { title: 'Notes <b>', child: 'c' },
          ...extra,
        ],
      },
      text('a', 'Plan body'),
      text('b', 'Stay body'),
      text('c', 'Notes body'),
    ],
    { second: 'Stay' }
  );

beforeEach(() => {
  // jsdom has no modal dialog; model the open flag and the close event.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
});
afterEach(cleanup);

describe('A2UI Tabs', () => {
  it('converts tabs to ordered children and literal titles', () => {
    const { spec } = a2uiSurfaceSpec(tabs());
    expect(spec?.elements['root']).toEqual({
      type: 'Tabs',
      props: { tabTitles: ['Plan', 'Stay', 'Notes <b>'] },
      children: ['a', 'b', 'c'],
    });
  });

  it('keeps titles aligned when a tab is missing, repeated or malformed', () => {
    const { spec } = a2uiSurfaceSpec(
      tabs([
        { title: 'Ghost', child: 'missing' },
        { title: 'Again', child: 'a' },
        { title: 'No child' },
        'junk',
        { title: { path: '/absent' }, child: 'd' },
        { title: 7, child: 'e' },
      ] as never)
    );
    // d and e are not components, so only the three real tabs remain.
    expect(spec?.elements['root'].children).toEqual(['a', 'b', 'c']);
    expect(spec?.elements['root'].props['tabTitles']).toEqual([
      'Plan',
      'Stay',
      'Notes <b>',
    ]);
  });

  it('reads titles through escaped and array pointers, and blanks unreadable ones', () => {
    const { spec } = a2uiSurfaceSpec(
      surface(
        [
          {
            id: 'root',
            component: 'Tabs',
            tabs: [
              { title: { path: '/a~1b/0' }, child: 'a' },
              { title: { path: '/n' }, child: 'b' },
              { title: { path: '/a~1b/x' }, child: 'c' },
              { title: { path: '/toString' }, child: 'd' },
            ],
          },
          text('a', 'A'),
          text('b', 'B'),
          text('c', 'C'),
          text('d', 'D'),
        ],
        { 'a/b': ['First'], n: 3 }
      )
    );
    expect(spec?.elements['root'].props['tabTitles']).toEqual(['First', '3', '', '']);
  });

  it('renders a tab list with one labelled panel showing the first tab', () => {
    const view = render(<A2uiSurface surface={tabs()} />);
    const all = view.getAllByRole('tab');
    expect(all.map((tab) => tab.textContent)).toEqual(['Plan', 'Stay', 'Notes <b>']);
    expect(all.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(all.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    for (const tab of all) expect(tab.getAttribute('type')).toBe('button');
    const panel = view.getByRole('tabpanel');
    expect(panel.textContent).toBe('Plan body');
    expect(panel.getAttribute('aria-labelledby')).toBe(all[0].id);
    expect(all[0].getAttribute('aria-controls')).toBe(panel.id);
    expect(view.container.querySelector('b')).toBeNull();
  });

  it('selects on click and renders only that tab', () => {
    const view = render(
      <StrictMode>
        <A2uiSurface surface={tabs()} />
      </StrictMode>
    );
    fireEvent.click(view.getByRole('tab', { name: 'Stay' }));
    const panel = view.getByRole('tabpanel');
    expect(panel.textContent).toBe('Stay body');
    expect(view.getByRole('tab', { name: 'Stay' }).getAttribute('aria-selected')).toBe('true');
    expect(panel.getAttribute('aria-labelledby')).toBe(view.getByRole('tab', { name: 'Stay' }).id);
    expect(view.queryByText('Plan body')).toBeNull();
  });

  it('moves and selects with arrows, Home and End, wrapping at the ends', () => {
    const view = render(<A2uiSurface surface={tabs()} />);
    const list = view.getByRole('tablist');
    const selected = () => view.getByRole('tab', { selected: true });
    view.getAllByRole('tab')[0].focus();
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(selected().textContent).toBe('Stay');
    expect(document.activeElement).toBe(selected());
    fireEvent.keyDown(list, { key: 'End' });
    expect(selected().textContent).toBe('Notes <b>');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(selected().textContent).toBe('Plan');
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    expect(selected().textContent).toBe('Notes <b>');
    fireEvent.keyDown(list, { key: 'Home' });
    expect(selected().textContent).toBe('Plan');
    expect(document.activeElement).toBe(selected());
  });

  it('leaves modified and unrelated keys alone', () => {
    const view = render(<A2uiSurface surface={tabs()} />);
    const list = view.getByRole('tablist');
    for (const init of [
      { key: 'ArrowRight', ctrlKey: true },
      { key: 'ArrowRight', altKey: true },
      { key: 'ArrowDown' },
      { key: 'a' },
    ])
      expect(fireEvent.keyDown(list, init)).toBe(true);
    expect(view.getByRole('tab', { selected: true }).textContent).toBe('Plan');
  });

  it('reverses the arrow keys in a right-to-left surface', () => {
    // jsdom does not inherit direction; the installed browser fixture checks the real cascade.
    const computed = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({ direction: 'rtl' } as CSSStyleDeclaration);
    const view = render(<A2uiSurface surface={tabs()} />);
    fireEvent.keyDown(view.getByRole('tablist'), { key: 'ArrowLeft' });
    computed.mockRestore();
    expect(view.getByRole('tab', { selected: true }).textContent).toBe('Stay');
  });

  it('falls back to the first tab when the selected one is removed, and follows new titles', () => {
    const view = render(<A2uiSurface surface={tabs()} />);
    fireEvent.click(view.getByRole('tab', { name: 'Notes <b>' }));
    view.rerender(
      <A2uiSurface
        surface={surface(
          [
            { id: 'root', component: 'Tabs', tabs: [{ title: { path: '/t' }, child: 'a' }] },
            text('a', 'Plan body'),
          ],
          { t: 'Only' }
        )}
      />
    );
    expect(view.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Only']);
    expect(view.getByRole('tab').getAttribute('aria-selected')).toBe('true');
    expect(view.getByRole('tabpanel').textContent).toBe('Plan body');
  });

  it('renders nothing for tabs without any usable tab', () => {
    for (const value of [undefined, [], 'x', [{ title: 'T' }]]) {
      const view = render(
        <A2uiSurface
          surface={surface([
            { id: 'root', component: 'Tabs', ...(value === undefined ? {} : { tabs: value }) },
          ])}
        />
      );
      expect(view.container.firstElementChild?.childElementCount).toBe(0);
      cleanup();
    }
  });

  it('server renders the first tab selected', () => {
    const html = renderToString(<A2uiSurface surface={tabs()} />);
    expect(html).toContain('Plan body');
    expect(html).not.toContain('Stay body');
    expect(html).toContain('aria-selected="true"');
  });
});

const modal = (extra: Record<string, unknown> = { trigger: 't', content: 'c' }) =>
  surface([
    { id: 'root', component: 'Column', children: ['m', 'after'] },
    { id: 'm', component: 'Modal', ...extra },
    text('t', 'Details'),
    text('c', 'Fare rules'),
    text('after', 'After'),
  ]);

describe('A2UI Modal', () => {
  it('converts the trigger then the content to children', () => {
    expect(a2uiSurfaceSpec(modal()).spec?.elements['m']).toEqual({
      type: 'Modal',
      props: {},
      children: ['t', 'c'],
    });
  });

  it('shows only the trigger until it is opened', () => {
    const view = render(<A2uiSurface surface={modal()} />);
    const trigger = view.getByRole('button', { name: 'Details' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.tabIndex).toBe(0);
    expect(view.container.querySelector('dialog')).toBeNull();
    expect(view.queryByText('Fare rules')).toBeNull();
  });

  it('opens a native modal dialog named by the trigger', () => {
    const view = render(<A2uiSurface surface={modal()} />);
    const trigger = view.getByRole('button', { name: 'Details' });
    fireEvent.click(trigger);
    const dialog = view.container.querySelector('dialog') as HTMLDialogElement;
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe(trigger.id);
    expect(dialog.textContent).toContain('Fare rules');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens once under StrictMode', () => {
    const view = render(
      <StrictMode>
        <A2uiSurface surface={modal()} />
      </StrictMode>
    );
    fireEvent.click(view.getByRole('button', { name: 'Details' }));
    expect(view.container.querySelectorAll('dialog[open]')).toHaveLength(1);
    expect(view.getByText('Fare rules')).toBeTruthy();
  });

  it('opens from Enter and Space on the trigger itself, not from repeats or inner keys', () => {
    const view = render(<A2uiSurface surface={modal()} />);
    const trigger = view.getByRole('button', { name: 'Details' });
    fireEvent.keyDown(trigger, { key: 'Enter', repeat: true });
    fireEvent.keyDown(trigger.firstElementChild as Element, { key: 'Enter' });
    fireEvent.keyDown(trigger, { key: 'a' });
    expect(view.container.querySelector('dialog')).toBeNull();
    expect(fireEvent.keyDown(trigger, { key: ' ' })).toBe(false);
    expect(view.container.querySelector('dialog')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Close' }));
    expect(fireEvent.keyDown(trigger, { key: 'Enter' })).toBe(false);
    expect(view.container.querySelector('dialog')).toBeTruthy();
  });

  it('closes from the Close button, the native close event and the backdrop, not from the panel', () => {
    const view = render(<A2uiSurface surface={modal()} />);
    const trigger = view.getByRole('button', { name: 'Details' });
    const dialog = () => view.container.querySelector('dialog');
    fireEvent.click(trigger);
    fireEvent.click(view.getByText('Fare rules'));
    expect(dialog()).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Close' }));
    expect(dialog()).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    // Escape reaches the page as the dialog's native close event.
    fireEvent(dialog() as Element, new Event('close'));
    expect(dialog()).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(dialog() as Element);
    expect(dialog()).toBeNull();
  });

  it('closes the native dialog when the surface unmounts while open', () => {
    const view = render(<A2uiSurface surface={modal()} />);
    fireEvent.click(view.getByRole('button', { name: 'Details' }));
    view.unmount();
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
  });

  it('opens an empty dialog without content and renders nothing without a trigger', () => {
    const view = render(<A2uiSurface surface={modal({ trigger: 't' })} />);
    fireEvent.click(view.getByRole('button', { name: 'Details' }));
    expect(view.container.querySelector('.a2ui-modal__panel')?.textContent).toBe('Close');
    cleanup();
    const none = render(<A2uiSurface surface={modal({})} />);
    expect(none.queryByRole('button')).toBeNull();
    expect(none.getByText('After')).toBeTruthy();
  });

  it('server renders the trigger closed', () => {
    const html = renderToString(<A2uiSurface surface={modal()} />);
    expect(html).toContain('Details');
    expect(html).not.toContain('<dialog');
    expect(html).not.toContain('Fare rules');
  });
});
