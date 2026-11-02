import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadState } from '@langchain/langgraph-sdk';
import { agent } from './agent.fn';
import { MockAgentTransport } from './transport/mock-stream.transport';

async function restoredAgent(messages: Record<string, unknown>[]) {
  const transport = new MockAgentTransport();
  transport.history = [{
    values: { messages }, next: [],
    checkpoint: { thread_id: 'projection-thread', checkpoint_ns: '', checkpoint_id: 'restored', checkpoint_map: null },
    metadata: null, created_at: '2026-11-02T00:00:00.000Z', parent_checkpoint: null, tasks: [],
  } as ThreadState];
  const ref = TestBed.runInInjectionContext(() => agent({
    apiUrl: '', assistantId: 'projection-test', transport,
    threadId: 'projection-thread', throttle: false, telemetry: false,
  }));
  await vi.waitFor(() => {
    expect(ref.history()).toHaveLength(1);
    expect(ref.messages()).toHaveLength(messages.length);
  });
  return { ref, transport };
}

describe('agent neutral projection work', () => {
  beforeEach(() => TestBed.configureTestingModule({}));
  afterEach(() => TestBed.resetTestingModule());

  it('reuses all 10000 unchanged restored projections when one streaming tail changes', async () => {
    const history = Array.from({ length: 10000 }, (_, index) => ({
      id: `history-${index}`, type: index % 2 === 0 ? 'human' : 'ai', content: `restored ${index}`,
    }));
    const { ref, transport } = await restoredAgent(history);
    const restored = ref.messages();
    const submitted = ref.submit({ message: 'continue' });
    let firstChurn = -1;
    let nextChurn = -1;
    try {
      await transport.emit([{
        type: 'messages', messages: [{ id: 'live-tail', type: 'ai', content: 'answer' }],
        messageMetadata: { langgraph_node: 'model' },
      }]);
      const first = ref.messages();
      firstChurn = first.slice(0, history.length).filter((message, index) => message !== restored[index]).length;
      expect(first.slice(0, history.length).map(message => [message.id, message.content])).toEqual(
        history.map(message => [message.id, message.content]),
      );
      expect(first.at(-1)).toMatchObject({ id: 'live-tail', content: 'answer', delivery: { phase: 'streaming' } });

      await transport.emit([{
        type: 'messages', messages: [{ id: 'live-tail', type: 'ai', content: ' continued' }],
        messageMetadata: { langgraph_node: 'model' },
      }]);
      const next = ref.messages();
      nextChurn = next.slice(0, history.length).filter((message, index) => message !== first[index]).length;
      expect(next.at(-1)).toMatchObject({ id: 'live-tail', content: 'answer continued', delivery: { phase: 'streaming' } });
      expect(next.at(-1)).not.toBe(first.at(-1));
      expect(first.at(-1)?.content).toBe('answer');
    } finally {
      await transport.close();
      await submitted;
    }
    expect({ firstChurn, nextChurn }).toEqual({ firstChurn: 0, nextChurn: 0 });
  });

  it.each(['primitive', 'nested'] as const)('refreshes same-object %s metadata without stale neutral identity', async kind => {
    const { ref, transport } = await restoredAgent([{
      id: 'restored', type: 'ai', content: 'unchanged text',
      customMetadata: kind === 'primitive' ? 'before' : { label: 'before' },
    }]);
    const before = ref.messages()[0];
    const raw = before.extra!;
    if (kind === 'primitive') raw['customMetadata'] = 'after';
    else (raw['customMetadata'] as { label: string }).label = 'after';
    const submitted = ref.submit({ message: 'continue' });
    try {
      await transport.emit([{
        type: 'messages', messages: [{ id: 'tail', type: 'ai', content: 'new' }],
        messageMetadata: { langgraph_node: 'model' },
      }]);
      const after = ref.messages().find(message => message.id === 'restored')!;
      expect(after.extra).toBe(raw);
      expect(after.extra?.['customMetadata']).toEqual(kind === 'primitive' ? 'after' : { label: 'after' });
      expect(after.content).toBe('unchanged text');
      expect(after.delivery).toEqual({ generation: 'restored', phase: 'complete', outcome: 'success' });
      expect(after).not.toBe(before);
    } finally {
      await transport.close();
      await submitted;
    }
  });

  it('reprojects terminal delivery for the same streamed ID even when its content does not change', async () => {
    const { ref, transport } = await restoredAgent([]);
    const submitted = ref.submit({ message: 'question' });
    await transport.emit([{
      type: 'messages', messages: [{ id: 'same-id', type: 'ai', content: 'answer' }],
      messageMetadata: { langgraph_node: 'model' },
    }]);
    const streaming = ref.messages().find(message => message.id === 'same-id')!;
    expect(streaming.delivery).toEqual({ generation: expect.any(String), phase: 'streaming' });
    // The final history read is authoritative. Model the server persisting the
    // streamed messages rather than returning the empty restored checkpoint.
    transport.history[0].values = { messages: ref.messages().map(message => message.extra) };
    await transport.emit([{ type: 'values', values: { done: true } }]);
    await transport.close();
    await submitted;
    const complete = ref.messages().find(message => message.id === 'same-id')!;
    expect(complete.content).toBe(streaming.content);
    expect(complete.delivery).toEqual({ generation: streaming.delivery.generation, phase: 'complete', outcome: 'success' });
    expect(complete).not.toBe(streaming);
    expect(streaming.delivery.phase).toBe('streaming');
  });

  it('updates reasoning duration when the same response moves from reasoning to visible text', async () => {
    const { ref, transport } = await restoredAgent([]);
    const submitted = ref.submit({ message: 'reason first' });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      await transport.emit([{
        type: 'messages',
        messages: [{ id: 'reasoned', type: 'ai', content: [{ type: 'reasoning', text: 'considering' }] }],
        messageMetadata: { langgraph_node: 'model' },
      }]);
      const reasoning = ref.messages().find(message => message.id === 'reasoned')!;
      expect(reasoning.reasoning).toBe('considering');
      expect(reasoning.reasoningDurationMs).toBeUndefined();
      clock.mockReturnValue(1250);
      await transport.emit([{
        type: 'messages', messages: [{ id: 'reasoned', type: 'ai', content: 'answer' }],
        messageMetadata: { langgraph_node: 'model' },
      }]);
      const answer = ref.messages().find(message => message.id === 'reasoned')!;
      expect(answer).toMatchObject({ content: 'answer', reasoning: 'considering', reasoningDurationMs: 250 });
      expect(answer.delivery).toEqual(reasoning.delivery);
      expect(answer).not.toBe(reasoning);
      expect(reasoning.reasoningDurationMs).toBeUndefined();
    } finally {
      clock.mockRestore();
      await transport.close();
      await submitted;
    }
  });
});
