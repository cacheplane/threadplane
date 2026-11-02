import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { ChatToolCallCardComponent } from '../../compositions/chat-tool-call-card/chat-tool-call-card.component';
import { ChatToolCallsComponent } from './chat-tool-calls.component';
import { ChatToolCallTemplateDirective } from './chat-tool-call-template.directive';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery, type Message, type ToolCall, type Subagent } from '../../agent';

const prose = (): Message => ({ id: 'answer', role: 'assistant', content: 'prose', delivery: staticDelivery('answer') });
const call = (id = 'search'): ToolCall => ({ id, name: 'search_web', args: { query: 'before' }, status: 'running' });

@Component({
  standalone: true,
  imports: [ChatToolCallsComponent, ChatToolCallTemplateDirective],
  template: `<chat-tool-calls [agent]="agent" [message]="message">
    <ng-template chatToolCallTemplate="search_web" let-call let-status="status">
      <span data-named>{{ call.id }}:{{ status }}:{{ call.result }}</span>
    </ng-template>
    <ng-template chatToolCallTemplate="*" let-call let-status="status">
      <span data-wildcard>{{ call.id }}:{{ status }}</span>
    </ng-template>
  </chat-tool-calls>`,
})
class EmptyTemplateHost {
  readonly agent = mockAgent();
  readonly message = { ...prose(), toolCallIds: ['search', 'other'] };
}

