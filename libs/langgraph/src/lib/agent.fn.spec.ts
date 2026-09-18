import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type { AIMessage as CoreAIMessage } from '@langchain/core/messages';
import { agent, resolveSubagentsByMessage } from './agent.fn';
import type { SubagentStreamRef } from './agent.types';
import { MockAgentTransport } from './transport/mock-stream.transport';
import type { AgentTransport, StreamEvent } from './agent.types';
import type { ThreadState } from '@langchain/langgraph-sdk';
import {
  createLangGraphClient,
  ɵcreateProtectedLangGraphClient,
} from './client/create-langgraph-client';
import { LANGGRAPH_CLIENT_OPTIONS } from './client/client-options';
import { AGENT_CONFIG } from './agent.provider';
import { AgentError } from '@threadplane/chat';
import { isDevelopmentRuntimeEnabled } from '@threadplane/telemetry/browser';
import { ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER } from './runtime-operation-reporter';

vi.mock('./client/create-langgraph-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client/create-langgraph-client')>();
  return {
    ...actual,
    createLangGraphClient: vi.fn(actual.createLangGraphClient),
    ɵcreateProtectedLangGraphClient: vi.fn(actual.ɵcreateProtectedLangGraphClient),
  };
});

function withInjectionContext<T>(fn: () => T): T {
  let result!: T;
  TestBed.runInInjectionContext(() => { result = fn(); });
  return result;
}

function threadState(
  checkpointId: string,
  parentCheckpointId: string | null = null,
): ThreadState<Record<string, unknown>> {
  return {
    values: { messages: [checkpointId] },
    next: [],
    checkpoint: {
      thread_id: 'thread-1',
      checkpoint_ns: '',
      checkpoint_id: checkpointId,
      checkpoint_map: null,
    },
    metadata: null,
    created_at: '2026-05-02T00:00:00.000Z',
    parent_checkpoint: parentCheckpointId
      ? {
          thread_id: 'thread-1',
          checkpoint_ns: '',
          checkpoint_id: parentCheckpointId,
          checkpoint_map: null,
        }
      : null,
    tasks: [],
  };
}

