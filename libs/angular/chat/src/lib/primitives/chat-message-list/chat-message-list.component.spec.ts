import { describe, it, expect } from 'vitest';
import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChatMessageListComponent, getMessageType } from './chat-message-list.component';
import { MessageTemplateDirective } from './message-template.directive';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery, type Message } from '../../agent';

describe('getMessageType', () => {
  it('maps user role to "human"', () => {
    const msg: Message = { id: '1', role: 'user', content: 'hello', delivery: staticDelivery('1') };
    expect(getMessageType(msg)).toBe('human');
  });

  it('maps assistant role to "ai"', () => {
    const msg: Message = { id: '2', role: 'assistant', content: 'response', delivery: staticDelivery('2') };
    expect(getMessageType(msg)).toBe('ai');
  });

  it('maps system role to "system"', () => {
    const msg: Message = { id: '3', role: 'system', content: 'system prompt', delivery: staticDelivery('3') };
    expect(getMessageType(msg)).toBe('system');
  });

  it('maps tool role to "tool"', () => {
    const msg: Message = { id: '4', role: 'tool', content: 'result', toolCallId: 'call_1', delivery: staticDelivery('4') };
    expect(getMessageType(msg)).toBe('tool');
  });

  it('falls back to "ai" for unknown roles', () => {
    const msg = { id: '5', role: 'unknown', content: '' } as unknown as Message;
    expect(getMessageType(msg)).toBe('ai');
  });
});

@Component({
  standalone: true,
  imports: [ChatMessageListComponent, MessageTemplateDirective],
  template: `
    <chat-message-list [agent]="agent()">
      <ng-template chatMessageTemplate="human" let-message let-i="index"><p class="human">{{ i }}:{{ message.content }}</p></ng-template>
      <ng-template chatMessageTemplate="ai" let-message let-i="index"><p class="ai">{{ i }}:{{ message.content }}</p></ng-template>
    </chat-message-list>
  `,
})
class ListHost {
  readonly agent = signal(mockAgent());
  readonly list = viewChild.required(ChatMessageListComponent);
}

describe('ChatMessageListComponent — computed messages', () => {
  function render(agent = mockAgent()) {
    const fixture = TestBed.createComponent(ListHost);
    fixture.componentInstance.agent.set(agent);
    fixture.detectChanges();
    const rows = () =>
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('p')).map((p) => `${p.className}:${p.textContent}`);
    return { fixture, list: fixture.componentInstance.list(), rows };
  }

  it('messages() signal reflects the agent messages signal', () => {
    const msgs: Message[] = [
      { id: '1', role: 'user', content: 'hi', delivery: staticDelivery('1') },
      { id: '2', role: 'assistant', content: 'hello', delivery: staticDelivery('2') },
    ];
    const agent = mockAgent({ messages: msgs });
    const { list, rows } = render(agent);

    expect(list.messages()).toBe(agent.messages());
    expect(list.messages()).toHaveLength(2);
    expect(list.messages()[0].role).toBe('user');
    expect(list.messages()[1].role).toBe('assistant');
    expect(rows()).toEqual(['human:0:hi', 'ai:1:hello']);
  });

  it('messages() updates reactively when agent messages change', () => {
    const { fixture, list, rows } = render(mockAgent({ messages: [] }));
    expect(list.messages()).toHaveLength(0);

    const updatedAgent = mockAgent({
      messages: [{ id: '1', role: 'user', content: 'new message' }],
    });
    fixture.componentInstance.agent.set(updatedAgent);
    fixture.detectChanges();
    expect(list.messages()).toHaveLength(1);
    expect(rows()).toEqual(['human:0:new message']);

    // The same agent publishing another message, and one with no template.
    updatedAgent.messages.update((messages) => [
      ...messages,
      { id: '2', role: 'tool', content: 'ignored', toolCallId: 't1' },
      { id: '3', role: 'assistant', content: 'reply' },
    ]);
    fixture.detectChanges();
    expect(rows()).toEqual(['human:0:new message', 'ai:2:reply']);
  });
});

describe('ChatMessageListComponent — findTemplate logic', () => {
  it('findTemplate returns matching directive by type', () => {
    const templates = [
      { chatMessageTemplate: () => 'human' as const, templateRef: {} },
      { chatMessageTemplate: () => 'ai' as const, templateRef: {} },
    ];

    const findTemplate = (type: string) =>
      templates.find(t => t.chatMessageTemplate() === type);

    expect(findTemplate('human')).toBeDefined();
    expect(findTemplate('human')?.chatMessageTemplate()).toBe('human');
    expect(findTemplate('ai')).toBeDefined();
    expect(findTemplate('tool')).toBeUndefined();
  });

  it('findTemplate returns undefined when no templates registered', () => {
    const templates: { chatMessageTemplate: () => string }[] = [];
    const findTemplate = (type: string) =>
      templates.find(t => t.chatMessageTemplate() === type);

    expect(findTemplate('human')).toBeUndefined();
  });
});
