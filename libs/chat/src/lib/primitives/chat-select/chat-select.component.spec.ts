// libs/chat/src/lib/primitives/chat-select/chat-select.component.spec.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatSelectComponent, type ChatSelectOption } from './chat-select.component';
import { ChatPopupComponent } from '../../compositions/chat-popup/chat-popup.component';
import { ChatSidebarComponent } from '../../compositions/chat-sidebar/chat-sidebar.component';

const OPTS: readonly ChatSelectOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie', disabled: true },
];

// SIGNAL-symbol writer for input signals (canonical pattern; setInput()
// silently no-ops with NG0303 under vitest JIT).
function setSignalInput<T>(fixture: ComponentFixture<unknown>, name: string, value: T): void {
  const inputs = fixture.componentInstance as Record<string, unknown>;
  const sig = inputs[name];
  const obj = sig as Record<symbol, unknown>;
  const signalSymbol = Object.getOwnPropertySymbols(obj).find(
    (s) => s.description === 'SIGNAL',
  );
  if (!signalSymbol) throw new Error(`Could not find SIGNAL symbol on input "${name}"`);
  const node = obj[signalSymbol] as {
    applyValueToInputSignal?: (n: unknown, v: T) => void;
    value?: T;
  };
  if (typeof node.applyValueToInputSignal === 'function') {
    node.applyValueToInputSignal(node, value);
  } else {
    node.value = value;
  }
}

describe('ChatSelectComponent', () => {
  let fixture: ComponentFixture<ChatSelectComponent>;
  let host: HTMLElement;
  // The menu renders through the chat connected-overlay primitive (a body-level
  // portal), so it lives in .chat-overlay-container, NOT inside the component host.
  const overlayRoot = () => document.querySelector('.chat-overlay-container') as HTMLElement | null;

  const trigger = () => host.querySelector<HTMLButtonElement>('.chat-select__trigger')!;
  const menu = () => overlayRoot()?.querySelector('.chat-select__menu') ?? null;
  const optionEls = () => overlayRoot()?.querySelectorAll<HTMLButtonElement>('.chat-select__option') ?? ([] as unknown as NodeListOf<HTMLButtonElement>);

  beforeEach(() => {
    fixture = TestBed.createComponent(ChatSelectComponent);
    setSignalInput(fixture, 'options', OPTS);
    setSignalInput(fixture, 'value', 'a');
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    // Destroying the fixture detaches the overlay, clearing the
    // overlay container between tests.
    fixture.destroy();
    overlayRoot()?.remove();
  });

  it('renders the selected option label', () => {
    expect(host.querySelector('.chat-select__label')?.textContent).toContain('Alpha');
  });

  it('falls back to placeholder when value not in options', () => {
    setSignalInput(fixture, 'value', '');
    setSignalInput(fixture, 'placeholder', 'Pick one');
    fixture.detectChanges();
    expect(host.querySelector('.chat-select__label')?.textContent).toContain('Pick one');
  });

  it('opens the menu on trigger click', () => {
    expect(menu()).toBeNull();
    trigger().click();
    fixture.detectChanges();
    expect(menu()).not.toBeNull();
    expect(optionEls().length).toBe(3);
  });

  it('renders an option description as a subtitle, and omits it when absent', () => {
    setSignalInput(fixture, 'options', [
      { value: 'a', label: 'Alpha', description: 'The first letter' },
      { value: 'b', label: 'Bravo' },
    ] as readonly ChatSelectOption[]);
    fixture.detectChanges();
    trigger().click();
    fixture.detectChanges();
    const opts = optionEls();
    expect(opts[0].querySelector('.chat-select__option-desc')?.textContent).toContain('The first letter');
    expect(opts[1].querySelector('.chat-select__option-desc')).toBeNull();
  });

  it('emits valueChange and closes the menu on option click', () => {
    let emitted: string | undefined;
    fixture.componentInstance.value.subscribe((v) => { emitted = v; });
    trigger().click();
    fixture.detectChanges();
    optionEls()[1].click();
    fixture.detectChanges();
    expect(emitted).toBe('b');
    expect(menu()).toBeNull();
  });

  it('does not select a disabled option', () => {
    let emitted: string | undefined;
    fixture.componentInstance.value.subscribe((v) => { emitted = v; });
    trigger().click();
    fixture.detectChanges();
    const charlie = optionEls()[2];
    expect(charlie.disabled).toBe(true);
    charlie.click();
    fixture.detectChanges();
    expect(emitted).toBeUndefined();
  });

  it('closes the menu on Escape', () => {
    trigger().click();
    fixture.detectChanges();
    expect(menu()).not.toBeNull();
    const evt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    menu()!.dispatchEvent(evt);
    fixture.detectChanges();
    expect(menu()).toBeNull();
  });

  it('closes the menu on Escape when focus is still on the trigger — bug #198 regression', () => {
    // Live Chrome smoke caught: clicking the trigger to open the menu leaves
    // focus on the trigger (not the menu). Pressing Escape there used to be
    // ignored — only Escape inside the menu was handled. Fix: handle Escape
    // in onTriggerKeydown when the menu is open.
    const t = trigger();
    t.click();
    fixture.detectChanges();
    expect(menu()).not.toBeNull();
    const evt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    t.dispatchEvent(evt);
    fixture.detectChanges();
    expect(menu()).toBeNull();
  });

  describe.each([
    ['popup', ChatPopupComponent],
    ['sidebar', ChatSidebarComponent],
  ] as const)('inside a %s', (_name, Surface) => {
    it.each(['menu', 'trigger'] as const)(
      'dismisses the select before the parent when Escape starts on the %s',
      (escapeFrom) => {
        // Use the real surface's window listener. The menu is portaled to the
        // body, so both menu and trigger events must stop before reaching it.
        const surface = TestBed.runInInjectionContext(() => new Surface());
        surface.openWindow();
        fixture.detectChanges();
        trigger().focus();
        trigger().click();
        fixture.detectChanges();
        expect(menu()).not.toBeNull();

        const target = escapeFrom === 'menu' ? optionEls()[0] : trigger();
        target.focus();
        target.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', bubbles: true, cancelable: true,
        }));
        fixture.detectChanges();

        expect(menu()).toBeNull();
        expect(surface.open()).toBe(true);
        expect(document.activeElement).toBe(trigger());

        trigger().dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', bubbles: true, cancelable: true,
        }));
        fixture.detectChanges();
        expect(surface.open()).toBe(false);
      },
    );
  });

  it('disables the trigger when [disabled]=true', () => {
    setSignalInput(fixture, 'disabled', true);
    fixture.detectChanges();
    expect(trigger().disabled).toBe(true);
  });
});
