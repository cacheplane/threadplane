import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, of, Subject } from 'rxjs';
import type { BaseMessage } from '@langchain/core/messages';
import type { ThreadState } from '@langchain/langgraph-sdk';
import { ResourceStatus, type StreamSubjects } from '../agent.types';
import { MockAgentTransport } from '../transport/mock-stream.transport';
import { createStreamManagerBridge, _internalsForTesting } from './stream-manager.bridge';

function message(id: string | undefined, content: string, type = 'human'): BaseMessage {
  return { id, content, type } as unknown as BaseMessage;
}

function subjects(): StreamSubjects<Record<string, unknown>> {
  return {
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
}

describe('batch snapshot reconciliation work', () => {
  it('reconciles a full 10,001-row values snapshot with linear predicate visits after restore and streaming', async () => {
    const historySize = 10_000;
    const history = Array.from({ length: historySize }, (_, i) =>
      message(`history-${i}`, `turn ${i}`, i % 2 ? 'human' : 'ai'));
    const transport = new MockAgentTransport();
    transport.history = [{
      values: { messages: history }, next: [],
      checkpoint: { thread_id: 'history', checkpoint_ns: '', checkpoint_id: 'restored', checkpoint_map: null },
      metadata: null, created_at: '2026-11-02T00:00:00Z', parent_checkpoint: null, tasks: [],
    } as ThreadState];
    const state = subjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport, telemetry: false },
      subjects: state, threadId$: of(null), destroy$,
    });
    let visits = 0;
    const originalFindIndex = Array.prototype.findIndex;
    let restoreSpy: (() => void) | undefined;
    try {
      bridge.switchThread('history');
      await vi.waitFor(() => expect(state.messages$.value).toHaveLength(historySize));
      const run = bridge.submit({});
      const response = message('response', 'answer', 'ai');
      await transport.emit([{
        type: 'messages', messages: [response], messageMetadata: { langgraph_node: 'model' },
      }]);
      const streamingDelivery = bridge.getMessageDelivery('response');
      expect(streamingDelivery.phase).toBe('streaming');
      const snapshot = [...history, response];
      transport.history = [{ ...transport.history[0], values: { messages: snapshot } }];
      const spy = vi.spyOn(Array.prototype, 'findIndex').mockImplementation(function (this: unknown[], predicate, thisArg) {
        const counted = this.length >= historySize;
        return originalFindIndex.call(this, (value, index, array) => {
          if (counted) visits++;
          return predicate.call(thisArg, value, index, array);
        });
      });
      restoreSpy = () => spy.mockRestore();
      await transport.emit([{ type: 'values', data: { messages: snapshot } }]);
      spy.mockRestore();
      restoreSpy = undefined;
      await transport.close();
      await run;
      expect(state.messages$.value.map(({ id, content }) => ({ id, content })))
        .toEqual(snapshot.map(({ id, content }) => ({ id, content })));
      expect(bridge.getMessageDelivery('response')).toEqual({
        generation: streamingDelivery.generation, phase: 'complete', outcome: 'success',
      });
      // One complete scan is allowed; triangular exact-ID scans are not.
      expect(visits).toBeLessThanOrEqual(snapshot.length);
    } finally {
      restoreSpy?.();
      destroy$.next();
      await transport.close();
    }
  });

  const merge = _internalsForTesting.mergeMessages;

  it('updates the first existing duplicate, regardless of incoming order', () => {
    const result = merge([
      message('same', 'first'), message('same', 'second'), message('other', 'before'),
    ], [message('other', 'before after'), message('same', 'first updated'), message('same', 'first updated final')]);
    expect(result.map(({ id, content }) => ({ id, content }))).toEqual([
      { id: 'same', content: 'first updated final' }, { id: 'same', content: 'second' }, { id: 'other', content: 'before after' },
    ]);
  });

  it('indexes appended IDs for repetitions later in the same batch', () => {
    const result = merge([message('old', 'old')], [message('new', 'first'), message('new', 'first final')]);
    expect(result.map(({ id, content }) => ({ id, content }))).toEqual([
      { id: 'old', content: 'old' }, { id: 'new', content: 'first final' },
    ]);
  });

  it.each([undefined, ''])('indexes the actual ID after filling a falsy-ID content match (%s)', id => {
    const result = merge([message(id, 'echo')], [message('server', 'echo'), message('server', 'echo updated')]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'server', content: 'echo updated' });
  });

  it('keeps content fallback for incoming messages without IDs', () => {
    const result = merge([message(undefined, 'echo'), message('same', 'later')], [
      message(undefined, 'echo'), message('same', 'later changed'),
    ]);
    expect(result.map(({ id, content }) => ({ id, content }))).toEqual([
      { id: undefined, content: 'echo' }, { id: 'same', content: 'later changed' },
    ]);
  });

  it('retains optimistic identity rather than indexing a server alias', () => {
    const result = merge([message('optimistic', 'echo')], [
      message('server', 'echo'), message('server', 'new turn'),
    ]);
    expect(result.map(({ id, content }) => ({ id, content }))).toEqual([
      { id: 'optimistic', content: 'echo' }, { id: 'server', content: 'new turn' },
    ]);
  });

  it('retains longer snapshots and canonical cross-ID restrictions', () => {
    const canonical = new Set(['canonical']);
    const result = merge([message('canonical', 'long answer', 'ai')], [
      message('canonical', 'long', 'ai'), message('other', 'unrelated', 'ai'),
    ], undefined, 'snapshot', canonical, undefined, false);
    expect(result.map(({ id, content }) => ({ id, content }))).toEqual([
      { id: 'canonical', content: 'long answer' }, { id: 'other', content: 'unrelated' },
    ]);
  });

  it('retains single-message delta accumulation', () => {
    const result = merge([message('ai', 'a', 'ai')], [message('ai', 'b', 'ai')], undefined, 'delta');
    expect(result[0]).toMatchObject({ id: 'ai', content: 'ab' });
  });
});
