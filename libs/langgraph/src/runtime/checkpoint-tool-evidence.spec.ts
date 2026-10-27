import { describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import type { AgentTransport, StreamEvent } from './transport.types';
import {
  checkpointEvent,
  fixture,
  position,
  saved,
} from './testing/checkpoint-fixture';

const call = {
  type: 'ai',
  id: 'tool-step',
  content: '',
  tool_calls: [{ id: 'fresh', name: 'work', args: { value: 'saved' } }],
};
const toolMessage = {
  type: 'tool',
  id: 'tool-result',
  tool_call_id: 'fresh',
  content: 'Result',
};
const values = (messages: unknown[], cursor: string): StreamEvent => ({
  type: 'values',
  sseId: cursor,
  data: { messages },
});

describe('confirmed checkpoint tool evidence', () => {
  it.each([
    'missing-before',
    'missing-after',
    'changed-name',
    'changed-args',
    'phantom-resolution-before',
    'phantom-resolution-after',
    'omitted-authoritative-call',
  ] as const)(
    'blocks effects and retains unavailable authority for %s',
    async (mismatch) => {
      const f = fixture();
      const missing = mismatch.startsWith('missing');
      const final = saved(
        'final',
        missing ? [{ type: 'ai', id: 'final', content: 'Done' }] : [call]
      );
      f.states.set('final', final);
      f.transport.stream = vi.fn<AgentTransport['stream']>(async function* (
        _a,
        _t,
        input,
        _s,
        options
      ) {
        options?.onRunCreated?.({ run_id: 'run-final' });
        const user = (input as { messages: unknown[] }).messages;
        if (mismatch === 'missing-before')
          yield values([...user, call], 'before');
        if (mismatch === 'phantom-resolution-before')
          yield values([...user, call, toolMessage], 'before');
        yield checkpointEvent(final);
        if (mismatch === 'missing-after')
          yield values([...user, call], 'after');
        if (mismatch === 'phantom-resolution-after')
          yield values([toolMessage], 'after');
        if (mismatch === 'changed-name' || mismatch === 'changed-args')
          yield values(
            [
              {
                ...call,
                tool_calls: [
                  {
                    ...call.tool_calls[0],
                    ...(mismatch === 'changed-name'
                      ? { name: 'other' }
                      : { args: { value: 'unsaved' } }),
                  },
                ],
              },
            ],
            'after'
          );
        if (mismatch === 'omitted-authoritative-call')
          yield values([{ ...call, tool_calls: [] }], 'after');
      });
      f.transport.updateState = vi.fn(async () => position('written'));
      const handler = vi.fn(() => 'Side effect');
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport: f.transport,
        tools: {
          work: { description: 'Work', handler, followUp: false },
          other: { description: 'Other work', handler, followUp: false },
        },
      });
      const outcome = await session.fork(position('a'), 'Run');
      expect(handler).not.toHaveBeenCalled();
      expect(f.transport.updateState).not.toHaveBeenCalled();
      expect(outcome).not.toBe('success');
      expect(f.transport.getState).toHaveBeenCalledTimes(2);
      await expect(session.submit('Next')).rejects.toThrow();
      await expect(session.load?.()).rejects.toThrow();
      await expect(session.checkStatus?.()).rejects.toThrow();
      expect(f.transport.stream).toHaveBeenCalledTimes(1);
      await session.dispose();
    }
  );

  it.each(['unresolved', 'resolved', 'follow-up', 'partial-stream'] as const)(
    'accepts matching saved %s invocation evidence',
    async (kind) => {
      const f = fixture();
      const final = saved(
        'final',
        kind === 'resolved' ? [call, toolMessage] : [call]
      );
      f.states.set('final', final);
      let streams = 0;
      f.transport.stream = vi.fn<AgentTransport['stream']>(async function* (
        _a,
        _t,
        input,
        _s,
        options
      ) {
        const result = streams++
          ? saved('follow-up', [
              ...(input as { messages: unknown[] }).messages,
              { type: 'ai', id: 'done', content: 'Done' },
            ])
          : final;
        f.states.set(result.checkpoint.checkpoint_id!, result);
        options?.onRunCreated?.({
          run_id: String(result.metadata?.['run_id']),
        });
        if (kind === 'partial-stream')
          yield {
            type: 'messages',
            sseId: 'partial',
            messages: [
              {
                type: 'AIMessageChunk',
                id: 'tool-step',
                content: 'Preparing',
                tool_call_chunks: [
                  { index: 0, id: 'fresh', name: 'work', args: '{' },
                ],
              },
            ],
          };
        yield checkpointEvent(result);
      });
      f.transport.updateState = vi.fn(async () => position('written'));
      const handler = vi.fn((args: { value: string }) => args.value);
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport: f.transport,
        tools: {
          work: {
            description: 'Work',
            handler,
            followUp: kind === 'follow-up',
          },
        },
      });
      expect(await session.fork(position('a'), 'Run')).toBe('success');
      expect(handler).toHaveBeenCalledTimes(kind === 'resolved' ? 0 : 1);
      if (kind !== 'resolved')
        expect(handler.mock.calls[0][0]).toEqual({ value: 'saved' });
      expect(f.transport.updateState).toHaveBeenCalledTimes(
        kind === 'unresolved' || kind === 'partial-stream' ? 1 : 0
      );
      expect(f.transport.stream).toHaveBeenCalledTimes(
        kind === 'follow-up' ? 2 : 1
      );
      if (kind === 'follow-up')
        expect(
          vi.mocked(f.transport.stream).mock.calls[1][4]?.checkpoint
        ).toEqual(position('final'));
      await session.dispose();
    }
  );
});

