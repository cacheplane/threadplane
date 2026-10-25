import { useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as chat from './index';
const items = [
  { id: 'a', label: 'Alpha' },
  { id: 'off', label: 'Disabled', disabled: true },
  { id: 'b', label: 'Beta', tone: 'destructive' as const },
];
function Controlled({ initial = false }: { initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <chat.OverflowMenu
      label="Actions for literal <ID>"
      items={items}
      open={open}
      onOpenChange={setOpen}
      onSelect={() => undefined}
    />
  );
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    function (this: HTMLElement) {
      return [this.getBoundingClientRect()] as unknown as DOMRectList;
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('exports the controlled chat menu as a runtime component', () => {
  expect('OverflowMenu' in chat && typeof chat.OverflowMenu).toBe('function');
});
it('reveals measured placement before attempting browser focus', () => {
  const original = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
    this: HTMLElement
  ) {
    if (
      (this.closest('[role="menu"]') as HTMLElement | null)?.style
        .visibility !== 'hidden'
    )
      original.call(this);
  });
  const view = render(<Controlled initial />);
  expect(document.activeElement).toBe(
    view.getByRole('menuitem', { name: 'Alpha' })
  );
});

it('requests controlled toggling without mounting or moving focus when refused', () => {
  const change = vi.fn();
  const view = render(
    <chat.OverflowMenu
      label="Actions"
      items={items}
      open={false}
      onOpenChange={change}
      onSelect={vi.fn()}
    />
  );
  const trigger = view.getByRole('button', { name: 'Actions' });
  trigger.focus();
  fireEvent.click(trigger);
  expect(change.mock.calls).toEqual([[true]]);
  expect(view.queryByRole('menu')).toBeNull();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(trigger.hasAttribute('aria-controls')).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

it('starts a fresh first-item opening when ordinary activation follows refused ArrowUp', () => {
  let requests = 0;
  function App() {
    const [open, setOpen] = useState(false);
    return (
      <chat.OverflowMenu
        label="Actions"
        items={items}
        open={open}
        onSelect={vi.fn()}
        onOpenChange={(value) => {
          if (++requests > 1) setOpen(value);
        }}
      />
    );
  }
  const view = render(<App />);
  const trigger = view.getByRole('button', { name: 'Actions' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowUp' });
  expect(view.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  expect(document.activeElement).toBe(
    view.getByRole('menuitem', { name: 'Alpha' })
  );
});

it('does not retain a refused keyboard focus intent for a later external opening', () => {
  const props = {
    label: 'Actions',
    items,
    onOpenChange: vi.fn(),
    onSelect: vi.fn(),
  };
  const view = render(<chat.OverflowMenu {...props} open={false} />);
  fireEvent.keyDown(view.getByRole('button'), { key: 'ArrowUp' });
  expect(view.queryByRole('menu')).toBeNull();
  view.rerender(<chat.OverflowMenu {...props} open />);
  expect(document.activeElement).toBe(
    view.getByRole('menuitem', { name: 'Alpha' })
  );
});

it('preserves an open menu and focused item across label and unrelated ancestor attributes', async () => {
  const change = vi.fn();
  const props = {
    label: 'Before',
    items,
    open: true,
    onOpenChange: change,
    onSelect: vi.fn(),
  };
  const view = render(
    <section>
      <chat.OverflowMenu {...props} />
    </section>
  );
  const menu = view.getByRole('menu');
  const focused = view.getByRole('menuitem', { name: 'Beta' });
  focused.focus();
  await act(async () =>
    view.rerender(
      <section>
        <chat.OverflowMenu {...props} label="After" />
      </section>
    )
  );
  expect(view.getByRole('menu', { name: 'After' })).toBe(menu);
  expect(change).not.toHaveBeenCalled();
  const trigger = view.getByRole('button', { name: 'After' });
  const parent = trigger.parentElement;
  if (!parent) throw Error('Missing parent');
  await act(async () => {
    parent.setAttribute('data-review', 'changed');
    parent.setAttribute('title', 'Unrelated tooltip');
    parent.setAttribute('aria-label', 'Unrelated name');
  });
  expect(change).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(focused);
});

it.each(['token', 'font', 'theme', 'direction'])(
  'still dismisses actual %s presentation changes',
  async (kind) => {
    const change = vi.fn();
    const view = render(
      <section>
        <chat.OverflowMenu
          label="Actions"
          items={items}
          open
          onOpenChange={change}
          onSelect={vi.fn()}
        />
      </section>
    );
    const parent = view.getByRole('button', { name: 'Actions' }).parentElement;
    if (!parent) throw Error('Missing parent');
    await act(async () => {
      if (kind === 'token')
        parent.style.setProperty('--tp-chat-surface', 'rgb(1, 2, 3)');
      if (kind === 'font') parent.style.fontFamily = 'monospace';
      if (kind === 'theme') parent.setAttribute('data-theme', 'dark');
      if (kind === 'direction') parent.setAttribute('dir', 'rtl');
    });
    expect(change.mock.calls).toEqual([[false]]);
  }
);

it('portals named ordered native items, focuses and navigates enabled items, closes on Escape before parent', () => {
  const parent = vi.fn();
  const view = render(
    <div onKeyDown={parent}>
      <Controlled />
    </div>
  );
  const trigger = view.getByRole('button', {
    name: 'Actions for literal <ID>',
  });
  expect(trigger.title).toBe('Actions for literal <ID>');
  fireEvent.keyDown(trigger, { key: 'ArrowUp' });
  const menu = view.getByRole('menu', { name: 'Actions for literal <ID>' });
  expect(menu.parentElement).toBe(document.body);
  expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  const [a, disabled, b] = view.getAllByRole('menuitem');
  expect([a.textContent, disabled.textContent, b.textContent]).toEqual([
    'Alpha',
    'Disabled',
    'Beta',
  ]);
  expect((disabled as HTMLButtonElement).disabled).toBe(true);
  expect(document.activeElement).toBe(b);
  expect(b.tabIndex).toBe(0);
  expect(a.tabIndex).toBe(-1);
  fireEvent.keyDown(b, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(a);
  fireEvent.keyDown(a, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(b);
  fireEvent.keyDown(b, { key: 'Home' });
  expect(document.activeElement).toBe(a);
  fireEvent.keyDown(a, { key: 'End' });
  expect(document.activeElement).toBe(b);
  parent.mockClear();
  fireEvent.keyDown(b, { key: 'Escape' });
  expect(parent).not.toHaveBeenCalled();
  expect(view.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('emits the literal ID and original mouse event synchronously once and respects deliberate owner focus', () => {
  const select = vi.fn();
  function App() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <input aria-label="Destination" />
        <chat.OverflowMenu
          label="Actions"
          items={items}
          open={open}
          onOpenChange={setOpen}
          onSelect={(id, event) => {
            select(
              id,
              event.currentTarget.ownerDocument,
              event.currentTarget.textContent
            );
            document.querySelector<HTMLInputElement>('input')?.focus();
          }}
        />
      </>
    );
  }
  const view = render(<App />);
  fireEvent.click(view.getByRole('menuitem', { name: 'Disabled' }));
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('menuitem', { name: 'Beta' }));
  expect(select.mock.calls).toEqual([['b', document, 'Beta']]);
  expect(view.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(view.getByRole('textbox'));
});

it('retains keyed focused items on rerender and recovers removed or disabled focus', () => {
  const props = {
    label: 'Actions',
    items,
    open: true,
    onOpenChange: vi.fn(),
    onSelect: vi.fn(),
  };
  const view = render(<chat.OverflowMenu {...props} />);
  const a = view.getByRole('menuitem', { name: 'Alpha' });
  const b = view.getByRole('menuitem', { name: 'Beta' });
  b.focus();
  view.rerender(
    <chat.OverflowMenu
      {...props}
      items={[items[2], items[0]]}
      onSelect={vi.fn()}
    />
  );
  expect(view.getByRole('menuitem', { name: 'Beta' })).toBe(b);
  expect(document.activeElement).toBe(b);
  view.rerender(<chat.OverflowMenu {...props} items={[items[0]]} />);
  expect(document.activeElement).toBe(a);
  view.rerender(<chat.OverflowMenu {...props} items={[]} />);
  expect(document.activeElement).toBe(view.getByRole('menu'));
});

it('dismisses outside pointer/focus, external scroll and resize, but ignores menu scroll and claimed input', () => {
  const change = vi.fn();
  const view = render(
    <>
      <input aria-label="Outside" />
      <chat.OverflowMenu
        label="Actions"
        items={items}
        open={true}
        onOpenChange={change}
        onSelect={vi.fn()}
      />
    </>
  );
  const menu = view.getByRole('menu');
  fireEvent.scroll(menu);
  expect(change).not.toHaveBeenCalled();
  fireEvent.pointerDown(view.getByRole('textbox'));
  expect(change.mock.calls).toEqual([[false]]);
  change.mockClear();
  fireEvent.focusIn(view.getByRole('textbox'));
  expect(change.mock.calls).toEqual([[false]]);
  change.mockClear();
  fireEvent.scroll(document);
  expect(change.mock.calls).toEqual([[false]]);
  change.mockClear();
  fireEvent(window, new Event('resize'));
  expect(change.mock.calls).toEqual([[false]]);
  view.unmount();
  change.mockClear();
  fireEvent.scroll(document);
  fireEvent(window, new Event('resize'));
  expect(change).not.toHaveBeenCalled();
});

it('suppresses unavailable anchors for the remaining refused open cycle and exposes effective ARIA', async () => {
  const change = vi.fn();
  const props = {
    label: 'Actions',
    items,
    open: true,
    onOpenChange: change,
    onSelect: vi.fn(),
  };
  const view = render(
    <section>
      <chat.OverflowMenu {...props} />
    </section>
  );
  const trigger = view.getByRole('button', { name: 'Actions' });
  const parent = trigger.parentElement;
  if (!parent) throw Error('Missing anchor parent');
  await act(async () => {
    parent.hidden = true;
  });
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(change).toHaveBeenCalledWith(false);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(trigger.hasAttribute('aria-controls')).toBe(false);
  await act(async () => {
    parent.hidden = false;
  });
  view.rerender(
    <section>
      <chat.OverflowMenu {...props} />
    </section>
  );
  expect(view.queryByRole('menu')).toBeNull();
  view.rerender(
    <section>
      <chat.OverflowMenu {...props} open={false} />
    </section>
  );
  view.rerender(
    <section>
      <chat.OverflowMenu {...props} />
    </section>
  );
  expect(view.getByRole('menu')).toBeTruthy();
});

it('snapshots local RTL, tokens, inherited font and clamps flipped placement', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return (
        this.getAttribute('role') === 'menu'
          ? {
              width: 180,
              height: 120,
              top: 0,
              bottom: 120,
              left: 0,
              right: 180,
            }
          : {
              width: 40,
              height: 40,
              top: 740,
              bottom: 780,
              left: 980,
              right: 1020,
            }
      ) as DOMRect;
    }
  );
  const view = render(
    <div
      dir="rtl"
      style={
        {
          direction: 'rtl',
          fontFamily: 'monospace',
          '--tp-chat-surface': 'rgb(1, 2, 3)',
        } as React.CSSProperties
      }
    >
      <Controlled initial />
    </div>
  );
  const menu = view.getByRole('menu');
  expect(menu.getAttribute('dir')).toBe('rtl');
  expect(menu.style.getPropertyValue('--tp-chat-surface')).toBe('rgb(1, 2, 3)');
  expect(Number.parseFloat(menu.style.left)).toBeLessThanOrEqual(836);
  expect(Number.parseFloat(menu.style.top)).toBeLessThan(740);
});

it('reclamps a growing React item label while preserving the focused surviving item', () => {
  let size = { width: 100, height: 40 };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return (
        this.getAttribute('role') === 'menu'
          ? { ...size, top: 0, left: 0, right: size.width, bottom: size.height }
          : {
              width: 40,
              height: 40,
              top: 700,
              bottom: 740,
              left: 960,
              right: 1000,
            }
      ) as DOMRect;
    }
  );
  const props = {
    label: 'Actions',
    items,
    open: true,
    onOpenChange: vi.fn(),
    onSelect: vi.fn(),
  };
  const view = render(<chat.OverflowMenu {...props} />);
  const focused = view.getByRole('menuitem', { name: 'Beta' });
  focused.focus();
  size = { width: 500, height: 300 };
  view.rerender(
    <chat.OverflowMenu
      {...props}
      items={items.map((item) => ({
        ...item,
        label: `${item.label} with a much longer wrapping label`,
      }))}
    />
  );
  const menu = view.getByRole('menu');
  expect(Number.parseFloat(menu.style.left) + size.width).toBeLessThanOrEqual(
    innerWidth - 8
  );
  expect(Number.parseFloat(menu.style.top) + size.height).toBeLessThanOrEqual(
    innerHeight - 8
  );
  expect(document.activeElement).toBe(focused);
  expect(props.onOpenChange).not.toHaveBeenCalled();
});

it('observes portal size changes and reclamps without resetting current focus', () => {
  let resize: (() => void) | undefined;
  const observed: Element[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = () => callback([], this);
      }
      observe(target: Element) {
        observed.push(target);
      }
      unobserve() {
        /* test observer */
      }
      disconnect() {
        /* test observer */
      }
    }
  );
  let size = { width: 100, height: 40 };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return (
        this.getAttribute('role') === 'menu'
          ? { ...size, top: 0, left: 0, right: size.width, bottom: size.height }
          : {
              width: 40,
              height: 40,
              top: 700,
              bottom: 740,
              left: 960,
              right: 1000,
            }
      ) as DOMRect;
    }
  );
  const view = render(<Controlled initial />);
  const focused = view.getByRole('menuitem', { name: 'Beta' });
  focused.focus();
  size = { width: 500, height: 300 };
  act(() => resize?.());
  const menu = view.getByRole('menu');
  expect(Number.parseFloat(menu.style.left) + size.width).toBeLessThanOrEqual(
    innerWidth - 8
  );
  expect(Number.parseFloat(menu.style.top) + size.height).toBeLessThanOrEqual(
    innerHeight - 8
  );
  expect(observed).toContain(menu);
  expect(document.activeElement).toBe(focused);
});

