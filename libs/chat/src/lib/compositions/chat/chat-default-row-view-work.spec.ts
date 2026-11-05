import { describe, expect, it, vi } from 'vitest';
import { NgTemplateOutlet } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChatComponent } from './chat.component';
import { ChatToolCallsComponent } from '../../primitives/chat-tool-calls/chat-tool-calls.component';
import { ChatToolViewsComponent } from '../../primitives/chat-tool-views/chat-tool-views.component';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery, streamingDelivery, type Message } from '../../agent';

describe('default row view work during fresh-wrapper streaming', () => {
  it.each([20, 10000])('bounds generic outlet updates at %i historical messages without removing rows or tool hosts', async historyCount => {
    const history: Message[] = Array.from({ length: historyCount }, (_, i) => ({
      id: `h-${i}`, role: i % 2 ? 'user' : 'assistant', content: `history ${i}`, delivery: staticDelivery(`g-${i}`),
    }));
    const tail: Message = { id: 'tail', role: 'assistant', content: 'tail', delivery: streamingDelivery('tail-generation') };
    const agent = mockAgent({ messages: [...history, tail], isLoading: true });
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const outletInstances = fixture.debugElement.queryAllNodes(By.directive(NgTemplateOutlet)).length;
    const toolHosts = fixture.debugElement.queryAll(By.directive(ChatToolCallsComponent));
    const viewHosts = fixture.debugElement.queryAll(By.directive(ChatToolViewsComponent));
    expect(toolHosts).toHaveLength(historyCount / 2 + 1);
    expect(viewHosts).toHaveLength(historyCount / 2 + 1);
    const changes = vi.spyOn(NgTemplateOutlet.prototype, 'ngOnChanges');
    try {
      const fresh = [...history, { ...tail, content: 'tail changed' }].map(message => ({ ...message }));
      agent.messages.set(fresh);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const observedOutletChanges = changes.mock.calls.length;
      const rows = fixture.nativeElement.querySelectorAll('chat-message-list > chat-message');
      expect(rows).toHaveLength(historyCount + 1);
      expect(rows[historyCount].textContent).toContain('tail changed');
      expect(rows[historyCount].getAttribute('data-current')).toBe('true');
      expect(rows[historyCount].getAttribute('data-streaming')).toBe('true');
      const children = fixture.debugElement.queryAll(By.directive(ChatToolCallsComponent));
      expect(children[0].componentInstance.message()).toBe(fresh[0]);
      expect(children.at(-1)!.componentInstance.message()).toBe(fresh.at(-1));
      process.stdout.write(`${JSON.stringify({ historyCount, outletInstances, observedOutletChanges, toolHosts: toolHosts.length, viewHosts: viewHosts.length, allRowsPreserved: rows.length })}\n`);
      expect.soft(outletInstances).toBeLessThanOrEqual(100);
      expect(observedOutletChanges).toBeLessThanOrEqual(100);
    } finally { changes.mockRestore(); }
  }, 180000);
});
