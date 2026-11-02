import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChatComponent } from './chat.component';
import { ChatMessageComponent } from '../../primitives/chat-message/chat-message.component';
import { ChatToolCallsComponent } from '../../primitives/chat-tool-calls/chat-tool-calls.component';
import { ChatStreamingMdComponent } from '../../streaming/streaming-markdown.component';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery, streamingDelivery, type Message } from '../../agent';

describe('ChatComponent empty tool grouping work', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ChatComponent] }));
  afterEach(() => vi.restoreAllMocks());

  it('keeps every empty tool host and fresh public message without rebuilding historical subagent indexes', () => {
    const messages: Message[] = [
      ...Array.from({ length: 1000 }, (_, i): Message => ({
        id: `history-${i}`, role: i % 2 ? 'user' : 'assistant',
        content: `Historical message ${i}.`, delivery: staticDelivery(`history-${i}`),
      })),
      { id: 'tail', role: 'assistant', content: 'Initial tail', delivery: streamingDelivery('g') },
    ];
    const agent = mockAgent({ messages, isLoading: true, withSubagents: true });
    // Observe the actual map iteration used to build each group's subagent
    // index; the real resolver, computed values and templates remain intact.
    const iterations = vi.spyOn(agent.subagents!(), 'forEach');
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
    const tools = fixture.debugElement.queryAll(By.directive(ChatToolCallsComponent));
    expect(tools).toHaveLength(501);
    const historical = tools.filter(element => element.componentInstance.message().id !== 'tail');
    expect(historical).toHaveLength(500);
    for (const element of tools) expect(element.componentInstance.groups()).toEqual([]);
    expect(fixture.nativeElement.querySelectorAll('chat-tool-call-card, chat-subagent-card')).toHaveLength(0);
    const rows = fixture.debugElement.queryAll(By.directive(ChatMessageComponent));
    const historyRow = rows.find(element => element.componentInstance.message()?.id === 'history-0')!;
    const document = historyRow.query(By.directive(ChatStreamingMdComponent)).componentInstance.document();
    const text = historyRow.nativeElement.textContent;
    iterations.mockClear();

    const next = messages.map(message => ({ ...message, delivery: { ...message.delivery },
      content: message.id === 'tail' ? 'Initial tail with next token' : message.content }));
    agent.messages.set(next);
    fixture.detectChanges();

    const updated = fixture.debugElement.queryAll(By.directive(ChatToolCallsComponent));
    expect(updated).toHaveLength(501);
    const byId = new Map(next.map(message => [message.id, message]));
    for (let i = 0; i < updated.length; i++) {
      expect(updated[i].nativeElement).toBe(tools[i].nativeElement);
      const current = updated[i].componentInstance.message();
      expect(current).toBe(byId.get(current.id));
      expect(current).not.toBe(messages.find(message => message.id === current.id));
      expect(updated[i].componentInstance.groups()).toEqual([]);
    }
    expect(historyRow.nativeElement.isConnected).toBe(true);
    expect(historyRow.nativeElement.textContent).toBe(text);
    expect(historyRow.query(By.directive(ChatStreamingMdComponent)).componentInstance.document()).toBe(document);
    expect(fixture.nativeElement.textContent).toContain('Initial tail with next token');
    console.info(JSON.stringify({ schema: 'chat-empty-tool-work-v1', historicalAssistants: 500,
      mountedToolHosts: updated.length, subagentIndexIterations: iterations.mock.calls.length }));
    expect(iterations, 'empty rows must not build a subagent index on a tail update').not.toHaveBeenCalled();
  }, 60000);
});
