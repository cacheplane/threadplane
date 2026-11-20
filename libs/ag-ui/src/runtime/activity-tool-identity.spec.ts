import type {
  ActivitySnapshotEvent,
  AGUIEvent,
  Message,
} from '@ag-ui/client';
import { describe, expect, it } from 'vitest';
import { applyActivityMessage } from './activity-messages';
import { reconcileTranscript } from './reconcile-transcript';
import { assertAttribution } from './session-attribution';
import { assertTranscriptIdentity } from './session-observation';
import { bindingFixture } from './testing/binding-fixture';
import { applyToolMessage } from './tool-messages';
import { ownTranscript, requestMessages } from './transcript';

type Fixture = ReturnType<typeof bindingFixture>;
type Exchange = Awaited<ReturnType<Fixture['started']>>;

const user: Message = { id: 'u', role: 'user', content: 'Delegate' };
const assistant: Message = {
  id: 'a',
  role: 'assistant',
  toolCalls: [
    {
      id: 'call-1',
      type: 'function',
      function: { name: 'researcher', arguments: '{}' },
    },
  ],
};
const record: Message = {
  id: 'call-1',
  role: 'activity',
  activityType: 'subagent',
  content: { toolCallId: 'call-1', name: 'researcher', status: 'running' },
};
const tool: Message = {
  id: 'call-1',
  role: 'tool',
  toolCallId: 'call-1',
  content: 'three hits',
};
const snapshot = {
  type: 'ACTIVITY_SNAPSHOT',
  messageId: 'call-1',
  activityType: 'subagent',
  content: { toolCallId: 'call-1', name: 'researcher', status: 'running' },
} as ActivitySnapshotEvent;
const result = {
  type: 'TOOL_CALL_RESULT',
  messageId: 'call-1',
  toolCallId: 'call-1',
  content: 'three hits',
} as Parameters<typeof applyToolMessage>[1];
const roles = (transcript: readonly { id: string; role: string }[]) =>
  transcript.map(({ id, role }) => `${role}:${id}`);

describe('an activity record and a tool result that share an identifier', () => {
  it('keeps the activity record when the tool result arrives after it', () => {
    const previous = ownTranscript([user, assistant, record]);
    const next = applyToolMessage(previous, result);
    expect(roles(next)).toEqual([
      'user:u',
      'assistant:a',
      'tool:call-1',
      'activity:call-1',
    ]);
    expect(next[3]).toBe(previous[2]);
    // The same result again changes nothing and still selects one record.
    expect(applyToolMessage(next, result)).toBe(next);
  });

  it('keeps the tool result when the activity record arrives after it', () => {
    const previous = ownTranscript([user, assistant, tool]);
    for (const replace of [undefined, true, false]) {
      const next = applyActivityMessage(previous, { ...snapshot, replace });
      expect(roles(next)).toEqual([
        'user:u',
        'assistant:a',
        'tool:call-1',
        'activity:call-1',
      ]);
      expect(next[2]).toBe(previous[2]);
    }
  });

  it('applies later activity events to the activity record only', () => {
    const previous = ownTranscript([user, assistant, tool, record]);
    const patched = applyActivityMessage(previous, {
      type: 'ACTIVITY_DELTA',
      messageId: 'call-1',
      activityType: 'subagent',
      patch: [{ op: 'replace', path: '/status', value: 'complete' }],
    } as Parameters<typeof applyActivityMessage>[1]);
    expect(patched[2]).toBe(previous[2]);
    expect(patched[3]).toMatchObject({
      role: 'activity',
      content: { status: 'complete' },
    });
    const replaced = applyActivityMessage(patched, {
      ...snapshot,
      content: { status: 'error' },
    });
    expect(replaced[2]).toBe(previous[2]);
    expect(replaced).toHaveLength(4);
    expect(replaced[3]).toMatchObject({ content: { status: 'error' } });
  });

  it('accepts the pair as history and still rejects every other duplicate', () => {
    expect(() =>
      assertTranscriptIdentity(ownTranscript([user, assistant, tool, record]))
    ).not.toThrow();
    for (const duplicate of [
      [user, assistant, tool, tool],
      [user, assistant, record, record],
      [user, assistant, tool, record, tool],
      [user, { ...record, id: 'u' }],
      [user, assistant, { ...record, id: 'a' }],
      [user, { ...tool, id: 'u' }],
    ])
      expect(() =>
        assertTranscriptIdentity(ownTranscript(duplicate))
      ).toThrow('Duplicate message ID');
  });

  it('does not read a tool result as attributed to the activity record', () => {
    const previous = ownTranscript([
      user,
      { ...assistant, subagentRunId: 'child' },
      record,
    ]);
    expect(() =>
      assertAttribution(previous, {
        ...result,
        subagentRunId: 'child',
      } as AGUIEvent)
    ).not.toThrow();
  });

  it('keeps both through a messages snapshot that lists only the tool result', () => {
    const previous = ownTranscript([user, assistant, tool, record]);
    const renamed = { ...tool, content: 'four hits' };
    const next = reconcileTranscript(previous, [user, assistant, renamed]);
    expect(roles(next)).toEqual([
      'user:u',
      'assistant:a',
      'tool:call-1',
      'activity:call-1',
    ]);
    expect(next[2]).toMatchObject({ content: 'four hits' });
    expect(next[3]).toBe(previous[3]);
    // A snapshot may list both, and one that lists either twice is rejected.
    expect(
      roles(reconcileTranscript(previous, [user, assistant, tool, record]))
    ).toEqual(['user:u', 'assistant:a', 'tool:call-1', 'activity:call-1']);
    expect(() =>
      reconcileTranscript(previous, [user, assistant, tool, tool])
    ).toThrow('Duplicate message IDs in snapshot');
    expect(() =>
      reconcileTranscript(ownTranscript([user, record, record]), [user])
    ).toThrow('Duplicate message IDs in previous transcript');
  });

  it('sends the tool result and never the activity record', () => {
    expect(
      roles(requestMessages(ownTranscript([user, assistant, tool, record])))
    ).toEqual(['user:u', 'assistant:a', 'tool:call-1']);
  });
});