describe('branch-owned local tool settlement', () => {
  it.each([
    { load: false, remove: false },
    { load: true, remove: false },
    { load: false, remove: true },
    { load: true, remove: true },
  ])(
    'resumes without repeating a consumed local result (load=$load, remove=$remove)',
    async ({ load, remove }) => {
      const f = fixture();
      let streams = 0;
      let user: unknown;
      let receipt: unknown;
      f.transport.stream = vi.fn<AgentTransport['stream']>(async function* (
        _a,
        _t,
        input,
        _s,
        options
      ) {
        streams++;
        if (streams === 1)
          user = (input as { messages: unknown[] }).messages[0];
        if (streams === 2)
          receipt = (input as { messages: unknown[] }).messages[0];
        const result = saved(
          String(streams),
          [
            user,
            ...(streams === 3 && remove ? [] : [call]),
            {
              type: 'ai',
              id: `answer-${streams}`,
              content: streams === 3 ? 'Done' : 'Waiting',
            },
          ],
          streams === 2
            ? {
                next: ['approval'],
                tasks: [
                  {
                    id: 'task',
                    name: 'approval',
                    error: null,
                    result: null,
                    interrupts: [{ id: 'decision', value: 'Approve?' }],
                  },
                ],
              }
            : {}
        );
        f.states.set(String(streams), result);
        options?.onRunCreated?.({ run_id: `run-${streams}` });
        if (streams === 3 && remove)
          yield values([user, call], 'old-call-echo');
        yield checkpointEvent(result);
      });
      const handler = vi.fn(() => 'ACTUAL RESULT');
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport: f.transport,
        tools: { work: { description: 'Work', handler, followUp: true } },
      });
      expect(await session.fork(position('a'), 'Run')).toBe('paused');
      expect(receipt).toMatchObject({
        tool_call_id: 'fresh',
        content: 'ACTUAL RESULT',
      });
      if (load) await session.load?.();
      expect(await session.resume(null)).toBe('success');
      expect(handler).toHaveBeenCalledOnce();
      expect(f.transport.stream).toHaveBeenCalledTimes(3);
      await session.dispose();
    }
  );

  it.each(['name', 'args'] as const)(
    'keeps changed settled %s identities as sticky conflicts after load',
    async (changed) => {
      const f = fixture();
      let streams = 0;
      let user: unknown;
      f.transport.stream = vi.fn<AgentTransport['stream']>(async function* (
        _a,
        _t,
        input,
        _s,
        options
      ) {
        streams++;
        if (streams === 1)
          user = (input as { messages: unknown[] }).messages[0];
        const current =
          streams === 3
            ? {
                ...call,
                tool_calls: [
                  {
                    ...call.tool_calls[0],
                    ...(changed === 'name'
                      ? { name: 'other' }
                      : { args: { value: 'changed' } }),
                  },
                ],
              }
            : call;
        const result = saved(
          String(streams),
          [user, current],
          streams === 2
            ? {
                next: ['approval'],
                tasks: [
                  {
                    id: 'task',
                    name: 'approval',
                    error: null,
                    result: null,
                    interrupts: [{ id: 'decision', value: 'Approve?' }],
                  },
                ],
              }
            : {}
        );
        f.states.set(String(streams), result);
        options?.onRunCreated?.({ run_id: `run-${streams}` });
        yield checkpointEvent(result);
      });
      const handler = vi.fn(() => 'ACTUAL RESULT');
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport: f.transport,
        tools: { work: { description: 'Work', handler, followUp: true } },
      });
      expect(await session.fork(position('a'), 'Run')).toBe('paused');
      await session.load?.();
      expect(await session.resume(null)).toBe('interrupted');
      expect(session.getSnapshot().error?.message).toContain(
        'identity conflict'
      );
      await expect(session.fork(position('a'), 'Again')).rejects.toThrow();
      expect(handler).toHaveBeenCalledOnce();
      await session.dispose();
    }
  );

  it('does not carry local settlement proof into a newly selected branch owner', async () => {
    const f = fixture();
    let streams = 0;
    let user: unknown;
    f.transport.stream = vi.fn<AgentTransport['stream']>(async function* (
      _a,
      _t,
      input,
      _s,
      options
    ) {
      streams++;
      if (streams !== 2) user = (input as { messages: unknown[] }).messages[0];
      const result = saved(String(streams), [user, call]);
      f.states.set(String(streams), result);
      options?.onRunCreated?.({ run_id: `run-${streams}` });
      yield checkpointEvent(result);
    });
    const handler = vi.fn(() => 'ACTUAL RESULT');
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
      tools: { work: { description: 'Work', handler, followUp: true } },
    });
    expect(await session.fork(position('a'), 'First branch')).toBe('success');
    expect(await session.fork(position('a'), 'Second branch')).not.toBe(
      'success'
    );
    expect(handler).toHaveBeenCalledOnce();
    expect(f.transport.stream).toHaveBeenCalledTimes(3);
    await expect(session.submit('Again')).rejects.toThrow();
    await session.dispose();
  });
});
