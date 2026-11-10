import { StrictMode, useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as chat from './index';
import type { SelectOption } from './index';

const options: readonly SelectOption[] = [
  { value: 'a', label: 'Alpha', description: 'The first <letter>' },
  { value: 'off', label: 'Disabled', disabled: true },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie' },
];

function Controlled({
  initial = '',
  initialOpen = false,
  changed,
  disabled,
  items = options,
  label = 'Model',
}: {
  initial?: string;
  initialOpen?: boolean;
  changed?: (value: string) => void;
  disabled?: boolean;
  items?: readonly SelectOption[];
  label?: string;
}) {
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(initialOpen);
  return (
    <chat.Select
      label={label}
      placeholder="Pick one"
      options={items}
      value={value}
      onValueChange={(next) => {
        changed?.(next);
        setValue(next);
      }}
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
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
});

const trigger = (view: ReturnType<typeof render>) =>
  view.container.querySelector<HTMLButtonElement>('.tp-select__trigger')!;

it('exports the controlled select as a runtime component', () => {
  expect('Select' in chat && typeof chat.Select).toBe('function');
});

it('shows the selected label, or the placeholder for an absent value, without mounting a list', () => {
  const view = render(<Controlled initial="b" />);
  expect(trigger(view).textContent).toBe('Bravo');
  expect(trigger(view).getAttribute('aria-haspopup')).toBe('listbox');
  expect(trigger(view).getAttribute('aria-expanded')).toBe('false');
  expect(trigger(view).hasAttribute('aria-controls')).toBe(false);
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  view.rerender(<Controlled key="missing" initial="missing" />);
  expect(trigger(view).textContent).toBe('Pick one');
});

it('defaults the placeholder to Select', () => {
  const view = render(
    <chat.Select
      label="Model"
      options={options}
      value=""
      onValueChange={() => undefined}
      open={false}
      onOpenChange={() => undefined}
    />
  );
  expect(trigger(view).textContent).toBe('Select');
});

it('portals a named listbox of literal native options and marks only the selected one', () => {
  const view = render(<Controlled initial="b" />);
  fireEvent.click(trigger(view));
  const list = view.getByRole('listbox', { name: 'Model' });
  expect(list.parentElement).toBe(document.body);
  expect(view.container.contains(list)).toBe(false);
  expect(trigger(view).getAttribute('aria-expanded')).toBe('true');
  expect(trigger(view).getAttribute('aria-controls')).toBe(list.id);
  const rendered = Array.from(
    list.querySelectorAll<HTMLButtonElement>('[role="option"]')
  );
  expect(rendered.map((node) => node.type)).toEqual(Array(4).fill('button'));
  expect(
    rendered.map(
      (node) => node.querySelector('.tp-select__option-label')!.textContent
    )
  ).toEqual(['Alpha', 'Disabled', 'Bravo', 'Charlie']);
  expect(rendered.map((node) => node.getAttribute('aria-selected'))).toEqual([
    'false',
    'false',
    'true',
    'false',
  ]);
  expect(rendered.map((node) => node.disabled)).toEqual([
    false,
    true,
    false,
    false,
  ]);
  expect(
    rendered[0].querySelector('.tp-select__option-description')!.textContent
  ).toBe('The first <letter>');
  expect(
    rendered[2].querySelector('.tp-select__option-description')
  ).toBeNull();
});

it('focuses the selected option on opening, or the first enabled one when none is selectable', () => {
  const view = render(<Controlled initial="b" />);
  fireEvent.click(trigger(view));
  expect(document.activeElement).toBe(
    view.getByRole('option', { name: 'Bravo' })
  );
  cleanup();
  const disabledSelection = render(<Controlled initial="off" />);
  fireEvent.click(trigger(disabledSelection));
  expect(document.activeElement).toBe(
    disabledSelection.getByRole('option', { name: /^Alpha/ })
  );
});

it('opens from the trigger at the selection with ArrowDown and at the last option with ArrowUp', () => {
  const view = render(<Controlled initial="b" />);
  fireEvent.keyDown(trigger(view), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(
    view.getByRole('option', { name: 'Bravo' })
  );
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  fireEvent.keyDown(trigger(view), { key: 'ArrowUp' });
  expect(document.activeElement).toBe(
    view.getByRole('option', { name: 'Charlie' })
  );
});

it('leaves focus to the natural Tab order and closes', () => {
  const view = render(<Controlled initial="b" />);
  fireEvent.click(trigger(view));
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(trigger(view));
});

it('skips disabled options with arrows, wraps, and supports Home and End', () => {
  const view = render(<Controlled />);
  fireEvent.keyDown(trigger(view), { key: 'ArrowDown' });
  const alpha = view.getByRole('option', { name: /^Alpha/ });
  const bravo = view.getByRole('option', { name: 'Bravo' });
  const charlie = view.getByRole('option', { name: 'Charlie' });
  expect(document.activeElement).toBe(alpha);
  fireEvent.keyDown(alpha, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(bravo);
  fireEvent.keyDown(bravo, { key: 'End' });
  expect(document.activeElement).toBe(charlie);
  fireEvent.keyDown(charlie, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(alpha);
  fireEvent.keyDown(alpha, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(charlie);
  fireEvent.keyDown(charlie, { key: 'Home' });
  expect(document.activeElement).toBe(alpha);
});

it('reports one accepted change with the literal value, closes and returns focus to the trigger', () => {
  const changed = vi.fn();
  const view = render(<Controlled initial="a" changed={changed} />);
  fireEvent.click(trigger(view));
  fireEvent.click(view.getByRole('option', { name: 'Bravo' }));
  expect(changed.mock.calls).toEqual([['b']]);
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(trigger(view).textContent).toBe('Bravo');
  expect(document.activeElement).toBe(trigger(view));
});

it('reports no change for a disabled option, and only closes for the current one', () => {
  const changed = vi.fn();
  const view = render(<Controlled initial="a" changed={changed} />);
  fireEvent.click(trigger(view));
  fireEvent.click(view.getByRole('option', { name: 'Disabled' }));
  expect(changed).not.toHaveBeenCalled();
  expect(document.querySelector('[role="listbox"]')).not.toBeNull();
  fireEvent.click(view.getByRole('option', { name: /^Alpha/ }));
  expect(changed).not.toHaveBeenCalled();
  expect(document.querySelector('[role="listbox"]')).toBeNull();
});

it('keeps the owner value when a change is refused, and the list when closing is refused', () => {
  const change = vi.fn();
  const openChange = vi.fn();
  const view = render(
    <chat.Select
      label="Model"
      options={options}
      value="a"
      onValueChange={change}
      open
      onOpenChange={openChange}
    />
  );
  fireEvent.click(view.getByRole('option', { name: 'Bravo' }));
  expect(change).toHaveBeenCalledTimes(1);
  expect(change.mock.calls[0][0]).toBe('b');
  expect(change.mock.calls[0][1].type).toBe('click');
  expect(openChange.mock.calls).toEqual([[false]]);
  expect(trigger(view).textContent).toBe('Alpha');
  expect(
    view.getByRole('option', { name: /^Alpha/ }).getAttribute('aria-selected')
  ).toBe('true');
});

it('closes on Escape from an option or the trigger and restores trigger focus', () => {
  const parent = vi.fn();
  const view = render(
    <div onKeyDown={parent}>
      <Controlled />
    </div>
  );
  fireEvent.click(trigger(view));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(trigger(view));
  fireEvent.click(trigger(view));
  trigger(view).focus();
  fireEvent.keyDown(trigger(view), { key: 'Escape' });
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(parent).not.toHaveBeenCalled();
  // A closed trigger leaves Escape to its ancestors.
  fireEvent.keyDown(trigger(view), { key: 'Escape' });
  expect(parent).toHaveBeenCalledTimes(1);
});

it('dismisses on an outside pointer without taking focus from the new target', () => {
  const view = render(
    <>
      <Controlled />
      <button type="button">Elsewhere</button>
    </>
  );
  fireEvent.click(trigger(view));
  const elsewhere = view.getByRole('button', { name: 'Elsewhere' });
  fireEvent.pointerDown(elsewhere);
  elsewhere.focus();
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(elsewhere);
});

it('uses a strict true disabled value and never opens a disabled select', () => {
  const openChange = vi.fn();
  const view = render(
    <chat.Select
      label="Model"
      options={options}
      value="a"
      onValueChange={() => undefined}
      open
      onOpenChange={openChange}
      disabled
    />
  );
  expect(trigger(view).disabled).toBe(true);
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(trigger(view).getAttribute('aria-expanded')).toBe('false');
  view.rerender(
    <chat.Select
      label="Model"
      options={options}
      value="a"
      onValueChange={() => undefined}
      open={false}
      onOpenChange={openChange}
      disabled={'true' as unknown as boolean}
    />
  );
  expect(trigger(view).disabled).toBe(false);
});

it('prefers the space above the trigger and falls back below when it does not fit', () => {
  const rect = (top: number, height: number, left = 100, width = 80) =>
    ({
      top,
      left,
      width,
      height,
      bottom: top + height,
      right: left + width,
      x: left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect);
  let anchorTop = 600;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return this.getAttribute('role') === 'listbox'
        ? rect(0, 200, 0, 180)
        : rect(anchorTop, 32);
    }
  );
  const view = render(<Controlled />);
  fireEvent.click(trigger(view));
  expect(view.getByRole('listbox').style.top).toBe('392px');
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  anchorTop = 100;
  fireEvent.click(trigger(view));
  expect(view.getByRole('listbox').style.top).toBe('140px');
});

it('applies caller classes to the trigger and the portaled list', () => {
  const view = render(
    <chat.Select
      label="Model"
      className="mine"
      menuClassName="wide"
      options={options}
      value=""
      onValueChange={() => undefined}
      open
      onOpenChange={() => undefined}
    />
  );
  expect(trigger(view).className).toBe('tp-select__trigger mine');
  expect(view.getByRole('listbox').className).toBe('tp-select__menu wide');
});

it('keeps independent instances and releases the portal on StrictMode unmount', () => {
  const first = vi.fn();
  const second = vi.fn();
  const view = render(
    <StrictMode>
      <Controlled label="First" changed={first} />
      <Controlled label="Second" changed={second} initialOpen />
    </StrictMode>
  );
  expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(1);
  const list = view.getByRole('listbox', { name: 'Second' });
  fireEvent.click(list.querySelector('[data-item-id="c"]')!);
  expect(first).not.toHaveBeenCalled();
  expect(second.mock.calls).toEqual([['c']]);
  const triggers = view.container.querySelectorAll('.tp-select__trigger');
  expect(Array.from(triggers).map((node) => node.textContent)).toEqual([
    'Pick one',
    'Charlie',
  ]);
  fireEvent.click(triggers[0]);
  expect(view.getByRole('listbox', { name: 'First' })).toBeTruthy();
  view.unmount();
  expect(document.querySelector('[role="listbox"]')).toBeNull();
});