it.each(
  [[], [{ id: 'off', label: 'Disabled', disabled: true }]].map((entries) => [
    entries,
  ])
)('focuses the menu fallback for no enabled items', (entries) => {
  const view = render(
    <chat.OverflowMenu
      label="Actions"
      items={entries}
      open
      onOpenChange={vi.fn()}
      onSelect={vi.fn()}
    />
  );
  expect(document.activeElement).toBe(view.getByRole('menu'));
  fireEvent.keyDown(view.getByRole('menu'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(view.getByRole('menu'));
});

it('restores focus only after controlled closure is accepted', () => {
  const change = vi.fn();
  const props = {
    label: 'Actions',
    items,
    open: true,
    onOpenChange: change,
    onSelect: vi.fn(),
  };
  const view = render(<chat.OverflowMenu {...props} />);
  const item = view.getByRole('menuitem', { name: 'Alpha' });
  fireEvent.keyDown(item, { key: 'Escape' });
  expect(change.mock.calls).toEqual([[false]]);
  expect(document.activeElement).toBe(item);
  view.rerender(<chat.OverflowMenu {...props} open={false} />);
  expect(document.activeElement).toBe(
    view.getByRole('button', { name: 'Actions' })
  );
});

it('uses strict true disabled values, preserves literal labels and respects claimed events', () => {
  const select = vi.fn();
  const change = vi.fn();
  const view = render(
    <chat.OverflowMenu
      label="Actions"
      disabled={'true' as unknown as boolean}
      items={[
        {
          id: '<&',
          label: '<b>literal &</b>',
          disabled: 'true' as unknown as boolean,
        },
      ]}
      open
      onOpenChange={change}
      onSelect={select}
    />
  );
  const item = view.getByRole('menuitem', { name: '<b>literal &</b>' });
  expect((item as HTMLButtonElement).disabled).toBe(false);
  const claimed = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  claimed.preventDefault();
  fireEvent(item, claimed);
  const pointer = new Event('pointerdown', { bubbles: true, cancelable: true });
  pointer.preventDefault();
  fireEvent(document.body, pointer);
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(item);
  expect(select.mock.calls[0][0]).toBe('<&');
});

it.each([
  'hidden',
  'inert',
  'display',
  'visibility',
  'no-layout',
  'disconnected',
  'disabled',
])(
  'suppresses a newly unavailable %s anchor without stealing deliberate focus',
  async (reason) => {
    const change = vi.fn();
    const view = render(
      <>
        <input aria-label="Owner destination" />
        <section>
          <chat.OverflowMenu
            label="Actions"
            items={items}
            open
            onOpenChange={change}
            onSelect={vi.fn()}
          />
        </section>
      </>
    );
    const trigger = view.getByRole('button', {
      name: 'Actions',
    }) as HTMLButtonElement;
    const section = trigger.parentElement;
    if (!section) throw Error('Missing anchor parent');
    await act(async () => {
      view.getByRole('textbox').focus();
      if (reason === 'hidden') section.hidden = true;
      if (reason === 'inert') section.setAttribute('inert', '');
      if (reason === 'display') section.style.display = 'none';
      if (reason === 'visibility') section.style.visibility = 'hidden';
      if (reason === 'no-layout') {
        vi.spyOn(trigger, 'getClientRects').mockReturnValue(
          [] as unknown as DOMRectList
        );
        section.setAttribute('data-layout', 'none');
      }
      if (reason === 'disconnected') section.remove();
      if (reason === 'disabled') trigger.disabled = true;
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(change).toHaveBeenCalledWith(false);
    expect(document.activeElement).toBe(view.getByRole('textbox'));
    if (reason === 'disconnected') view.container.append(section);
  }
);

it('portals into the trigger document and releases owner listeners on unmount', () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const doc = frame.contentDocument;
  if (!doc?.defaultView) throw Error('Missing frame document');
  vi.spyOn(
    doc.defaultView.HTMLElement.prototype,
    'getClientRects'
  ).mockReturnValue([{}] as unknown as DOMRectList);
  const change = vi.fn();
  const view = render(
    <chat.OverflowMenu
      label="Owner actions"
      items={items}
      open
      onOpenChange={change}
      onSelect={vi.fn()}
    />,
    { container: doc.body }
  );
  expect(view.getByRole('menu').parentElement).toBe(doc.body);
  expect(doc.activeElement).toBe(view.getByRole('menuitem', { name: 'Alpha' }));
  fireEvent.pointerDown(document.body);
  expect(change).not.toHaveBeenCalled();
  view.unmount();
  fireEvent.pointerDown(doc.body);
  expect(change).not.toHaveBeenCalled();
  frame.remove();
});

it.each([
  ['ltr', { x: 100, y: 200 }, 100, 204],
  ['rtl', { x: 300, y: 200 }, 120, 204],
  ['ltr', { x: -40, y: -20 }, 8, 8],
  ['ltr', { x: 9999, y: 9999 }, 836, 640],
  ['ltr', { x: NaN, y: 200 }, 240, 84],
  ['ltr', { x: 100, y: Infinity }, 240, 84],
] as const)(
  'places context points with direction, flip, clamp and trigger fallback: %s %s',
  (direction, anchorPoint, left, top) => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        return (
          this.getAttribute('role') === 'menu'
            ? {
                width: 180,
                height: 120,
                left: 0,
                right: 180,
                top: 0,
                bottom: 120,
              }
            : {
                width: 40,
                height: 40,
                left: 380,
                right: 420,
                top: 40,
                bottom: 80,
              }
        ) as DOMRect;
      }
    );
    const view = render(
      <div dir={direction} style={{ direction }}>
        <chat.OverflowMenu
          label="Actions"
          items={items}
          open
          onOpenChange={vi.fn()}
          onSelect={vi.fn()}
          anchorPoint={anchorPoint}
        />
      </div>
    );
    const menu = view.getByRole('menu');
    expect(menu.style.left).toBe(`${left}px`);
    expect(menu.style.top).toBe(`${top}px`);
  }
);

