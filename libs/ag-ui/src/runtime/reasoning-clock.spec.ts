import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AGUIEvent } from '@ag-ui/client';
import { projectMessages } from './message-projection';
import {
  carryReasoningDurations,
  createReasoningClock,
} from './reasoning-clock';
import { initialObservation } from './session-observation';
import { bindingFixture } from './testing/binding-fixture';

type Records = NonNullable<Parameters<typeof initialObservation>[0]>;
const transcript = (records: Records) => initialObservation(records).transcript;
const reasoning = (id: string): Records[number] => ({
  id,
  role: 'reasoning',
  content: id,
});
const answer = (id: string): Records[number] => ({
  id,
  role: 'assistant',
  content: id,
});
const user: Records[number] = { id: 'u', role: 'user', content: 'Ask' };

describe('carryReasoningDurations', () => {
  const streamed = transcript([
    user,
    reasoning('p1'),
    reasoning('p2'),
    answer('stream-1'),
    reasoning('p3'),
    answer('stream-2'),
  ]);
  const durations = Object.freeze({ p1: 1_000, p2: 500, p3: 2_000 });

  it('moves each run total onto the first record that replaces the run', () => {
    const saved = transcript([
      user,
      reasoning('saved-a'),
      answer('saved-1'),
      reasoning('saved-b'),
      reasoning('saved-c'),
      answer('saved-2'),
    ]);
    const carried = carryReasoningDurations(streamed, saved, durations);
    expect(carried).toEqual({ 'saved-a': 1_500, 'saved-b': 2_000 });
    expect(Object.isFrozen(carried)).toBe(true);
  });

  it('gives a run that kept one of its IDs the whole run total', () => {
    const saved = transcript([
      user,
      reasoning('p1'),
      answer('saved-1'),
      reasoning('p3'),
      answer('saved-2'),
    ]);
    expect(carryReasoningDurations(streamed, saved, durations)).toEqual({
      p1: 1_500,
      p3: 2_000,
    });
  });

  it('returns the same times when the reasoning records are unchanged', () => {
    const saved = transcript([
      user,
      reasoning('p1'),
      reasoning('p2'),
      answer('saved-1'),
      { id: 'tool', role: 'tool', toolCallId: 'call', content: 'hit' },
      reasoning('p3'),
      answer('saved-2'),
    ]);
    expect(carryReasoningDurations(streamed, saved, durations)).toBe(durations);
    expect(carryReasoningDurations(streamed, streamed, durations)).toBe(
      durations
    );
    expect(carryReasoningDurations(streamed, saved, undefined)).toBeUndefined();
  });

  it('keeps only surviving records when the runs do not line up', () => {
    const fewer = transcript([user, reasoning('p3'), answer('saved-2')]);
    expect(carryReasoningDurations(streamed, fewer, durations)).toEqual({
      p3: 2_000,
    });
    const none = transcript([user, answer('saved-2')]);
    expect(carryReasoningDurations(streamed, none, durations)).toBeUndefined();
  });

  it('leaves an unmeasured run unmeasured and ignores child and activity records', () => {
    const before = transcript([
      user,
      reasoning('p1'),
      {
        id: 'child',
        role: 'assistant',
        content: 'Child',
        subagentRunId: 'worker',
      },
      {
        id: 'activity',
        role: 'activity',
        activityType: 'progress',
        content: {},
      },
      reasoning('p2'),
      answer('stream-1'),
      reasoning('restored'),
      answer('stream-2'),
    ]);
    const saved = transcript([
      user,
      reasoning('saved-a'),
      answer('saved-1'),
      reasoning('saved-b'),
      answer('saved-2'),
    ]);
    expect(
      carryReasoningDurations(before, saved, { p1: 1_000, p2: 500 })
    ).toEqual({ 'saved-a': 1_500 });
  });

  it('is applied by the clock only for a messages snapshot with its earlier state', () => {
    const clock = createReasoningClock(() => 0);
    const previous = Object.freeze({
      ...initialObservation([]),
      transcript: streamed,
      reasoningDurations: durations,
    });
    const next = Object.freeze({
      ...previous,
      transcript: transcript([user, answer('saved-2')]),
    });
    const event = { type: 'MESSAGES_SNAPSHOT', messages: [] } as AGUIEvent;
    expect(clock.observe(event, next)).toBe(next);
    const applied = clock.observe(event, next, previous);
    expect(applied).not.toHaveProperty('reasoningDurations');
    expect(Object.isFrozen(applied)).toBe(true);
    expect(
      clock.observe({ type: 'STATE_SNAPSHOT' } as AGUIEvent, next, previous)
    ).toBe(next);
  });
});

