import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, signal, viewChildren } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChatComponent } from '../../compositions/chat/chat.component';
import { ChatToolCallCardComponent } from '../../compositions/chat-tool-call-card/chat-tool-call-card.component';
import { ChatToolViewsComponent } from '../chat-tool-views/chat-tool-views.component';
import { ChatToolCallsComponent } from './chat-tool-calls.component';
import { ChatToolCallTemplateDirective } from './chat-tool-call-template.directive';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery, streamingDelivery, type Message, type Subagent, type ToolCall } from '../../agent';

@Component({
  standalone: true,
  imports: [ChatToolCallsComponent, ChatToolCallTemplateDirective],
  template: `
    @if (supplied()) {
      <ng-template #supplied chatToolCallTemplate="search_web" let-call let-status="status">
        <span data-template="named">{{ version() }}:{{ call.id }}:{{ status }}</span>
      </ng-template>
      <ng-template #supplied chatToolCallTemplate="*" let-call>
        <span data-template="wildcard">{{ version() }}:{{ call.id }}</span>
      </ng-template>
    }
    <chat-tool-calls [agent]="agent()" [message]="message()" [grouping]="grouping()"
      [excludeToolNames]="excluded()" [toolCallTemplates]="suppliedTemplates()">
      @if (ownTemplate()) {
        <ng-template chatToolCallTemplate="search_web" let-call>
          <span data-template="own">{{ version() }}:{{ call.id }}</span>
        </ng-template>
      }
    </chat-tool-calls>
  `,
})
class LiveScopeHost {
  readonly agent = signal(mockAgent({ withSubagents: true }));
  readonly message = signal<Message | undefined>(undefined);
  readonly grouping = signal<'auto' | 'none'>('auto');
  readonly excluded = signal<readonly string[]>([]);
  readonly supplied = signal(false);
  readonly ownTemplate = signal(false);
  readonly version = signal('initial');
  readonly suppliedTemplates = viewChildren('supplied', { read: ChatToolCallTemplateDirective });
}

const call = (id: string, name = 'search_web'): ToolCall => ({ id, name, args: { query: id }, status: 'running' });
const subagent = (toolCallId: string, name: string): Subagent => ({
  toolCallId, name, status: signal('running'), messages: signal([]), state: signal({}),
});

