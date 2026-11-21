import type { AgentSession } from '@threadplane/core';
import { describe, expect, it } from 'vitest';
import { bindingFixture } from './testing/binding-fixture';

describe('core interrupts and child agents on the AG-UI snapshot', () => {
  it('publishes each child with its own messages and tool calls', async () => {
    const fixture = bindingFixture();
    try {
      const run = fixture.session.submit('Research it');
      const exchange = await fixture.started();
      const streamed = fixture.changed(
        (snapshot) =>
          snapshot.subagents[0]?.messages[0]?.content === 'Two sources'
      );
      exchange.emit({
        type: 'TEXT_MESSAGE_START',
        messageId: 'root',
        role: 'assistant',
      });
      exchange.emit({
        type: 'TOOL_CALL_START',
        toolCallId: 'delegate',
        toolCallName: 'task',
        parentMessageId: 'root',
      });
      exchange.emit({
        type: 'SUBAGENT_STARTED',
        subagentRunId: 'child',
        name: 'researcher',
        description: 'Find the sources',
        parentToolCallId: 'delegate',
      });
      exchange.emit({
        type: 'TEXT_MESSAGE_START',
        messageId: 'finding',
        role: 'assistant',
        subagentRunId: 'child',
      });
      exchange.emit({
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'finding',
        delta: 'Two sources',
      });
      exchange.emit({ type: 'TEXT_MESSAGE_END', messageId: 'finding' });
      await streamed;
      const running = fixture.session.getSnapshot();
      expect(running.subagents).toHaveLength(1);
      const child = running.subagents[0];
      expect(child).toMatchObject({
        id: 'child',
        name: 'researcher',
        description: 'Find the sources',
        toolCallId: 'delegate',
        status: 'running',
        toolCalls: [],
      });
      expect(child.messages.map((message) => message.content)).toEqual([
        'Two sources',
      ]);
      // The child's messages are its own: the root transcript does not repeat them.
      expect(running.messages.map((message) => message.id)).not.toContain(
        'finding'
      );
      // The protocol evidence stays alongside the core fields.
      expect(child.started.subagentRunId).toBe('child');
      expect(child.terminal).toBeUndefined();

      // A publication that does not touch the child keeps its reference.
      const worked = fixture.changed((snapshot) =>
        snapshot.messages.some((message) => message.content === 'Working')
      );
      exchange.emit({
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'root',
        delta: 'Working',
      });
      await worked;
      expect(fixture.session.getSnapshot().subagents).toBe(running.subagents);

      const ended = fixture.changed(
        (snapshot) => snapshot.subagents[0]?.terminal !== undefined
      );
      exchange.emit({
        type: 'SUBAGENT_ERROR',
        subagentRunId: 'child',
        message: 'The search failed',
      });
      await ended;
      const failed = fixture.session.getSnapshot().subagents[0];
      expect(failed).not.toBe(child);
      expect(failed).toMatchObject({
        id: 'child',
        status: 'error',
        error: 'The search failed',
      });
      // A child that has ended streams nothing further.
      expect(child.messages[0].delivery.phase).toBe('streaming');
      expect(failed.messages[0].delivery.phase).toBe('complete');

      exchange.emit({ type: 'TOOL_CALL_END', toolCallId: 'delegate' });
      exchange.emit({ type: 'TEXT_MESSAGE_END', messageId: 'root' });
      exchange.emit({
        type: 'RUN_FINISHED',
        threadId: exchange.body.threadId,
        runId: exchange.body.runId,
      });
      await expect(run).resolves.toBe('success');
      // A core observer reads the same children.
      const observer: AgentSession = fixture.session;
      expect(observer.getSnapshot().subagents?.[0]?.id).toBe('child');
    } finally {
      await fixture.cleanup();
    }
  });

  it('reports a child with no ending as unknown once the run settles', async () => {
    const fixture = bindingFixture();
    try {
      const run = fixture.session.submit('Go');
      const exchange = await fixture.started();
      const seen = fixture.changed(
        (snapshot) => snapshot.subagents.length === 1
      );
      exchange.emit({
        type: 'SUBAGENT_STARTED',
        subagentRunId: 'open',
        name: 'worker',
      });
      await seen;
      expect(fixture.session.getSnapshot().subagents[0].status).toBe('running');
      exchange.emit({
        type: 'RUN_FINISHED',
        threadId: exchange.body.threadId,
        runId: exchange.body.runId,
      });
      // The protocol requires every child to end before its run does.
      await expect(run).resolves.toBe('error');
      expect(fixture.session.getSnapshot().subagents[0].status).toBe('unknown');
    } finally {
      await fixture.cleanup();
    }
  });

  it('keeps a paused child running and continues it with its records after resume', async () => {
    const fixture = bindingFixture();
    try {
      const run = fixture.session.submit('Book it');
      const exchange = await fixture.started();
      const paused = fixture.changed(
        (snapshot) => snapshot.subagents[0]?.terminal !== undefined
      );
      exchange.emit({
        type: 'SUBAGENT_STARTED',
        subagentRunId: 'child',
        name: 'booker',
      });
      exchange.emit({
        type: 'TEXT_MESSAGE_START',
        messageId: 'before',
        role: 'assistant',
        subagentRunId: 'child',
      });
      exchange.emit({
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'before',
        delta: 'Need approval',
      });
      exchange.emit({ type: 'TEXT_MESSAGE_END', messageId: 'before' });
      exchange.emit({
        type: 'SUBAGENT_FINISHED',
        subagentRunId: 'child',
        outcome: { type: 'suspended', interruptIds: ['approval'] },
      });
      await paused;
      exchange.emit({
        type: 'RUN_FINISHED',
        threadId: exchange.body.threadId,
        runId: exchange.body.runId,
        outcome: {
          type: 'interrupt',
          interrupts: [{ id: 'approval', reason: 'approve' }],
        },
      });
      await expect(run).resolves.toBe('paused');
      // Paused is not finished: the child can continue.
      expect(fixture.session.getSnapshot().subagents[0].status).toBe('running');

      const resumed = fixture.session.resume([
        { interruptId: 'approval', status: 'resolved' },
      ]);
      const next = await fixture.started(1);
      // Between the answer and the child's restart it is history, still going.
      expect(fixture.session.getSnapshot().subagents).toMatchObject([
        { id: 'child', status: 'running', earlier: true },
      ]);
      const continued = fixture.changed(
        (snapshot) =>
          snapshot.subagents.length === 1 &&
          snapshot.subagents[0].messages.length === 2
      );
      next.emit({
        type: 'SUBAGENT_STARTED',
        subagentRunId: 'child',
        name: 'booker',
      });
      next.emit({
        type: 'TEXT_MESSAGE_START',
        messageId: 'after',
        role: 'assistant',
        subagentRunId: 'child',
      });
      next.emit({
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'after',
        delta: 'Booked',
      });
      next.emit({ type: 'TEXT_MESSAGE_END', messageId: 'after' });
      // One child, not two, and it keeps what it said before the pause.
      const child = (await continued).subagents[0];
      expect(child).not.toHaveProperty('earlier');
      expect(child.messages.map((message) => message.content)).toEqual([
        'Need approval',
        'Booked',
      ]);
      next.emit({ type: 'SUBAGENT_FINISHED', subagentRunId: 'child' });
      next.emit({
        type: 'RUN_FINISHED',
        threadId: next.body.threadId,
        runId: next.body.runId,
      });
      await expect(resumed).resolves.toBe('success');
      expect(fixture.session.getSnapshot().subagents[0].status).toBe(
        'complete'
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it('lists pending interrupts until an answer is sent, and answers them by id', async () => {
    const fixture = bindingFixture();
    try {
      expect('interrupts' in fixture.session.getSnapshot()).toBe(false);
      const run = fixture.session.submit('Refund it');
      const exchange = await fixture.started();
      exchange.emit({
        type: 'RUN_FINISHED',
        threadId: exchange.body.threadId,
        runId: exchange.body.runId,
        outcome: {
          type: 'interrupt',
          interrupts: [
            { id: 'approval', reason: 'approve', message: 'Refund $20?' },
          ],
        },
      });
      await expect(run).resolves.toBe('paused');
      const paused = fixture.session.getSnapshot();
      expect(paused.interrupts).toEqual([
        { id: 'approval', reason: 'approve', message: 'Refund $20?' },
      ]);
      // A core observer answers through the core command.
      const observer: AgentSession = fixture.session;
      await expect(
        observer.resume?.([{ interruptId: 'other', status: 'resolved' }])
      ).rejects.toThrow(TypeError);
      expect(fixture.session.getSnapshot()).toBe(paused);
      const pending = observer.getSnapshot().interrupts ?? [];
      const resumed = observer.resume?.(
        pending.map((interrupt) => ({
          interruptId: interrupt.id,
          status: 'resolved' as const,
          value: { approved: true },
        }))
      );
      const next = await fixture.started(1);
      expect(next.body.resume).toEqual([
        {
          interruptId: 'approval',
          status: 'resolved',
          payload: { approved: true },
        },
      ]);
      // The answer is on its way: nothing is waiting on a person now.
      expect('interrupts' in fixture.session.getSnapshot()).toBe(false);
      next.emit({
        type: 'RUN_FINISHED',
        threadId: next.body.threadId,
        runId: next.body.runId,
      });
      await expect(resumed).resolves.toBe('success');
      expect('interrupts' in fixture.session.getSnapshot()).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });
});