describe('agent', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  it('propagates automatic collection policy to consumers of the returned agent', () => {
    for (const telemetry of [undefined, false, vi.fn()] as const) {
      const ref = withInjectionContext(() => agent({ assistantId: 'test', transport: new MockAgentTransport(), telemetry }));
      expect(isDevelopmentRuntimeEnabled(ref)).toBe(telemetry === undefined);
    }
  });

  it('returns a ref with initial idle status', () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );
    // status() now returns AgentStatus (runtime-neutral), not ResourceStatus
    expect(ref.status()).toBe('idle');
    expect(ref.isLoading()).toBe(false);
    expect(ref.hasValue()).toBe(false);
    expect(ref.error()).toBeUndefined();
    expect(ref.messages()).toEqual([]);
  });

  it('returns initialValues in value() immediately', () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({
        apiUrl: '', assistantId: 'a', transport,
        initialValues: { count: 99 },
      })
    );
    expect((ref.value() as any).count).toBe(99);
  });

  describe('neutral message delivery', () => {
    it('projects restored assistant, user, tool, and system messages as static success', async () => {
      const transport = new MockAgentTransport();
      transport.history = [{
        values: {
          messages: [
            { id: 'system-1', type: 'system', content: 'rules' },
            { id: 'user-1', type: 'human', content: 'question' },
            { id: 'assistant-1', type: 'ai', content: 'answer' },
            { id: 'tool-1', type: 'tool', tool_call_id: 'call-1', content: 'result' },
          ],
        },
        next: [],
        checkpoint: { thread_id: 'thread-1', checkpoint_ns: '', checkpoint_id: 'cp-1', checkpoint_map: null },
        metadata: null,
        created_at: '2026-07-11T00:00:00.000Z',
        parent_checkpoint: null,
        tasks: [],
      } as never];
      const ref = withInjectionContext(() =>
        agent({ apiUrl: '', assistantId: 'a', transport, threadId: 'thread-1', throttle: false })
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(ref.messages().map(message => message.delivery)).toEqual([
        { generation: 'system-1', phase: 'complete', outcome: 'success' },
        { generation: 'user-1', phase: 'complete', outcome: 'success' },
        { generation: 'assistant-1', phase: 'complete', outcome: 'success' },
        { generation: 'tool-1', phase: 'complete', outcome: 'success' },
      ]);
    });

    it('reactively projects assistant streaming and terminal success without content changing', async () => {
      const transport = new MockAgentTransport();
      const ref = withInjectionContext(() =>
        agent({ apiUrl: '', assistantId: 'a', transport, throttle: false })
      );

      const submitted = ref.submit({ message: 'hello' });
      await transport.emit([{
        type: 'messages',
        messages: [{ id: 'ai-live', type: 'ai', content: 'answer' }],
        messageMetadata: { langgraph_node: 'model' },
      }]);

      const streaming = ref.messages().find(message => message.id === 'ai-live')?.delivery;
      expect(streaming).toEqual({ generation: expect.any(String), phase: 'streaming' });

      transport.emit([{ type: 'values', values: { done: true } }]);
      transport.close();
      await submitted;

      expect(ref.messages().find(message => message.id === 'ai-live')?.delivery).toEqual({
        generation: streaming?.generation,
        phase: 'complete',
        outcome: 'success',
      });
    });

    it('allocates a new generation for a regenerated assistant response', async () => {
      let run = 0;
      const transport: AgentTransport = {
        async *stream() {
          run += 1;
          yield {
            type: 'messages',
            messages: run === 1
              ? [{ id: 'user-regen', type: 'human', content: 'question' }, { id: 'ai-old', type: 'ai', content: 'old' }]
              : [{ id: 'ai-new', type: 'ai', content: 'new' }],
          };
          yield { type: 'values', values: { done: true } };
        },
        async updateState() {
          return;
        },
      };
      const ref = withInjectionContext(() =>
        agent({ apiUrl: '', assistantId: 'a', transport, threadId: 'thread-1', throttle: false })
      );

      await ref.submit({ message: 'question' });
      const oldGeneration = ref.messages().find(message => message.id === 'ai-old')?.delivery.generation;
      expect(oldGeneration).not.toBe('ai-old');
      await ref.regenerate(ref.messages().findIndex(message => message.id === 'ai-old'));
      const regenerated = ref.messages().find(message => message.id === 'ai-new')?.delivery;

      expect(regenerated).toMatchObject({ phase: 'complete', outcome: 'success' });
      expect(regenerated?.generation).not.toBe('ai-new');
      expect(regenerated?.generation).not.toBe(oldGeneration);
    });

    it('uses each subagent invocation generation and terminalizes success and error', async () => {
      const transport = new MockAgentTransport();
      const ref = withInjectionContext(() =>
        agent({
          apiUrl: '', assistantId: 'a', transport, throttle: false,
          subagentToolNames: ['task'],
        })
      );

      void ref.submit({ message: 'delegate' });
      transport.emit([{
        type: 'messages',
        messages: [{
          id: 'ai-parent', type: 'ai', content: '',
          tool_calls: [
            { id: 'call-success', name: 'task', args: { subagent_type: 'researcher', description: 'research' } },
            { id: 'call-error', name: 'task', args: { subagent_type: 'reviewer', description: 'review' } },
          ],
        }],
      }]);
      await transport.emit([{
        type: 'messages|tools:call-success', namespace: ['tools:call-success'],
        messages: [{ id: 'sub-success', type: 'ai', content: 'result' }],
        messageMetadata: { checkpoint_ns: 'tools:call-success|model' },
      }, {
        type: 'messages|tools:call-error', namespace: ['tools:call-error'],
        messages: [{ id: 'sub-error', type: 'ai', content: 'partial' }],
        messageMetadata: { checkpoint_ns: 'tools:call-error|model' },
      }]);

      const successStreaming = ref.subagents().get('call-success')?.messages()[0].delivery;
      const errorStreaming = ref.subagents().get('call-error')?.messages()[0].delivery;
      expect(successStreaming).toMatchObject({ phase: 'streaming' });
      expect(errorStreaming).toMatchObject({ phase: 'streaming' });
      expect(successStreaming?.generation).not.toBe(errorStreaming?.generation);

      await transport.emit([{
        type: 'messages',
        messages: [
          { id: 'tool-success', type: 'tool', tool_call_id: 'call-success', content: 'done', status: 'success' },
          { id: 'tool-error', type: 'tool', tool_call_id: 'call-error', content: 'failed', status: 'error' },
        ],
      }]);

      expect(ref.subagents().get('call-success')?.messages()[0].delivery).toEqual({
        generation: successStreaming?.generation,
        phase: 'complete',
        outcome: 'success',
      });
      expect(ref.subagents().get('call-error')?.messages()[0].delivery).toEqual({
        generation: errorStreaming?.generation,
        phase: 'complete',
        outcome: 'error',
      });
      await ref.stop();
    });
  });

  it('status transitions to running (isLoading) on submit()', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );
    ref.submit({ message: 'hello' });
    expect(ref.isLoading()).toBe(true);
  });

  it('submit() resolves after the active stream completes', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );

    let settled = false;
    const submitted = ref.submit({ message: 'hello' }).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    transport.close();
    await submitted;
    expect(settled).toBe(true);
  });

  it('queue() exposes server-side enqueue submissions', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport, threadId: 'thread-1' })
    );

    ref.submit({ message: 'active' });
    await ref.submit({ message: 'queued' }, { multitaskStrategy: 'enqueue' });

    expect(ref.queue().size).toBe(1);
    expect(ref.queue().entries[0]).toMatchObject({
      values: { messages: [{ role: 'human', content: 'queued' }] },
    });

    await ref.queue().clear();
    expect(ref.queue().size).toBe(0);
  });

  it('hasValue becomes true after values event', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );
    ref.submit({ message: 'hello' });
    transport.emit([{ type: 'values', values: { x: 1 } }]);
    transport.close();
    await new Promise(r => setTimeout(r, 20));
    expect(ref.hasValue()).toBe(true);
    expect((ref.value() as any).x).toBe(1);
  });

  it('error() is set and status is "error" on transport error', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );
    ref.submit({ message: 'hello' });
    transport.emitError(new Error('fail'));
    await new Promise(r => setTimeout(r, 20));
    expect(ref.status()).toBe('error');
    expect(ref.error()).toBeInstanceOf(Error);
  });

  it('stop() resolves the stream and sets status to idle', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );
    ref.submit({ message: 'hello' });
    await ref.stop();
    // After stop, status is no longer "running"
    expect(ref.isLoading()).toBe(false);
  });

  it('reload() re-submits the last payload', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );
    const submitted = ref.submit({ message: 'hello' });
    transport.close();
    await submitted;
    await new Promise(r => setTimeout(r, 10));
    const reloaded = ref.reload();
    expect(reloaded).toBeUndefined();
    expect(ref.isLoading()).toBe(true);
    await ref.stop();
  });

  it('accepts threadId as a Signal', () => {
    const transport = new MockAgentTransport();
    const threadId = signal<string | null>(null);
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport, threadId })
    );
    expect(ref.status()).toBe('idle');
  });

  it('messages() returns Message[] (runtime-neutral) with correct role translation', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );
    ref.submit({ message: 'hello' });
    transport.emit([{
      type: 'messages',
      messages: [{ id: '1', type: 'human', content: 'hi' }],
    }]);
    transport.close();
    await new Promise(r => setTimeout(r, 20));
    const msgs = ref.messages();
    expect(msgs).toHaveLength(1);
    // Runtime-neutral role: 'human' translates to 'user'
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('hi');
  });

  it('langGraphMessages() returns raw BaseMessage[] without role translation', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport, throttle: false })
    );
    ref.submit({ message: 'hello' });
    transport.emit([{
      type: 'messages',
      messages: [{ id: '1', type: 'human', content: 'hi' }],
    }]);
    transport.close();
    await new Promise(r => setTimeout(r, 30));
    const rawMsgs = ref.langGraphMessages();
    expect(rawMsgs).toHaveLength(1);
    // Raw BaseMessage: no role translation — the internal type field is 'human'
    const raw = rawMsgs[0] as any;
    const type = typeof raw._getType === 'function' ? raw._getType() : raw['type'];
    expect(type).toBe('human');
  });

  it('history() returns AgentCheckpoint[]; langGraphHistory() returns ThreadState[]', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );
    // Initially both are empty arrays
    expect(ref.history()).toEqual([]);
    expect(ref.langGraphHistory()).toEqual([]);

    // history() returns AgentCheckpoint-shaped objects (runtime-neutral)
    const histVal = ref.history();
    expect(Array.isArray(histVal)).toBe(true);

    // langGraphHistory() returns ThreadState-shaped objects
    const rawHist = ref.langGraphHistory();
    expect(Array.isArray(rawHist)).toBe(true);
  });

  it('normalizes resume submit options into a LangGraph command', async () => {
    const seen: Array<{ payload: unknown; options: unknown }> = [];
    const transport = new MockAgentTransport();
    transport.stream = async function* (
      _assistantId: string,
      _threadId: string | null,
      payload: unknown,
      _signal: AbortSignal,
      options?: unknown,
    ) {
      seen.push({ payload, options });
      yield* [];
    };

    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport, threadId: 'thread-1', throttle: false })
    );

    await ref.submit(null, { resume: { approved: true } });

    expect(seen).toEqual([
      {
        payload: null,
        options: expect.objectContaining({
          command: { resume: { approved: true } },
        }),
      },
    ]);
  });

  it('forwards a multi-field structured resume payload verbatim', async () => {
    const seen: Array<{ payload: unknown; options: unknown }> = [];
    const transport = new MockAgentTransport();
    transport.stream = async function* (
      _assistantId: string,
      _threadId: string | null,
      payload: unknown,
      _signal: AbortSignal,
      options?: unknown,
    ) {
      seen.push({ payload, options });
      yield* [];
    };

    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport, threadId: 'thread-1', throttle: false })
    );

    await ref.submit(null, {
      resume: {
        approved: true,
        amount: 47.5,
        idempotency_key: 'idem_abc123',
        meta: { reviewer: 'brian', at: '2026-05-25T18:00:00Z' },
      },
    });

    expect(seen).toEqual([
      {
        payload: null,
        options: expect.objectContaining({
          command: {
            resume: {
              approved: true,
              amount: 47.5,
              idempotency_key: 'idem_abc123',
              meta: { reviewer: 'brian', at: '2026-05-25T18:00:00Z' },
            },
          },
        }),
      },
    ]);
  });

  it('normalizes resume submit input state into a LangGraph command update', async () => {
    const seen: Array<{ payload: unknown; options: unknown }> = [];
    const transport = new MockAgentTransport();
    transport.stream = async function* (
      _assistantId: string,
      _threadId: string | null,
      payload: unknown,
      _signal: AbortSignal,
      options?: unknown,
    ) {
      seen.push({ payload, options });
      yield* [];
    };

    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport, threadId: 'thread-1', throttle: false })
    );

    await ref.submit({
      resume: { approved: true },
      state: { reviewNotes: 'ship it' },
    });

    expect(seen).toEqual([
      {
        payload: null,
        options: expect.objectContaining({
          command: {
            resume: { approved: true },
            update: { reviewNotes: 'ship it' },
          },
        }),
      },
    ]);
  });

  it('normalizes resume submit input messages into a LangGraph command update', async () => {
    const seen: Array<{ payload: unknown; options: unknown }> = [];
    const transport = new MockAgentTransport();
    transport.stream = async function* (
      _assistantId: string,
      _threadId: string | null,
      payload: unknown,
      _signal: AbortSignal,
      options?: unknown,
    ) {
      seen.push({ payload, options });
      yield* [];
    };

    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport, threadId: 'thread-1', throttle: false })
    );

    await ref.submit({
      message: 'Approved, continue',
      resume: { approved: true },
      state: { reviewer: 'Ada' },
    });

    expect(seen).toEqual([
      {
        payload: null,
        options: expect.objectContaining({
          command: {
            resume: { approved: true },
            update: {
              messages: [{ type: 'human', role: 'human', content: 'Approved, continue' }],
              reviewer: 'Ada',
            },
          },
        }),
      },
    ]);
  });

  it('merges resume submit updates with existing LangGraph command updates', async () => {
    const seen: Array<{ payload: unknown; options: unknown }> = [];
    const transport = new MockAgentTransport();
    transport.stream = async function* (
      _assistantId: string,
      _threadId: string | null,
      payload: unknown,
      _signal: AbortSignal,
      options?: unknown,
    ) {
      seen.push({ payload, options });
      yield* [];
    };

    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport, threadId: 'thread-1', throttle: false })
    );

    await ref.submit(
      {
        resume: { approved: true },
        state: { reviewer: 'Ada' },
      },
      {
        command: {
          update: { workflow: 'release' },
          goto: 'publish',
        },
      },
    );

    expect(seen).toEqual([
      {
        payload: null,
        options: expect.objectContaining({
          command: {
            resume: { approved: true },
            update: {
              workflow: 'release',
              reviewer: 'Ada',
            },
            goto: 'publish',
          },
        }),
      },
    ]);
  });

  it('experimentalBranchTree() exposes a branch tree derived from LangGraph history', async () => {
    const root = threadState('root');
    const left = threadState('left', 'root');
    const right = threadState('right', 'root');
    const transport = new MockAgentTransport();
    transport.history = [root, left, right];

    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport, threadId: 'thread-1', throttle: false })
    );
    await new Promise(r => setTimeout(r, 20));

    const tree = ref.experimentalBranchTree();
    expect(tree.type).toBe('sequence');
    expect(tree.items[0]).toEqual({ type: 'node', value: root, path: [] });
    const fork = tree.items[1];
    expect(fork?.type).toBe('fork');
    if (fork?.type !== 'fork') throw new Error('Expected fork node');
    expect(fork.items.map(sequence => sequence.items[0])).toEqual(
      expect.arrayContaining([
        { type: 'node', value: left, path: ['left'] },
        { type: 'node', value: right, path: ['right'] },
      ]),
    );
  });

  it('messages() translates AIMessage role to "assistant"', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );
    ref.submit({ message: 'hello' });
    transport.emit([{
      type: 'messages',
      messages: [{ id: '2', type: 'ai', content: 'hello back' }],
    }]);
    transport.close();
    await new Promise(r => setTimeout(r, 20));
    const msgs = ref.messages();
    expect(msgs[0].role).toBe('assistant');
  });

  it('switchThread() resets messages and values', () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );
    ref.switchThread('thread-2');
    expect(ref.messages()).toEqual([]);
  });

  it('resets state when a bound threadId signal changes', async () => {
    const transport = new MockAgentTransport();
    const threadId = signal<string | null>('thread-1');
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport, threadId })
    );

    ref.submit({ message: 'hello' });
    transport.emit([
      { type: 'values', values: { x: 1 } },
      { type: 'messages', messages: [{ id: '1', type: 'human', content: 'hi' }] as any[] },
    ]);
    await new Promise(r => setTimeout(r, 20));

    expect(ref.hasValue()).toBe(true);
    expect((ref.value() as any).x).toBe(1);
    expect(ref.messages()).toHaveLength(1);

    threadId.set('thread-2');
    await new Promise(r => setTimeout(r, 30));

    expect(ref.hasValue()).toBe(false);
    expect(ref.status()).toBe('idle');
    expect(ref.error()).toBeUndefined();
    expect(ref.value()).toEqual({});
    expect(ref.messages()).toEqual([]);
    expect(ref.history()).toEqual([]);
    expect(ref.interrupt()).toBeUndefined();
    expect(ref.isThreadLoading()).toBe(false);
  });

  it('langGraphInterrupts() exposes raw LangGraph interrupts signal', () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );
    expect(Array.isArray(ref.langGraphInterrupts())).toBe(true);
  });

  it('langGraphToolCalls() exposes raw ToolCallWithResult[] signal', () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );
    expect(Array.isArray(ref.langGraphToolCalls())).toBe(true);
  });

  it('toolProgress() reflects tools stream lifecycle events', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport, throttle: false })
    );

    ref.submit({ message: 'hello' });
    transport.emit([{
      type: 'tools',
      data: { event: 'on_tool_start', toolCallId: 'call-1', name: 'search', input: { q: 'angular' } },
    } satisfies StreamEvent]);
    transport.close();
    await new Promise(r => setTimeout(r, 20));

    expect(ref.toolProgress()).toEqual([
      {
        toolCallId: 'call-1',
        name: 'search',
        state: 'starting',
        input: { q: 'angular' },
      },
    ]);
  });

  it('toolCalls() and getToolCalls() expose tool results derived from messages', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport, throttle: false })
    );

    ref.submit({ message: 'hello' });
    transport.emit([{
      type: 'messages',
      messages: [
        {
          id: 'ai-1',
          type: 'ai',
          content: '',
          tool_calls: [{ id: 'call-1', name: 'search', args: { q: 'angular' } }],
        },
        {
          id: 'tool-1',
          type: 'tool',
          tool_call_id: 'call-1',
          content: 'result',
          status: 'success',
        },
      ],
    } satisfies StreamEvent]);
    transport.close();
    await new Promise(r => setTimeout(r, 20));

    expect(ref.langGraphToolCalls()).toHaveLength(1);
    expect(ref.toolCalls()).toEqual([
      {
        id: 'call-1',
        name: 'search',
        args: { q: 'angular' },
        status: 'complete',
        result: 'result',
        error: undefined,
      },
    ]);
    expect(ref.getToolCalls(ref.langGraphMessages()[0] as CoreAIMessage)).toHaveLength(1);
  });

  it('getMessagesMetadata() returns stream metadata captured from message tuples', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport, throttle: false })
    );

    ref.submit({ message: 'hello' });
    transport.emit([{
      type: 'messages',
      messages: [{ id: 'ai-1', type: 'ai', content: 'hello' }],
      messageMetadata: { langgraph_node: 'model', run_id: 'run-1' },
    } satisfies StreamEvent]);
    transport.close();
    await new Promise(r => setTimeout(r, 20));

    const aiMessage = ref.langGraphMessages().find(
      msg => (msg as unknown as Record<string, unknown>)['id'] === 'ai-1',
    );
    if (!aiMessage) throw new Error('Expected streamed AI message');

    expect(ref.getMessagesMetadata(aiMessage, 0)).toEqual({
      messageId: 'ai-1',
      firstSeenState: undefined,
      branch: undefined,
      branchOptions: undefined,
      streamMetadata: { langgraph_node: 'model', run_id: 'run-1' },
    });
  });

  it('subagents() and activeSubagents() expose delegated work as signals', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({
        apiUrl: '',
        assistantId: 'a',
        transport,
        throttle: false,
        subagentToolNames: ['task'],
      })
    );

    ref.submit({ message: 'hello' });
    transport.emit([{
      type: 'messages',
      messages: [{
        id: 'ai-1',
        type: 'ai',
        content: '',
        tool_calls: [{
          id: 'call-1',
          name: 'task',
          args: { subagent_type: 'researcher', description: 'Research Angular signals' },
        }],
      }],
    } satisfies StreamEvent]);
    transport.emit([{
      type: 'messages|tools:call-1' as StreamEvent['type'],
      namespace: ['tools:call-1'],
      messages: [{ id: 'sub-ai-1', type: 'ai', content: 'Subagent note' }],
      messageMetadata: { checkpoint_ns: 'tools:call-1|model:abc' },
    } satisfies StreamEvent]);

    await new Promise(r => setTimeout(r, 20));

    expect(ref.activeSubagents()).toHaveLength(1);
    expect(ref.activeSubagents()[0].status()).toBe('running');
    expect(ref.subagents().get('call-1')?.name).toBe('researcher');
    expect(ref.subagents().get('call-1')?.messages()).toEqual([
      expect.objectContaining({ id: 'sub-ai-1', role: 'assistant', content: 'Subagent note' }),
    ]);
    expect(ref.messages()).toHaveLength(1);
    expect(ref.messages()[0].id).toBe('ai-1');

    transport.emit([{
      type: 'messages',
      messages: [{ id: 'tool-1', type: 'tool', tool_call_id: 'call-1', content: 'done', status: 'success' }],
    } satisfies StreamEvent]);
    transport.close();
    await new Promise(r => setTimeout(r, 20));

    expect(ref.activeSubagents()).toHaveLength(0);
    expect(ref.subagents().get('call-1')?.status()).toBe('complete');
  });

  it('exposes helper methods for looking up subagent streams', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({
        apiUrl: '',
        assistantId: 'a',
        transport,
        throttle: false,
        subagentToolNames: ['task'],
      })
    );

    ref.submit({ message: 'hello' });
    const triggeringMessage = {
      id: 'ai-helpers',
      type: 'ai',
      content: '',
      tool_calls: [
        {
          id: 'call-research',
          name: 'task',
          args: { subagent_type: 'researcher', description: 'Research Angular signals' },
        },
        {
          id: 'call-review',
          name: 'task',
          args: { subagent_type: 'reviewer', description: 'Review the notes' },
        },
      ],
    } as unknown as CoreAIMessage;
    transport.emit([{
      type: 'messages',
      messages: [triggeringMessage],
    } satisfies StreamEvent]);
    transport.emit([{
      type: 'messages|tools:call-research' as StreamEvent['type'],
      namespace: ['tools:call-research'],
      messages: [{ id: 'sub-ai-research', type: 'ai', content: 'Research note' }],
    } satisfies StreamEvent]);
    transport.emit([{
      type: 'messages|tools:call-review' as StreamEvent['type'],
      namespace: ['tools:call-review'],
      messages: [{ id: 'sub-ai-review', type: 'ai', content: 'Review note' }],
    } satisfies StreamEvent]);

    await new Promise(r => setTimeout(r, 20));

    expect(ref.getSubagent('call-research')?.name).toBe('researcher');
    expect(ref.getSubagentsByType('reviewer').map(sa => sa.toolCallId)).toEqual(['call-review']);
    expect(ref.getSubagentsByMessage(triggeringMessage).map(sa => sa.toolCallId)).toEqual([
      'call-research',
      'call-review',
    ]);
    expect(ref.getSubagent('missing')).toBeUndefined();
  });

  it('getSubagentsByMessage resolves through the Subagent.toolCallId field, not the map key', () => {
    // The neutral contract anchors a subagent on `Subagent.toolCallId`; the
    // map KEY is an adapter detail (LangGraph keys by the id today, AG-UI
    // keys activities by `<toolCallId>-sub`). A key that diverges from the
    // field must not hide the subagent from the message lookup.
    const sub = (toolCallId: string, name: string): SubagentStreamRef => ({
      toolCallId,
      name,
      status: signal<'pending' | 'running' | 'complete' | 'error'>('running'),
      values: signal<Record<string, unknown>>({}),
      messages: signal([]),
    });
    const subagents = new Map<string, SubagentStreamRef>([
      ['call_x-sub', sub('call_x', 'researcher')],
      ['call_y-sub', sub('call_y', 'reviewer')],
      ['unrelated-sub', sub('call_z', 'other')],
    ]);
    const msg = {
      id: 'ai-1',
      type: 'ai',
      content: '',
      tool_calls: [
        { id: 'call_x', name: 'task', args: {} },
        { id: 'call_y', name: 'task', args: {} },
      ],
    } as unknown as CoreAIMessage;

    expect(resolveSubagentsByMessage(msg, subagents).map(sa => sa.name)).toEqual(['researcher', 'reviewer']);
  });

  it('events$ is an Observable-like with .subscribe', () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );
    expect(typeof ref.events$.subscribe).toBe('function');
  });

  describe('agent.regenerate()', () => {
    it('truncates messages inclusive of user (userIdx+1) and re-runs with null input', async () => {
      const seen: Array<{ payload: unknown; options: unknown }> = [];
      const transport = new MockAgentTransport();
      const origStream = transport.stream.bind(transport);
      transport.stream = async function* (
        assistantId: string,
        threadId: string | null,
        payload: unknown,
        signal: AbortSignal,
        options?: unknown,
      ) {
        seen.push({ payload, options });
        yield* origStream(assistantId, threadId, payload, signal, options as any);
      };

      const ref = withInjectionContext(() =>
        agent({ apiUrl: '', assistantId: 'a', transport, throttle: false })
      );

      // Seed messages via transport
      ref.submit({ message: 'hello' });
      transport.emit([{
        type: 'messages',
        messages: [
          { id: '1', type: 'human', content: 'hello' },
          { id: '2', type: 'ai', content: 'hi there' },
        ],
      }]);
      transport.close();
      await new Promise(r => setTimeout(r, 30));

      expect(ref.messages()).toHaveLength(2);
      expect(ref.messages()[1].role).toBe('assistant');

      // Regenerate the assistant message at index 1
      const regeneratePromise = ref.regenerate(1);
      transport.close();
      await regeneratePromise;

      // After regenerate: exactly 1 message — user preserved (inclusive truncation),
      // assistant dropped. Buffer length === userIdx + 1 === 1.
      expect(ref.messages()).toHaveLength(1);
      expect(ref.messages()[0].role).toBe('user');
      expect(ref.messages()[0].content).toBe('hello');

      // The second submit call (for the re-run) must use null input (no new messages)
      expect(seen).toHaveLength(2);
      expect(seen[1]?.payload).toBeNull();
    });

    it("forwards asNode: '__start__' to transport.updateState so the next submit(null) can resume", async () => {
      // After the original run the LangGraph thread sits at __end__ with
      // `next: []`. submit(null) is a no-op in that position. The regenerate
      // flow has to reposition the thread via `as_node='__start__'` before
      // re-running, so the transport must receive that option.
      const updateCalls: Array<{
        threadId: string;
        values: Record<string, unknown>;
        options?: { asNode?: string };
      }> = [];
      const transport = new MockAgentTransport();
      // Augment the mock with an updateState capture.
      (transport as unknown as {
        updateState: (
          threadId: string,
          values: Record<string, unknown>,
          signal: AbortSignal,
          options?: { asNode?: string },
        ) => Promise<void>;
      }).updateState = async (threadId, values, _signal, options) => {
        updateCalls.push({ threadId, values, options });
      };

      const ref = withInjectionContext(() =>
        agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
      );

      ref.submit({ message: 'hello' });
      transport.emit([{
        type: 'messages',
        messages: [
          { id: 'u-1', type: 'human', content: 'hello' },
          { id: 'a-1', type: 'ai', content: 'hi there' },
        ],
      }]);
      transport.close();
      await new Promise(r => setTimeout(r, 30));

      const regeneratePromise = ref.regenerate(1);
      transport.close();
      await regeneratePromise;

      // updateState invoked exactly once — with the RemoveMessage payload
      // AND asNode set to '__start__'. Without asNode, regenerate would
      // submit(null) against a terminal thread and produce no new assistant.
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]?.threadId).toBe('t-1');
      expect(updateCalls[0]?.options?.asNode).toBe('__start__');
      const removeMessages = (updateCalls[0]?.values?.['messages'] as Array<Record<string, unknown>>) ?? [];
      expect(removeMessages).toHaveLength(1);
      expect(removeMessages[0]?.['type']).toBe('remove');
      expect(removeMessages[0]?.['id']).toBe('a-1');
    });

    it('throws when target index is not an assistant message', async () => {
      const transport = new MockAgentTransport();
      const ref = withInjectionContext(() =>
        agent({ apiUrl: '', assistantId: 'a', transport, throttle: false })
      );

      ref.submit({ message: 'hello' });
      transport.emit([{
        type: 'messages',
        messages: [{ id: '1', type: 'human', content: 'hello' }],
      }]);
      transport.close();
      await new Promise(r => setTimeout(r, 20));

      await expect(ref.regenerate(0)).rejects.toThrow(/not an assistant/);
    });

    it('throws when agent is loading', async () => {
      const transport = new MockAgentTransport();
      const ref = withInjectionContext(() =>
        agent({ apiUrl: '', assistantId: 'a', transport, throttle: false })
      );

      // Start a submit but don't close it (so isLoading remains true)
      ref.submit({ message: 'hello' });
      expect(ref.isLoading()).toBe(true);

      await expect(ref.regenerate(0)).rejects.toThrow(/loading/);
      transport.close();
    });

    it('throws when no user message precedes the target', async () => {
      const transport = new MockAgentTransport();
      const ref = withInjectionContext(() =>
        agent({ apiUrl: '', assistantId: 'a', transport, throttle: false })
      );

      // Inject an assistant message with no preceding user message
      ref.submit({ message: '' });
      transport.emit([{
        type: 'messages',
        messages: [{ id: '1', type: 'ai', content: 'orphan response' }],
      }]);
      transport.close();
      await new Promise(r => setTimeout(r, 20));

      await expect(ref.regenerate(0)).rejects.toThrow(/No user message/);
    });
  });

  // ── Error-UX: normalize, abort→idle, retry() ─────────────────────────────

  it('error() is AgentError with kind="server" on an HTTP 500 failure', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );
    ref.submit({ message: 'hello' });
    transport.emitError(new Error('HTTP 500: boom'));
    await new Promise(r => setTimeout(r, 20));

    expect(ref.status()).toBe('error');
    const err = ref.error();
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).kind).toBe('server');
    expect((err as AgentError).retryable).toBe(true);
  });

  it('user stop() → status becomes idle and error() stays undefined', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );
    ref.submit({ message: 'hello' });
    // stop() is user-initiated — should NOT produce an error
    await ref.stop();
    await new Promise(r => setTimeout(r, 20));

    expect(ref.status()).toBe('idle');
    expect(ref.error()).toBeUndefined();
  });

  it('retry() clears error and calls resubmitLast', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );

    // Drive to an error state
    const submitted = ref.submit({ message: 'hello' });
    transport.emitError(new Error('HTTP 503: service unavailable'));
    await submitted.catch(() => undefined);
    await new Promise(r => setTimeout(r, 20));

    expect(ref.status()).toBe('error');
    expect(ref.error()).toBeInstanceOf(AgentError);

    // Invoke retry(); the error should clear and a new run should start
    const retryPromise = ref.retry();
    // error is cleared synchronously at the start of retry()
    expect(ref.error()).toBeUndefined();
    // isLoading should become true once resubmitLast kicks off runStream
    expect(ref.isLoading()).toBe(true);

    // Clean up the new run
    transport.close();
    await retryPromise;
  });

  it('retry() is a no-op while a run is already in flight', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport })
    );
    ref.submit({ message: 'hello' });
    expect(ref.isLoading()).toBe(true);

    // retry() while loading should not start a second run or throw
    await ref.retry();
    // Still one active stream; transport only received one stream call
    expect(transport.streams).toHaveLength(1);

    await ref.stop();
  });
});

