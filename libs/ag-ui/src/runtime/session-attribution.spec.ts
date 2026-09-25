import { describe, expect, it } from 'vitest';
import { EventType as E, type AGUIEvent } from '@ag-ui/client';
import { ownTranscript } from './transcript';
import { assertAttribution } from './session-attribution';
import { applyObservation, initialObservation } from './session-observation';

const history = ownTranscript([
  {
    id: 'a',
    role: 'assistant',
    content: '',
    subagentRunId: 'owner',
    toolCalls: [
      { id: 'c', type: 'function', function: { name: 'f', arguments: '' } },
    ],
  },
  { id: 'r', role: 'reasoning', content: '', subagentRunId: 'owner' },
  {
    id: 'result',
    role: 'tool',
    toolCallId: 'c',
    content: 'ok',
    subagentRunId: 'executor',
  },
  {
    id: 'activity',
    role: 'activity',
    activityType: 'p',
    content: {},
    subagentRunId: 'owner',
  },
]);
describe('retained attribution admission', () => {
  const selected: AGUIEvent[] = [
    { type: E.TEXT_MESSAGE_START, messageId: 'a', role: 'assistant' },
    { type: E.TEXT_MESSAGE_CONTENT, messageId: 'a', delta: 'x' },
    { type: E.TEXT_MESSAGE_END, messageId: 'a' },
    { type: E.REASONING_MESSAGE_START, messageId: 'r', role: 'reasoning' },
    { type: E.REASONING_MESSAGE_CONTENT, messageId: 'r', delta: 'x' },
    { type: E.REASONING_MESSAGE_END, messageId: 'r' },
    { type: E.TOOL_CALL_START, toolCallId: 'c', toolCallName: 'f' },
    {
      type: E.TOOL_CALL_START,
      toolCallId: 'new',
      toolCallName: 'f',
      parentMessageId: 'a',
    },
    { type: E.TOOL_CALL_START, toolCallId: 'a', toolCallName: 'f' },
    { type: E.TOOL_CALL_ARGS, toolCallId: 'c', delta: 'x' },
    { type: E.TOOL_CALL_END, toolCallId: 'c' },
    {
      type: E.ACTIVITY_DELTA,
      messageId: 'activity',
      activityType: 'p',
      patch: [],
    },
  ];
  it.each(selected)('checks selected retained owner for $type', (event) => {
    expect(() =>
      assertAttribution(history, { ...event, subagentRunId: 'other' })
    ).toThrow(/attribution/);
    expect(() =>
      assertAttribution(history, { ...event, subagentRunId: 'owner' })
    ).not.toThrow();
    expect(() => assertAttribution(history, event)).not.toThrow();
  });
  it('checks existing result executor and allows distinct new result executor', () => {
    const event = {
      type: E.TOOL_CALL_RESULT,
      toolCallId: 'c',
      messageId: 'result',
      content: 'new',
    } as const;
    expect(() =>
      assertAttribution(history, { ...event, subagentRunId: 'owner' })
    ).toThrow();
    expect(() =>
      assertAttribution(history, { ...event, subagentRunId: 'executor' })
    ).not.toThrow();
    expect(() =>
      assertAttribution(history, {
        ...event,
        messageId: 'new',
        subagentRunId: 'other',
      })
    ).not.toThrow();
  });
  it.each([undefined, null, ''])(
    'distinguishes empty child from root %s',
    (owner) => {
      const previous = ownTranscript([
        {
          id: 'a',
          role: 'assistant',
          subagentRunId: owner as string | undefined,
        },
      ]);
      const check = () =>
        assertAttribution(previous, {
          type: E.TEXT_MESSAGE_END,
          messageId: 'a',
          subagentRunId: '',
        });
      if (owner === '') expect(check).not.toThrow();
      else expect(check).toThrow();
    }
  );
  it('uses authoritative replacement ownership and keeps replace:false ownership', () => {
    const start = initialObservation(history);
    const changed = applyObservation(start, {
      type: E.MESSAGES_SNAPSHOT,
      messages: [{ id: 'a', role: 'assistant', subagentRunId: 'new' }],
    });
    expect(() =>
      assertAttribution(changed.transcript, {
        type: E.TEXT_MESSAGE_END,
        messageId: 'a',
        subagentRunId: 'new',
      })
    ).not.toThrow();
    expect(() =>
      assertAttribution(changed.transcript, {
        type: E.TEXT_MESSAGE_END,
        messageId: 'a',
        subagentRunId: 'owner',
      })
    ).toThrow();
    const activity = {
      type: E.ACTIVITY_SNAPSHOT,
      replace: true,
      messageId: 'activity',
      activityType: 'p',
      content: {},
      subagentRunId: 'new',
    } as const;
    const kept = applyObservation(start, { ...activity, replace: false });
    expect(kept).toBe(start);
    const replaced = applyObservation(start, activity);
    expect(
      replaced.transcript.find((m) => m.id === 'activity')?.subagentRunId
    ).toBe('new');
  });
  it('does not consult encryption attribution or exempt event getters', () => {
    expect(() =>
      assertAttribution(history, {
        type: E.REASONING_ENCRYPTED_VALUE,
        subtype: 'message',
        entityId: 'a',
        encryptedValue: 'bytes',
        get subagentRunId(): string {
          throw new Error('not consulted');
        },
      })
    ).not.toThrow();
  });
  it('delegates activity deltas targeting nonactivity messages to the helper no-op', () => {
    const previous = initialObservation(history);
    expect(
      applyObservation(previous, {
        type: E.ACTIVITY_DELTA,
        messageId: 'a',
        activityType: 'p',
        patch: [],
        subagentRunId: 'different',
      })
    ).toBe(previous);
  });
});
