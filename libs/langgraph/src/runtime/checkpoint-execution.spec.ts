import type { ThreadState } from '@langchain/langgraph-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import type { StreamEvent } from './transport.types';
import { deferred } from './testing/deferred';
import { controlledTransport } from './testing/controlled-transport';

import {
  checkpointEvent,
  fixture,
  position,
  saved,
} from './testing/checkpoint-fixture';

describe('checkpoint execution', () => {
  it('acknowledges a confirmed tool-result follow-up that pauses so its owned interrupt can resume', async () => {
    const f = fixture();
    const tools = saved('tools', [
      {
        type: 'ai',
        id: 'tool-step',
        content: '',
        tool_calls: [{ id: 'fresh', name: 'work', args: {} }],
      },
    ]);
    const pause = saved('pause', [], {
      next: ['approval'],
      tasks: [
        {
          id: 'task',
          name: 'approval',
          result: null,
          error: null,
          interrupts: [{ id: 'decision', value: 'Approve?' }],
        },
      ],
    });
    const done = saved('done', [{ type: 'ai', id: 'done', content: 'Done' }]);
    let calls = 0;
    f.transport.stream = vi.fn(async function* (_a, _t, input, _s, options) {
      const result = [tools, pause, done][calls++];
      if (result === pause) result.values = input as ThreadState['values'];
      f.states.set(result.checkpoint.checkpoint_id!, result);
      options?.onRunCreated?.({ run_id: String(result.metadata?.['run_id']) });
      yield checkpointEvent(result);
    });
    const handler = vi.fn(() => 'Tool result');
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
      tools: { work: { description: 'Work', followUp: true, handler } },
    });
    expect(await session.fork(position('a'), 'Run')).toBe('paused');
    expect(handler).toHaveBeenCalledOnce();
    expect(await session.resume(null)).toBe('success');
    expect(vi.mocked(f.transport.stream).mock.calls[1][4]?.checkpoint).toEqual(
      position('tools')
    );
    expect(vi.mocked(f.transport.stream).mock.calls[2][4]?.checkpoint).toEqual(
      position('pause')
    );
  });
  it('keeps historical echoes inert but blocks identical new-turn baseline call ID reuse monotonically', async () => {
    const f = fixture();
    const call = { id: 'old', name: 'work', args: {} };
    const history = [
      { type: 'ai', id: 'historic', content: '', tool_calls: [call] },
      { type: 'tool', id: 'result', tool_call_id: 'old', content: 'done' },
    ];
    f.states.set('a', saved('a', history));
    let collide = false;
    f.transport.stream = vi.fn(async function* (_a, _t, input, _s, options) {
      options?.onRunCreated?.({ run_id: 'run-echo' });
      const result = saved('echo', [
        ...history,
        ...(input as { messages: unknown[] }).messages,
        {
          type: 'ai',
          id: collide ? 'new' : 'answer',
          content: 'New answer',
          ...(collide ? { tool_calls: [call] } : {}),
        },
      ]);
      f.states.set('echo', result);
      yield checkpointEvent(result);
    });
    const handler = vi.fn(() => 'should not run');
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
      tools: { work: { description: 'Work', handler } },
    });
    expect(await session.fork(position('a'), 'Echo')).toBe('success');
    expect(handler).not.toHaveBeenCalled();
    collide = true;
    expect(await session.submit('Collide')).toBe('interrupted');
    expect(session.getSnapshot().error?.message).toContain('identity conflict');
    await expect(session.load?.()).rejects.toThrow();
    await expect(session.submit('Again')).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
  it('is inert until commanded, adopts A atomically, and retains its position across submit/load/check', async () => {
    const f = fixture();
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
    });
    const views: string[][] = [];
    session.subscribe(() =>
      views.push(session.getSnapshot().messages.map((m) => m.content))
    );
    expect(f.transport.getState).not.toHaveBeenCalled();
    expect(await session.fork(position('a'), 'Fork')).toBe('success');
    expect(views[0]).toEqual(['Source A', 'Answer A', 'Fork']);
    expect(f.requests[0].options?.checkpoint).toEqual(position('a'));
    expect(f.requests[0].options?.streamMode).toContain('checkpoints');
    expect(await session.submit('Next')).toBe('success');
    expect(f.requests[1].options?.checkpoint).toEqual(position('result-1'));
    await session.load?.();
    expect(f.transport.getState).toHaveBeenLastCalledWith(
      'thread',
      position('result-2'),
      expect.any(AbortSignal)
    );
    const reads = vi.mocked(f.transport.getState!).mock.calls.length;
    await session.checkStatus?.();
    expect(f.transport.getState).toHaveBeenCalledTimes(reads);
    expect(f.transport.getHistory).not.toHaveBeenCalled();
    expect(session.getSnapshot().history).toBeUndefined();
  });
  it('does not replace the prior snapshot or POST after stop during source preparation', async () => {
    const f = fixture();
    const waiting = deferred<ThreadState>();
    f.transport.getState = vi.fn(() => waiting.promise);
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
    });
    const before = session.getSnapshot();
    const run = session.fork(position('a'), 'Fork');
    await vi.waitFor(() => expect(f.transport.getState).toHaveBeenCalled());
    const signal = vi.mocked(f.transport.getState).mock.calls[0][2];
    await session.stop();
    expect(await run).toBe('aborted');
    expect(signal.aborted).toBe(true);
    waiting.resolve(f.source);
    await Promise.resolve();
    expect(session.getSnapshot()).toBe(before);
    expect(f.transport.stream).not.toHaveBeenCalled();
  });
  it('owns input before awaiting and rejects overlapping branch consumers', async () => {
    const f = fixture();
    const waiting = deferred<ThreadState>();
    f.transport.getState = vi
      .fn()
      .mockReturnValueOnce(waiting.promise)
      .mockImplementation(async (_thread, cp) =>
        f.states.get(cp.checkpoint_id)
      );
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
    });
    const input = { message: 'Fork', state: { preference: { color: 'blue' } } };
    const run = session.fork(position('a'), input);
    await vi.waitFor(() => expect(f.transport.getState).toHaveBeenCalled());
    input.state.preference.color = 'red';
    await expect(session.submit('Overlap')).rejects.toThrow();
    await expect(session.load?.()).rejects.toThrow();
    await expect(session.fork(position('a'), 'Overlap')).rejects.toThrow();
    waiting.resolve(f.source);
    expect(await run).toBe('success');
    expect(f.requests[0].input).toMatchObject({
      preference: { color: 'blue' },
    });
  });
  it('retains physical run evidence when stopped between terminal status and exact confirmation', async () => {
    const f = fixture();
    const waiting = deferred<ThreadState>();
    f.transport.getState = vi
      .fn()
      .mockImplementationOnce(async () => f.source)
      .mockImplementationOnce(() => waiting.promise)
      .mockImplementation(async (_thread, cp) =>
        f.states.get(cp.checkpoint_id)
      );
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
    });
    const run = session.fork(position('a'), 'Fork');
    await vi.waitFor(() =>
      expect(f.transport.getState).toHaveBeenCalledTimes(2)
    );
    await session.stop();
    await session.stop();
    expect(await run).toBe('aborted');
    await expect(session.submit('Wrong')).rejects.toThrow();
    await expect(session.checkStatus?.()).rejects.toThrow();
    expect(session.getSnapshot().reconnect?.runId).toBe('run-result-1');
    expect(await session.reconnect()).toBe('success');
    expect(f.transport.joinStream).toHaveBeenCalledWith(
      'thread',
      'run-result-1',
      'cursor-result-1',
      expect.any(AbortSignal),
      { streamMode: expect.arrayContaining(['checkpoints']) }
    );
    expect(f.transport.stream).toHaveBeenCalledTimes(1);
    waiting.resolve(f.states.get('result-1')!);
  });
  it('does not run a handler until the physical position is confirmed', async () => {
    const f = fixture();
    const wire = controlledTransport<StreamEvent>();
    const confirmed = deferred<ThreadState>();
    const handler = vi.fn(() => 'done');
    const result = saved('tools', [
      {
        id: 'assistant-tools',
        type: 'ai',
        content: '',
        tool_calls: [{ id: 'fresh', name: 'work', args: {} }],
      },
    ]);
    f.transport.stream = vi.fn((_a, _t, _p, _s, options) => {
      options?.onRunCreated?.({ run_id: 'run-tools' });
      return wire.stream;
    });
    f.transport.getState = vi
      .fn()
      .mockResolvedValueOnce(f.source)
      .mockImplementation(() => confirmed.promise);
    f.transport.updateState = vi.fn(async () => position('written'));
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
      tools: { work: { description: 'Work', handler, followUp: false } },
    });
    const run = session.fork(position('a'), 'Fork');
    await vi.waitFor(() => expect(f.transport.stream).toHaveBeenCalled());
    wire.release(checkpointEvent(result));
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
    wire.finish();
    await vi.waitFor(() =>
      expect(f.transport.getState).toHaveBeenCalledTimes(2)
    );
    expect(handler).not.toHaveBeenCalled();
    confirmed.resolve(result);
    expect(await run).toBe('success');
    expect(handler).toHaveBeenCalledOnce();
    expect(f.transport.updateState).toHaveBeenCalledWith(
      'thread',
      expect.any(Object),
      expect.any(AbortSignal),
      { checkpoint: position('tools') }
    );
  });
  it('rejects undefined branch resume and an already consumed paused task without mutation', async () => {
    const f = fixture();
    const tasks = [
      {
        id: 'task',
        name: 'approval',
        error: null,
        result: null,
        interrupts: [{ id: 'decision', value: { amount: 10 } }],
      },
    ];
    const pause = saved('pause', [], { next: ['approval'], tasks });
    f.states.set('pause', pause);
    f.transport.stream = vi.fn(async function* (_a, _t, _p, _s, options) {
      options?.onRunCreated?.({ run_id: 'run-pause' });
      yield checkpointEvent(pause);
    });
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
    });
    expect(await session.fork(position('a'), 'Pause')).toBe('paused');
    const before = session.getSnapshot();
    const reads = vi.mocked(f.transport.getState!).mock.calls.length;
    await expect(session.resume()).rejects.toThrow();
    expect(f.transport.getState).toHaveBeenCalledTimes(reads);
    f.states.set(
      'pause',
      saved('pause', [], {
        next: ['approval'],
        tasks: [{ ...tasks[0], result: { decision: true } }],
      })
    );
    await expect(session.resume(null)).rejects.toThrow();
    expect(session.getSnapshot()).toBe(before);
    expect(f.transport.stream).toHaveBeenCalledTimes(1);
  });
  it('resumes an unconsumed exact paused position with explicit null and the command signal', async () => {
    const f = fixture();
    const tasks = [
      {
        id: 'task',
        name: 'approval',
        error: null,
        result: null,
        interrupts: [{ id: 'decision', value: { amount: 10 } }],
      },
    ];
    const pause = saved('pause', [], { next: ['approval'], tasks });
    const complete = saved('done', [
      { type: 'ai', id: 'done', content: 'Decided' },
    ]);
    f.states.set('pause', pause);
    f.states.set('done', complete);
    let calls = 0;
    f.transport.stream = vi.fn(async function* (_a, _t, _p, _s, options) {
      const result = calls++ ? complete : pause;
      options?.onRunCreated?.({ run_id: String(result.metadata?.['run_id']) });
      yield checkpointEvent(result);
    });
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
    });
    expect(await session.fork(position('a'), 'Pause')).toBe('paused');
    const external = new AbortController();
    expect(await session.resume(null, { signal: external.signal })).toBe(
      'success'
    );
    const stream = vi.mocked(f.transport.stream).mock.calls[1];
    expect(stream[2]).toBeNull();
    expect(stream[4]).toMatchObject({
      checkpoint: position('pause'),
      command: { resume: null },
    });
    const preflight = vi.mocked(f.transport.getState!).mock.calls[2];
    expect(preflight[1]).toEqual(position('pause'));
    expect(preflight[2]).not.toBe(external.signal);
    expect(preflight[2].aborted).toBe(false);
  });
});
