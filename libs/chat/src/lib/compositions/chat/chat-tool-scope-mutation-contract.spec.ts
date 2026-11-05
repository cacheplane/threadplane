import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChatComponent } from './chat.component';
import { ChatToolCallsComponent } from '../../primitives/chat-tool-calls/chat-tool-calls.component';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery, type Message, type ToolCall } from '../../agent';

describe('legacy composition mutable tool-scope contract', () => {
  it.each(['ids', 'blocks'] as const)('discovers in-place %s linkage through only toolCalls publication', async (kind) => {
    const message: Message = {
      id: 'original-message', role: 'assistant', content: kind === 'blocks' ? [] : 'plain text',
      toolCallIds: kind === 'ids' ? [] : undefined, delivery: staticDelivery('generation'),
    };
    const agent = mockAgent({ messages: [message] });
    const originalMessages = agent.messages();
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
    await fixture.whenStable();
    const child = fixture.debugElement.query(By.directive(ChatToolCallsComponent)).componentInstance as ChatToolCallsComponent;
    expect(child.message()).toBe(message);
    expect(child.groups()).toHaveLength(0);
    expect(fixture.nativeElement.querySelectorAll('chat-tool-call-card')).toHaveLength(0);
    if (kind === 'ids') message.toolCallIds!.push('late-tool');
    else (message.content as Array<unknown>).push({ type: 'tool_use', id: 'late-tool', name: 'lookup', args: {} });
    const call: ToolCall = { id: 'late-tool', name: 'lookup', args: { query: 'mutable' }, status: 'running' };
    agent.toolCalls.set([call]);
    // No forced parent detectChanges or messages publication after mutation.
    await fixture.whenStable();
    expect(agent.messages()).toBe(originalMessages);
    expect(child.message()).toBe(message);
    expect(child.groups()[0].calls[0]).toBe(call);
    expect(fixture.nativeElement.querySelectorAll('chat-tool-call-card')).toHaveLength(1);
    process.stdout.write(`${JSON.stringify({ kind, parentMessagesArrayUnchanged: true, originalChildMessageRetained: true, renderedToolCards: 1 })}\n`);
  });
});