it('remeasures changed points without remounting or resetting focus and observes latest coordinates', () => {
  let resize: (() => void) | undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {
        /* Observer callbacks are driven explicitly by the test. */
      }
      disconnect() {
        /* No native observer resources are allocated. */
      }
    }
  );
  let width = 100;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return (
        this.getAttribute('role') === 'menu'
          ? { width, height: 40, left: 0, right: width, top: 0, bottom: 40 }
          : { width: 40, height: 40, left: 0, right: 40, top: 0, bottom: 40 }
      ) as DOMRect;
    }
  );
  const props = {
    label: 'Actions',
    items,
    open: true,
    onOpenChange: vi.fn(),
    onSelect: vi.fn(),
  };
  const view = render(
    <chat.OverflowMenu {...props} anchorPoint={{ x: 50, y: 60 }} />
  );
  const menu = view.getByRole('menu');
  const beta = view.getByRole('menuitem', { name: 'Beta' });
  beta.focus();
  view.rerender(
    <chat.OverflowMenu {...props} anchorPoint={{ x: 900, y: 100 }} />
  );
  expect(view.getByRole('menu')).toBe(menu);
  expect(menu.style.left).toBe('900px');
  expect(menu.style.top).toBe('104px');
  expect(document.activeElement).toBe(beta);
  width = 200;
  act(() => resize?.());
  expect(menu.style.left).toBe('816px');
  expect(menu.style.top).toBe('104px');
  expect(document.activeElement).toBe(beta);
});

