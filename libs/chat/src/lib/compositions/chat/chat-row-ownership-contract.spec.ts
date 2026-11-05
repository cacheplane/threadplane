import { Component, inject, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it, vi } from 'vitest';
import { ChatComponent } from './chat.component';
import { ChatDefaultMessageListComponent } from './chat-default-message-list.component';
import { ChatActivityTemplateDirective } from './chat-activity-template.directive';
import { ChatToolCallTemplateDirective } from '../../primitives/chat-tool-calls/chat-tool-call-template.directive';
import { ChatToolCallsComponent } from '../../primitives/chat-tool-calls/chat-tool-calls.component';
import { ChatToolViewsComponent } from '../../primitives/chat-tool-views/chat-tool-views.component';
import { ChatMessageListComponent } from '../../primitives/chat-message-list/chat-message-list.component';
import { CHAT_LIFECYCLE } from '../../lifecycle';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery, type Message } from '../../agent';
import { views } from '@threadplane/render';

@Component({ standalone: true, selector: 'chat-ownership-contract-probe', template: `<span class="probe">{{ label() }}</span>` })
class OwnershipProbe {
  readonly label = input('');
  readonly chat = inject(ChatComponent);
  readonly lifecycle = inject(CHAT_LIFECYCLE);
  readonly list = inject(ChatMessageListComponent, { optional: true });
}
@Component({ standalone: true, selector: 'chat-tool-view-mutation-probe', template: `<span class="late-tool-view">{{ query() }}</span>` })
class ToolViewMutationProbe { readonly query = input(''); }
const message = (): Message => ({ id: 'answer', role: 'assistant', content: 'answer text', toolCallIds: ['tool'], delivery: staticDelivery('g') });
const makeAgent = () => mockAgent({ messages: [message()], toolCalls: [{ id: 'tool', name: 'lookup', args: {}, status: 'complete', result: 'found' }] });
@Component({ standalone: true, imports: [ChatComponent, ChatActivityTemplateDirective, OwnershipProbe], template: `<chat [agent]="agent"><ng-template chatActivityTemplate let-message let-i="index"><chat-ownership-contract-probe [label]="message.id + ':' + i" /></ng-template></chat>` })
class ActivityHost { readonly agent = makeAgent(); }
@Component({ standalone: true, imports: [ChatComponent, ChatToolCallTemplateDirective, OwnershipProbe], template: `<chat [agent]="agent"><ng-template chatToolCallTemplate="lookup" let-call><chat-ownership-contract-probe [label]="call.id" /></ng-template></chat>` })
class ToolHost { readonly agent = makeAgent(); }

