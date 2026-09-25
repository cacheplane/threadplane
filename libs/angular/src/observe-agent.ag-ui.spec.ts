import {
  createEnvironmentInjector,
  EnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { observeAgent } from './public-api';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Only integration tests compose the actual private native owner.
import { bindingFixture } from '../../ag-ui/src/runtime/testing/binding-fixture';

const fixtures: ReturnType<typeof bindingFixture>[] = [];
const injectors: EnvironmentInjector[] = [];
function fixture(options?: Parameters<typeof bindingFixture>[0]) {
  const value = bindingFixture(options);
  fixtures.push(value);
  return value;
}
function observe(session: ReturnType<typeof bindingFixture>['session']) {
  const injector = createEnvironmentInjector(
    [],
    TestBed.inject(EnvironmentInjector)
  );
  injectors.push(injector);
  return {
    snapshot: runInInjectionContext(injector, () => observeAgent(session)),
    destroy: () => injector.destroy(),
  };
}
afterEach(async () => {
  for (const injector of injectors.splice(0)) {
    if (!injector.destroyed) injector.destroy();
  }
  await Promise.all(fixtures.splice(0).map((value) => value.cleanup()));
  TestBed.resetTestingModule();
});

describe('observeAgent native AG-UI owner', () => {
  it('shares native snapshots across contexts and retains work after one context is destroyed', async () => {
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
    const first = observe(f.session);
    const second = observe(f.session);
    expect(first.snapshot()).toBe(second.snapshot());
    expect(second.snapshot()).toBe(f.session.getSnapshot());
    expect(second.snapshot).not.toHaveProperty('set');
    expect(f.exchanges).toHaveLength(0);
    const run = f.session.submit('Hello');
    const exchange = await f.started();
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
    const changed = f.changed(
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
    await changed;
    expect(first.snapshot()).toBe(second.snapshot());
    expect(second.snapshot().state).toEqual({ count: 1 });
    expect(second.snapshot().transcript.at(-1)).toEqual({
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
    expect(second.snapshot().subagents).toEqual([
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
    expect(second.snapshot().status).toBe('running');
    expect(second.snapshot().run?.outcome).toBeUndefined();
    expect(second.snapshot()).not.toHaveProperty('toolCalls');
    const detached = first.snapshot();
    first.destroy();
    expect(exchange.aborts).toBe(0);
    const continuing = f.changed(
      (snapshot) => snapshot.transcript.at(-1)?.content === 'Hello'
    );
    exchange.emit({
      type: 'TEXT_MESSAGE_CONTENT',
      messageId: 'answer',
      delta: 'lo',
    });
    await continuing;
    expect(first.snapshot()).toBe(detached);
    expect(second.snapshot()).toBe(f.session.getSnapshot());
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
    exchange.emit({ type: 'TOOL_CALL_END', toolCallId: 'call' });
    exchange.emit({ type: 'TEXT_MESSAGE_END', messageId: 'answer' });
    exchange.emit(terminal);
    expect(await run).toBe('paused');
    await exchange.closed;
    expect(second.snapshot().run?.terminal).toEqual(terminal);
    expect(second.snapshot().run?.outcome).toBe('paused');
    const nextRun = f.session.submit('Next');
    const next = await f.started(1);
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
        { id: expect.any(String), role: 'user', content: 'Next' },
      ],
      state: { count: 1 },
      tools: [],
      context: [],
      forwardedProps: {},
    });
    expect(next.body.runId).not.toBe(exchange.body.runId);
    second.destroy();
    expect(next.aborts).toBe(0);
    await f.session.dispose();
    expect(await nextRun).toBe('aborted');
    await next.closed;
    expect(next.aborts).toBe(1);
    expect(f.exchanges).toHaveLength(2);
  });

  it('replaces contexts without transferring owner state or cancelling another owner', async () => {
    const a = fixture({ threadId: 'a', state: { owner: 'a' } });
    const b = fixture({ threadId: 'b', state: { owner: 'b' } });
    const first = observe(a.session);
    const firstRun = a.session.submit('A');
    const aExchange = await a.started();
    first.destroy();
    const selected = observe(b.session);
    const baseline = selected.snapshot();
    expect(aExchange.aborts).toBe(0);
    expect(b.exchanges).toHaveLength(0);
    const changed = a.changed(
      (snapshot) => JSON.stringify(snapshot.state) === '{"stage":"retained"}'
    );
    aExchange.emit({ type: 'STATE_SNAPSHOT', snapshot: { stage: 'retained' } });
    await changed;
    expect(selected.snapshot()).toBe(baseline);
    const restored = observe(a.session);
    expect(restored.snapshot().state).toEqual({ stage: 'retained' });
    const secondRun = b.session.submit('B');
    const bExchange = await b.started();
    expect(bExchange.body).toEqual({
      threadId: 'b',
      runId: b.session.getSnapshot().run?.id,
      messages: [{ id: expect.any(String), role: 'user', content: 'B' }],
      state: { owner: 'b' },
      tools: [],
      context: [],
      forwardedProps: {},
    });
    await a.session.stop();
    expect(await firstRun).toBe('aborted');
    await aExchange.closed;
    expect(restored.snapshot().run?.outcome).toBe('aborted');
    expect(selected.snapshot().status).toBe('running');
    expect(bExchange.aborts).toBe(0);
    bExchange.emit({
      type: 'RUN_FINISHED',
      threadId: bExchange.body.threadId,
      runId: bExchange.body.runId,
    });
    expect(await secondRun).toBe('success');
    await bExchange.closed;
    expect(selected.snapshot().run?.outcome).toBe('success');
    expect(a.session.getSnapshot().state).toEqual({ stage: 'retained' });
  });
});
