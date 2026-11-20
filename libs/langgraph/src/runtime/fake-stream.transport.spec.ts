import { describe, it, expect } from 'vitest';
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
});
