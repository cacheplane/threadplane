import { useState } from 'react';
import { cleanup, createEvent, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OverflowMenu, Select, type SelectOption } from './index';

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

const options: readonly SelectOption[] = [
  { value: 'a', label: 'Alpha', description: 'Zulu time' },
  { value: 'b', label: 'Bravo' },
  { value: 'bo', label: 'Boston' },
  { value: 'off', label: 'Bermuda', disabled: true },
  { value: 'c', label: '  Charlie Brown' },
  { value: 'e', label: 'Éclair' },
];

function Picker({ changed }: { changed?: (value: string) => void }) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <Select
      label="City"
      options={options}
      value={value}
      onValueChange={(next) => {
        changed?.(next);
        setValue(next);
      }}
      open={open}
      onOpenChange={setOpen}
    />
  );
}

const openPicker = (changed?: (value: string) => void) => {
  const view = render(<Picker changed={changed} />);
  fireEvent.click(view.container.querySelector('button')!);
  return view;
};

let clock = 1000;
/** Presses a key on the focused entry at a controlled event time. */
function press(key: string, init: KeyboardEventInit = {}, wait = 50) {
  clock += wait;
  const target = document.activeElement as HTMLElement;
  const event = createEvent.keyDown(target, { key, ...init });
  Object.defineProperty(event, 'timeStamp', { value: clock });
  fireEvent(target, event);
  return event;
}
const focused = () =>
  document.activeElement?.querySelector('.tp-select__option-label')
    ?.textContent ?? document.activeElement?.textContent;

it('moves focus to the next enabled option whose label starts with the typed character', () => {
  const changed = vi.fn();
  openPicker(changed);
  expect(focused()).toBe('Alpha');
  const event = press('b');
  expect(focused()).toBe('Bravo');
  expect(event.defaultPrevented).toBe(true);
  // Typing only moves focus; the owner's value is untouched.
  expect(changed).not.toHaveBeenCalled();
});

it('matches a multi-character prefix typed quickly, staying on an entry that still matches', () => {
  openPicker();
  press('b');
  expect(focused()).toBe('Bravo');
  press('o');
  expect(focused()).toBe('Boston');
  press('s');
  expect(focused()).toBe('Boston');
});

it('starts a new search after a pause', () => {
  openPicker();
  press('b');
  press('o', {}, 501);
  // "o" alone matches nothing, so focus stays.
  expect(focused()).toBe('Bravo');
  press('c', {}, 501);
  expect(focused()).toBe('  Charlie Brown');
});

it('cycles through entries sharing a first character, wrapping and skipping disabled ones', () => {
  openPicker();
  press('b');
  expect(focused()).toBe('Bravo');
  press('b');
  expect(focused()).toBe('Boston');
  press('b');
  expect(focused()).toBe('Bravo');
});

it('ignores case, leading label whitespace and descriptions, and matches non-ASCII labels', () => {
  openPicker();
  press('C', { shiftKey: true });
  expect(focused()).toBe('  Charlie Brown');
  // "Zulu time" is Alpha's description, not its label.
  press('z', {}, 501);
  expect(focused()).toBe('  Charlie Brown');
  press('é', {}, 501);
  expect(focused()).toBe('Éclair');
});

it('leaves Space, modified keys and IME composition to their existing meaning', () => {
  openPicker();
  press('b');
  expect(press(' ').defaultPrevented).toBe(false);
  expect(press('c', { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(press('c', { metaKey: true }).defaultPrevented).toBe(false);
  expect(press('c', { altKey: true }).defaultPrevented).toBe(false);
  expect(press('c', { isComposing: true }).defaultPrevented).toBe(false);
  expect(focused()).toBe('Bravo');
});

it('forgets the search when an arrow key moves focus or the list closes', () => {
  openPicker();
  press('b');
  press('ArrowDown');
  expect(focused()).toBe('Boston');
  // A fresh "a", not "ba".
  press('a');
  expect(focused()).toBe('Alpha');
});

it('does not let a typed character reach application shortcuts', () => {
  const shortcut = vi.fn();
  document.addEventListener('keydown', shortcut);
  openPicker();
  press('b');
  press('x');
  document.removeEventListener('keydown', shortcut);
  expect(shortcut).not.toHaveBeenCalled();
});

it('gives a command menu the same typeahead over its item labels', () => {
  const onSelect = vi.fn();
  function Menu() {
    const [open, setOpen] = useState(false);
    return (
      <OverflowMenu
        label="Thread actions"
        open={open}
        onOpenChange={setOpen}
        onSelect={onSelect}
        items={[
          { id: 'rename', label: 'Rename' },
          { id: 'pin', label: 'Pin' },
          { id: 'remove', label: 'Remove', disabled: true },
          { id: 'report', label: 'Report', tone: 'destructive' },
        ]}
      />
    );
  }
  const view = render(<Menu />);
  fireEvent.click(view.container.querySelector('button')!);
  expect(document.activeElement).toBe(
    view.getByRole('menuitem', { name: 'Rename' })
  );
  press('p');
  expect(document.activeElement?.textContent).toBe('Pin');
  // The search continues from the focused entry and skips the disabled one.
  press('r', {}, 501);
  expect(document.activeElement?.textContent).toBe('Report');
  press('r');
  expect(document.activeElement?.textContent).toBe('Rename');
  press('r');
  expect(document.activeElement?.textContent).toBe('Report');
  press('e', {}, 501);
  press('p');
  // No "ep" entry: focus stays, and nothing was selected by typing.
  expect(document.activeElement?.textContent).toBe('Report');
  expect(onSelect).not.toHaveBeenCalled();
});
