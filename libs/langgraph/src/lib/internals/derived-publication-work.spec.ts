import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, of, Subject } from 'rxjs';
import type { BaseMessage } from '@langchain/core/messages';
import type { ThreadState } from '@langchain/langgraph-sdk';
import { ResourceStatus, type StreamEvent, type StreamSubjects } from '../agent.types';
import { MockAgentTransport } from '../transport/mock-stream.transport';
import { createStreamManagerBridge } from './stream-manager.bridge';

function message(id: string, content: string, type = 'human'): BaseMessage {
  return { id, content, type } as unknown as BaseMessage;
}

function checkpoint(messages: BaseMessage[]): ThreadState {
  return {
    values: { messages }, next: [],
    checkpoint: { thread_id: 'history', checkpoint_ns: '', checkpoint_id: 'restored', checkpoint_map: null },
    metadata: null, created_at: '2026-11-04T00:00:00Z', parent_checkpoint: null, tasks: [],
  } as ThreadState;
}

function harness() {
  const subjects: StreamSubjects<Record<string, unknown>> = {
    status$: new BehaviorSubject(ResourceStatus.Idle),
    values$: new BehaviorSubject({}), messages$: new BehaviorSubject([]),
    error$: new BehaviorSubject(undefined), interrupt$: new BehaviorSubject(undefined),
    interrupts$: new BehaviorSubject([]), branch$: new BehaviorSubject(''),
    history$: new BehaviorSubject([]), isThreadLoading$: new BehaviorSubject(false),
    toolProgress$: new BehaviorSubject([]), toolCalls$: new BehaviorSubject([]),
    messageMetadata$: new BehaviorSubject(new Map()), subagents$: new BehaviorSubject(new Map()),
    queue$: new BehaviorSubject({ entries: [], size: 0, cancel: async () => false, clear: async () => undefined }),
    custom$: new BehaviorSubject([]),
  };
  const transport = new MockAgentTransport();
  const destroy$ = new Subject<void>();
  const bridge = createStreamManagerBridge({
    options: { apiUrl: '', assistantId: 'test', transport, subagentToolNames: ['task'], telemetry: false },
    subjects, threadId$: of(null), destroy$,
  });
  return {
    subjects, transport, bridge,
    async dispose() { destroy$.next(); await transport.close(); },
  };
}

function delta(value: Record<string, unknown>): StreamEvent {
  return { type: 'messages', messages: [value], messageMetadata: { langgraph_node: 'model' } } as StreamEvent;
}

