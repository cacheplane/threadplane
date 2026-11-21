import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Component, signal } from '@angular/core';
import { ChatReasoningComponent } from './chat-reasoning.component';
import { ChatStreamingMdComponent } from '../../streaming/streaming-markdown.component';
import { completeDelivery, streamingDelivery, type MessageDelivery } from '../../agent';

@Component({
  standalone: true,
  imports: [ChatReasoningComponent],
  template: `
    <chat-reasoning
      [content]="content()"
      [delivery]="delivery()"
      [durationMs]="durationMs()"
      [defaultExpanded]="defaultExpanded()"
    />
  `,
})
class HostComponent {
  content = signal<string>('I considered the problem.');
  delivery = signal<MessageDelivery>(completeDelivery('reasoning-1', 'success'));
  durationMs = signal<number | undefined>(undefined);
  defaultExpanded = signal<boolean>(false);
}

function makeFixture() {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return fixture;
}

function getEl(fixture: ReturnType<typeof makeFixture>): HTMLElement {
  return fixture.nativeElement.querySelector('chat-reasoning');
}

function getHeader(fixture: ReturnType<typeof makeFixture>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('chat-reasoning button.chat-reasoning__header');
}

function getLabelText(fixture: ReturnType<typeof makeFixture>): string {
  return fixture.nativeElement.querySelector('chat-reasoning .chat-reasoning__label')?.textContent?.trim() ?? '';
}

describe('ChatReasoningComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('hides itself when content is empty', () => {
    const fixture = makeFixture();
    fixture.componentInstance.content.set('');
    fixture.detectChanges();
    expect(getEl(fixture).getAttribute('data-has-content')).toBe('false');
  });

  it('shows itself when content is non-empty', () => {
    const fixture = makeFixture();
    expect(getEl(fixture).getAttribute('data-has-content')).toBe('true');
  });

  it('renders "Thinking…" while streaming', () => {
    const fixture = makeFixture();
    fixture.componentInstance.delivery.set(streamingDelivery('reasoning-1'));
    fixture.detectChanges();
    expect(getLabelText(fixture)).toContain('Thinking');
  });

  it('renders "Thought for Ns" when idle with durationMs', () => {
    const fixture = makeFixture();
    fixture.componentInstance.delivery.set(completeDelivery('reasoning-1', 'success'));
    fixture.componentInstance.durationMs.set(4000);
    fixture.detectChanges();
    expect(getLabelText(fixture)).toContain('Thought for 4s');
  });

  it('renders "Show reasoning" when idle without durationMs', () => {
    const fixture = makeFixture();
    fixture.componentInstance.delivery.set(completeDelivery('reasoning-1', 'success'));
    fixture.componentInstance.durationMs.set(undefined);
    fixture.detectChanges();
    expect(getLabelText(fixture)).toContain('Show reasoning');
  });

  it('starts collapsed by default', () => {
    const fixture = makeFixture();
    expect(getEl(fixture).getAttribute('data-expanded')).toBe('false');
  });

  it('starts expanded when defaultExpanded=true', () => {
    const fixture = makeFixture();
    fixture.componentInstance.defaultExpanded.set(true);
    fixture.detectChanges();
    expect(getEl(fixture).getAttribute('data-expanded')).toBe('true');
  });

  it('force-expands while streaming', () => {
    const fixture = makeFixture();
    fixture.componentInstance.delivery.set(streamingDelivery('reasoning-1'));
    fixture.detectChanges();
    expect(getEl(fixture).getAttribute('data-expanded')).toBe('true');
  });

  it('toggles open and closed on header click', () => {
    const fixture = makeFixture();
    const header = getHeader(fixture);
    header.click();
    fixture.detectChanges();
    expect(getEl(fixture).getAttribute('data-expanded')).toBe('true');
    header.click();
    fixture.detectChanges();
    expect(getEl(fixture).getAttribute('data-expanded')).toBe('false');
  });

  it('does not force-collapse when streaming ends (user-open persists past true → false)', () => {
    const fixture = makeFixture();
    fixture.componentInstance.delivery.set(streamingDelivery('reasoning-1'));
    fixture.detectChanges();
    expect(getEl(fixture).getAttribute('data-expanded')).toBe('true');
    // User clicks to keep it open (already open, but the click captures intent)
    getHeader(fixture).click();
    getHeader(fixture).click(); // toggle back to expanded
    fixture.detectChanges();
    fixture.componentInstance.delivery.set(completeDelivery('reasoning-1', 'success'));
    fixture.detectChanges();
    expect(getEl(fixture).getAttribute('data-expanded')).toBe('true');
  });

  it('does not force-collapse on true → false when user explicitly collapsed before streaming ended', () => {
    const fixture = makeFixture();
    fixture.componentInstance.delivery.set(streamingDelivery('reasoning-1'));
    fixture.detectChanges();
    expect(getEl(fixture).getAttribute('data-expanded')).toBe('true');
    getHeader(fixture).click(); // user collapses mid-stream
    fixture.detectChanges();
    expect(getEl(fixture).getAttribute('data-expanded')).toBe('false');
    fixture.componentInstance.delivery.set(completeDelivery('reasoning-1', 'success'));
    fixture.detectChanges();
    expect(getEl(fixture).getAttribute('data-expanded')).toBe('false');
  });

  it('auto-resets to expanded when streaming re-engages on a follow-up turn', () => {
    const fixture = makeFixture();
    // Round 1: streaming → user collapses → streaming ends
    fixture.componentInstance.delivery.set(streamingDelivery('reasoning-1'));
    fixture.detectChanges();
    getHeader(fixture).click();
    fixture.detectChanges();
    expect(getEl(fixture).getAttribute('data-expanded')).toBe('false');
    fixture.componentInstance.delivery.set(completeDelivery('reasoning-1', 'success'));
    fixture.detectChanges();
    expect(getEl(fixture).getAttribute('data-expanded')).toBe('false');
    // Round 2: streaming re-engages — should auto-expand again
    fixture.componentInstance.delivery.set(streamingDelivery('reasoning-2'));
    fixture.detectChanges();
    expect(getEl(fixture).getAttribute('data-expanded')).toBe('true');
  });

  it('renders the content body inside chat-streaming-md when expanded', () => {
    const fixture = makeFixture();
    fixture.componentInstance.defaultExpanded.set(true);
    fixture.detectChanges();
    const md = fixture.nativeElement.querySelector('chat-reasoning chat-streaming-md');
    expect(md).not.toBeNull();
  });

  it('binds reasoning markdown to delivery with the reasoning generation suffix', () => {
    const fixture = makeFixture();
    fixture.componentInstance.content.set('first\n\nsecond');
    fixture.componentInstance.delivery.set(streamingDelivery('step-2'));
    fixture.detectChanges();

    const md = fixture.debugElement.query(By.directive(ChatStreamingMdComponent));
    expect(md.componentInstance.document()).toEqual({
      generation: 'step-2:reasoning',
      phase: 'streaming',
      content: 'first\n\nsecond',
    });
  });

  it('derives reasoning UI streaming state only from delivery phase', () => {
    const fixture = makeFixture();
    fixture.componentInstance.delivery.set(completeDelivery('reasoning-1', 'paused'));
    fixture.detectChanges();
    expect(getEl(fixture).getAttribute('data-streaming')).toBe('false');

    fixture.componentInstance.delivery.set(streamingDelivery('reasoning-2'));
    fixture.detectChanges();
    expect(getEl(fixture).getAttribute('data-streaming')).toBe('true');
    expect(getLabelText(fixture)).toContain('Thinking');
  });
});