describe('agent — LANGGRAPH_CLIENT_OPTIONS resolution (no mock transport)', () => {
  // Spy on createLangGraphClient so we can assert which clientOptions reach
  // the FetchStreamTransport constructor, without making real network calls.
  // The mock returns a minimal stub object that satisfies all downstream
  // accesses (threads.create, runs.stream, etc. are never called in these
  // construction-only tests).
  const mockClientStub = {
    threads: {
      create: vi.fn().mockResolvedValue({ thread_id: 'stub-thread' }),
      getState: vi.fn().mockResolvedValue({ values: {}, next: [] }),
      patchState: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
    },
    runs: {
      stream: vi.fn().mockReturnValue((async function* () {
        /* empty stream — construction-only tests assert wiring, not events */
      })()),
    },
  };

  const createLangGraphClientMock = createLangGraphClient as ReturnType<typeof vi.fn>;
  const createProtectedLangGraphClientMock =
    ɵcreateProtectedLangGraphClient as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    createLangGraphClientMock.mockClear();
    createLangGraphClientMock.mockReturnValue(mockClientStub);
    createProtectedLangGraphClientMock.mockClear();
    createProtectedLangGraphClientMock.mockReturnValue(mockClientStub);
  });

  it('case 1 — token only: passes token clientOptions to createLangGraphClient', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: LANGGRAPH_CLIENT_OPTIONS, useValue: { maxRetries: 0 } },
      ],
    });

    TestBed.runInInjectionContext(() => {
      agent({ apiUrl: 'http://localhost:2024', assistantId: 'a' });
    });

    expect(createLangGraphClientMock).toHaveBeenCalledWith(
      'http://localhost:2024',
      { maxRetries: 0 },
    );
  });

  it('case 2 — call-site wins: call-site clientOptions override the token', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: LANGGRAPH_CLIENT_OPTIONS, useValue: { maxRetries: 0 } },
      ],
    });

    TestBed.runInInjectionContext(() => {
      agent({
        apiUrl: 'http://localhost:2024',
        assistantId: 'a',
        clientOptions: { maxRetries: 7 },
      });
    });

    expect(createLangGraphClientMock).toHaveBeenCalledWith(
      'http://localhost:2024',
      { maxRetries: 7 },
    );
  });

  it('case 3 — none provided: passes undefined clientOptions to createLangGraphClient', () => {
    TestBed.configureTestingModule({});

    TestBed.runInInjectionContext(() => {
      agent({ apiUrl: 'http://localhost:2024', assistantId: 'a' });
    });

    expect(createLangGraphClientMock).toHaveBeenCalledWith(
      'http://localhost:2024',
      undefined,
    );
  });

  it('case 4 — AGENT_CONFIG middle layer: provideAgent clientOptions override the token', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: LANGGRAPH_CLIENT_OPTIONS, useValue: { maxRetries: 0 } },
        {
          provide: AGENT_CONFIG,
          useValue: {
            assistantId: 'a',
            apiUrl: 'http://localhost:2024',
            clientOptions: { maxRetries: 3 },
          },
        },
      ],
    });

    TestBed.runInInjectionContext(() => {
      // No call-site clientOptions — AGENT_CONFIG.clientOptions is the winner.
      agent({ apiUrl: 'http://localhost:2024', assistantId: 'a' });
    });

    expect(createLangGraphClientMock).toHaveBeenCalledWith(
      'http://localhost:2024',
      { maxRetries: 3 },
    );
  });

  it('passes an explicit api key through the Agent streaming client options', () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: LANGGRAPH_CLIENT_OPTIONS,
          useValue: { apiKey: 'test-key-redact-me', maxRetries: 0 },
        },
      ],
    });

    TestBed.runInInjectionContext(() => {
      agent({ apiUrl: 'https://runtime.example/api', assistantId: 'a' });
    });

    expect(createProtectedLangGraphClientMock).toHaveBeenCalledWith(
      'https://runtime.example/api',
      { apiKey: 'test-key-redact-me', maxRetries: 0 },
      expect.any(Function),
    );
  });
});