describe('ChatToolCallsComponent empty groups', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ChatToolCallsComponent] }));
  afterEach(() => vi.restoreAllMocks());

  it('skips subagent indexing for empty calls while retaining its host and unit-computed styles', () => {
    const agent = mockAgent({ withSubagents: true });
    const iterations = vi.spyOn(agent.subagents!(), 'forEach');
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('message', prose());
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    document.body.appendChild(host);
    try {
      expect(getComputedStyle(host).display).toBe('block');
      expect(getComputedStyle(host).marginBottom).toBe('20px');
      iterations.mockClear();
      fixture.componentRef.setInput('message', prose());
      fixture.detectChanges();
      expect(fixture.componentInstance.toolCalls()).toEqual([]);
      expect(fixture.componentInstance.groups()).toEqual([]);
      expect(fixture.nativeElement).toBe(host);
      expect(getComputedStyle(host).display).toBe('block');
      expect(getComputedStyle(host).marginBottom).toBe('20px');
      console.info(JSON.stringify({ schema: 'primitive-empty-tool-work-v1', subagentIndexIterations: iterations.mock.calls.length }));
      expect(iterations).not.toHaveBeenCalled();
    } finally { host.remove(); }
  });

  it('exposes supported same-object linkage and tool mutations through existing tool-call signal invalidations', () => {
    const tool = call();
    const agent = mockAgent({ toolCalls: [tool] });
    const message = { ...prose(), toolCallIds: [] as string[] };
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('message', message);
    fixture.detectChanges();
    expect(fixture.componentInstance.groups()).toEqual([]);
    const host = fixture.nativeElement;
    message.toolCallIds.push(tool.id);
    agent.toolCalls.set([...agent.toolCalls()]);
    fixture.detectChanges();
    expect(fixture.componentInstance.message()).toBe(message);
    expect(fixture.componentInstance.toolCalls()).toEqual([tool]);
    expect(fixture.componentInstance.groups()[0].calls[0]).toBe(tool);
    expect(host.querySelectorAll('chat-tool-call-card')).toHaveLength(1);
    tool.status = 'complete'; tool.result = 'answer'; tool.args['query'] = 'after';
    agent.toolCalls.set([...agent.toolCalls()]);
    fixture.detectChanges();
    expect(fixture.componentInstance.groups()[0].calls[0]).toBe(tool);
    const card = fixture.debugElement.query(By.directive(ChatToolCallCardComponent)).componentInstance;
    expect(card.toolCall()).toMatchObject({ status: 'complete', result: 'answer', args: { query: 'after' } });
    message.toolCallIds.length = 0;
    agent.toolCalls.set([...agent.toolCalls()]);
    fixture.detectChanges();
    expect(fixture.componentInstance.groups()).toEqual([]);
    expect(host.querySelectorAll('chat-tool-call-card')).toHaveLength(0);
    expect(fixture.nativeElement).toBe(host);
  });

  it('resolves structured content mutated in place and calls supplied after the empty result', () => {
    const message: Message = { ...prose(), content: [] };
    const tool = call();
    const agent = mockAgent();
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('message', message);
    fixture.detectChanges();
    expect(fixture.componentInstance.groups()).toEqual([]);
    (message.content as Exclude<Message['content'], string>).push({ type: 'tool_use', id: tool.id, name: tool.name, args: {} });
    agent.toolCalls.set([]);
    fixture.detectChanges();
    expect(fixture.componentInstance.groups()).toEqual([]);
    agent.toolCalls.set([tool]);
    fixture.detectChanges();
    expect(fixture.componentInstance.toolCalls()[0]).toBe(tool);
    expect(fixture.nativeElement.querySelectorAll('chat-tool-call-card')).toHaveLength(1);
  });

  it('resumes subagent anchoring after an empty result and reacts to subagent replacement', () => {
    const agent = mockAgent({ withSubagents: true });
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('message', { ...prose(), toolCallIds: ['task'] });
    fixture.detectChanges();
    expect(fixture.componentInstance.groups()).toEqual([]);
    const sub: Subagent = { toolCallId: 'task', name: 'Research', status: signal('running'), messages: signal([]), state: signal({}) };
    agent.subagents!.set(new Map([['different-run-key', sub]]));
    agent.toolCalls.set([{ ...call('task'), name: 'task' }]);
    fixture.detectChanges();
    expect(fixture.componentInstance.groups()[0].subagent).toBe(sub);
    expect(fixture.nativeElement.querySelectorAll('chat-subagent-card')).toHaveLength(1);
    const replacement = { ...sub, name: 'Replacement' };
    agent.subagents!.set(new Map([['another-key', replacement]]));
    fixture.detectChanges();
    expect(fixture.componentInstance.groups()[0].subagent).toBe(replacement);
  });

  it('keeps nonassistant and absent-message global calls across agent replacement', () => {
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    fixture.componentRef.setInput('agent', mockAgent());
    fixture.detectChanges();
    expect(fixture.componentInstance.groups()).toEqual([]);
    const tool = call();
    fixture.componentRef.setInput('agent', mockAgent({ toolCalls: [tool] }));
    fixture.detectChanges();
    expect(fixture.componentInstance.toolCalls()[0]).toBe(tool);
    fixture.componentRef.setInput('message', { ...prose(), role: 'user' });
    fixture.detectChanges();
    expect(fixture.componentInstance.toolCalls()[0]).toBe(tool);
    expect(fixture.nativeElement.querySelectorAll('chat-tool-call-card')).toHaveLength(1);
  });

  it('returns independent empty group arrays after actual recomputation', () => {
    const fixture = TestBed.createComponent(ChatToolCallsComponent);
    fixture.componentRef.setInput('agent', mockAgent());
    fixture.componentRef.setInput('message', prose());
    fixture.detectChanges();
    const first = fixture.componentInstance.groups();
    first.push({ name: 'consumer edit', calls: [] });
    fixture.componentRef.setInput('message', prose());
    fixture.detectChanges();
    expect(fixture.componentInstance.groups()).not.toBe(first);
    expect(fixture.componentInstance.groups()).toEqual([]);
  });
});

describe('empty tool groups with projected templates', () => {
  it('instantiates named/wildcard templates after empty linkage and updates their status/result context', () => {
    TestBed.configureTestingModule({ imports: [EmptyTemplateHost] });
    const fixture = TestBed.createComponent(EmptyTemplateHost);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-named], [data-wildcard]')).toHaveLength(0);
    const tool = call();
    fixture.componentInstance.agent.toolCalls.set([tool, { ...call('other'), name: 'read_file' }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-named]')).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('[data-wildcard]')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('[data-named]').textContent).toContain('search:running:');
    tool.status = 'complete'; tool.result = 'finished';
    fixture.componentInstance.agent.toolCalls.set([...fixture.componentInstance.agent.toolCalls()]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-named]').textContent).toContain('search:complete:finished');
    fixture.componentInstance.agent.toolCalls.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-named], [data-wildcard]')).toHaveLength(0);
  });
});
