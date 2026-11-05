import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';
import { ChatMessageListComponent } from './chat-message-list.component';
import { MessageTemplateDirective } from './message-template.directive';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery, type Message } from '../../agent';

@Component({
  standalone: true, imports: [ChatMessageListComponent, MessageTemplateDirective],
  template: `<chat-message-list [agent]="agent" [projectedMessages]="projected()">
    @if (alternate()) {
      <ng-template chatMessageTemplate="human" let-message let-i="index"><b class="rendered">alternate:{{ i }}:{{ message.content }}</b></ng-template>
    } @else {
      <ng-template chatMessageTemplate="human" let-message let-i="index"><b class="rendered">human:{{ i }}:{{ message.content }}</b></ng-template>
    }
    <ng-template chatMessageTemplate="ai" let-message let-i="index"><b class="rendered">ai:{{ i }}:{{ message.content }}</b></ng-template>
    <ng-template chatMessageTemplate="system" let-message let-i="index"><b class="rendered">system:{{ i }}:{{ message.content }}</b></ng-template>
    <ng-template chatMessageTemplate="tool" let-message let-i="index"><b class="rendered">tool:{{ i }}:{{ message.content }}</b></ng-template>
    <span class="projected-body">projected once</span>
  </chat-message-list>`,
})
class ListHost {
  readonly projected = signal(false);
  readonly alternate = signal(false);
  readonly agent = mockAgent({ messages: ['user', 'assistant', 'system', 'tool', 'unknown'].map((role, index) => ({
    id: String(index), role, content: `m${index}`, delivery: staticDelivery(String(index)),
  })) as Message[] });
}

describe('ChatMessageList projected message mode', () => {
  it('retains generic templates, roles, fresh contexts and dynamic query updates by default', () => {
    const fixture = TestBed.createComponent(ListHost);
    fixture.detectChanges();
    const list = fixture.debugElement.query(By.directive(ChatMessageListComponent)).componentInstance as ChatMessageListComponent;
    expect(list.projectedMessages()).toBe(false);
    expect(list.messageTemplates()).toHaveLength(4);
    expect([...fixture.nativeElement.querySelectorAll('.rendered')].map((n: Element) => n.textContent))
      .toEqual(['human:0:m0', 'ai:1:m1', 'system:2:m2', 'tool:3:m3', 'ai:4:m4']);
    expect(fixture.nativeElement.querySelector('.projected-body')).toBeNull();
    fixture.componentInstance.alternate.set(true);
    fixture.detectChanges();
    expect(list.messageTemplates()).toHaveLength(4);
    expect(fixture.nativeElement.querySelector('.rendered').textContent).toBe('alternate:0:m0');
    const fresh = fixture.componentInstance.agent.messages().map(m => ({ ...m, content: `${m.content}!` }));
    fixture.componentInstance.agent.messages.set(fresh);
    fixture.detectChanges();
    expect(list.messages()).toBe(fresh);
    expect(fixture.nativeElement.querySelector('.rendered').textContent).toBe('alternate:0:m0!');
  });

  it('projects once without also executing generic templates and can switch modes', () => {
    const fixture = TestBed.createComponent(ListHost);
    fixture.componentInstance.projected.set(true);
    fixture.detectChanges();
    const list = fixture.debugElement.query(By.directive(ChatMessageListComponent)).componentInstance as ChatMessageListComponent;
    expect(list.messageTemplates()).toHaveLength(4);
    expect(fixture.nativeElement.querySelectorAll('.projected-body')).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('.rendered')).toHaveLength(0);
    fixture.componentInstance.projected.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.projected-body')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.rendered')).toHaveLength(5);
    fixture.componentInstance.projected.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.projected-body')).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('.rendered')).toHaveLength(0);
  });

  it('keeps default no-template behavior without exposing projected content', () => {
    @Component({ standalone: true, imports: [ChatMessageListComponent], template: `<chat-message-list [agent]="agent"><span class="unregistered">hidden</span></chat-message-list>` })
    class EmptyHost { readonly agent = mockAgent({ messages: [{ id: 'm', role: 'user', content: 'not templated', delivery: staticDelivery('m') }] }); }
    const fixture = TestBed.createComponent(EmptyHost);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.unregistered')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('not templated');
  });
});
