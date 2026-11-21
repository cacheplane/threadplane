import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChatMessageActionsComponent } from './chat-message-actions.component';

describe('ChatMessageActionsComponent — Regenerate', () => {
  function render() {
    const fixture = TestBed.createComponent(ChatMessageActionsComponent);
    fixture.componentRef.setInput('content', 'An answer');
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const regenerate = () => root.querySelector<HTMLButtonElement>('button[aria-label="Regenerate response"]');
    const labels = () => Array.from(root.querySelectorAll('button')).map((button) => button.getAttribute('aria-label'));
    return { fixture, regenerate, labels };
  }

  it('offers Regenerate by default and emits when it is activated', () => {
    const { fixture, regenerate, labels } = render();
    let emitted = 0;
    fixture.componentInstance.regenerate.subscribe(() => emitted++);
    expect(labels()).toEqual(['Regenerate response', 'Copy to clipboard', 'Thumbs up', 'Thumbs down']);
    regenerate()!.click();
    expect(emitted).toBe(1);
  });

  it('disables Regenerate, and nothing else, while disabled', () => {
    const { fixture, regenerate } = render();
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect(regenerate()!.disabled).toBe(true);
    expect(regenerate()!.getAttribute('aria-disabled')).toBe('true');
    const others = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).slice(1);
    expect(others.every((button) => !button.disabled)).toBe(true);
  });

  it('offers no Regenerate control when canRegenerate is false, and keeps the other actions', () => {
    const { fixture, regenerate, labels } = render();
    fixture.componentRef.setInput('canRegenerate', false);
    fixture.detectChanges();
    expect(regenerate()).toBeNull();
    expect(labels()).toEqual(['Copy to clipboard', 'Thumbs up', 'Thumbs down']);

    fixture.componentRef.setInput('canRegenerate', true);
    fixture.detectChanges();
    expect(regenerate()).not.toBeNull();
  });
});
