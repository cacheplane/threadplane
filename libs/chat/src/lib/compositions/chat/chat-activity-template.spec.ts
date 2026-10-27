import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChatComponent } from './chat.component';
import { ChatActivityTemplateDirective } from './chat-activity-template.directive';
import { ChatToolCallTemplateDirective } from '../../primitives/chat-tool-calls/chat-tool-call-template.directive';
import { mockAgent, type MockAgent } from '../../testing/mock-agent';
import { staticDelivery, type Message, type Subagent, type ToolCall } from '../../agent';

function subagent(toolCallId: string, name: string): Subagent {
  return {
    toolCallId,
    name,
    status: signal<'running'>('running'),
    messages: signal<Message[]>([]),
    state: signal({}),
  };
}

function buildAgent(): MockAgent {
  const agent = mockAgent({
    messages: [
      { id: 'u1', role: 'user', content: 'plan a trip', delivery: staticDelivery('u1') },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Looking into it.',
        reasoning: 'I should search first.',
        reasoningDurationMs: 1200,
        toolCallIds: ['c_search', 'c_task', 'c_spec'],
        delivery: staticDelivery('a1'),
      },
      { id: 't1', role: 'tool', content: 'ok', toolCallId: 'c_search', delivery: staticDelivery('t1') },
      { id: 'a2', role: 'assistant', content: 'Here is the plan.', delivery: staticDelivery('a2') },
    ],
    toolCalls: [
      { id: 'c_search', name: 'search_web', args: { q: 'x' }, status: 'complete', result: 'r' },
      { id: 'c_task', name: 'task', args: {}, status: 'running' },
      { id: 'c_spec', name: 'render_spec', args: {}, status: 'complete' },
    ] as ToolCall[],
    withSubagents: true,
  });
  // Keyed by something other than the spawning call id: anchoring must use
  // Subagent.toolCallId, not the map key.
  agent.subagents!.set(new Map([['run-42', subagent('c_task', 'research')]]));
  return agent;
}

@Component({
  standalone: true,
  imports: [ChatComponent, ChatActivityTemplateDirective, ChatToolCallTemplateDirective],
  template: `
    <chat [agent]="agent">
      @if (withActivity) {
        <ng-template
          chatActivityTemplate
          let-message
          let-i="index"
          let-toolCalls="toolCalls"
          let-subagents="subagents"
          let-ctxAgent="agent"
        >
          <div
            class="activity"
            [attr.data-message]="message.id"
            [attr.data-index]="i"
            [attr.data-calls]="callIds(toolCalls)"
            [attr.data-subagents]="subagentNames(subagents)"
            [attr.data-same-agent]="ctxAgent === agent"
          ></div>
        </ng-template>
      }
      @if (withToolTemplate) {
        <ng-template chatToolCallTemplate="search_web" let-call>
          <span class="tool-tpl">{{ call.id }}</span>
        </ng-template>
      }
    </chat>
  `,
})
class HostComponent {
  agent: MockAgent = buildAgent();
  withActivity = true;
  withToolTemplate = false;

  callIds(calls: ToolCall[]): string {
    return calls.map((c) => c.id).join(',');
  }

  subagentNames(subagents: Subagent[]): string {
    return subagents.map((s) => `${s.name}@${s.toolCallId}`).join(',');
  }
}

function render(configure: (host: HostComponent) => void = () => undefined): HTMLElement {
  const fixture = TestBed.createComponent(HostComponent);
  configure(fixture.componentInstance);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ChatComponent — chatActivityTemplate', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('renders the template once per assistant message with that message context', () => {
    const host = render();
    const activities = [...host.querySelectorAll<HTMLElement>('.activity')];
    expect(activities.map((el) => el.dataset['message'])).toEqual(['a1', 'a2']);
    expect(activities.map((el) => el.dataset['index'])).toEqual(['1', '3']);
    expect(activities.every((el) => el.dataset['sameAgent'] === 'true')).toBe(true);
  });

  it('scopes tool calls to the message and drops excluded dispatcher tools', () => {
    const host = render();
    const [first, second] = [...host.querySelectorAll<HTMLElement>('.activity')];
    expect(first.dataset['calls']).toBe('c_search,c_task');
    expect(second.dataset['calls']).toBe('');
  });

  it('anchors subagents to the message by Subagent.toolCallId', () => {
    const host = render();
    const [first, second] = [...host.querySelectorAll<HTMLElement>('.activity')];
    expect(first.dataset['subagents']).toBe('research@c_task');
    expect(second.dataset['subagents']).toBe('');
  });

  it('replaces the reasoning pill and tool-call region but keeps markdown and actions', () => {
    const host = render();
    expect(host.querySelector('chat-reasoning')).toBeNull();
    expect(host.querySelector('chat-tool-calls')).toBeNull();
    expect(host.querySelector('chat-subagent-card')).toBeNull();
    expect(host.querySelectorAll('chat-streaming-md').length).toBe(2);
    expect(host.querySelectorAll('chat-message-actions').length).toBe(2);
    expect(host.querySelectorAll('chat-tool-views').length).toBe(2);
  });

  it('takes precedence over a projected chatToolCallTemplate', () => {
    const host = render((h) => { h.withToolTemplate = true; });
    expect(host.querySelectorAll('.activity').length).toBe(2);
    expect(host.querySelector('chat-tool-calls')).toBeNull();
    expect(host.querySelector('.tool-tpl')).toBeNull();
  });

  it('leaves rendering unchanged when no activity template is projected', () => {
    const host = render((h) => { h.withActivity = false; });
    expect(host.querySelector('.activity')).toBeNull();
    expect(host.querySelectorAll('chat-reasoning').length).toBe(1);
    expect(host.querySelectorAll('chat-tool-calls').length).toBe(2);
    expect(host.querySelectorAll('chat-subagent-card').length).toBe(1);
  });

  it('updates the context when the message tool calls change', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const agent = fixture.componentInstance.agent;
    agent.toolCalls.update((calls) => [
      ...calls,
      { id: 'c_more', name: 'read_file', args: {}, status: 'pending' },
    ]);
    agent.messages.update((msgs) =>
      msgs.map((m) => (m.id === 'a2' ? { ...m, toolCallIds: ['c_more'] } : m)),
    );
    fixture.detectChanges();
    const second = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.activity')[1];
    expect(second.dataset['calls']).toBe('c_more');
  });

  it('reuses the context object while the message activity is unchanged', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const chat = fixture.debugElement.query(By.directive(ChatComponent)).componentInstance as unknown as {
      activityContextFor(message: Message, index: number): unknown;
    };
    const message = fixture.componentInstance.agent.messages()[1];
    const first = chat.activityContextFor(message, 1);
    expect(chat.activityContextFor(message, 1)).toBe(first);
    fixture.componentInstance.agent.subagents!.set(new Map());
    expect(chat.activityContextFor(message, 1)).not.toBe(first);
  });
});
