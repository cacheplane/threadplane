import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signalStateStore, views } from '@threadplane/render';
import { ChatComponent } from './chat.component';
import { ChatActivityTemplateDirective } from './chat-activity-template.directive';
import { ChatToolCallTemplateDirective } from '../../primitives/chat-tool-calls/chat-tool-call-template.directive';
import { ChatToolCallsComponent } from '../../primitives/chat-tool-calls/chat-tool-calls.component';
import { ChatToolViewsComponent } from '../../primitives/chat-tool-views/chat-tool-views.component';
import { ChatMessageActionsComponent } from '../../primitives/chat-message-actions/chat-message-actions.component';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery, streamingDelivery, type Message } from '../../agent';

@Component({ standalone: true, template: '<span>registered view</span>' })
class SharedReadViewComponent {}

@Component({
  standalone: true,
  imports: [ChatComponent, ChatActivityTemplateDirective, ChatToolCallTemplateDirective],
  template: `
    <chat [agent]="agent">
      @if (activity()) {
        <ng-template chatActivityTemplate let-message><span class="shared-activity">{{ label() }}:{{ message.id }}</span></ng-template>
      }
      @if (named()) {
        <ng-template chatToolCallTemplate="search" let-call><span class="shared-named">{{ label() }}:{{ call.id }}</span></ng-template>
      }
      @if (wildcard()) {
        <ng-template chatToolCallTemplate="*" let-call><span class="shared-wildcard">{{ label() }}:{{ call.id }}</span></ng-template>
      }
    </chat>
  `,
})
class SharedReadProjectionHost {
  readonly agent = mockAgent({
    messages: [{ id: 'answer', role: 'assistant', content: 'answer', toolCallIds: ['call'], delivery: staticDelivery('answer') }],
    toolCalls: [{ id: 'call', name: 'search', args: {}, status: 'complete' }],
  });
  readonly activity = signal(false);
  readonly named = signal(false);
  readonly wildcard = signal(false);
  readonly label = signal('first');
}

