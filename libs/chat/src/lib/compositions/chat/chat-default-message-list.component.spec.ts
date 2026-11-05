import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';
import {
  ChatDefaultMessageListComponent,
  type ChatDefaultRowsRenderer,
} from './chat-default-message-list.component';
import { ChatMessageListComponent } from '../../primitives/chat-message-list/chat-message-list.component';
import { MessageTemplateDirective } from '../../primitives/chat-message-list/message-template.directive';
import { mockAgent } from '../../testing/mock-agent';

@Component({
  standalone: true,
  imports: [ChatDefaultMessageListComponent, MessageTemplateDirective],
  template: `<chat-message-list
    chatDefaultMessages
    [agent]="agent"
    [renderer]="renderer"
  >
    @if (alternate()) {
    <ng-template chatMessageTemplate="human">alternate</ng-template>
    } @else {
    <ng-template chatMessageTemplate="ai">initial</ng-template>
    }
  </chat-message-list>`,
})
class QueryHost {
  readonly alternate = signal(false);
  readonly agent = mockAgent();
  // Empty history exercises inherited query/input metadata without invoking
  // any rendering callback; actual row semantics use the real Chat context.
  readonly renderer = {} as ChatDefaultRowsRenderer;
}

describe('private default list inherited public contracts', () => {
  it('aliases the original list token to the same instance and retains live queries', () => {
    const fixture = TestBed.createComponent(QueryHost);
    fixture.detectChanges();
    const node = fixture.debugElement.query(
      By.directive(ChatDefaultMessageListComponent)
    );
    const list = node.componentInstance as ChatDefaultMessageListComponent;
    expect(list).toBeInstanceOf(ChatMessageListComponent);
    expect(node.injector.get(ChatMessageListComponent)).toBe(list);
    expect(
      fixture.debugElement.query(By.directive(ChatMessageListComponent))
        .componentInstance
    ).toBe(list);
    expect(list.agent()).toBe(fixture.componentInstance.agent);
    expect(list.messageTemplates()).toHaveLength(1);
    expect(list.findTemplate('ai')).toBe(list.messageTemplates()[0]);
    expect(list.findTemplate('human')).toBeUndefined();
    fixture.componentInstance.alternate.set(true);
    fixture.detectChanges();
    expect(list.messageTemplates()).toHaveLength(1);
    expect(list.findTemplate('human')).toBe(list.messageTemplates()[0]);
    expect(list.findTemplate('ai')).toBeUndefined();
    const next: [] = [];
    fixture.componentInstance.agent.messages.set(next);
    fixture.detectChanges();
    expect(list.messages()).toBe(next);
    expect(
      fixture.nativeElement.querySelectorAll('chat-message-list')
    ).toHaveLength(1);
    expect(fixture.nativeElement.textContent).not.toContain('alternate');
  });
});
