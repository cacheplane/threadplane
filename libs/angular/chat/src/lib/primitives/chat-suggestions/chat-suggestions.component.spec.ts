// NOTE: Angular signal-based inputs cannot be exercised via TestBed.createComponent +
// componentRef.setInput() under vitest JIT without the analogjs Angular vite plugin —
// setInput() throws NG0303 because JIT does not process signal-input metadata.
// We follow the same pattern used by chat-trace, chat-typing-indicator, and
// a2ui/catalog/button in this library: test signal/output logic via
// runInInjectionContext and verify the class structure directly.
import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { OutputEmitterRef } from '@angular/core';
import { ChatSuggestionsComponent } from './chat-suggestions.component';

describe('ChatSuggestionsComponent', () => {
  it('exports the component class', () => {
    expect(ChatSuggestionsComponent).toBeDefined();
  });

  it('suggestions signal defaults to empty array', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const instance = new ChatSuggestionsComponent();
      expect(instance.suggestions()).toEqual([]);
    });
  });

  it('has a selected output', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const instance = new ChatSuggestionsComponent();
      expect(instance.selected).toBeInstanceOf(OutputEmitterRef);
    });
  });

  it('renders no buttons when suggestions is empty', () => {
    TestBed.configureTestingModule({});
    const fx = TestBed.createComponent(ChatSuggestionsComponent);
    fx.detectChanges();
    const buttons = (fx.nativeElement as HTMLElement).querySelectorAll('.chat-suggestion');
    expect(buttons.length).toBe(0);
  });
});
