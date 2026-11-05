import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChatComponent } from './chat.component';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery, streamingDelivery, type Message } from '../../agent';

describe('Chat shared transcript reads', () => {
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