it.each(['Escape', 'Tab', 'ShiftTab', 'command'])(
  'returns to the invoking row on %s',
  (kind) => {
    const invoker = document.createElement('button');
    document.body.append(invoker);
    function App() {
      const [open, setOpen] = useState(true);
      return (
        <chat.OverflowMenu
          label="Actions"
          items={items}
          open={open}
          onOpenChange={setOpen}
          onSelect={vi.fn()}
          returnFocusTo={invoker}
        />
      );
    }
    const view = render(<App />);
    const item = view.getByRole('menuitem', { name: 'Alpha' });
    if (kind === 'command') fireEvent.click(item);
    else
      fireEvent.keyDown(item, {
        key: kind === 'ShiftTab' ? 'Tab' : kind,
        shiftKey: kind === 'ShiftTab',
      });
    expect(document.activeElement).toBe(invoker);
    invoker.remove();
  }
);

it.each([
  'hidden',
  'inert',
  'disabled',
  'disconnected',
  'foreign',
  'unfocusable',
])('falls back from an unavailable %s invoker to the trigger', (kind) => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const foreignDocument = frame.contentDocument;
  if (!foreignDocument) throw Error('Missing iframe document');
  const invoker = (
    kind === 'foreign' ? foreignDocument : document
  ).createElement(kind === 'unfocusable' ? 'div' : 'button');
  invoker.ownerDocument.body.append(invoker);
  if (kind === 'hidden') invoker.hidden = true;
  if (kind === 'inert') invoker.setAttribute('inert', '');
  if (kind === 'disabled') invoker.setAttribute('disabled', '');
  if (kind === 'disconnected') invoker.remove();
  function App() {
    const [open, setOpen] = useState(true);
    return (
      <chat.OverflowMenu
        label="Actions"
        items={items}
        open={open}
        onOpenChange={setOpen}
        onSelect={vi.fn()}
        returnFocusTo={invoker}
      />
    );
  }
  const view = render(<App />);
  fireEvent.keyDown(view.getByRole('menuitem', { name: 'Alpha' }), {
    key: 'Escape',
  });
  expect(document.activeElement).toBe(
    view.getByRole('button', { name: 'Actions' })
  );
  invoker.remove();
  frame.remove();
});