describe('agent — runtime operation reporter integration', () => {
  it('does not pass the private reporter to a custom transport', async () => {
    class HTTPError extends Error {
      readonly text = 'unauthorized';
      constructor(readonly status: number) {
        super(`HTTP ${status}: unauthorized`);
      }
    }
    const transport = new MockAgentTransport();
    const reportOperationFailure = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER,
          useValue: reportOperationFailure,
        },
      ],
    });
    const runtime = TestBed.runInInjectionContext(() =>
      agent({
        apiUrl: 'https://runtime.example/api',
        assistantId: 'a',
        transport,
      }),
    );

    const submitted = runtime.submit({ message: 'hello' });
    transport.emitError(new HTTPError(403));
    await submitted;

    expect(reportOperationFailure).not.toHaveBeenCalled();
  });
});

import { computeMessageCheckpoints } from './agent.fn';

describe('computeMessageCheckpoints', () => {
  it('returns an empty map when history is empty', () => {
    expect(computeMessageCheckpoints([])).toEqual(new Map());
  });

  it('pairs each AIMessage with the most recent checkpoint containing it', () => {
    const history = [
      {
        checkpoint: { checkpoint_id: 'cp-1' },
        values: {
          messages: [
            { id: 'h-1', _getType: () => 'human' },
            { id: 'a-1', _getType: () => 'ai' },
          ],
        },
      },
      {
        checkpoint: { checkpoint_id: 'cp-2' },
        values: {
          messages: [
            { id: 'h-1', _getType: () => 'human' },
            { id: 'a-1', _getType: () => 'ai' },
            { id: 'h-2', _getType: () => 'human' },
            { id: 'a-2', _getType: () => 'ai' },
          ],
        },
      },
    ] as unknown as ThreadState<unknown>[];

    const map = computeMessageCheckpoints(history);
    expect(map.get('a-1')).toBe('cp-1');
    expect(map.get('a-2')).toBe('cp-2');
    expect(map.size).toBe(2);
  });

  it('skips checkpoints with no AIMessage in scope', () => {
    const history = [
      {
        checkpoint: { checkpoint_id: 'cp-start' },
        values: { messages: [{ id: 'h-1', _getType: () => 'human' }] },
      },
    ] as unknown as ThreadState<unknown>[];

    expect(computeMessageCheckpoints(history).size).toBe(0);
  });

  it('skips checkpoints with no checkpoint_id', () => {
    const history = [
      {
        checkpoint: {},
        values: { messages: [{ id: 'a-1', _getType: () => 'ai' }] },
      },
    ] as unknown as ThreadState<unknown>[];

    expect(computeMessageCheckpoints(history).size).toBe(0);
  });
});