describe('reasoning time across a final messages snapshot', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps each step and its time when the snapshot renames every record', async () => {
    const clock = vi.spyOn(Date, 'now');
    const fixture = bindingFixture();
    const has = (id: string) =>
      fixture.changed((snapshot) =>
        snapshot.transcript.some((record) => record.id === id)
      );
    const think = async (
      exchange: Awaited<ReturnType<typeof fixture.started>>,
      id: string,
      from: number,
      to: number
    ) => {
      clock.mockReturnValue(from);
      exchange.emit({
        type: 'REASONING_MESSAGE_START',
        messageId: id,
        role: 'reasoning',
      });
      exchange.emit({
        type: 'REASONING_MESSAGE_CONTENT',
        messageId: id,
        delta: id,
      });
      await has(id);
      clock.mockReturnValue(to);
      exchange.emit({ type: 'REASONING_MESSAGE_END', messageId: id });
      await fixture.changed(
        (snapshot) => snapshot.reasoningDurations?.[id] !== undefined
      );
    };
    try {
      clock.mockReturnValue(0);
      const run = fixture.session.submit('Go');
      const exchange = await fixture.started();
      const userRecord = exchange.body.messages[0];
      await think(exchange, 'p1', 1_000, 2_000);
      await think(exchange, 'p2', 2_000, 2_500);
      exchange.emit({
        type: 'TOOL_CALL_START',
        toolCallId: 'call',
        toolCallName: 'search',
        parentMessageId: 'stream-1',
      });
      exchange.emit({ type: 'TOOL_CALL_ARGS', toolCallId: 'call', delta: '{}' });
      exchange.emit({ type: 'TOOL_CALL_END', toolCallId: 'call' });
      exchange.emit({
        type: 'TOOL_CALL_RESULT',
        toolCallId: 'call',
        messageId: 'call',
        content: 'hit',
      });
      await has('call');
      await think(exchange, 'p3', 5_000, 7_000);
      exchange.emit({
        type: 'TEXT_MESSAGE_START',
        messageId: 'stream-2',
        role: 'assistant',
      });
      exchange.emit({
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'stream-2',
        delta: 'Answer',
      });
      exchange.emit({ type: 'TEXT_MESSAGE_END', messageId: 'stream-2' });
      await has('stream-2');
      const view = () =>
        projectMessages(fixture.session.getSnapshot())
          .filter((message) => message.role === 'assistant')
          .map((message) => [
            message.id,
            message.reasoning,
            message.reasoningDurationMs,
          ]);
      expect(view()).toEqual([
        ['stream-1', 'p1\n\np2', 1_500],
        ['stream-2', 'p3', 2_000],
      ]);
      // The saved history: one reasoning record per step, every ID new except
      // the user's.
      exchange.emit({
        type: 'MESSAGES_SNAPSHOT',
        messages: [
          userRecord,
          { id: 'saved-a', role: 'reasoning', content: 'p1 p2' },
          {
            id: 'saved-1',
            role: 'assistant',
            toolCalls: [
              {
                id: 'call',
                type: 'function',
                function: { name: 'search', arguments: '{}' },
              },
            ],
          },
          { id: 'saved-tool', role: 'tool', toolCallId: 'call', content: 'hit' },
          { id: 'saved-b', role: 'reasoning', content: 'p3' },
          { id: 'saved-2', role: 'assistant', content: 'Answer' },
        ],
      });
      exchange.emit({
        type: 'RUN_FINISHED',
        threadId: exchange.body.threadId,
        runId: exchange.body.runId,
      });
      expect(await run).toBe('success');
      const snapshot = fixture.session.getSnapshot();
      expect(snapshot.transcript.map((record) => record.id)).toEqual([
        userRecord.id,
        'saved-a',
        'saved-1',
        'saved-tool',
        'saved-b',
        'saved-2',
      ]);
      expect(snapshot.reasoningDurations).toEqual({
        'saved-a': 1_500,
        'saved-b': 2_000,
      });
      expect(view()).toEqual([
        ['saved-1', 'p1 p2', 1_500],
        ['saved-2', 'p3', 2_000],
      ]);
    } finally {
      await fixture.cleanup();
    }
  });
});
