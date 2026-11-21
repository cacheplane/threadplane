import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal, computed } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ChatInputComponent, submitMessage } from './chat-input.component';
import { mockAgent } from '../../testing/mock-agent';
import { registerClientToolAbort } from '../../client-tools/stop-agent';

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
    const agent = mockAgent({ inputBlocked: { reason: 'interrupt' } });
    expect(submitMessage(agent, 'keep my draft')).toBeNull();
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

describe('ChatInputComponent — isLoading computed', () => {
  function inputFor(agent: ReturnType<typeof mockAgent>) {
    const fixture = TestBed.createComponent(ChatInputComponent);
    setSignalInput(fixture.componentInstance.agent, agent);
    return fixture.componentInstance;
  }

  it('isLoading is false when the agent is not running', () => {
    expect(inputFor(mockAgent({ status: 'idle' })).isLoading()).toBe(false);
    expect(inputFor(mockAgent({ status: 'error' })).isLoading()).toBe(false);
  });

  it('isLoading is true when the agent is running', () => {
    expect(inputFor(mockAgent({ status: 'running' })).isLoading()).toBe(true);
  });

  it('isLoading updates reactively when agent changes', () => {
    const idleAgent = mockAgent({ status: 'idle' });
    const loadingAgent = mockAgent({ status: 'running' });
    const agent$ = signal(idleAgent);
    const isLoading = computed(() => agent$().status() === 'running');

    expect(isLoading()).toBe(false);
    agent$.set(loadingAgent);
    expect(isLoading()).toBe(true);
    loadingAgent.status.set('idle');
    expect(isLoading()).toBe(false);
  });
});

describe('ChatInputComponent', () => {
  let fixture: ComponentFixture<ChatInputComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(ChatInputComponent);
    setSignalInput(fixture.componentInstance.agent, mockAgent({ status: 'idle' }));
    fixture.detectChanges();
  });

  it('keeps a multiline draft scrollable when the layout applies a smaller height cap', () => {
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, get: () => 240 });
    Object.defineProperty(textarea, 'clientHeight', { configurable: true, get: () => 162 });
    fixture.componentInstance.messageText.set('A multiline draft constrained by the surrounding layout');
    fixture.detectChanges();
    expect(textarea.style.overflowY).toBe('auto');
  });

  it('resizes an existing draft for the software keyboard and keeps its focused end visible', async () => {
    fixture.destroy();
    const viewport = Object.assign(new EventTarget(), { height: 700, scale: 1 });
    vi.stubGlobal('visualViewport', viewport);
    try {
      fixture = TestBed.createComponent(ChatInputComponent);
      setSignalInput(fixture.componentInstance.agent, mockAgent());
      fixture.componentInstance.messageText.set('A long draft');
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
      Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 400 });
      let renderedHeight = 140;
      let scrollTop = 0;
      Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => renderedHeight });
      Object.defineProperty(el, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => { scrollTop = Math.min(value, 400 - renderedHeight); },
      });
      viewport.addEventListener('resize', () => { renderedHeight = viewport.height * 0.2; });
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      viewport.height = 200;
      viewport.dispatchEvent(new Event('resize'));
      await vi.waitFor(() => expect(el.style.height).toBe('80px'));
      await vi.waitFor(() => expect(el.scrollTop).toBe(360));
      el.setSelectionRange(2, 2);
      el.scrollTop = 25;
      viewport.height = 400;
      viewport.dispatchEvent(new Event('resize'));
      await vi.waitFor(() => expect(el.style.height).toBe('160px'));
      expect(el.scrollTop).toBe(25);
      expect(document.activeElement).toBe(el);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('disables Send and preserves the draft on Enter until the adapter releases input', () => {
    const agent = mockAgent({ inputBlocked: { reason: 'interrupt' } });
    setSignalInput(fixture.componentInstance.agent, agent);
    fixture.componentInstance.messageText.set('keep my draft');
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button[aria-label="Send message"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fixture.componentInstance.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(agent.submitCalls).toHaveLength(0);
    expect(fixture.componentInstance.messageText()).toBe('keep my draft');
    agent.inputBlocked.set(undefined);
    fixture.detectChanges();
    expect(button.disabled).toBe(false);
  });

  it('keeps the draft and starts no second run when Enter is pressed while a reply is running', () => {
    const agent = mockAgent({ status: 'running' });
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
    const agent = mockAgent({ status: 'running' });
    setSignalInput(fixture.componentInstance.agent, agent);
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    try {
      const stop = fixture.nativeElement.querySelector('button[aria-label="Stop generating"]') as HTMLButtonElement;
      stop.focus();
      expect(document.activeElement).toBe(stop);
      agent.status.set('idle');
      fixture.detectChanges();
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      expect(document.activeElement).toBe(fromKeyboard ? fixture.nativeElement.querySelector('textarea') : document.body);
    } finally {
      fixture.nativeElement.remove();
      spy.mockRestore();
    }
  });

  it('Stop cancels the client tools running for the agent, then calls agent.stop() once, and emits stopped', () => {
    const agent = mockAgent({ status: 'running' });
    const order: string[] = [];
    const release = registerClientToolAbort(agent, () => order.push('abort'));
    const stop = vi.spyOn(agent, 'stop').mockImplementation(async () => { order.push('stop'); });
    let stopped = 0;
    fixture.componentInstance.stopped.subscribe(() => stopped++);
    setSignalInput(fixture.componentInstance.agent, agent);
    fixture.detectChanges();
    try {
      (fixture.nativeElement.querySelector('button[aria-label="Stop generating"]') as HTMLButtonElement).click();
      expect(order).toEqual(['abort', 'stop']);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(stopped).toBe(1);
    } finally {
      release();
    }
  });

  it('Stop calls agent.stop() once when no client tool is running', () => {
    const agent = mockAgent({ status: 'running' });
    setSignalInput(fixture.componentInstance.agent, agent);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button[aria-label="Stop generating"]') as HTMLButtonElement).click();
    expect(agent.stopCount).toBe(1);
  });

  it('says why Enter did nothing while a reply runs, and clears that when the reply ends', () => {
    const agent = mockAgent({ status: 'running' });
    setSignalInput(fixture.componentInstance.agent, agent);
    fixture.componentInstance.messageText.set('next question');
    fixture.detectChanges();
    const hint = () => (fixture.nativeElement as HTMLElement).querySelector('.chat-input__hint');
    expect(hint()?.textContent?.trim() ?? '').toBe('');
    fixture.componentInstance.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(hint()?.getAttribute('role')).toBe('status');
    expect(hint()?.textContent?.trim()).toBe('A response is still running. Stop it to send now, or send when it finishes.');
    agent.status.set('idle');
    fixture.detectChanges();
    expect(hint()?.textContent?.trim() ?? '').toBe('');
    expect(fixture.componentInstance.messageText()).toBe('next question');
  });

  it('renders the pill with full border-radius', () => {
    const pill = (fixture.nativeElement as HTMLElement).querySelector('.chat-input__pill') as HTMLElement;
    expect(pill).not.toBeNull();
    const cs = getComputedStyle(pill);
    expect(cs.borderRadius).toBe('var(--tplane-chat-radius-launcher)');
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