describe('composed row ownership contracts', () => {
  it('observes actual default AI tool configuration reads through the live renderer', () => {
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', makeAgent());
    const exclusions = vi.spyOn(fixture.componentInstance, 'excludedToolNames');
    const templates = vi.spyOn(fixture.componentInstance, 'toolCallTemplates');
    fixture.detectChanges();
    expect(exclusions).toHaveBeenCalled();
    expect(templates).toHaveBeenCalled();
  });
  it.each([ActivityHost, ToolHost])('preserves custom descendant declaration injection for %s', async Host => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    const chat = fixture.debugElement.query(By.directive(ChatComponent));
    const probe = fixture.debugElement.query(By.directive(OwnershipProbe)).componentInstance as OwnershipProbe;
    expect(probe.chat).toBe(chat.componentInstance);
    expect(probe.lifecycle).toBe(chat.injector.get(CHAT_LIFECYCLE));
    // These consumer templates are declared directly under <chat>, outside
    // its internal list; insertion must not change their declaration injector.
    expect(probe.list).toBeNull();
    expect(fixture.nativeElement.querySelector('.probe').textContent).toContain(Host === ActivityHost ? 'answer:0' : 'tool');
    process.stdout.write(`${JSON.stringify({ customTemplate: Host.name, chatAndLifecycleInjectionPreserved: true, listInjection: null })}\n`);
  });

  it.each([{ history: [] }, { history: [{ id: 'user', role: 'user', content: 'human', delivery: staticDelivery('user') }] }] as { history: Message[] }[])('does not eagerly read AI tool configuration for non-AI histories', ({ history }) => {
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', mockAgent({ messages: history }));
    const exclusions = vi.spyOn(fixture.componentInstance, 'excludedToolNames');
    const templates = vi.spyOn(fixture.componentInstance, 'toolCallTemplates');
    fixture.detectChanges();
    expect(exclusions).not.toHaveBeenCalled();
    expect(templates).not.toHaveBeenCalled();
  });

  it('keeps custom activity selection, default-tool laziness and undefined-view host bindings', async () => {
    const fixture = TestBed.createComponent(ActivityHost);
    const chat = fixture.debugElement.query(By.directive(ChatComponent)).componentInstance as ChatComponent;
    const templates = vi.spyOn(chat, 'toolCallTemplates');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(templates).not.toHaveBeenCalled();
    expect(fixture.debugElement.query(By.directive(ChatToolCallsComponent))).toBeNull();
    const toolViews = fixture.debugElement.query(By.directive(ChatToolViewsComponent)).componentInstance as ChatToolViewsComponent;
    expect(toolViews.views()).toBeUndefined();
    expect(toolViews.message()).toBe(fixture.componentInstance.agent.messages()[0]);
  });

  it('retains unknown-role AI/global-tool fallback and hides tool message rows', async () => {
    const unknown = { id: 'unknown', role: 'unknown', content: 'unknown role text', delivery: staticDelivery('unknown') } as unknown as Message;
    const agent = mockAgent({ messages: [unknown, { id: 'tool-message', role: 'tool', content: 'hidden result', delivery: staticDelivery('tool') }] });
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('chat-message-list > chat-message')).toHaveLength(1);
    const child = fixture.debugElement.query(By.directive(ChatToolCallsComponent)).componentInstance as ChatToolCallsComponent;
    expect(child.message()).toBe(unknown);
    agent.toolCalls.set([{ id: 'global', name: 'global_lookup', args: {}, status: 'complete', result: 'global result' }]);
    await fixture.whenStable();
    expect(child.groups()[0].calls[0].id).toBe('global');
    expect(fixture.nativeElement.querySelectorAll('chat-tool-call-card')).toHaveLength(1);
  });

  it('retains raw message reactivity for late tool-view linkage without a messages publication', async () => {
    const original: Message = { id: 'view-message', role: 'assistant', content: 'view text', toolCallIds: [], delivery: staticDelivery('view-generation') };
    const agent = mockAgent({ messages: [original] });
    const published = agent.messages();
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('views', views({ lookup: ToolViewMutationProbe }));
    fixture.detectChanges();
    await fixture.whenStable();
    const child = fixture.debugElement.query(By.directive(ChatToolViewsComponent)).componentInstance as ChatToolViewsComponent;
    expect(child.message()).toBe(original);
    expect(fixture.nativeElement.querySelector('.late-tool-view')).toBeNull();
    original.toolCallIds!.push('late-view');
    agent.toolCalls.set([{ id: 'late-view', name: 'lookup', args: { query: 'late mutable view' }, status: 'running' }]);
    await fixture.whenStable();
    expect(agent.messages()).toBe(published);
    expect(child.message()).toBe(original);
    expect(fixture.nativeElement.querySelector('.late-tool-view').textContent).toBe('late mutable view');
    expect(fixture.nativeElement.querySelectorAll('chat-tool-call-card')).toHaveLength(0);
  });

  it('keeps the real list host and explicitly has no registered default message templates in composition mode', () => {
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', makeAgent());
    fixture.detectChanges();
    const list = fixture.debugElement.query(By.directive(ChatMessageListComponent)).componentInstance as ChatMessageListComponent;
    const specialized = fixture.debugElement.query(By.directive(ChatDefaultMessageListComponent));
    expect(list).toBe(specialized.componentInstance);
    expect(list).toBeInstanceOf(ChatMessageListComponent);
    expect(specialized.injector.get(ChatMessageListComponent)).toBe(list);
    expect(list.messageTemplates()).toHaveLength(0);
    expect(list.findTemplate('ai')).toBeUndefined();
    expect(list.messages()).toBe(fixture.componentInstance.agent().messages());
    expect(fixture.nativeElement.querySelectorAll('chat-message-list')).toHaveLength(1);
  });
});