describe('derived subject publication work', () => {
  it('does not republish empty tool and subagent state for text deltas after restoring 10,000 messages', async () => {
    const h = harness();
    const history = Array.from({ length: 10_000 }, (_, index) =>
      message(`history-${index}`, `Historical turn ${index}`, index % 2 ? 'human' : 'ai'));
    h.transport.history = [checkpoint(history)];
    let run: Promise<unknown> | undefined;
    const toolPublications: unknown[] = [], subagentPublications: unknown[] = [];
    const toolSubscription = h.subjects.toolCalls$.subscribe(value => toolPublications.push(value));
    const subagentSubscription = h.subjects.subagents$.subscribe(value => subagentPublications.push(value));
    try {
      h.bridge.switchThread('history');
      await vi.waitFor(() => expect(h.subjects.messages$.value).toHaveLength(history.length));
      const emptyTools = h.subjects.toolCalls$.value, emptySubagents = h.subjects.subagents$.value;
      toolPublications.length = 0;
      subagentPublications.length = 0;
      run = h.bridge.submit({});
      for (const content of ['first', ' second', ' third']) {
        await h.transport.emit([delta({ id: 'response', type: 'ai', content })]);
      }
      const finalMessages = [...history, message('response', 'first second third', 'ai')];
      expect(h.subjects.messages$.value.map(({ id, content }) => ({ id, content })))
        .toEqual(finalMessages.map(({ id, content }) => ({ id, content })));
      const delivery = h.bridge.getMessageDelivery('response');
      expect(delivery.phase).toBe('streaming');
      const counts = { tools: toolPublications.length, subagents: subagentPublications.length };
      console.info(JSON.stringify({ schema: 'derived-publication-work-v1', history: history.length, deltas: 3, ...counts }));
      h.transport.history = [checkpoint(finalMessages)];
      await h.transport.emit([{ type: 'values', data: { messages: finalMessages } }]);
      await h.transport.close();
      await run;
      expect(h.bridge.getMessageDelivery('response')).toEqual({
        generation: delivery.generation, phase: 'complete', outcome: 'success',
      });
      expect(counts).toEqual({ tools: 0, subagents: 0 });
      expect(h.subjects.toolCalls$.value).toBe(emptyTools);
      expect(h.subjects.subagents$.value).toBe(emptySubagents);
    } finally {
      toolSubscription.unsubscribe();
      subagentSubscription.unsubscribe();
      await h.dispose();
      await run;
    }
  });

  it('always republishes nonempty tool results, including same-object argument changes', async () => {
    const h = harness();
    const run = h.bridge.submit({});
    const call = { id: 'search-1', name: 'search', args: { q: 'before' } };
    try {
      await h.transport.emit([delta({ id: 'ai-1', type: 'ai', content: '', tool_calls: [call] })]);
      expect(h.subjects.toolCalls$.value[0]).toMatchObject({ id: 'search-1', state: 'pending', call: { args: { q: 'before' } } });
      const before = h.subjects.toolCalls$.value;
      const publications: unknown[] = [];
      const subscription = h.subjects.toolCalls$.subscribe(value => publications.push(value));
      publications.length = 0;
      await h.transport.emit([delta({ id: 'ai-1', type: 'ai', content: 'answer', tool_calls: [call] })]);
      expect(publications).toHaveLength(1);
      expect(h.subjects.toolCalls$.value).not.toBe(before);
      call.args.q = 'after';
      await h.transport.emit([delta({ id: 'ai-1', type: 'ai', content: ' continued', tool_calls: [call] })]);
      expect(publications).toHaveLength(2);
      expect(h.subjects.toolCalls$.value[0].call).toBe(call);
      expect(h.subjects.toolCalls$.value[0].call.args).toEqual({ q: 'after' });
      subscription.unsubscribe();
    } finally { await h.dispose(); await run; }
  });

  it.each(['success', 'error'] as const)('preserves matching result mutations and %s settlement', async status => {
    const h = harness();
    const run = h.bridge.submit({});
    const call = { id: 'search-1', name: 'search', args: {} };
    const result = { id: 'result-1', type: 'tool', tool_call_id: call.id, content: 'result', status };
    try {
      await h.transport.emit([delta({ id: 'ai-1', type: 'ai', content: '', tool_calls: [call] })]);
      await h.transport.emit([{ type: 'messages/partial', data: [result] }]);
      expect(h.subjects.toolCalls$.value[0]).toMatchObject({
        id: call.id, state: status === 'error' ? 'error' : 'completed', result: { content: 'result' },
      });
      const prior = h.subjects.toolCalls$.value;
      result.content = 'result updated';
      await h.transport.emit([{ type: 'messages/partial', data: [result] }]);
      expect(h.subjects.toolCalls$.value).not.toBe(prior);
      expect(h.subjects.toolCalls$.value[0]).toMatchObject({
        state: status === 'error' ? 'error' : 'completed', result: { content: 'result updated' },
      });
    } finally { await h.dispose(); await run; }
  });

  it('retains implied completion from a subsequent assistant without a tool result', async () => {
    const h = harness();
    const run = h.bridge.submit({});
    const call = { id: 'search-1', name: 'search', args: {} };
    try {
      await h.transport.emit([{
        type: 'messages/partial', data: [
          { id: 'ai-1', type: 'ai', content: '', tool_calls: [call] },
          { id: 'human-1', type: 'human', content: 'continue' },
        ],
      }]);
      expect(h.subjects.toolCalls$.value[0].state).toBe('pending');
      await h.transport.emit([delta({ id: 'ai-2', type: 'ai', content: 'subsequent answer' })]);
      expect(h.subjects.toolCalls$.value[0]).toMatchObject({ state: 'completed', result: undefined });
    } finally { await h.dispose(); await run; }
  });

  it('publishes removal of nonempty calls after authoritative history replacement', async () => {
    const h = harness();
    const history = [message('human-1', 'initial')];
    h.transport.history = [checkpoint(history)];
    let run: Promise<unknown> | undefined;
    try {
      h.bridge.switchThread('history');
      await vi.waitFor(() => expect(h.subjects.messages$.value).toHaveLength(1));
      run = h.bridge.submit({});
      await h.transport.emit([delta({
        id: 'ai-1', type: 'ai', content: '', tool_calls: [{ id: 'search-1', name: 'search', args: {} }],
      })]);
      expect(h.subjects.toolCalls$.value).toHaveLength(1);
      await h.transport.close();
      await run;
      expect(h.subjects.messages$.value.map(({ id }) => id)).toEqual(['human-1']);
      expect(h.subjects.toolCalls$.value).toEqual([]);
    } finally { await h.dispose(); await run; }
  });

  it('always republishes running and settled subagents and clears them on thread reset', async () => {
    const h = harness();
    h.transport.history = [checkpoint([message('human-1', 'initial')])];
    let run: Promise<unknown> | undefined;
    try {
      h.bridge.switchThread('history');
      await vi.waitFor(() => expect(h.subjects.messages$.value).toHaveLength(1));
      run = h.bridge.submit({});
      await h.transport.emit([delta({
        id: 'ai-1', type: 'ai', content: '',
        tool_calls: [{ id: 'child-1', name: 'task', args: { subagent_type: 'researcher', description: 'Research signals' } }],
      })]);
      expect(h.subjects.subagents$.value.size).toBe(0);
      const childValues = { messages: [{ type: 'human', content: 'Research signals' }], notes: 'first' };
      const childEvent = () => ({ type: 'values|tools:child-1', namespace: ['tools:child-1'], data: childValues }) as StreamEvent;
      await h.transport.emit([childEvent()]);
      expect(h.subjects.subagents$.value.get('child-1')?.status()).toBe('running');
      const prior = h.subjects.subagents$.value;
      childValues.notes = 'updated';
      await h.transport.emit([childEvent()]);
      expect(h.subjects.subagents$.value).not.toBe(prior);
      expect(h.subjects.subagents$.value.get('child-1')?.values()).toMatchObject({ notes: 'updated' });
      await h.transport.emit([{
        type: 'messages/partial', data: [{ id: 'tool-1', type: 'tool', tool_call_id: 'child-1', content: 'failed', status: 'error' }],
      }]);
      expect(h.subjects.subagents$.value.get('child-1')?.status()).toBe('error');
      expect(h.subjects.toolCalls$.value).toHaveLength(1);
      h.transport.history = [checkpoint([])];
      h.bridge.switchThread('empty-thread');
      await vi.waitFor(() => expect(h.subjects.messages$.value).toEqual([]));
      expect(h.subjects.toolCalls$.value).toEqual([]);
      expect(h.subjects.subagents$.value.size).toBe(0);
    } finally { await h.dispose(); await run; }
  });
});
