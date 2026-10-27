/* eslint @typescript-eslint/no-unused-vars: ["warn", { "argsIgnorePattern": "^_" }] */
import { describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import { createToolBuffer } from './function-tools';
import { deferred } from './testing/deferred';
import type { AgentTransport, StreamEvent } from './transport.types';
import type { ThreadState } from '@langchain/langgraph-sdk';

const call = {
  type: 'ai',
  id: 'assistant',
  content: '',
  tool_calls: [{ id: 'call', name: 'work', args: {} }],
};
const final: StreamEvent = {
  type: 'values',
  data: { messages: [{ type: 'ai', id: 'answer', content: 'Done' }] },
};
function options(transport: AgentTransport, followUp = false) {
  return {
    assistantId: 'agent',
    threadId: 'thread',
    transport,
    tools: {
      work: {
        description: 'Work',
        followUp,
        handler: (_args: object) => 'Result',
      },
    },
  };
}

describe('tool result handoff', () => {
  it('does not acknowledge an empty continuation from the earlier tool-producing checkpoint', async () => {
    let count = 0;
    const stream = vi.fn<AgentTransport['stream']>(async function* () {
      if (++count === 1) yield { type: 'values', data: { messages: [call] } };
      else if (count > 2) yield final;
    });
    const getHistory = vi.fn<NonNullable<AgentTransport['getHistory']>>(
      async () => [
        {
          values: {
            messages: [
              ...(stream.mock.calls[0][2] as { messages: unknown[] }).messages,
              call,
            ],
          },
          next: [],
          tasks: [],
          checkpoint: {
            thread_id: 'thread',
            checkpoint_id: 'old',
            checkpoint_ns: '',
            checkpoint_map: {},
          },
          metadata: null,
          parent_checkpoint: null,
          created_at: null,
        } as ThreadState,
      ]
    );
    const session = createSession(options({ stream, getHistory }, true));
    await expect(session.submit('First')).resolves.toBe('interrupted');
    await session.checkStatus?.();
    expect(session.getSnapshot().status).toBe('error');
    await session.submit('Second');
    expect(stream.mock.calls[2][2]).toMatchObject({
      messages: [
        { tool_call_id: 'call', content: 'Result' },
        { type: 'human', content: 'Second' },
      ],
    });
  });
  it.each(['stop', 'dispose'] as const)(
    'persists without continuation when a completed-result observer calls %s',
    async (command) => {
      const flushed = deferred<void>();
      const stream = vi.fn<AgentTransport['stream']>(async function* () {
        yield { type: 'values', data: { messages: [call] } };
      });
      const updateState = vi.fn<NonNullable<AgentTransport['updateState']>>(
        async () => {
          flushed.resolve();
        }
      );
      const session = createSession(options({ stream, updateState }, true));
      const off = session.subscribe(() => {
        if (session.getSnapshot().toolCalls[0]?.status === 'complete')
          void session[command]();
      });
      try {
        await expect(session.submit('First')).resolves.toBe('aborted');
        await flushed.promise;
        expect(stream).toHaveBeenCalledTimes(1);
        expect(updateState.mock.calls[0][1]).toMatchObject({
          messages: [{ content: 'Result' }],
        });
      } finally {
        off();
        await session.dispose();
      }
    }
  );
  it.each(['missing', 'reject'] as const)(
    'retains terminal results when updateState is %s, for the next explicit handoff',
    async (mode) => {
      let runCount = 0;
      const stream = vi.fn<AgentTransport['stream']>(async function* () {
        yield ++runCount === 1
          ? { type: 'values', data: { messages: [call] } }
          : final;
      });
      const updateState = vi.fn<NonNullable<AgentTransport['updateState']>>(
        async () => {
          throw new Error('offline');
        }
      );
      const session = createSession(
        options({ stream, ...(mode === 'reject' ? { updateState } : {}) })
      );
      await expect(session.submit('First')).resolves.toBe('error');
      expect(session.getSnapshot().error).toMatchObject({
        kind: 'server',
        recovery: 'none',
      });
      expect(stream).toHaveBeenCalledTimes(1);
      await expect(session.submit('Second')).resolves.toBe('success');
      expect(stream.mock.calls[1][2]).toMatchObject({
        messages: [
          { id: 'client-tool-result-call', content: 'Result' },
          { type: 'human', content: 'Second' },
        ],
      });
      await session.submit('Third');
      expect(stream.mock.calls[2][2]).toMatchObject({
        messages: [{ type: 'human', content: 'Third' }],
      });
      expect(
        (stream.mock.calls[2][2] as { messages: unknown[] }).messages
      ).toHaveLength(1);
    }
  );

  it.each(['empty', 'error'] as const)(
    'retains continuation results after %s closure, without inheriting prior completion',
    async (mode) => {
      let count = 0;
      const stream = vi.fn<AgentTransport['stream']>(async function* () {
        count += 1;
        if (count === 1) yield { type: 'values', data: { messages: [call] } };
        else if (count === 2 && mode === 'error')
          yield { type: 'error', data: { message: 'failed' } };
        else if (count > 2) yield final;
      });
      const session = createSession(options({ stream }, true));
      await expect(session.submit('First')).resolves.toBe(
        mode === 'empty' ? 'interrupted' : 'error'
      );
      expect(stream).toHaveBeenCalledTimes(2);
      expect(session.getSnapshot().toolCalls[0]).toMatchObject({
        status: 'complete',
        result: 'Result',
      });
      expect(
        session
          .getSnapshot()
          .messages.find((message) => message.id === 'assistant')?.delivery
      ).toMatchObject({ phase: 'complete', outcome: 'success' });
      await session.submit('Next');
      expect(stream.mock.calls[2][2]).toMatchObject({
        messages: [
          { tool_call_id: 'call', content: 'Result' },
          { type: 'human' },
        ],
      });
    }
  );

  it('stop settles promptly but submission waits for pending terminal persistence', async () => {
    const persisted = deferred<void>();
    const persisting = deferred<void>();
    let count = 0;
    const stream = vi.fn<AgentTransport['stream']>(async function* () {
      yield {
        type: 'values',
        data: {
          messages: [
            {
              ...call,
              id: `assistant-${++count}`,
              tool_calls: [{ id: `call-${count}`, name: 'work', args: {} }],
            },
          ],
        },
      };
    });
    const updateState = vi.fn<NonNullable<AgentTransport['updateState']>>(
      () => {
        if (updateState.mock.calls.length === 1) {
          persisting.resolve();
          return persisted.promise;
        }
        return Promise.reject(new Error('keep new result staged'));
      }
    );
    const session = createSession(options({ stream, updateState }));
    try {
      const first = session.submit('First');
      await persisting.promise;
      await session.stop();
      await expect(first).resolves.toBe('aborted');
      await expect(
        session.submit('Cannot overtake persistence')
      ).rejects.toThrow(/pending tool persistence/);
      expect(stream).toHaveBeenCalledTimes(1);
      persisted.resolve();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await session.submit('Second');
      // The successful first write removed only its batch; the failed second
      // write leaves its result available for the next explicit submission.
      await session.submit('Third');
      expect(stream.mock.calls[2][2]).toMatchObject({
        messages: [
          { tool_call_id: 'call-2' },
          { type: 'human', content: 'Third' },
        ],
      });
    } finally {
      persisted.resolve();
      await session.dispose();
    }
  });

  it('buffer ACK removes only exact captured entries and handles void/string/JSON/error deterministically', () => {
    const buffer = createToolBuffer();
    buffer.stage('a', { ok: true, value: undefined });
    const first = buffer.snapshot();
    expect(first.messages[0].content).toBe('');
    buffer.stage('a', { ok: true, value: '123' });
    buffer.stage('b', { ok: true, value: { x: 2 } });
    buffer.stage('c', { ok: false, error: 'Failed' });
    first.acknowledge();
    expect(
      buffer.snapshot().messages.map((message) => message.content)
    ).toEqual(['123', '{"x":2}', 'Error: Failed']);
    const second = buffer.snapshot();
    buffer.stage('d', { ok: true, value: null });
    second.acknowledge();
    second.acknowledge();
    expect(
      buffer.snapshot().messages.map((message) => message.tool_call_id)
    ).toEqual(['d']);
  });
});