describe('empty message-scoped tool groups', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([20, 1000])('skips child grouping preparation for empty scopes during H%i fresh-wrapper streaming', async historyCount => {
    const history: Message[] = Array.from({ length: historyCount }, (_, i) => ({
      id: `h-${i}`, role: i % 2 ? 'user' : 'assistant', content: `history ${i}`,
      delivery: staticDelivery(`g-${i}`),
    }));
    const tail: Message = { id: 'tail', role: 'assistant', content: 'tail', delivery: streamingDelivery('tail') };
    const agent = mockAgent({ messages: [...history, tail], isLoading: true, withSubagents: true });
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const rows = [...fixture.nativeElement.querySelectorAll('chat-message-list > chat-message')] as HTMLElement[];
    const hosts = fixture.debugElement.queryAll(By.directive(ChatToolCallsComponent));
    expect(hosts).toHaveLength(historyCount / 2 + 1);
    // Main retains tool-view hosts even with an undefined registry. Preserve
    // that existing contract independently of the tool-group work reduction.
    const viewHosts = fixture.debugElement.queryAll(By.directive(ChatToolViewsComponent));
    expect(viewHosts).toHaveLength(historyCount / 2 + 1);
    const spies = hosts.map(host => {
      const child = host.componentInstance as ChatToolCallsComponent;
      expect(child.toolCalls()).toEqual([]);
      return {
        groups: vi.spyOn(child, 'groups'), scoped: vi.spyOn(child, 'toolCalls'),
        exclusions: vi.spyOn(child, 'excludeToolNames'), grouping: vi.spyOn(child, 'grouping'),
        registry: vi.spyOn(child as unknown as { templateRegistry: () => unknown }, 'templateRegistry'),
      };
    });
    const globalCalls = vi.spyOn(agent, 'toolCalls');
    const subagents = vi.spyOn(agent, 'subagents');
    const fresh = [...history, tail].map(message => ({ ...message, delivery: { ...message.delivery },
      content: message.id === 'tail' ? 'tail changed' : message.content }));
    agent.messages.set(fresh);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const counts = Object.fromEntries(['groups', 'scoped', 'exclusions', 'grouping', 'registry'].map(key =>
      [key, spies.reduce((sum, entry) => sum + entry[key as keyof typeof entry].mock.calls.length, 0)]));
    const observedSubagents = subagents.mock.calls.length;
    expect(counts.groups).toBeGreaterThan(0);
    expect(counts.scoped).toBeGreaterThanOrEqual(hosts.length);
    expect(globalCalls).toHaveBeenCalled();
    const nextHosts = fixture.debugElement.queryAll(By.directive(ChatToolCallsComponent));
    const assistants = fresh.filter(message => message.role === 'assistant');
    expect(nextHosts).toHaveLength(hosts.length);
    nextHosts.forEach((host, i) => {
      expect(host.componentInstance).toBe(hosts[i].componentInstance);
      expect(host.nativeElement).toBe(hosts[i].nativeElement);
      expect(host.componentInstance.message()).toBe(assistants[i]);
      expect(host.componentInstance.toolCalls()).toEqual([]);
      expect(host.componentInstance.groups()).toEqual([]);
    });
    const nextRows = [...fixture.nativeElement.querySelectorAll('chat-message-list > chat-message')] as HTMLElement[];
    expect(nextRows).toHaveLength(historyCount + 1);
    history.forEach((message, i) => {
      expect(nextRows[i]).toBe(rows[i]);
      expect(nextRows[i].textContent).toContain(message.content);
    });
    expect(nextRows.at(-1)!.textContent).toContain('tail changed');
    const nextViewHosts = fixture.debugElement.queryAll(By.directive(ChatToolViewsComponent));
    expect(nextViewHosts).toHaveLength(viewHosts.length);
    nextViewHosts.forEach((host, i) => {
      expect(host.componentInstance).toBe(viewHosts[i].componentInstance);
      expect(host.nativeElement).toBe(viewHosts[i].nativeElement);
      expect(host.componentInstance.message()).toBe(assistants[i]);
    });
    process.stdout.write(`${JSON.stringify({ schema: 'empty-scoped-tool-groups-v1', historyCount,
      children: hosts.length, counts, globalToolReads: globalCalls.mock.calls.length,
      subagentReads: observedSubagents, changedTail: true, stableHosts: true, latestRawWrappers: true })}\n`);
    expect.soft(counts.exclusions, 'empty child exclusion reads').toBe(0);
    expect.soft(counts.grouping, 'empty child grouping reads').toBe(0);
    expect.soft(counts.registry, 'empty child template-registry reads').toBe(0);
    expect(observedSubagents, 'empty child subagent reads').toBe(0);
  }, 60000);

  it.each(['ids', 'blocks'] as const)('keeps live %s linkage and current configuration across repeated empty transitions', async kind => {
    const fixture = TestBed.createComponent(LiveScopeHost);
    const host = fixture.componentInstance;
    const message: Message = { id: 'answer', role: 'assistant', content: kind === 'blocks' ? [] : 'answer',
      toolCallIds: kind === 'ids' ? [] : undefined, delivery: staticDelivery('answer') };
    host.message.set(message);
    fixture.detectChanges();
    await fixture.whenStable();
    const agent = host.agent();
    const publishedMessages = agent.messages();
    const element = fixture.debugElement.query(By.directive(ChatToolCallsComponent));
    const child = element.componentInstance as ChatToolCallsComponent;
    const cards = () => fixture.debugElement.queryAll(By.directive(ChatToolCallCardComponent));
    const templates = () => [...fixture.nativeElement.querySelectorAll('chat-tool-calls [data-template]')]
      .map((node: Element) => `${node.getAttribute('data-template')}:${node.textContent?.trim()}`);
    const a = call('a');
    const b = call('b');
    const other = call('other', 'read_file');
    // Configure while empty, then discover in-place linkage through only a
    // notifying global-tool publication. Never force parent detection here.
    host.grouping.set('none');
    host.excluded.set(['read_file']);
    host.supplied.set(true);
    host.ownTemplate.set(true);
    host.version.set('first');
    await fixture.whenStable();
    expect(child.groups()).toEqual([]);
    if (kind === 'ids') message.toolCallIds!.push('a', 'b', 'other');
    else (message.content as Exclude<Message['content'], string>).push(...[a, b, other].map(tc =>
      ({ type: 'tool_use' as const, id: tc.id, name: tc.name, args: tc.args })));
    agent.toolCalls.set([a, b, other]);
    await fixture.whenStable();
    expect(child.toolCalls()).toEqual([a, b, other]);
    expect(child.groups().map(group => group.calls)).toEqual([[a], [b]]);
    expect(templates()).toEqual(['own:first:a', 'own:first:b']);
    expect(cards()).toHaveLength(0);
    host.ownTemplate.set(false);
    await fixture.whenStable();
    expect(templates()).toEqual(['named:first:a:running', 'named:first:b:running']);
    host.excluded.set([]);
    await fixture.whenStable();
    expect(templates()).toEqual(['named:first:a:running', 'named:first:b:running', 'wildcard:first:other']);
    host.supplied.set(false);
    host.grouping.set('auto');
    await fixture.whenStable();
    expect(child.groups().map(group => group.calls)).toEqual([[a, b], [other]]);
    expect(fixture.nativeElement.querySelectorAll('[data-group="true"]')).toHaveLength(1);
    host.grouping.set('none');
    await fixture.whenStable();
    expect(cards()).toHaveLength(3);
    a.status = 'complete'; a.args = { query: 'mutated query' }; a.result = 'mutated result';
    agent.toolCalls.set([a, b, other]);
    await fixture.whenStable();
    expect(child.groups()[0].calls[0]).toBe(a);
    expect(cards()[0].componentInstance.toolCall()).toEqual({ id: a.id, name: a.name,
      status: 'complete', args: a.args, result: 'mutated result' });
    // Nonempty, fully excluded scope still takes the configuration-dependent path.
    host.excluded.set(['search_web', 'read_file']);
    await fixture.whenStable();
    expect(child.toolCalls()).toHaveLength(3);
    expect(child.groups()).toEqual([]);
    host.excluded.set([]);
    await fixture.whenStable();
    expect(cards()).toHaveLength(3);
    agent.toolCalls.set([]);
    await fixture.whenStable();
    expect(child.groups()).toEqual([]);
    expect(cards()).toHaveLength(0);
    const previousEmpty = child.groups();
    // Replace all relevant configuration while empty. A later live scope must
    // use these replacements, including a subagent indexed by a different key.
    const currentSubagent = subagent('a', 'replacement researcher');
    host.grouping.set('auto');
    host.excluded.set(['read_file']);
    host.supplied.set(true);
    host.version.set('second');
    agent.subagents!.set(new Map([['unrelated-map-key', currentSubagent]]));
    await fixture.whenStable();
    expect(child.groups()).toEqual([]);
    agent.toolCalls.set([]);
    await fixture.whenStable();
    expect(child.groups()).toEqual([]);
    expect(child.groups()).not.toBe(previousEmpty);
    agent.toolCalls.set([a, b, other]);
    await fixture.whenStable();
    expect(child.groups().map(group => group.calls)).toEqual([[a], [b]]);
    expect(child.groups()[0].subagent).toBe(currentSubagent);
    expect(fixture.nativeElement.querySelectorAll('chat-subagent-card')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('replacement researcher');
    expect(templates()).toEqual(['named:second:b:running']);
    agent.subagents!.set(new Map());
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('chat-subagent-card')).toHaveLength(0);
    expect(templates()).toEqual(['named:second:a:complete', 'named:second:b:running']);
    expect(child.message()).toBe(message);
    expect(agent.messages()).toBe(publishedMessages);
    expect(fixture.debugElement.query(By.directive(ChatToolCallsComponent)).nativeElement).toBe(element.nativeElement);
  });

  it('retains global fallback, agent/message replacements and per-instance fresh empty results', async () => {
    const fixture = TestBed.createComponent(LiveScopeHost);
    fixture.detectChanges();
    await fixture.whenStable();
    const host = fixture.componentInstance;
    const child = fixture.debugElement.query(By.directive(ChatToolCallsComponent)).componentInstance as ChatToolCallsComponent;
    const separate = TestBed.createComponent(ChatToolCallsComponent);
    separate.componentRef.setInput('agent', mockAgent());
    separate.detectChanges();
    expect(child.groups()).not.toBe(separate.componentInstance.groups());
    const global = call('global');
    for (const context of [undefined, { id: 'user', role: 'user', content: 'user', delivery: staticDelivery('user') },
      { id: 'unknown', role: 'unknown', content: 'unknown', delivery: staticDelivery('unknown') }] as (Message | undefined)[]) {
      host.message.set(context);
      host.agent().toolCalls.set([global]);
      await fixture.whenStable();
      expect(child.groups()[0].calls[0]).toBe(global);
      expect(fixture.nativeElement.querySelectorAll('chat-tool-call-card')).toHaveLength(1);
      host.agent().toolCalls.set([]);
      await fixture.whenStable();
      expect(child.groups()).toEqual([]);
      expect(fixture.nativeElement.querySelectorAll('chat-tool-call-card')).toHaveLength(0);
    }
    host.message.set({ id: 'assistant', role: 'assistant', content: 'answer',
      toolCallIds: ['replacement'], delivery: staticDelivery('assistant') });
    const replacement = call('replacement', 'lookup');
    host.agent.set(mockAgent({ toolCalls: [replacement] }));
    await fixture.whenStable();
    expect(child.groups()[0].calls[0]).toBe(replacement);
    expect(child.toolCalls()).toEqual([replacement]);
    host.message.set({ id: 'other', role: 'assistant', content: 'other', delivery: staticDelivery('other') });
    await fixture.whenStable();
    expect(child.toolCalls()).toEqual([]);
    expect(child.groups()).toEqual([]);
  });
});
