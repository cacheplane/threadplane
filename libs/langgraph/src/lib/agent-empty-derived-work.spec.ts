import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { agent } from './agent.fn';
import { MockAgentTransport } from './transport/mock-stream.transport';

describe('empty derived agent state during long-history streaming', () => {
  it('keeps tool and subagent consumers stable while delivering every message delta', async () => {
    TestBed.configureTestingModule({});
    const history = Array.from({ length: 10_000 }, (_, index) => ({
      id: `history-${index}`, type: index % 2 ? 'human' : 'ai', content: `history ${index}`,
    }));
    const transport = new MockAgentTransport();
    transport.history = [{
      values: { messages: history }, next: [],
      checkpoint: { thread_id: 'history', checkpoint_ns: '', checkpoint_id: 'initial', checkpoint_map: null },
      metadata: null, created_at: '2026-11-04T00:00:00Z', parent_checkpoint: null, tasks: [],
    }];
    const ref = TestBed.runInInjectionContext(() => agent({
      apiUrl: '', assistantId: 'test', transport, threadId: 'history', throttle: false, telemetry: false,
    }));
    await vi.waitFor(() => expect(ref.messages()).toHaveLength(history.length));
    const run = ref.submit(null);
    try {
      await transport.emit([{
        type: 'messages', messages: [{ id: 'response', type: 'ai', content: 'a' }],
        messageMetadata: { langgraph_node: 'model' },
      }]);
      const toolRead = vi.fn(() => ref.toolCalls());
      const subagentRead = vi.fn(() => ref.subagents());
      const tools = computed(toolRead), subagents = computed(subagentRead);
      const emptyTools = tools(), emptySubagents = subagents();
      expect(emptyTools).toEqual([]);
      expect(emptySubagents.size).toBe(0);
      const first = ref.messages();
      for (const delta of ['b', 'c', 'd']) {
        await transport.emit([{
          type: 'messages', messages: [{ id: 'response', type: 'ai', content: delta }],
          messageMetadata: { langgraph_node: 'model' },
        }]);
        expect(tools()).toBe(emptyTools);
        expect(subagents()).toBe(emptySubagents);
      }
      // Public message projection remains fresh; no historical object cache is introduced.
      expect(ref.messages()).not.toBe(first);
      expect(ref.messages()[0]).not.toBe(first[0]);
      expect(ref.messages().slice(0, history.length).map(message => message.content))
        .toEqual(history.map(message => message.content));
      expect(ref.messages().at(-1)?.content).toBe('abcd');
      expect(ref.messages().at(-1)?.delivery.phase).toBe('streaming');
      expect(toolRead).toHaveBeenCalledTimes(1);
      expect(subagentRead).toHaveBeenCalledTimes(1);
      // ReplayTransport ends with an authoritative values snapshot before EOF.
      await transport.emit([{ type: 'values', data: {
        messages: [...history, { id: 'response', type: 'ai', content: 'abcd' }],
      } }]);
      await transport.close();
      await run;
      expect(ref.messages().at(-1)?.delivery).toMatchObject({ phase: 'complete', outcome: 'success' });
    } finally {
      await transport.close();
      await run;
    }
  });
});
