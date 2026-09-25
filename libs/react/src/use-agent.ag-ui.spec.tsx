import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useAgent } from './index';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Only integration tests compose the actual private native owner.
import { bindingFixture } from '../../ag-ui/src/runtime/testing/binding-fixture';

const fixtures: ReturnType<typeof bindingFixture>[] = [];
function fixture(options?: Parameters<typeof bindingFixture>[0]) {
  const value = bindingFixture(options);
  fixtures.push(value);
  return value;
}
afterEach(async () => {
  cleanup();
  await Promise.all(fixtures.splice(0).map((value) => value.cleanup()));
});

describe('useAgent native AG-UI owner', () => {
  it('shares exact protocol snapshots, releases one view, pauses and sends full next input', async () => {
    const seed = { id: 'seed', role: 'system' as const, content: 'Rules' };
    const f = fixture({
      messages: [
        seed,
        {
          id: 'activity',
          role: 'activity',
          activityType: 'progress',
          content: { count: 0 },
        },
      ],
      state: { count: 0 },
    });
    const first = renderHook(() => useAgent(f.session), {
      reactStrictMode: true,
    });
    const second = renderHook(() => useAgent(f.session), {
      reactStrictMode: true,
    });
    expect(first.result.current).toBe(f.session.getSnapshot());
    expect(second.result.current).toBe(first.result.current);
    expect(f.exchanges).toHaveLength(0);
    let run!: ReturnType<typeof f.session.submit>;
    await act(async () => {
      run = f.session.submit('Hello');
      await f.started();
    });
    const exchange = f.exchanges[0];
    expect(exchange.body).toEqual({
      threadId: 'native-thread',
      runId: f.session.getSnapshot().run?.id,
      messages: [
        seed,
        { id: expect.any(String), role: 'user', content: 'Hello' },
      ],
      state: { count: 0 },
      tools: [],
      context: [],
      forwardedProps: {},
    });
    expect(exchange.body.runId).toMatch(/^[0-9a-f-]{36}$/);
    const user = exchange.body.messages[1];
    await act(async () => {
      const observed = f.changed(
        (snapshot) => snapshot.subagents[0]?.terminal !== undefined
      );
      exchange.emit({
        type: 'TEXT_MESSAGE_START',
        messageId: 'answer',
        role: 'assistant',
      });
      exchange.emit({
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'answer',
        delta: 'Hel',
      });
      exchange.emit({ type: 'STATE_SNAPSHOT', snapshot: { count: 1 } });
      exchange.emit({
        type: 'TOOL_CALL_START',
        toolCallId: 'call',
        toolCallName: 'weather',
        parentMessageId: 'answer',
      });
      exchange.emit({
        type: 'TOOL_CALL_ARGS',
        toolCallId: 'call',
        delta: '{"city":',
      });
      exchange.emit({
        type: 'SUBAGENT_STARTED',
        subagentRunId: 'child',
        name: 'worker',
      });
      exchange.emit({
        type: 'SUBAGENT_FINISHED',
        subagentRunId: 'child',
        outcome: { type: 'suspended', interruptIds: ['child-approval'] },
      });
      await observed;
    });
    expect(first.result.current).toBe(second.result.current);
    expect(second.result.current).toBe(f.session.getSnapshot());
    expect(second.result.current.state).toEqual({ count: 1 });
    expect(second.result.current.transcript.at(-1)).toEqual({
      id: 'answer',
      role: 'assistant',
      content: 'Hel',
      toolCalls: [
        {
          id: 'call',
          type: 'function',
          function: { name: 'weather', arguments: '{"city":' },
        },
      ],
    });
    expect(second.result.current.subagents).toEqual([
      {
        started: {
          type: 'SUBAGENT_STARTED',
          subagentRunId: 'child',
          name: 'worker',
        },
        terminal: {
          type: 'SUBAGENT_FINISHED',
          subagentRunId: 'child',
          outcome: { type: 'suspended', interruptIds: ['child-approval'] },
        },
      },
    ]);
    expect(second.result.current.status).toBe('running');
    expect(second.result.current.run?.outcome).toBeUndefined();
    expect(second.result.current).not.toHaveProperty('toolCalls');
    const detached = first.result.current;
    first.unmount();
    expect(exchange.aborts).toBe(0);
    await act(async () => {
      const observed = f.changed(
        (snapshot) => snapshot.transcript.at(-1)?.content === 'Hello'
      );
      exchange.emit({
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'answer',
        delta: 'lo',
      });
      await observed;
    });
    expect(first.result.current).toBe(detached);
    expect(second.result.current.transcript.at(-1)?.content).toBe('Hello');
    expect(f.exchanges).toHaveLength(1);
    const terminal = {
      type: 'RUN_FINISHED',
      threadId: exchange.body.threadId,
      runId: exchange.body.runId,
      outcome: {
        type: 'interrupt',
        interrupts: [
          { id: 'approval', reason: 'approve', metadata: { choices: ['yes'] } },
        ],
      },
    };
    await act(async () => {
      exchange.emit({ type: 'TOOL_CALL_END', toolCallId: 'call' });
      exchange.emit({ type: 'TEXT_MESSAGE_END', messageId: 'answer' });
      exchange.emit(terminal);
      expect(await run).toBe('paused');
      await exchange.closed;
    });
    expect(second.result.current.run?.terminal).toEqual(terminal);
    expect(second.result.current.run?.outcome).toBe('paused');
    const decision = second.result.current.decision;
    if (decision?.kind !== 'native') throw new Error('Missing observed pause');
    await act(async () => {
      run = f.session.resume(decision.id, [
        { interruptId: 'approval', status: 'resolved', payload: 'yes' },
      ]);
      await f.started(1);
    });
    const next = f.exchanges[1];
    expect(next.body).toEqual({
      threadId: 'native-thread',
      runId: f.session.getSnapshot().run?.id,
      messages: [
        seed,
        user,
        {
          id: 'answer',
          role: 'assistant',
          content: 'Hello',
          toolCalls: [
            {
              id: 'call',
              type: 'function',
              function: { name: 'weather', arguments: '{"city":' },
            },
          ],
        },
      ],
      state: { count: 1 },
      resume: [{ interruptId: 'approval', status: 'resolved', payload: 'yes' }],
      tools: [],
      context: [],
      forwardedProps: {},
    });
    expect(next.body.runId).not.toBe(exchange.body.runId);
    second.unmount();
    expect(next.aborts).toBe(0);
    await f.session.dispose();
    expect(await run).toBe('aborted');
    await next.closed;
    expect(next.aborts).toBe(1);
  });

  it('transfers a StrictMode subscription without stopping the old owner or contaminating a second owner', async () => {
    const a = fixture({ threadId: 'a', state: { owner: 'a' } });
    const b = fixture({ threadId: 'b', state: { owner: 'b' } });
    const view = renderHook(({ session }) => useAgent(session), {
      initialProps: { session: a.session },
      reactStrictMode: true,
    });
    const other = renderHook(() => useAgent(b.session));
    let first!: ReturnType<typeof a.session.submit>;
    await act(async () => {
      first = a.session.submit('A');
      await a.started();
    });
    const selected = b.session.getSnapshot();
    view.rerender({ session: b.session });
    expect(view.result.current).toBe(selected);
    expect(other.result.current).toBe(selected);
    expect(b.exchanges).toHaveLength(0);
    expect(a.exchanges[0].aborts).toBe(0);
    await act(async () => {
      const changed = a.changed(
        (snapshot) => JSON.stringify(snapshot.state) === '{"stage":"retained"}'
      );
      a.exchanges[0].emit({
        type: 'STATE_SNAPSHOT',
        snapshot: { stage: 'retained' },
      });
      await changed;
    });
    expect(view.result.current).toBe(selected);
    view.rerender({ session: a.session });
    expect(view.result.current.state).toEqual({ stage: 'retained' });
    let second!: ReturnType<typeof b.session.submit>;
    await act(async () => {
      second = b.session.submit('B');
      await b.started();
    });
    expect(b.exchanges[0].body).toEqual({
      threadId: 'b',
      runId: b.session.getSnapshot().run?.id,
      messages: [{ id: expect.any(String), role: 'user', content: 'B' }],
      state: { owner: 'b' },
      tools: [],
      context: [],
      forwardedProps: {},
    });
    await act(async () => {
      await a.session.stop();
      expect(await first).toBe('aborted');
      await a.exchanges[0].closed;
    });
    expect(view.result.current.run?.outcome).toBe('aborted');
    expect(other.result.current.status).toBe('running');
    expect(b.exchanges[0].aborts).toBe(0);
    await act(async () => {
      const body = b.exchanges[0].body;
      b.exchanges[0].emit({
        type: 'RUN_FINISHED',
        threadId: body.threadId,
        runId: body.runId,
      });
      expect(await second).toBe('success');
      await b.exchanges[0].closed;
    });
    expect(other.result.current.run?.outcome).toBe('success');
    expect(a.session.getSnapshot().state).toEqual({ stage: 'retained' });
  });
});
