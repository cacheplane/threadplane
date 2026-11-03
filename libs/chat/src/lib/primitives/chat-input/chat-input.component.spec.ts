import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal, computed } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ChatInputComponent, submitMessage } from './chat-input.component';
import { mockAgent } from '../../testing/mock-agent';

function setSignalInput<T>(sig: unknown, value: T): void {
  const obj = sig as Record<symbol, unknown>;
  const signalSymbol = Object.getOwnPropertySymbols(obj).find(
    (s) => s.description === 'SIGNAL',
  );
  if (!signalSymbol) throw new Error('Could not find SIGNAL symbol on input');
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

describe('submitMessage()', () => {
  it('does not dispatch ordinary input when the adapter blocks it', () => {
    const agent = mockAgent();
    const blocked = { ...agent, isInputBlocked: signal(true) };
    expect(submitMessage(blocked, 'keep my draft')).toBeNull();
    expect(agent.submitCalls).toHaveLength(0);
  });
  it('calls agent.submit with { message: trimmed text }', async () => {
    const agent = mockAgent();

    submitMessage(agent, '  hello world  ');

    // Flush the async submit (it's void-async, we just need microtask flush)
    await Promise.resolve();
    expect(agent.submitCalls).toHaveLength(1);
    expect(agent.submitCalls[0].input).toEqual({ message: 'hello world' });
  });

  it('returns the trimmed text on successful submit', () => {
    const agent = mockAgent();
    const result = submitMessage(agent, '  hello  ');
    expect(result).toBe('hello');
  });

  it('does not call agent.submit and returns null for whitespace-only text', async () => {
    const agent = mockAgent();

    const result = submitMessage(agent, '   ');

    await Promise.resolve();
    expect(agent.submitCalls).toHaveLength(0);
    expect(result).toBeNull();
  });

  it('does not call agent.submit and returns null for empty string', async () => {
    const agent = mockAgent();

    const result = submitMessage(agent, '');

    await Promise.resolve();
    expect(agent.submitCalls).toHaveLength(0);
    expect(result).toBeNull();
  });
});

describe('ChatInputComponent — isDisabled computed', () => {
  it('isDisabled is false when agent.isLoading is false', () => {
    const agent = mockAgent({ isLoading: false });
    const agent$ = signal(agent);

    const isDisabled = computed(() => agent$().isLoading());

    expect(isDisabled()).toBe(false);
  });

  it('isDisabled is true when agent.isLoading is true', () => {
    const agent = mockAgent({ isLoading: true });
    const agent$ = signal(agent);

    const isDisabled = computed(() => agent$().isLoading());

    expect(isDisabled()).toBe(true);
  });

  it('isDisabled updates reactively when agent changes', () => {
    const idleAgent = mockAgent({ isLoading: false });
    const loadingAgent = mockAgent({ isLoading: true });
    const agent$ = signal(idleAgent);

    const isDisabled = computed(() => agent$().isLoading());

    expect(isDisabled()).toBe(false);
    agent$.set(loadingAgent);
    expect(isDisabled()).toBe(true);
  });
});

describe('ChatInputComponent', () => {
  let fixture: ComponentFixture<ChatInputComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(ChatInputComponent);
    setSignalInput(fixture.componentInstance.agent, mockAgent({ isLoading: false }));
    fixture.detectChanges();
  });

  it('disables Send and preserves the draft on Enter until the adapter releases input', () => {
    const agent = mockAgent();
    const blocked = signal(true);
    setSignalInput(fixture.componentInstance.agent, { ...agent, isInputBlocked: blocked });
    fixture.componentInstance.messageText.set('keep my draft');
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button[aria-label="Send message"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fixture.componentInstance.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(agent.submitCalls).toHaveLength(0);
    expect(fixture.componentInstance.messageText()).toBe('keep my draft');
    blocked.set(false);
    fixture.detectChanges();
    expect(button.disabled).toBe(false);
  });

  it('keeps the draft and starts no second run when Enter is pressed while a reply is running', () => {
    const agent = mockAgent({ isLoading: true });
    setSignalInput(fixture.componentInstance.agent, agent);
    fixture.componentInstance.messageText.set('follow-up for later');
    fixture.detectChanges();
    fixture.componentInstance.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(agent.submitCalls).toHaveLength(0);
    expect(fixture.componentInstance.messageText()).toBe('follow-up for later');
  });

  it.each([true, false])('when the focused Stop is replaced by Send, keyboard=%s moves focus to the composer only from the keyboard', async (fromKeyboard) => {
    const original = Element.prototype.matches;
    const spy = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':focus-visible' ? fromKeyboard && this === document.activeElement : original.call(this, selector);
    });
    const agent = mockAgent({ isLoading: true });
    setSignalInput(fixture.componentInstance.agent, agent);
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    try {
      const stop = fixture.nativeElement.querySelector('button[aria-label="Stop generating"]') as HTMLButtonElement;
      stop.focus();
      expect(document.activeElement).toBe(stop);
      agent.isLoading.set(false);
      fixture.detectChanges();
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      expect(document.activeElement).toBe(fromKeyboard ? fixture.nativeElement.querySelector('textarea') : document.body);
    } finally {
      fixture.nativeElement.remove();
      spy.mockRestore();
    }
  });

  it('says why Enter did nothing while a reply runs, and clears that when the reply ends', () => {
    const agent = mockAgent({ isLoading: true });
    setSignalInput(fixture.componentInstance.agent, agent);
    fixture.componentInstance.messageText.set('next question');
    fixture.detectChanges();
    const hint = () => (fixture.nativeElement as HTMLElement).querySelector('.chat-input__hint');
    expect(hint()?.textContent?.trim() ?? '').toBe('');
    fixture.componentInstance.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(hint()?.getAttribute('role')).toBe('status');
    expect(hint()?.textContent?.trim()).toBe('A response is still running. Stop it to send now, or send when it finishes.');
    agent.isLoading.set(false);
    fixture.detectChanges();
    expect(hint()?.textContent?.trim() ?? '').toBe('');
    expect(fixture.componentInstance.messageText()).toBe('next question');
  });

  it('renders the pill with full border-radius', () => {
    const pill = (fixture.nativeElement as HTMLElement).querySelector('.chat-input__pill') as HTMLElement;
    expect(pill).not.toBeNull();
    const cs = getComputedStyle(pill);
    expect(cs.borderRadius).toBe('9999px');
  });

  it('renders the send button as a circle', () => {
    const btn = (fixture.nativeElement as HTMLElement).querySelector('.chat-input__send') as HTMLElement;
    expect(btn).not.toBeNull();
    const cs = getComputedStyle(btn);
    expect(cs.borderRadius).toBe('50%');
  });

  it('exposes [chatInputModelSelect] slot inside the controls row', () => {
    const controls = (fixture.nativeElement as HTMLElement).querySelector('.chat-input__controls');
    expect(controls).not.toBeNull();
  });

  it('auto-resizes textarea height when messageText changes — bug #198 regression', () => {
    // Live Chrome smoke caught: rows="1" textarea did not grow with
    // multi-line input. clientHeight stayed at 24px while scrollHeight
    // grew to 72px+, hiding lines past the first. Fix: an effect() sets
    // el.style.height = scrollHeight (capped at 200px) on every change.
    const textarea = (fixture.nativeElement as HTMLElement).querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    fixture.componentInstance.messageText.set('line one\nline two\nline three');
    fixture.detectChanges();
    // The effect sets el.style.height; jsdom layout produces a value (
    // possibly '0px' due to no real layout, but the property is set).
    expect(textarea.style.height).not.toBe('');
  });
});

describe('ChatInputComponent — clears view on submit (F1 regression)', () => {
  let fixture: ComponentFixture<ChatInputComponent>;
  let agent: ReturnType<typeof mockAgent>;

  beforeEach(() => {
    agent = mockAgent();
    TestBed.configureTestingModule({ imports: [ChatInputComponent] });
    fixture = TestBed.createComponent(ChatInputComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
  });

  it('empties both the signal and the textarea DOM value after Enter submit', async () => {
    const textarea: HTMLTextAreaElement =
      fixture.nativeElement.querySelector('textarea');
    // Simulate real typing: set the DOM value and fire the input event.
    textarea.value = 'hello world';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.messageText()).toBe('hello world');

    // Enter-key submit (the (keydown.enter) path).
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(agent.submitCalls).toHaveLength(1);
    expect(fixture.componentInstance.messageText()).toBe('');
    // The DOM must reflect the clear. (Historical bug: ngModel never wrote
    // the programmatic '' back to the view in real browsers. In jsdom both
    // the [value] binding and the explicit el.value='' clear satisfy this;
    // the Playwright e2e regression covers the real-browser path.)
    expect(textarea.value).toBe('');
  });
});
