import { describe, expect, it } from 'vitest';
import { bindingFixture } from './testing/binding-fixture';

type Fixture = ReturnType<typeof bindingFixture>;
type Exchange = Awaited<ReturnType<Fixture['started']>>;
const finish = (exchange: Exchange) =>
  exchange.emit({
    type: 'RUN_FINISHED',
    threadId: exchange.body.threadId,
    runId: exchange.body.runId,
  });
const activity = (messageId: string, content: object, activityType = 'subagent') => ({
  type: 'ACTIVITY_SNAPSHOT',
  messageId,
  activityType,
  content,
});
/** Waits until the session has applied everything emitted so far. */
async function applied(fixture: Fixture, exchange: Exchange, marker: string) {
  exchange.emit({ type: 'STATE_SNAPSHOT', snapshot: { marker } });
  return fixture.changed(
    (snapshot) => (snapshot.state as { marker?: string } | undefined)?.marker === marker
  );
}

describe('child agents from subagent activity records', () => {
  it('lists an activity record of type subagent as a child, with its own messages and calls', async () => {
    const fixture = bindingFixture();
    try {
      const run = fixture.session.submit('Research');
      const first = await fixture.started();
      first.emit(
        activity('act-1', {
          name: 'researcher',
          description: 'Find sources',
          toolCallId: 'tc-1',
          status: 'running',
          messages: [
            { id: 'c1', role: 'assistant', content: 'Looking', toolCallIds: ['k1'], reasoning: 'Plan' },
            { role: 'tool', content: 'three hits' },
          ],
          toolCalls: [
            { id: 'k1', name: 'search', args: { q: 'x' }, status: 'complete', result: 3 },
            { name: 'no id' },
          ],
        })
      );
      const streaming = await applied(fixture, first, 'one');
      const [child] = streaming.subagents;
      expect(child).toMatchObject({
        id: 'act-1',
        name: 'researcher',
        description: 'Find sources',
        toolCallId: 'tc-1',
        status: 'running',
        started: {
          type: 'SUBAGENT_STARTED',
          subagentRunId: 'act-1',
          name: 'researcher',
          parentToolCallId: 'tc-1',
        },
      });
      expect(child.terminal).toBeUndefined();
      expect(child.earlier).toBeUndefined();
      expect(child.activity).toMatchObject({ name: 'researcher' });
      expect(child.messages).toEqual([
        {
          id: 'c1',
          role: 'assistant',
          content: 'Looking',
          toolCallIds: ['k1'],
          reasoning: 'Plan',
          delivery: { generation: 'c1', phase: 'streaming' },
        },
        {
          id: 'act-1-1',
          role: 'assistant',
          content: 'three hits',
          delivery: { generation: 'act-1-1', phase: 'complete', outcome: 'success' },
        },
      ]);
      expect(child.toolCalls).toEqual([
        { id: 'k1', name: 'search', args: { q: 'x' }, status: 'complete', result: 3 },
      ]);
      expect(Object.isFrozen(child)).toBe(true);
      // The record is the child's, not a root message.
      expect(streaming.messages.map((message) => message.content)).toEqual(['Research']);

      // An unrelated publication keeps the child and the list.
      const again = await applied(fixture, first, 'two');
      expect(again.subagents).toBe(streaming.subagents);

      first.emit({
        type: 'ACTIVITY_DELTA',
        messageId: 'act-1',
        activityType: 'subagent',
        patch: [{ op: 'replace', path: '/status', value: 'complete' }],
      });
      finish(first);
      expect(await run).toBe('success');
      const [done] = fixture.session.getSnapshot().subagents;
      expect(done.status).toBe('complete');
      expect(done).not.toBe(child);
      expect(done.messages[0].delivery).toEqual({
        generation: 'c1',
        phase: 'complete',
        outcome: 'success',
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('reads one text, an error and a missing status as the Angular adapter did', async () => {
    const fixture = bindingFixture();
    try {
      const run = fixture.session.submit('Go');
      const first = await fixture.started();
      first.emit(activity('plain', { text: 'Working' }));
      first.emit(activity('failed', { status: 'error', state: { error: 'No access' } }));
      first.emit(activity('other', { text: 'not a child' }, 'progress'));
      const live = await applied(fixture, first, 'one');
      expect(live.subagents.map((child) => [child.id, child.status])).toEqual([
        ['plain', 'running'],
        ['failed', 'error'],
      ]);
      expect(live.subagents[0].messages).toEqual([
        {
          id: 'plain',
          role: 'assistant',
          content: 'Working',
          delivery: { generation: 'plain', phase: 'streaming' },
        },
      ]);
      expect(live.subagents[0].name).toBeUndefined();
      expect(live.subagents[0].started.name).toBe('');
      expect(live.subagents[1]).toMatchObject({ error: 'No access' });
      expect(live.subagents[1].messages[0].delivery).toMatchObject({ outcome: 'error' });
      finish(first);
      await run;
      // With no ending and no run going, what became of it is not known.
      expect(fixture.session.getSnapshot().subagents[0].status).toBe('unknown');
    } finally {
      await fixture.cleanup();
    }
  });

  it('marks a child of an earlier run, and lists children with event evidence first', async () => {
    const fixture = bindingFixture();
    try {
      const one = fixture.session.submit('One');
      const first = await fixture.started();
      first.emit(activity('act-1', { name: 'writer', status: 'complete', text: 'Draft' }));
      finish(first);
      await one;
      const settled = fixture.session.getSnapshot().subagents[0];
      expect(settled.earlier).toBeUndefined();

      const two = fixture.session.submit('Two');
      const second = await fixture.started(1);
      second.emit({ type: 'SUBAGENT_STARTED', subagentRunId: 'evt-1', name: 'reviewer' });
      second.emit(activity('act-2', { name: 'checker' }));
      const live = await applied(fixture, second, 'one');
      expect(
        live.subagents.map((child) => [child.id, child.status, child.earlier])
      ).toEqual([
        ['evt-1', 'running', undefined],
        ['act-1', 'complete', true],
        ['act-2', 'running', undefined],
      ]);
      expect(live.subagents[0].activity).toBeUndefined();
      second.emit({ type: 'SUBAGENT_FINISHED', subagentRunId: 'evt-1' });
      finish(second);
      await two;
    } finally {
      await fixture.cleanup();
    }
  });

  it('reads a child from its events when an activity record shares its id', async () => {
    const fixture = bindingFixture();
    try {
      const run = fixture.session.submit('Go');
      const first = await fixture.started();
      first.emit({ type: 'SUBAGENT_STARTED', subagentRunId: 'same', name: 'from events' });
      first.emit(activity('same', { name: 'from activity', status: 'complete' }));
      const live = await applied(fixture, first, 'one');
      expect(live.subagents).toHaveLength(1);
      expect(live.subagents[0]).toMatchObject({ name: 'from events', status: 'running' });
      first.emit({ type: 'SUBAGENT_FINISHED', subagentRunId: 'same' });
      finish(first);
      await run;
    } finally {
      await fixture.cleanup();
    }
  });

  it('restores an activity child with a loaded thread', async () => {
    const fixture = bindingFixture({
      messages: [
        { id: 'u1', role: 'user', content: 'Go' },
        {
          id: 'act-1',
          role: 'activity',
          activityType: 'subagent',
          content: { name: 'writer', status: 'complete', text: 'Draft' },
        },
      ],
    });
    try {
      expect(fixture.session.getSnapshot().subagents).toMatchObject([
        { id: 'act-1', name: 'writer', status: 'complete' },
      ]);
    } finally {
      await fixture.cleanup();
    }
  });
});