describe('Chat shared transcript reads', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([[20, 'stable'], [20, 'fresh'], [1000, 'stable'], [1000, 'fresh']] as const)(
    'bounds shared configuration reads for H%i %s message wrappers', async (historyCount, wrappers) => {
      const initial: Message[] = [
        ...Array.from({ length: historyCount }, (_, i): Message => ({
          id: `history-${i}`, role: i % 2 ? 'user' : 'assistant', content: `history ${i}`,
          delivery: staticDelivery(`history-${i}`),
        })),
        { id: 'response', role: 'assistant', content: 'tail', delivery: streamingDelivery('response-generation') },
      ];
      const agent = mockAgent({ messages: initial, isLoading: true });
      TestBed.configureTestingModule({});
      const fixture = TestBed.createComponent(ChatComponent);
      fixture.componentRef.setInput('agent', agent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const children = fixture.debugElement.queryAll(By.directive(ChatToolViewsComponent));
      const rows = [...fixture.nativeElement.querySelectorAll('chat-message-list > chat-message')];
      // Call through to the actual signals so Angular dependency tracking and
      // computed caching remain in use. Only getter invocations are counted.
      const shared = fixture.componentInstance as unknown as Pick<ChatComponent,
        'activityTemplate' | 'excludedToolNames' | 'toolCallTemplates' | 'resolvedStore' | 'handlers'> & {
          effectiveViews: () => unknown;
        };
      const getters = {
        activityTemplate: vi.spyOn(shared, 'activityTemplate'),
        excludedToolNames: vi.spyOn(shared, 'excludedToolNames'),
        toolCallTemplates: vi.spyOn(shared, 'toolCallTemplates'),
        effectiveViews: vi.spyOn(shared, 'effectiveViews'),
        resolvedStore: vi.spyOn(shared, 'resolvedStore'),
        handlers: vi.spyOn(shared, 'handlers'),
      };
      const snapshot = () => Object.fromEntries(Object.entries(getters).map(([name, spy]) => [name, spy.mock.calls.length]));
      const changed = initial.map(message => message.id === 'response' ? { ...message, content: 'tail changed' } : message);
      const next = wrappers === 'fresh' ? changed.map(message => ({ ...message, delivery: { ...message.delivery } })) : changed;
      agent.messages.set(next);
      fixture.detectChanges();
      const afterExplicitDetection = snapshot();
      await fixture.whenStable();
      fixture.detectChanges();
      const afterSettledSequenceCumulative = snapshot();
      process.stdout.write(`${JSON.stringify({ schema: 'chat-shared-config-read-counts-v1', historyCount, wrappers,
        afterExplicitDetection, afterSettledSequenceCumulative })}\n`);

      const nextRows = [...fixture.nativeElement.querySelectorAll('chat-message-list > chat-message')];
      expect(nextRows).toHaveLength(historyCount + 1);
      nextRows.forEach((row, index) => expect(row).toBe(rows[index]));
      expect(nextRows.at(-1)!.textContent).toContain('tail changed');
      const latestAssistants = next.filter(message => message.role === 'assistant');
      const latestChildren = fixture.debugElement.queryAll(By.directive(ChatToolViewsComponent));
      latestChildren.forEach((child, index) => {
        expect(child.componentInstance).toBe(children[index].componentInstance);
        expect(child.componentInstance.message()).toBe(latestAssistants[index]);
      });
      for (const [name, reads] of Object.entries(afterSettledSequenceCumulative)) {
        expect(reads, `${name} has an observed real read`).toBeGreaterThan(0);
        expect(reads, `${name} does not scale with assistant history`).toBeLessThanOrEqual(20);
      }
    }, 60000,
  );

  it('updates shared view, store and handler inputs without publishing messages', async () => {
    const answer: Message = {
      id: 'answer', role: 'assistant', content: 'answer', toolCallIds: ['call'], delivery: staticDelivery('answer'),
    };
    const agent = mockAgent({
      messages: [answer], toolCalls: [{ id: 'call', name: 'search', args: {}, status: 'complete' }],
    });
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('genuiToolNames', []);
    fixture.detectChanges();
    await fixture.whenStable();
    const originalMessages = agent.messages();
    const tool = fixture.debugElement.query(By.directive(ChatToolCallsComponent));
    const view = fixture.debugElement.query(By.directive(ChatToolViewsComponent));
    const row = fixture.nativeElement.querySelector('chat-message');
    expect(fixture.nativeElement.querySelectorAll('chat-tool-activity')).toHaveLength(1);
    expect(view.componentInstance.views()).toBeUndefined();
    expect(view.componentInstance.store()).toBeUndefined();

    const registry = views({ search: SharedReadViewComponent });
    fixture.componentRef.setInput('views', registry);
    // Deliberately use the scheduled Angular cycle: no manual detectChanges
    // and no publication of the messages signal after changing configuration.
    await fixture.whenStable();
    expect(view.componentInstance.views()).toBe(registry);
    const fallbackStore = view.componentInstance.store();
    expect(fallbackStore).toBeDefined();
    expect(tool.componentInstance.excludeToolNames()).toEqual(['search']);
    expect(fixture.nativeElement.querySelector('chat-tool-activity')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('registered view');

    const replacementRegistry = views({ search: SharedReadViewComponent });
    const explicitStore = signalStateStore({ configured: true });
    const firstHandlers = { selected: () => 'first' };
    fixture.componentRef.setInput('views', replacementRegistry);
    fixture.componentRef.setInput('store', explicitStore);
    fixture.componentRef.setInput('handlers', firstHandlers);
    await fixture.whenStable();
    expect(view.componentInstance.views()).toBe(replacementRegistry);
    expect(view.componentInstance.store()).toBe(explicitStore);
    expect(view.componentInstance.handlers()).toBe(firstHandlers);

    const replacementHandlers = { selected: () => 'second' };
    fixture.componentRef.setInput('handlers', replacementHandlers);
    fixture.componentRef.setInput('store', undefined);
    await fixture.whenStable();
    expect(view.componentInstance.store()).toBe(fallbackStore);
    expect(view.componentInstance.handlers()).toBe(replacementHandlers);

    fixture.componentRef.setInput('views', undefined);
    await fixture.whenStable();
    expect(view.componentInstance.views()).toBeUndefined();
    expect(view.componentInstance.store()).toBeUndefined();
    expect(tool.componentInstance.excludeToolNames()).toEqual([]);
    expect(fixture.nativeElement.querySelectorAll('chat-tool-activity')).toHaveLength(1);
    expect(fixture.debugElement.query(By.directive(ChatToolCallsComponent)).componentInstance).toBe(tool.componentInstance);
    expect(fixture.debugElement.query(By.directive(ChatToolViewsComponent)).componentInstance).toBe(view.componentInstance);
    expect(view.componentInstance.message()).toBe(answer);
    expect(fixture.nativeElement.querySelector('chat-message')).toBe(row);
    expect(agent.messages()).toBe(originalMessages);
  });

  it('keeps projected activity and tool queries live with stable messages', async () => {
    TestBed.configureTestingModule({ imports: [SharedReadProjectionHost] });
    const fixture = TestBed.createComponent(SharedReadProjectionHost);
    fixture.detectChanges();
    await fixture.whenStable();
    const host = fixture.componentInstance;
    const messages = host.agent.messages();
    const originalRow = fixture.nativeElement.querySelector('chat-message');
    expect(fixture.nativeElement.querySelectorAll('chat-tool-activity')).toHaveLength(1);

    host.wildcard.set(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.shared-wildcard').textContent).toBe('first:call');
    host.named.set(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.shared-named').textContent).toBe('first:call');
    expect(fixture.nativeElement.querySelector('.shared-wildcard')).toBeNull();
    host.label.set('second');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.shared-named').textContent).toBe('second:call');

    host.activity.set(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.shared-activity').textContent).toBe('second:answer');
    expect(fixture.nativeElement.querySelector('chat-tool-calls')).toBeNull();
    const chat = fixture.debugElement.query(By.directive(ChatComponent)).componentInstance as ChatComponent;
    const defaultTemplates = vi.spyOn(chat, 'toolCallTemplates');
    host.label.set('third');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.shared-activity').textContent).toBe('third:answer');
    expect(defaultTemplates).not.toHaveBeenCalled();

    host.activity.set(false);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.shared-named').textContent).toBe('third:call');
    host.named.set(false);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.shared-wildcard').textContent).toBe('third:call');
    host.wildcard.set(false);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('chat-tool-activity')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('chat-message')).toBe(originalRow);
    expect(host.agent.messages()).toBe(messages);
  });

  it('keeps guarded action state reactive and accepts an agent without optional blocking', async () => {
    const blocked = signal(false);
    const agent = { ...mockAgent({ messages: [
      { id: 'empty', role: 'assistant', content: '', delivery: staticDelivery('empty') },
      { id: 'answer', role: 'assistant', content: 'answer', delivery: staticDelivery('answer') },
    ] }), isInputBlocked: blocked };
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
    await fixture.whenStable();
    const messages = agent.messages();
    const actions = fixture.debugElement.queryAll(By.directive(ChatMessageActionsComponent));
    expect(actions).toHaveLength(1);
    expect(actions[0].componentInstance.disabled()).toBe(false);
    blocked.set(true);
    await fixture.whenStable();
    expect(actions[0].componentInstance.disabled()).toBe(true);
    agent.isLoading.set(true);
    blocked.set(false);
    await fixture.whenStable();
    expect(actions[0].componentInstance.disabled()).toBe(true);
    agent.isLoading.set(false);
    await fixture.whenStable();
    expect(actions[0].componentInstance.disabled()).toBe(false);
    expect(agent.messages()).toBe(messages);

    const replacement = mockAgent({ messages });
    expect(replacement.isInputBlocked).toBeUndefined();
    fixture.componentRef.setInput('agent', replacement);
    await fixture.whenStable();
    expect(fixture.debugElement.query(By.directive(ChatMessageActionsComponent)).componentInstance).toBe(actions[0].componentInstance);
    expect(actions[0].componentInstance.disabled()).toBe(false);
    const toolViews = fixture.debugElement.queryAll(By.directive(ChatToolViewsComponent));
    expect(toolViews.every(child => child.componentInstance.agent() === replacement)).toBe(true);
  });

  it.each(['empty', 'user', 'tool'] as const)('keeps a %s transcript without assistant-only hosts', async (kind) => {
    const messages: Message[] = kind === 'empty' ? [] : [{
      id: kind, role: kind, content: kind, delivery: staticDelivery(kind),
    }];
    const agent = mockAgent({ messages });
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('welcomeDisabled', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('chat-tool-calls')).toBeNull();
    expect(fixture.nativeElement.querySelector('chat-tool-views')).toBeNull();
    expect(fixture.nativeElement.querySelector('chat-message-actions')).toBeNull();
    expect(fixture.nativeElement.querySelector('chat-input')).not.toBeNull();
    expect(agent.messages()).toBe(messages);
  });

  it.each([20, 10000])('bounds real messages reads while updating a %i-message transcript', async (historyCount) => {
    const history: Message[] = Array.from({ length: historyCount }, (_, i) => ({
      id: `history-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `history ${i}`,
      delivery: staticDelivery(`history-${i}`),
    }));
    const tail: Message = {
      id: 'response', role: 'assistant', content: 'tail',
      delivery: streamingDelivery('response-generation'),
    };
    const agent = mockAgent({ messages: [...history, tail], isLoading: true });
    const originalMessages = agent.messages;
    const messagesReads = vi.spyOn(agent, 'messages');
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    messagesReads.mockClear();

    // Match the real adapter: every published message wrapper is fresh while
    // nested delivery/content metadata may retain its original identity.
    originalMessages.set([...history, { ...tail, content: 'tail changed' }].map(message => ({ ...message })));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const observedReads = messagesReads.mock.calls.length;
    process.stdout.write(`${JSON.stringify({ historyCount, observedMessagesReads: observedReads })}\n`);

    const rows = fixture.nativeElement.querySelectorAll('chat-message-list > chat-message');
    expect(rows.length).toBe(historyCount + 1);
    expect(rows[0].textContent).toContain('history 0');
    expect(rows[historyCount - 1].textContent).toContain(`history ${historyCount - 1}`);
    expect(rows[historyCount].textContent).toContain('tail changed');
    expect(rows[historyCount].getAttribute('data-current')).toBe('true');
    expect(rows[historyCount].getAttribute('data-streaming')).toBe('true');
    expect(observedReads).toBeLessThanOrEqual(100);
  }, 180000);

  it('refreshes indexed predecessor and current bindings after mutation, replacement and agent swap', () => {
    const message = (id: string, role: Message['role'], content = id): Message => ({
      id, role, content, delivery: staticDelivery(id),
    });
    const preceding = message('preceding', 'user');
    const answer = message('answer', 'assistant');
    const agent = mockAgent({ messages: [preceding, answer] });
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
    const answerRow = () => fixture.nativeElement.querySelector('chat-message[data-role="assistant"]');
    expect(answerRow().getAttribute('data-prev-role')).toBe('user');
    expect(answerRow().getAttribute('data-current')).toBe('true');

    // The same message object may change; the outer snapshot must not cache
    // predecessor fields or use message identity as an invalidation policy.
    preceding.role = 'system';
    agent.messages.set([preceding, answer]);
    fixture.detectChanges();
    expect(answerRow().getAttribute('data-prev-role')).toBe('system');
    agent.messages.set([answer, message('hidden-last', 'tool')]);
    fixture.detectChanges();
    expect(answerRow().getAttribute('data-prev-role')).toBeNull();
    expect(answerRow().getAttribute('data-current')).toBe('false');

    const replacement = mockAgent({ messages: [message('replacement-user', 'user'), {
      ...answer, content: 'replacement answer', delivery: staticDelivery('replacement-generation'),
    }] });
    fixture.componentRef.setInput('agent', replacement);
    fixture.detectChanges();
    expect(answerRow().textContent).toContain('replacement answer');
    expect(answerRow().getAttribute('data-prev-role')).toBe('user');
    expect(answerRow().getAttribute('data-current')).toBe('true');
  });

  it('keeps public predecessor normalization for missing, unknown and duplicate-ID entries', () => {
    const history = ['user', 'assistant', 'system', 'tool', 'unknown', undefined].map((role, index) => ({
      id: 'duplicate', role, content: String(index), delivery: staticDelivery(String(index)),
    })) as Message[];
    const agent = mockAgent({ messages: history });
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', agent);
    expect(fixture.componentInstance.prevRole(0)).toBeUndefined();
    expect([1, 2, 3, 4, 5, 6, 7].map(index => fixture.componentInstance.prevRole(index)))
      .toEqual(['user', 'assistant', 'system', 'tool', undefined, undefined, undefined]);
  });
});
