// @vitest-environment jsdom
import { describe, test, expect, beforeEach } from 'vitest';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ChatComponent } from './compositions/chat/chat.component';
import { CHAT_LIFECYCLE, type ChatLifecycle } from './lifecycle';
import { mockAgent } from './testing/mock-agent';

describe('ChatLifecycle integration', () => {
  let fixture: ComponentFixture<ChatComponent>;
  let chatRef: ChatComponent;
  let lifecycle: ChatLifecycle;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(ChatComponent);
    chatRef = fixture.componentInstance;
    fixture.componentRef.setInput('agent', mockAgent());
    fixture.detectChanges();
    // CHAT_LIFECYCLE is component-scoped — read it from the component's injector.
    lifecycle = fixture.componentRef.injector.get(CHAT_LIFECYCLE);
  });

  test('componentReady is true after ChatComponent initializes with an agent', () => {
    expect(lifecycle.componentReady()).toBe(true);
  });

  test('firstMessageSent starts false', () => {
    // Re-create a fresh fixture so we observe the initial value before any submit.
    const f = TestBed.createComponent(ChatComponent);
    f.componentRef.setInput('agent', mockAgent());
    f.detectChanges();
    const lc = f.componentRef.injector.get(CHAT_LIFECYCLE);
    expect(lc.firstMessageSent()).toBe(false);
  });

  test('firstMessageSent flips to true after first submitMessage and stays true', () => {
    chatRef.submitMessage('hello');
    expect(lifecycle.firstMessageSent()).toBe(true);
    chatRef.submitMessage('again');
    expect(lifecycle.firstMessageSent()).toBe(true);
  });

  test('messageCount increments on each submit', () => {
    chatRef.submitMessage('one');
    chatRef.submitMessage('two');
    chatRef.submitMessage('three');
    expect(lifecycle.messageCount()).toBe(3);
  });

  test('messageCount resets on clearThread but firstMessageSent stays true', () => {
    chatRef.submitMessage('one');
    chatRef.clearThread();
    expect(lifecycle.messageCount()).toBe(0);
    expect(lifecycle.firstMessageSent()).toBe(true);
  });

  test('inputSubmittedAt updates on submit and resets to null on clearThread', () => {
    expect(lifecycle.inputSubmittedAt()).toBe(null);
    chatRef.submitMessage('one');
    expect(lifecycle.inputSubmittedAt()).toBeGreaterThan(0);
    chatRef.clearThread();
    expect(lifecycle.inputSubmittedAt()).toBe(null);
  });

  test('onUserSubmitted increments messageCount and flips firstMessageSent to true', () => {
    expect(lifecycle.messageCount()).toBe(0);
    expect(lifecycle.firstMessageSent()).toBe(false);
    chatRef.onUserSubmitted();
    expect(lifecycle.messageCount()).toBe(1);
    expect(lifecycle.firstMessageSent()).toBe(true);
  });

  test('firstMessageSent flips when agent.lifecycle.streamStartedAt transitions to non-null', () => {
    const agent = mockAgent();
    const f = TestBed.createComponent(ChatComponent);
    f.componentRef.setInput('agent', agent);
    f.detectChanges();
    const lc = f.componentRef.injector.get(CHAT_LIFECYCLE);
    expect(lc.firstMessageSent()).toBe(false);

    agent.lifecycle.streamStartedAt.set(Date.now());
    f.detectChanges();
    expect(lc.firstMessageSent()).toBe(true);
  });

  test('firstMessageSent stays sticky across multiple agent-driven transitions', () => {
    const agent = mockAgent();
    const f = TestBed.createComponent(ChatComponent);
    f.componentRef.setInput('agent', agent);
    f.detectChanges();
    const lc = f.componentRef.injector.get(CHAT_LIFECYCLE);

    agent.lifecycle.streamStartedAt.set(Date.now());
    f.detectChanges();
    expect(lc.firstMessageSent()).toBe(true);

    agent.lifecycle.streamStartedAt.set(null);
    f.detectChanges();
    expect(lc.firstMessageSent()).toBe(true);

    agent.lifecycle.streamStartedAt.set(Date.now());
    f.detectChanges();
    expect(lc.firstMessageSent()).toBe(true);
  });
});