it.each(['Escape', 'Tab', 'command'])(
  'issues one controlled close while returning to an invoker for %s',
  (kind) => {
    const invoker = document.createElement('button');
    document.body.append(invoker);
    const change = vi.fn();
    function App() {
      const [open, setOpen] = useState(true);
      return (
        <chat.OverflowMenu
          label="Actions"
          items={items}
          open={open}
          onOpenChange={(next) => {
            change(next);
            setOpen(next);
          }}
          onSelect={vi.fn()}
          returnFocusTo={open ? invoker : null}
        />
      );
    }
    const view = render(<App />);
    const item = view.getByRole('menuitem', { name: 'Alpha' });
    if (kind === 'command') fireEvent.click(item);
    else fireEvent.keyDown(item, { key: kind });
    expect(document.activeElement).toBe(invoker);
    expect(change.mock.calls).toEqual([[false]]);
    invoker.remove();
  }
);

it('keeps deliberate external focus when an accepted command closes a context menu', () => {
  const invoker = document.createElement('button');
  document.body.append(invoker);
  function App() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <input aria-label="Destination" />
        <chat.OverflowMenu
          label="Actions"
          items={items}
          open={open}
          onOpenChange={setOpen}
          returnFocusTo={invoker}
          onSelect={() =>
            document.querySelector<HTMLInputElement>('input')?.focus()
          }
        />
      </>
    );
  }
  const view = render(<App />);
  fireEvent.click(view.getByRole('menuitem', { name: 'Alpha' }));
  expect(document.activeElement).toBe(view.getByRole('textbox'));
  invoker.remove();
});

it('does not return focus to the context invoker while controlled closure is refused', () => {
  const invoker = document.createElement('button');
  document.body.append(invoker);
  const props = {
    label: 'Actions',
    items,
    open: true,
    onOpenChange: vi.fn(),
    onSelect: vi.fn(),
    returnFocusTo: invoker,
  };
  const view = render(<chat.OverflowMenu {...props} />);
  const item = view.getByRole('menuitem', { name: 'Alpha' });
  fireEvent.keyDown(item, { key: 'Escape' });
  expect(document.activeElement).toBe(item);
  view.rerender(
    <chat.OverflowMenu {...props} open={false} returnFocusTo={null} />
  );
  expect(document.activeElement).toBe(invoker);
  invoker.remove();
});

it('suppresses point menus when their real trigger is unavailable', () => {
  const change = vi.fn();
  const view = render(
    <chat.OverflowMenu
      label="Actions"
      items={items}
      open
      disabled
      anchorPoint={{ x: 200, y: 300 }}
      onOpenChange={change}
      onSelect={vi.fn()}
    />
  );
  expect(view.queryByRole('menu')).toBeNull();
  expect(change.mock.calls).toEqual([[false]]);
});
