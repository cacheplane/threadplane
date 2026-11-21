// NOTE: Angular signal-based inputs cannot be exercised via
// componentRef.setInput() under vitest JIT (NG0303). We follow the established
// pattern used by streaming-markdown.component.spec.ts and use a
// SIGNAL-symbol writer for input signals, with TestBed.createComponent to
// exercise template rendering and DOM event wiring.
import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatWelcomeSuggestionComponent } from './chat-welcome-suggestion.component';

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

describe('ChatWelcomeSuggestionComponent', () => {
  let fixture: ComponentFixture<ChatWelcomeSuggestionComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(ChatWelcomeSuggestionComponent);
    setSignalInput(fixture.componentInstance.label, 'Tell me about yourself');
    setSignalInput(fixture.componentInstance.value, 'tell-me');
    fixture.detectChanges();
  });

  it('renders the label', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Tell me about yourself');
  });

  it('emits select with the value on click', () => {
    let emitted: string | undefined;
    fixture.componentInstance.selected.subscribe((v: string) => {
      emitted = v;
    });
    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    expect(button).not.toBeNull();
    button!.click();
    expect(emitted).toBe('tell-me');
  });

  it('exposes description as a title + aria-description tooltip when set', () => {
    setSignalInput(fixture.componentInstance.description, 'What this prompt demonstrates');
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(button.getAttribute('title')).toBe('What this prompt demonstrates');
    expect(button.getAttribute('aria-description')).toBe('What this prompt demonstrates');
  });

  it('omits the tooltip attributes when no description is provided', () => {
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(button.getAttribute('title')).toBeNull();
    expect(button.getAttribute('aria-description')).toBeNull();
  });
});
