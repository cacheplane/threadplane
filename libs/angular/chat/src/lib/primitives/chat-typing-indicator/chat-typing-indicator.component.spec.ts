import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal, computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChatTypingIndicatorComponent, isTyping } from './chat-typing-indicator.component';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery } from '../../agent';

@Component({
  standalone: true,
  imports: [ChatTypingIndicatorComponent],
  template: '<chat-typing-indicator [agent]="agent" />',
})
class HostComponent {
  readonly agent = mockAgent({ status: 'idle' });
}

describe('ChatTypingIndicatorComponent host visibility', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('removes its padded host from layout when idle', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement.querySelector('chat-typing-indicator');

    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(getComputedStyle(host).display).toBe('none');
  });

  it('restores the same host for typing and hides it when reply text arrives', () => {
    const fixture = TestBed.createComponent(HostComponent);
    const agent = fixture.componentInstance.agent;
    agent.status.set('running');
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement.querySelector('chat-typing-indicator');

    expect(getComputedStyle(host).display).not.toBe('none');
    expect(host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Assistant is typing');
    expect(host.querySelectorAll('.chat-typing__dot')).toHaveLength(3);

    agent.messages.set([
      { id: 'reply', role: 'assistant', content: 'Hello', delivery: staticDelivery('reply') },
    ]);
    fixture.detectChanges();
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(getComputedStyle(host).display).toBe('none');

    agent.status.set('idle');
    fixture.detectChanges();
    expect(getComputedStyle(host).display).toBe('none');

    agent.messages.set([
      { id: 'follow-up', role: 'user', content: 'Again', delivery: staticDelivery('follow-up') },
    ]);
    agent.status.set('running');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('chat-typing-indicator')).toBe(host);
    expect(getComputedStyle(host).display).not.toBe('none');
    expect(host.style.display).toBe('');
    expect(host.querySelectorAll('.chat-typing__dot')).toHaveLength(3);
  });
});

describe('isTyping()', () => {
  it('returns false when the agent is not running', () => {
    const agent = mockAgent({ status: 'idle' });
    expect(isTyping(agent)).toBe(false);
  });

  it('returns true when the agent is running and messages is empty', () => {
    const agent = mockAgent({ status: 'running', messages: [] });
    expect(isTyping(agent)).toBe(true);
  });

  it('returns true when loading and last message is user', () => {
    const agent = mockAgent({
      status: 'running',
      messages: [{ id: '1', role: 'user', content: 'hi' }],
    });
    expect(isTyping(agent)).toBe(true);
  });

  it('returns false when loading and last message is non-empty assistant', () => {
    const agent = mockAgent({
      status: 'running',
      messages: [
        { id: '1', role: 'user', content: 'hi' },
        { id: '2', role: 'assistant', content: 'hello there' },
      ],
    });
    expect(isTyping(agent)).toBe(false);
  });

  it('returns true when loading and last message is empty-content assistant', () => {
    const agent = mockAgent({
      status: 'running',
      messages: [
        { id: '1', role: 'user', content: 'hi' },
        { id: '2', role: 'assistant', content: '' },
      ],
    });
    expect(isTyping(agent)).toBe(true);
  });

  it('returns true when loading and last assistant message has empty block array', () => {
    const agent = mockAgent({
      status: 'running',
      messages: [
        { id: '1', role: 'user', content: 'hi' },
        { id: '2', role: 'assistant', content: '', blocks: [] },
      ],
    });
    expect(isTyping(agent)).toBe(true);
  });

  it('returns false when loading and last assistant message holds blocks but no text yet', () => {
    const agent = mockAgent({
      status: 'running',
      messages: [
        { id: '1', role: 'user', content: 'hi' },
        { id: '2', role: 'assistant', content: '', blocks: [{ type: 'tool_use', id: 't1', name: 'search', args: {} }] },
      ],
    });
    expect(isTyping(agent)).toBe(false);
  });

  it('returns false when the agent failed, and for a trailing tool message', () => {
    expect(isTyping(mockAgent({ status: 'error' }))).toBe(false);
    const agent = mockAgent({
      status: 'running',
      messages: [{ id: '1', role: 'tool', content: 'ok', toolCallId: 't1' }],
    });
    expect(isTyping(agent)).toBe(false);
  });
});

describe('ChatTypingIndicatorComponent — visible computed', () => {
  it('visible is false when the agent is not running', () => {
    const agent = mockAgent({ status: 'idle' });
    const agent$ = signal(agent);

    const visible = computed(() => isTyping(agent$()));

    expect(visible()).toBe(false);
  });

  it('visible is true when the agent is running and no messages', () => {
    const agent = mockAgent({ status: 'running', messages: [] });
    const agent$ = signal(agent);

    const visible = computed(() => isTyping(agent$()));

    expect(visible()).toBe(true);
  });

  it('visible updates reactively when agent changes', () => {
    const idleAgent = mockAgent({ status: 'idle' });
    const loadingAgent = mockAgent({
      status: 'running',
      messages: [{ id: '1', role: 'user', content: 'hi' }],
    });
    const agent$ = signal(idleAgent);

    const visible = computed(() => isTyping(agent$()));

    expect(visible()).toBe(false);
    agent$.set(loadingAgent);
    expect(visible()).toBe(true);
  });
});