// ── Client-tool staging wiring ───────────────────────────────────────────────
// The capability is unit-tested in client-tools.spec.ts; these cover the
// agent.fn.ts seam: which persist function is supplied, the null-payload
// staging guard, and discarding staged results on a thread switch.

describe('agent — client tool staging', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  const SPEC = { name: 'get_weather', description: 'w', parameters: {} };

  /** MockAgentTransport has no updateState; add one that records its calls. */
  function withUpdateState(transport: MockAgentTransport) {
    const updateCalls: Array<{ threadId: string; values: Record<string, unknown> }> = [];
    (transport as unknown as {
      updateState: (
        threadId: string,
        values: Record<string, unknown>,
        signal: AbortSignal,
      ) => Promise<void>;
    }).updateState = async (threadId, values) => {
      updateCalls.push({ threadId, values });
    };
    return updateCalls;
  }

  /** The langgraph capability exposes staging members beyond the neutral contract. */
  function staging(ref: { clientTools: unknown }) {
    return ref.clientTools as {
      setCatalog(specs: unknown[]): void;
      settle(id: string, result: { ok: true; value: unknown }): void;
      resolve(id: string, result: { ok: true; value: unknown }): void;
      flush(): Promise<void>;
      snapshotToolMessages(): {
        messages: ReadonlyArray<{ id: string; tool_call_id: string }>;
      };
    };
  }

  type StreamScript = (signal: AbortSignal) => AsyncIterable<StreamEvent>;

  class ScriptedAgentTransport implements AgentTransport {
    readonly calls: Array<{
      payload: unknown;
      options: Parameters<AgentTransport['stream']>[4];
    }> = [];
    readonly queuedCalls: Array<{
      payload: unknown;
      options: Parameters<NonNullable<AgentTransport['createQueuedRun']>>[4];
    }> = [];
    readonly joinedCalls: Array<{
      threadId: string;
      runId: string;
      lastEventId: string | undefined;
    }> = [];

    constructor(
      private readonly scripts: readonly StreamScript[],
      private readonly queueError?: Error,
    ) {}

    stream(
      _assistantId: string,
      _threadId: string | null,
      payload: unknown,
      signal: AbortSignal,
      options?: Parameters<AgentTransport['stream']>[4],
    ): AsyncIterable<StreamEvent> {
      const script = this.scripts[this.calls.length];
      this.calls.push({ payload, options });
      if (!script) throw new Error('No stream script configured for this invocation.');
      return script(signal);
    }

    async createQueuedRun(
      _assistantId: string,
      threadId: string,
      payload: unknown,
      _signal: AbortSignal,
      options?: Parameters<NonNullable<AgentTransport['createQueuedRun']>>[4],
    ) {
      this.queuedCalls.push({ payload, options });
      if (this.queueError) throw this.queueError;
      return {
        id: `queued-${this.queuedCalls.length}`,
        threadId,
        values: payload,
        options,
        createdAt: new Date(0),
      };
    }

    async *joinStream(
      threadId: string,
      runId: string,
      lastEventId: string | undefined,
    ): AsyncIterable<StreamEvent> {
      this.joinedCalls.push({ threadId, runId, lastEventId });
      yield { type: 'values', values: { queued: true } };
    }
  }

  function successfulStream(): StreamScript {
    return () => (async function* () {
      yield { type: 'values', values: { done: true } };
    })();
  }

  function preStreamFailure(message: string): StreamScript {
    return () => (async function* () {
      yield* [];
      throw new Error(message);
    })();
  }

  function midStreamFailure(message: string): StreamScript {
    return () => (async function* () {
      yield {
        type: 'messages',
        messages: [{ id: 'ai-interrupted', type: 'ai', content: 'partial' }],
      };
      throw new Error(message);
    })();
  }

  function deferred(): { promise: Promise<void>; resolve(): void } {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  }

  function controlledSuccess(
    release: Promise<void>,
    onStarted: () => void,
    onCompleted: () => void = () => undefined,
  ): StreamScript {
    return () => (async function* () {
      onStarted();
      await release;
      yield { type: 'values', values: { done: true } };
      onCompleted();
    })();
  }

  function controlledFailure(
    release: Promise<void>,
    onStarted: () => void,
    message: string,
  ): StreamScript {
    return () => (async function* () {
      onStarted();
      await release;
      yield* [];
      throw new Error(message);
    })();
  }

  function messagesFrom(payload: unknown): Array<Record<string, unknown>> {
    return (payload as { messages: Array<Record<string, unknown>> }).messages;
  }

  function stagedToolMessage(id: string, content: string): Record<string, unknown> {
    return {
      id: `client-tool-result-${id}`,
      type: 'tool',
      role: 'tool',
      tool_call_id: id,
      content,
    };
  }

  it('flush() writes staged tool messages via updateState without starting a run', async () => {
    const transport = new MockAgentTransport();
    const updateCalls = withUpdateState(transport);
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);

    cap.settle('tc-1', { ok: true, value: 'sunny' });
    await cap.flush();

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.threadId).toBe('t-1');
    expect(updateCalls[0]?.values?.['messages']).toEqual([
      {
        id: 'client-tool-result-tc-1',
        type: 'tool',
        role: 'tool',
        tool_call_id: 'tc-1',
        content: 'sunny',
      },
    ]);
    // A durable write must not issue a run.
    expect(transport.streams).toHaveLength(0);
    expect(cap.snapshotToolMessages().messages).toEqual([]);
  });

  it('flush() keeps the buffer when there is no thread to write to', async () => {
    const transport = new MockAgentTransport();
    const updateCalls = withUpdateState(transport);
    // No threadId and no run yet → the bridge has no currentThreadId, so the
    // persist function must throw rather than let updateState silently no-op.
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);

    cap.settle('tc-1', { ok: true, value: 'sunny' });
    await cap.flush();

    expect(updateCalls).toHaveLength(0);
    expect(cap.snapshotToolMessages().messages).toEqual([
      stagedToolMessage('tc-1', 'sunny'),
    ]);
  });

  it('submit acknowledges its deterministic staged batch only after terminal success', async () => {
    const release = deferred();
    let streamStarted = false;
    const transport = new ScriptedAgentTransport([
      controlledSuccess(release.promise, () => { streamStarted = true; }),
      successfulStream(),
    ]);
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);

    cap.settle('tc-1', { ok: true, value: 'sunny' });
    const submitted = ref.submit({ message: 'and tomorrow?' });

    try {
      await vi.waitFor(() => expect(streamStarted).toBe(true), { timeout: 1000 });
      expect(cap.snapshotToolMessages().messages).toEqual([
        stagedToolMessage('tc-1', 'sunny'),
      ]);
      expect(messagesFrom(transport.calls[0]?.payload)[0]).toEqual(
        stagedToolMessage('tc-1', 'sunny'),
      );
    } finally {
      release.resolve();
    }

    await expect(submitted).resolves.toBeUndefined();
    expect(cap.snapshotToolMessages().messages).toEqual([]);

    await ref.submit({ message: 'unrelated' });
    expect(messagesFrom(transport.calls[1]?.payload)).toEqual([
      expect.objectContaining({ type: 'human', content: 'unrelated' }),
    ]);
  });

  it('replays the same staged result after a pre-stream failure and acknowledges it on success', async () => {
    const transport = new ScriptedAgentTransport([
      preStreamFailure('connect failed'),
      successfulStream(),
      successfulStream(),
    ]);
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);
    cap.settle('tc-1', { ok: true, value: 'sunny' });

    await expect(ref.submit({ message: 'first' })).resolves.toBeUndefined();

    expect(ref.status()).toBe('error');
    expect(ref.error()).toBeInstanceOf(AgentError);
    expect(cap.snapshotToolMessages().messages).toEqual([
      stagedToolMessage('tc-1', 'sunny'),
    ]);

    await expect(ref.submit({ message: 'second' })).resolves.toBeUndefined();

    expect(messagesFrom(transport.calls[0]?.payload)[0]).toEqual(
      stagedToolMessage('tc-1', 'sunny'),
    );
    expect(messagesFrom(transport.calls[1]?.payload)[0]).toEqual(
      stagedToolMessage('tc-1', 'sunny'),
    );
    expect(cap.snapshotToolMessages().messages).toEqual([]);

    await ref.submit({ message: 'third' });
    expect(messagesFrom(transport.calls[2]?.payload)).toEqual([
      expect.objectContaining({ type: 'human', content: 'third' }),
    ]);
  });

  it('replays the identical staged result after a mid-stream failure', async () => {
    const transport = new ScriptedAgentTransport([
      midStreamFailure('stream interrupted'),
      successfulStream(),
    ]);
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);
    cap.settle('tc-1', { ok: true, value: 'sunny' });

    await ref.submit({ message: 'first' });

    expect(ref.status()).toBe('error');
    expect(ref.messages().find((message) => message.id === 'ai-interrupted')?.content).toBe('partial');
    expect(cap.snapshotToolMessages().messages).toEqual([
      stagedToolMessage('tc-1', 'sunny'),
    ]);

    await ref.submit({ message: 'second' });

    expect(messagesFrom(transport.calls[0]?.payload)[0]).toEqual(
      stagedToolMessage('tc-1', 'sunny'),
    );
    expect(messagesFrom(transport.calls[1]?.payload)[0]).toEqual(
      stagedToolMessage('tc-1', 'sunny'),
    );
    expect(cap.snapshotToolMessages().messages).toEqual([]);
  });

  it('retry acknowledges the failed run batch after a successful resubmission', async () => {
    const transport = new ScriptedAgentTransport([
      preStreamFailure('connect failed'),
      successfulStream(),
    ]);
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);
    cap.settle('tc-1', { ok: true, value: 'sunny' });
    await ref.submit({ message: 'first' });

    await expect(ref.retry()).resolves.toBeUndefined();

    expect(transport.calls[1]?.payload).toEqual(transport.calls[0]?.payload);
    expect(messagesFrom(transport.calls[1]?.payload)[0]).toEqual(
      stagedToolMessage('tc-1', 'sunny'),
    );
    expect(cap.snapshotToolMessages().messages).toEqual([]);
  });

  it('retry acknowledges only the failed payload batch when a newer result settles', async () => {
    const transport = new ScriptedAgentTransport([
      preStreamFailure('connect failed'),
      successfulStream(),
    ]);
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);
    cap.settle('tc-1', { ok: true, value: 'sunny' });
    await ref.submit({ message: 'first' });
    cap.settle('tc-2', { ok: true, value: 'rainy' });

    await ref.retry();

    expect(messagesFrom(transport.calls[1]?.payload)[0]).toEqual(
      stagedToolMessage('tc-1', 'sunny'),
    );
    expect(messagesFrom(transport.calls[1]?.payload).some((message) =>
      message['id'] === 'client-tool-result-tc-2'
    )).toBe(false);
    expect(cap.snapshotToolMessages().messages).toEqual([
      stagedToolMessage('tc-2', 'rainy'),
    ]);
  });

  it('an immediate null submit retains staging and clears the failed result batch from retry', async () => {
    const transport = new ScriptedAgentTransport([
      preStreamFailure('connect failed'),
      successfulStream(),
    ]);
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);
    cap.settle('tc-1', { ok: true, value: 'sunny' });

    await ref.submit({ message: 'first' });
    await ref.submit(null);

    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]?.payload).toBeNull();
    expect(cap.snapshotToolMessages().messages).toEqual([
      stagedToolMessage('tc-1', 'sunny'),
    ]);

    await ref.retry();

    expect(transport.calls).toHaveLength(2);
    expect(cap.snapshotToolMessages().messages).toEqual([
      stagedToolMessage('tc-1', 'sunny'),
    ]);
  });

  it('treats enqueue options as an immediate retryable run while idle', async () => {
    const transport = new ScriptedAgentTransport([
      preStreamFailure('idle enqueue failed'),
      successfulStream(),
    ]);
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);
    cap.settle('tc-1', { ok: true, value: 'sunny' });

    await ref.submit(
      { message: 'run now' },
      { multitaskStrategy: 'enqueue' },
    );

    expect(transport.calls).toHaveLength(1);
    expect(transport.queuedCalls).toHaveLength(0);
    expect(transport.calls[0]?.options).toMatchObject({
      multitaskStrategy: 'enqueue',
    });
    expect(cap.snapshotToolMessages().messages).toEqual([
      stagedToolMessage('tc-1', 'sunny'),
    ]);

    await ref.retry();

    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]?.payload).toEqual(transport.calls[0]?.payload);
    expect(cap.snapshotToolMessages().messages).toEqual([]);
  });

  it('clears the failed result batch association when regenerate submits null', async () => {
    const failedTranscript: StreamScript = () => (async function* () {
      yield {
        type: 'messages',
        messages: [
          { id: 'user-before-regenerate', type: 'human', content: 'first' },
          { id: 'ai-before-regenerate', type: 'ai', content: 'partial' },
        ],
      };
      throw new Error('initial run failed');
    })();
    const transport = new ScriptedAgentTransport([
      failedTranscript,
      successfulStream(),
    ]);
    const releaseUpdate = deferred();
    let updateStarted = false;
    const updateCalls: Array<{
      threadId: string;
      values: Record<string, unknown>;
      options?: { asNode?: string };
    }> = [];
    (transport as AgentTransport).updateState = async (
      threadId,
      values,
      _signal,
      options,
    ) => {
      updateCalls.push({ threadId, values, options });
      updateStarted = true;
      await releaseUpdate.promise;
    };
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);
    cap.settle('tc-1', { ok: true, value: 'sunny' });

    await ref.submit({ message: 'first' });
    const assistantIndex = ref.messages().findIndex(message => message.id === 'ai-before-regenerate');
    expect(assistantIndex).toBeGreaterThan(-1);

    const regenerated = ref.regenerate(assistantIndex);

    try {
      await vi.waitFor(() => expect(updateStarted).toBe(true), { timeout: 1000 });
      expect(updateCalls).toEqual([{
        threadId: 't-1',
        values: {
          messages: [{
            type: 'remove',
            role: 'remove',
            id: 'ai-before-regenerate',
            content: '',
          }],
        },
        options: { asNode: '__start__' },
      }]);
      expect(transport.calls).toHaveLength(1);
    } finally {
      releaseUpdate.resolve();
      await regenerated;
    }

    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]?.payload).toBeNull();
    expect(cap.snapshotToolMessages().messages).toEqual([
      stagedToolMessage('tc-1', 'sunny'),
    ]);

    await ref.retry();

    expect(transport.calls).toHaveLength(2);
    expect(cap.snapshotToolMessages().messages).toEqual([
      stagedToolMessage('tc-1', 'sunny'),
    ]);
  });

  it('makes the second of two immediate ordinary submissions the exact retry batch', async () => {
    const releaseFirst = deferred();
    let firstStarted = false;
    const transport = new ScriptedAgentTransport([
      controlledSuccess(releaseFirst.promise, () => { firstStarted = true; }),
      preStreamFailure('second submit failed'),
      successfulStream(),
    ]);
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);

    cap.settle('tc-1', { ok: true, value: 'sunny' });
    const first = ref.submit({ message: 'first' });
    cap.settle('tc-2', { ok: true, value: 'rainy' });
    const second = ref.submit({ message: 'second' });

    try {
      await expect(second).resolves.toBeUndefined();
      await vi.waitFor(() => expect(firstStarted).toBe(true), { timeout: 1000 });
      expect(ref.status()).toBe('error');
      expect(messagesFrom(transport.calls[0]?.payload)[0]).toEqual(
        stagedToolMessage('tc-1', 'sunny'),
      );
      expect(messagesFrom(transport.calls[1]?.payload).slice(0, 2)).toEqual([
        stagedToolMessage('tc-1', 'sunny'),
        stagedToolMessage('tc-2', 'rainy'),
      ]);
    } finally {
      releaseFirst.resolve();
      await first;
    }

    cap.settle('tc-3', { ok: true, value: 'windy' });
    await expect(ref.retry()).resolves.toBeUndefined();

    expect(transport.calls[2]?.payload).toEqual(transport.calls[1]?.payload);
    expect(messagesFrom(transport.calls[2]?.payload).slice(0, 2)).toEqual([
      stagedToolMessage('tc-1', 'sunny'),
      stagedToolMessage('tc-2', 'rainy'),
    ]);
    expect(messagesFrom(transport.calls[2]?.payload).some((message) =>
      message['id'] === 'client-tool-result-tc-3'
    )).toBe(false);
    expect(cap.snapshotToolMessages().messages).toEqual([
      stagedToolMessage('tc-3', 'windy'),
    ]);
  });

  it('acknowledges a successful loading enqueue without replacing the active retry batch', async () => {
    const releaseActive = deferred();
    let activeStarted = false;
    const transport = new ScriptedAgentTransport([
      controlledFailure(
        releaseActive.promise,
        () => { activeStarted = true; },
        'active submit failed',
      ),
      successfulStream(),
    ]);
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);

    cap.settle('tc-1', { ok: true, value: 'sunny' });
    const active = ref.submit({ message: 'active' });

    try {
      await vi.waitFor(() => expect(activeStarted).toBe(true), { timeout: 1000 });
      expect(ref.isLoading()).toBe(true);
      cap.settle('tc-2', { ok: true, value: 'rainy' });

      await ref.submit(
        { message: 'queued' },
        { multitaskStrategy: 'enqueue' },
      );

      expect(transport.calls).toHaveLength(1);
      expect(transport.queuedCalls).toHaveLength(1);
      expect(ref.queue()).toMatchObject({
        size: 1,
        entries: [{ id: 'queued-1', threadId: 't-1' }],
      });
      expect(messagesFrom(transport.queuedCalls[0]?.payload).slice(0, 2)).toEqual([
        stagedToolMessage('tc-1', 'sunny'),
        stagedToolMessage('tc-2', 'rainy'),
      ]);
      expect(cap.snapshotToolMessages().messages).toEqual([]);

      cap.settle('tc-3', { ok: true, value: 'windy' });
    } finally {
      releaseActive.resolve();
      await active;
    }

    expect(ref.status()).toBe('error');
    await ref.retry();

    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]?.payload).toEqual(transport.calls[0]?.payload);
    expect(messagesFrom(transport.calls[1]?.payload)[0]).toEqual(
      stagedToolMessage('tc-1', 'sunny'),
    );
    expect(messagesFrom(transport.calls[1]?.payload).some((message) =>
      message['id'] === 'client-tool-result-tc-2'
        || message['id'] === 'client-tool-result-tc-3'
    )).toBe(false);
    expect(cap.snapshotToolMessages().messages).toEqual([
      stagedToolMessage('tc-3', 'windy'),
    ]);
    expect(ref.queue().size).toBe(0);
    expect(transport.joinedCalls).toEqual([{
      threadId: 't-1',
      runId: 'queued-1',
      lastEventId: undefined,
    }]);
  });

  it('does not replace the active retry batch when a loading enqueue is rejected', async () => {
    const releaseActive = deferred();
    let activeStarted = false;
    const transport = new ScriptedAgentTransport(
      [
        controlledFailure(
          releaseActive.promise,
          () => { activeStarted = true; },
          'active submit failed',
        ),
        successfulStream(),
      ],
      new Error('queue creation failed'),
    );
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);

    cap.settle('tc-1', { ok: true, value: 'sunny' });
    const active = ref.submit({ message: 'active' });

    try {
      await vi.waitFor(() => expect(activeStarted).toBe(true), { timeout: 1000 });
      expect(ref.isLoading()).toBe(true);
      cap.settle('tc-2', { ok: true, value: 'rainy' });
      await expect(ref.submit(
        { message: 'queued' },
        { multitaskStrategy: 'enqueue' },
      )).rejects.toThrow('queue creation failed');
      expect(transport.calls).toHaveLength(1);
      expect(transport.queuedCalls).toHaveLength(1);
      expect(transport.queuedCalls[0]?.options).toMatchObject({
        multitaskStrategy: 'enqueue',
      });
      expect(messagesFrom(transport.queuedCalls[0]?.payload).slice(0, 2)).toEqual([
        stagedToolMessage('tc-1', 'sunny'),
        stagedToolMessage('tc-2', 'rainy'),
      ]);
      expect(cap.snapshotToolMessages().messages).toEqual([
        stagedToolMessage('tc-1', 'sunny'),
        stagedToolMessage('tc-2', 'rainy'),
      ]);
    } finally {
      releaseActive.resolve();
      await active;
    }
    expect(ref.status()).toBe('error');

    cap.settle('tc-3', { ok: true, value: 'windy' });
    await expect(ref.retry()).resolves.toBeUndefined();

    expect(transport.calls[1]?.payload).toEqual(transport.calls[0]?.payload);
    expect(messagesFrom(transport.calls[1]?.payload)[0]).toEqual(
      stagedToolMessage('tc-1', 'sunny'),
    );
    expect(messagesFrom(transport.calls[1]?.payload).some((message) =>
      message['id'] === 'client-tool-result-tc-2'
        || message['id'] === 'client-tool-result-tc-3'
    )).toBe(false);
    expect(cap.snapshotToolMessages().messages).toEqual([
      stagedToolMessage('tc-2', 'rainy'),
      stagedToolMessage('tc-3', 'windy'),
    ]);
  });

  it('keeps the active retry batch when a loading enqueue carries null', async () => {
    const releaseActive = deferred();
    let activeStarted = false;
    const transport = new ScriptedAgentTransport([
      controlledFailure(
        releaseActive.promise,
        () => { activeStarted = true; },
        'active submit failed',
      ),
      successfulStream(),
    ]);
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);

    cap.settle('tc-1', { ok: true, value: 'sunny' });
    const active = ref.submit({ message: 'active' });

    try {
      await vi.waitFor(() => expect(activeStarted).toBe(true), { timeout: 1000 });
      expect(ref.isLoading()).toBe(true);

      await ref.submit(null, { multitaskStrategy: 'enqueue' });

      expect(transport.calls).toHaveLength(1);
      expect(transport.queuedCalls).toHaveLength(1);
      expect(transport.queuedCalls[0]?.payload).toBeNull();
      expect(ref.queue()).toMatchObject({
        size: 1,
        entries: [{ id: 'queued-1', threadId: 't-1' }],
      });
      expect(cap.snapshotToolMessages().messages).toEqual([
        stagedToolMessage('tc-1', 'sunny'),
      ]);

      cap.settle('tc-2', { ok: true, value: 'rainy' });
    } finally {
      releaseActive.resolve();
      await active;
    }

    await ref.retry();

    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]?.payload).toEqual(transport.calls[0]?.payload);
    expect(cap.snapshotToolMessages().messages).toEqual([
      stagedToolMessage('tc-2', 'rainy'),
    ]);
    expect(ref.queue().size).toBe(0);
    expect(transport.joinedCalls).toEqual([{
      threadId: 't-1',
      runId: 'queued-1',
      lastEventId: undefined,
    }]);
  });

  it('reload starts a retry and acknowledges only its captured batch', async () => {
    const release = deferred();
    let retryStarted = false;
    let retryCompleted = false;
    const transport = new ScriptedAgentTransport([
      preStreamFailure('connect failed'),
      controlledSuccess(
        release.promise,
        () => { retryStarted = true; },
        () => { retryCompleted = true; },
      ),
    ]);
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);
    cap.settle('tc-1', { ok: true, value: 'sunny' });
    await ref.submit({ message: 'first' });
    cap.settle('tc-2', { ok: true, value: 'rainy' });

    const reloaded = ref.reload();

    try {
      expect(reloaded).toBeUndefined();
      await vi.waitFor(() => expect(retryStarted).toBe(true), { timeout: 1000 });
      expect(messagesFrom(transport.calls[1]?.payload)[0]).toEqual(
        stagedToolMessage('tc-1', 'sunny'),
      );
    } finally {
      release.resolve();
    }
    await vi.waitFor(() => expect(retryCompleted).toBe(true), { timeout: 1000 });
    await vi.waitFor(() => {
      expect(cap.snapshotToolMessages().messages).toEqual([
        stagedToolMessage('tc-2', 'rainy'),
      ]);
    }, { timeout: 1000 });
  });

  it('keeps a failed resolve continuation batch for a later ordinary submit', async () => {
    const transport = new ScriptedAgentTransport([
      preStreamFailure('continuation failed'),
      successfulStream(),
    ]);
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);

    const resolved = cap.resolve('tc-1', { ok: true, value: 'sunny' });

    expect(resolved).toBeUndefined();
    await vi.waitFor(() => expect(ref.status()).toBe('error'), { timeout: 1000 });
    expect(messagesFrom(transport.calls[0]?.payload)[0]).toEqual(
      stagedToolMessage('tc-1', 'sunny'),
    );
    expect(cap.snapshotToolMessages().messages).toEqual([
      stagedToolMessage('tc-1', 'sunny'),
    ]);

    await ref.submit({ message: 'recover' });

    expect(messagesFrom(transport.calls[1]?.payload)[0]).toEqual(
      stagedToolMessage('tc-1', 'sunny'),
    );
    expect(cap.snapshotToolMessages().messages).toEqual([]);
  });

  it('acknowledges the exact resolve continuation batch only after success', async () => {
    const release = deferred();
    let streamStarted = false;
    const transport = new ScriptedAgentTransport([
      controlledSuccess(release.promise, () => { streamStarted = true; }),
    ]);
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);

    const resolved = cap.resolve('tc-1', { ok: true, value: 'sunny' });

    try {
      expect(resolved).toBeUndefined();
      await vi.waitFor(() => expect(streamStarted).toBe(true), { timeout: 1000 });
      expect(messagesFrom(transport.calls[0]?.payload)[0]).toEqual(
        stagedToolMessage('tc-1', 'sunny'),
      );
      expect(cap.snapshotToolMessages().messages).toEqual([
        stagedToolMessage('tc-1', 'sunny'),
      ]);
    } finally {
      release.resolve();
    }
    await vi.waitFor(() => expect(ref.status()).toBe('idle'), { timeout: 1000 });
    expect(cap.snapshotToolMessages().messages).toEqual([]);
  });

  it('submit(null) does not acknowledge staged tool messages', async () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);

    cap.settle('tc-1', { ok: true, value: 'sunny' });
    const submitted = ref.submit(null);

    try {
      // A null payload signals a no-input resume and cannot carry messages;
      // acknowledging here would discard the result silently.
      expect(transport.streams[0]?.payload).toBeNull();
      expect(cap.snapshotToolMessages().messages).toEqual([
        stagedToolMessage('tc-1', 'sunny'),
      ]);
    } finally {
      await ref.stop();
      transport.close();
      await submitted;
    }
  });

  it('switchThread discards staged tool messages', () => {
    const transport = new MockAgentTransport();
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);

    cap.settle('tc-1', { ok: true, value: 'sunny' });
    ref.switchThread('t-2');

    // Carrying it over would prepend a ToolMessage whose tool_call_id matches
    // no AIMessage on t-2 — turning one broken thread into two.
    expect(cap.snapshotToolMessages().messages).toEqual([]);
  });

  it('clears staged ownership and retry payloads when switching threads', async () => {
    const transport = new ScriptedAgentTransport([
      preStreamFailure('old thread failed'),
    ]);
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);
    cap.settle('tc-old', { ok: true, value: 'old result' });
    await ref.submit({ message: 'old thread run' });

    expect(transport.calls).toHaveLength(1);
    expect(cap.snapshotToolMessages().messages).toEqual([
      stagedToolMessage('tc-old', 'old result'),
    ]);

    ref.switchThread('t-2');

    expect(cap.snapshotToolMessages().messages).toEqual([]);
    cap.settle('tc-new', { ok: true, value: 'new result' });

    await ref.retry();
    const reloaded = ref.reload();

    expect(reloaded).toBeUndefined();
    // A stale resubmit would invoke transport.stream synchronously before the
    // fire-and-forget helper reaches its first await, so no timing flush is
    // needed to prove reload did not start a new-thread stream.
    expect(transport.calls).toHaveLength(1);
    expect(cap.snapshotToolMessages().messages).toEqual([
      stagedToolMessage('tc-new', 'new result'),
    ]);
  });

  it('keeps a new-thread result when an old-thread stream completes after the switch', async () => {
    const releaseOld = deferred();
    let oldStarted = false;
    const transport = new ScriptedAgentTransport([
      controlledSuccess(releaseOld.promise, () => { oldStarted = true; }),
    ]);
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);
    cap.settle('tc-old', { ok: true, value: 'old result' });
    const oldRun = ref.submit({ message: 'old thread run' });

    try {
      await vi.waitFor(() => expect(oldStarted).toBe(true), { timeout: 1000 });
      ref.switchThread('t-2');
      cap.settle('tc-new', { ok: true, value: 'new result' });
      expect(cap.snapshotToolMessages().messages).toEqual([
        stagedToolMessage('tc-new', 'new result'),
      ]);
    } finally {
      releaseOld.resolve();
      await oldRun;
    }

    // The bridge classifies the switched-away stream as interrupted even
    // though its script later closes successfully. Generation-level stale
    // acknowledge behavior is covered directly in client-tools.spec.ts; this
    // seam proves the transition cannot disturb staging on the new thread.
    expect(cap.snapshotToolMessages().messages).toEqual([
      stagedToolMessage('tc-new', 'new result'),
    ]);
  });
});

