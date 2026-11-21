import { describe, it, expect } from 'vitest';
import { createSession } from './create-session';
import { FakeStreamTransport } from './fake-stream.transport';
import type { StreamEvent } from './transport.types.js';

async function collect(transport: FakeStreamTransport): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  const ac = new AbortController();
  for await (const ev of transport.stream('a', null, {}, ac.signal)) {
    out.push(ev);
  }
  return out;
}

describe('FakeStreamTransport', () => {
  it('auto-streams tokens as cumulative assistant message events', async () => {
    const transport = new FakeStreamTransport({ tokens: ['Hello', ' world'], delayMs: 0 });
    const events = await collect(transport);
    const messageEvents = events.filter((e) => e.type === 'messages');
    expect(messageEvents.length).toBeGreaterThan(0);
    const last = messageEvents[messageEvents.length - 1] as StreamEvent & {
      messages: Array<{ type: string; content: string }>;
    };
    expect(last.messages[0].type).toBe('ai');
    expect(last.messages[0].content).toBe('Hello world');
  });

  it('completes (stream ends) after emitting all tokens', async () => {
    const transport = new FakeStreamTransport({ tokens: ['x'], delayMs: 0 });
    const events = await collect(transport);
    expect(events.length).toBeGreaterThan(0);
  });

  it('uses default tokens when none provided', async () => {
    const transport = new FakeStreamTransport({ delayMs: 0 });
    const events = await collect(transport);
    expect(events.length).toBeGreaterThan(0);
  });

  it('backs a session created without a thread id', async () => {
    const transport = new FakeStreamTransport({ tokens: ['Hi', ' there'], delayMs: 0 });
    const created: string[] = [];
    const session = createSession({
      assistantId: 'agent',
      transport,
      onThreadId: (id) => created.push(id),
    });
    expect(session.threadId).toBeUndefined();
    await expect(session.submit('Hello')).resolves.toBe('success');
    expect(session.threadId).toBe('fake-thread-1');
    expect(created).toEqual(['fake-thread-1']);
    expect(
      session.getSnapshot().messages.map((message) => [message.role, message.content]),
    ).toEqual([
      ['user', 'Hello'],
      ['assistant', 'Hi there'],
    ]);
    expect(session.getSnapshot().status).toBe('idle');
    expect(session.getSnapshot().error).toBeUndefined();
    // A second turn adds to the thread: its reply is a message of its own.
    await expect(session.submit('More')).resolves.toBe('success');
    expect(
      session.getSnapshot().messages.map((message) => [message.role, message.content]),
    ).toEqual([
      ['user', 'Hello'],
      ['assistant', 'Hi there'],
      ['user', 'More'],
      ['assistant', 'Hi there'],
    ]);
    await session.dispose();
    // Each session without a thread id gets a thread of its own.
    const next = createSession({ assistantId: 'agent', transport });
    await next.submit('Again');
    expect(next.threadId).toBe('fake-thread-2');
    await next.dispose();
  });
});