describe('a run whose activity record and tool result share an identifier', () => {
  const call = (exchange: Exchange) => {
    exchange.emit({
      type: 'TOOL_CALL_START',
      toolCallId: 'call-1',
      toolCallName: 'researcher',
      parentMessageId: 'a',
    });
    exchange.emit({
      type: 'TOOL_CALL_ARGS',
      toolCallId: 'call-1',
      delta: '{}',
    });
    exchange.emit({ type: 'TOOL_CALL_END', toolCallId: 'call-1' });
  };
  const finish = (exchange: Exchange) =>
    exchange.emit({
      type: 'RUN_FINISHED',
      threadId: exchange.body.threadId,
      runId: exchange.body.runId,
    });

  it.each(['activity first', 'result first'] as const)(
    'succeeds and shows both, %s',
    async (order) => {
      const fixture = bindingFixture();
      try {
        const run = fixture.session.submit('Delegate');
        const first = await fixture.started();
        call(first);
        const events =
          order === 'activity first' ? [snapshot, result] : [result, snapshot];
        for (const event of events) first.emit(event);
        first.emit({
          type: 'ACTIVITY_DELTA',
          messageId: 'call-1',
          activityType: 'subagent',
          patch: [{ op: 'replace', path: '/status', value: 'complete' }],
        });
        finish(first);
        expect(await run).toBe('success');
        const settled = fixture.session.getSnapshot();
        expect(settled.error).toBeUndefined();
        expect(settled.toolCalls).toMatchObject([
          { id: 'call-1', status: 'complete', result: 'three hits' },
        ]);
        expect(settled.subagents).toMatchObject([
          { id: 'call-1', name: 'researcher', status: 'complete' },
        ]);
        expect(
          settled.transcript.filter((row) => row.id === 'call-1')
        ).toHaveLength(2);

        // The pair is ordinary history for the next request.
        const next = fixture.session.submit('Again');
        const second = await fixture.started(1);
        expect(roles(second.body.messages).slice(1)).toEqual([
          'assistant:a',
          'tool:call-1',
          expect.stringMatching(/^user:/),
        ]);
        finish(second);
        expect(await next).toBe('success');
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it('restores the pair with a loaded thread', async () => {
    const fixture = bindingFixture({
      messages: [user, assistant, tool, record],
    });
    try {
      const restored = fixture.session.getSnapshot();
      expect(restored.toolCalls).toMatchObject([
        { id: 'call-1', result: 'three hits' },
      ]);
      expect(restored.subagents).toMatchObject([{ id: 'call-1' }]);
    } finally {
      await fixture.cleanup();
    }
  });
});