// ── Stale-thread guard ───────────────────────────────────────────────────────
// A tool handler still in flight when the user clicks another thread settles
// AFTER the switch. Its ToolMessage belongs to the thread whose AIMessage
// produced the tool_call_id, so it must never reach the new thread.

describe('agent — client tool results settled after a thread switch', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  const SPEC = { name: 'get_weather', description: 'w', parameters: {} };

  function staging(ref: { clientTools: unknown }) {
    return ref.clientTools as {
      setCatalog(specs: unknown[]): void;
      settle(id: string, result: { ok: true; value: unknown }): void;
      flush(): Promise<void>;
      snapshotToolMessages(): { messages: ReadonlyArray<{ tool_call_id: string }> };
    };
  }

  /** Agent on t-1 whose transcript holds one pending client tool call. */
  async function agentWithPendingToolCall(transport: MockAgentTransport) {
    const ref = withInjectionContext(() =>
      agent({ apiUrl: '', assistantId: 'a', threadId: 't-1', transport, throttle: false })
    );
    const cap = staging(ref);
    cap.setCatalog([SPEC]);
    ref.submit({ message: 'weather?' });
    transport.emit([{
      type: 'messages',
      messages: [{
        id: 'ai-1', type: 'ai', content: '',
        tool_calls: [{ id: 'tc-1', name: 'get_weather', args: {} }],
      }],
    }]);
    transport.close();
    await new Promise(r => setTimeout(r, 30));
    return { ref, cap };
  }

  it('drops a result settled after a thread switch instead of writing it to the new thread', async () => {
    const transport = new MockAgentTransport();
    const updateCalls: Array<{ threadId: string; values: Record<string, unknown> }> = [];
    (transport as unknown as {
      updateState: (t: string, v: Record<string, unknown>, s: AbortSignal) => Promise<void>;
    }).updateState = async (threadId, values) => { updateCalls.push({ threadId, values }); };

    const { ref, cap } = await agentWithPendingToolCall(transport);
    ref.switchThread('t-2');
    cap.settle('tc-1', { ok: true, value: 'sunny' });
    await cap.flush();

    // Writing here would give t-2 a ToolMessage matching no AIMessage → 400.
    expect(updateCalls).toHaveLength(0);
    expect(cap.snapshotToolMessages().messages).toEqual([]);
  });

  it('does not carry a result settled after a thread switch into the new thread submit', async () => {
    const transport = new MockAgentTransport();
    const { ref, cap } = await agentWithPendingToolCall(transport);
    const streamsBefore = transport.streams.length;

    ref.switchThread('t-2');
    cap.settle('tc-1', { ok: true, value: 'sunny' });
    ref.submit({ message: 'hello on the new thread' });

    const payload = transport.streams[streamsBefore]?.payload as {
      messages: Array<Record<string, unknown>>;
    };
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]).toMatchObject({ type: 'human' });
    expect(cap.snapshotToolMessages().messages).toEqual([]);
  });
});
