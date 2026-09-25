import { describe, expect, it } from 'vitest';
import { EventType as E, type AGUIEvent, type Message } from '@ag-ui/client';
import {
  applyObservation,
  initialObservation,
  type SessionSnapshot,
} from './session-observation';

const running = (): SessionSnapshot =>
  Object.freeze({
    ...initialObservation(),
    status: 'running',
    run: Object.freeze({ id: 'run' }),
  });
describe('private session observation', () => {
  it('owns literal native notices separately and preserves them beside later terminal evidence', () => {
    const previous = running();
    const event = {
      type: E.CUSTOM as const,
      name: 'on_interrupt',
      value: { nested: [1], responseSchema: '{not parsed}' },
      metadata: { detail: [2] },
      timestamp: 3,
    };
    const observed = applyObservation(previous, event);
    expect(observed.run?.terminal).toBeUndefined();
    expect(observed.run?.legacyInterrupt).toEqual(event);
    event.value.nested.push(99);
    event.metadata.detail.push(99);
    expect(observed.run?.legacyInterrupt).toEqual({
      type: E.CUSTOM,
      name: 'on_interrupt',
      value: { nested: [1], responseSchema: '{not parsed}' },
      metadata: { detail: [2] },
      timestamp: 3,
    });
    expect(Object.isFrozen(observed.run?.legacyInterrupt?.value)).toBe(true);
    expect(
      Object.isFrozen(observed.run?.legacyInterrupt?.metadata?.['detail'])
    ).toBe(true);
    expect(Object.isFrozen(event.value)).toBe(false);
    expect(previous.run?.legacyInterrupt).toBeUndefined();
    const terminal = {
      type: E.RUN_FINISHED as const,
      threadId: 'thread',
      runId: 'run',
      outcome: { type: 'success' as const },
    };
    const finished = applyObservation(observed, terminal);
    expect(finished.run?.terminal).toEqual(terminal);
    expect(finished.run?.legacyInterrupt).toBe(observed.run?.legacyInterrupt);
    expect(finished.state).toBe(previous.state);
    expect(finished.transcript).toBe(previous.transcript);
    expect(observed.run?.terminal).toBeUndefined();
  });
  it('explicit legacy observation shares one selected immutable object between notice and terminal', () => {
    const event = {
      type: E.CUSTOM as const,
      name: 'on_interrupt',
      value: '{literal}',
      metadata: { detail: [1] },
    };
    const value = applyObservation(running(), event, 'legacy-observation');
    expect(value.run?.legacyInterrupt).toEqual(event);
    expect(value.run?.legacyInterrupt).toBe(value.run?.terminal);
    expect(value.run?.legacyInterrupt?.value).toBe('{literal}');
  });
  it.each([null, false, 0])(
    'owns initial inputs and preserves literal %s state',
    (state) => {
      const messages: Message[] = [
        { id: 'seed', role: 'user', content: 'hi', metadata: { nested: [1] } },
      ];
      const value = initialObservation(messages, state);
      expect(value.state).toBe(state);
      expect(value.transcript).toEqual(messages);
      expect(value.transcript).not.toBe(messages);
      expect(Object.isFrozen(value.transcript[0].metadata?.['nested'])).toBe(
        true
      );
      expect(Object.isFrozen(value)).toBe(true);
    }
  );
  it('combines native families with shared state and structural sharing', () => {
    let value = running();
    const events: AGUIEvent[] = [
      { type: E.SUBAGENT_STARTED, subagentRunId: 'child', name: 'worker' },
      {
        type: E.TEXT_MESSAGE_START,
        messageId: 'a',
        role: 'assistant',
        subagentRunId: 'child',
      },
      { type: E.TEXT_MESSAGE_CONTENT, messageId: 'a', delta: 'hello' },
      { type: E.REASONING_MESSAGE_START, messageId: 'r', role: 'reasoning' },
      { type: E.REASONING_MESSAGE_CONTENT, messageId: 'r', delta: 'thinking' },
      {
        type: E.TOOL_CALL_START,
        toolCallId: 'c',
        toolCallName: 'search',
        parentMessageId: 'a',
        subagentRunId: 'child',
      },
      { type: E.TOOL_CALL_ARGS, toolCallId: 'c', delta: '{' },
      {
        type: E.TOOL_CALL_RESULT,
        toolCallId: 'c',
        messageId: 'result',
        content: 'ok',
        subagentRunId: 'executor',
      },
      {
        type: E.ACTIVITY_SNAPSHOT,
        replace: true,
        messageId: 'activity',
        activityType: 'progress',
        content: { n: 1 },
      },
      {
        type: E.ACTIVITY_DELTA,
        messageId: 'activity',
        activityType: 'progress',
        patch: [{ op: 'replace', path: '/n', value: 2 }],
      },
      {
        type: E.REASONING_ENCRYPTED_VALUE,
        subtype: 'tool-call',
        entityId: 'c',
        encryptedValue: 'opaque',
      },
      {
        type: E.STATE_SNAPSHOT,
        snapshot: { count: 1 },
        subagentRunId: 'child',
      },
      {
        type: E.STATE_DELTA,
        delta: [{ op: 'replace', path: '/count', value: 2 }],
        subagentRunId: 'other',
      },
      {
        type: E.SUBAGENT_FINISHED,
        subagentRunId: 'child',
        result: { ok: true },
      },
    ];
    const old = value;
    for (const event of events) value = applyObservation(value, event);
    expect(value.transcript.map((m) => m.id)).toEqual([
      'a',
      'result',
      'r',
      'activity',
    ]);
    expect(value.transcript[0]).toMatchObject({
      content: 'hello',
      toolCalls: [{ function: { arguments: '{' }, encryptedValue: 'opaque' }],
    });
    expect(value.state).toEqual({ count: 2 });
    expect(value.subagents[0].terminal).toMatchObject({ result: { ok: true } });
    expect(value.status).toBe('running');
    expect(value.run).toBe(old.run);
    expect(old.transcript).toEqual([]);
    const next = applyObservation(value, {
      type: E.TEXT_MESSAGE_CONTENT,
      messageId: 'a',
      delta: '!',
    });
    expect(next.transcript[1]).toBe(value.transcript[1]);
    expect(next.subagents).toBe(value.subagents);
    expect(next.state).toBe(value.state);
    expect(
      applyObservation(next, { type: E.TEXT_MESSAGE_END, messageId: 'a' })
    ).toBe(next);
  });
  it.each([
    {
      type: E.RUN_FINISHED,
      threadId: 'thread',
      runId: 'run',
      result: { answer: [1] },
      outcome: {
        type: 'interrupt',
        interrupts: [{ id: 'i', reason: 'approve', metadata: { x: 1 } }],
      },
      timestamp: 1,
      metadata: { m: [1] },
    },
    {
      type: E.RUN_ERROR,
      message: 'bad',
      code: 'E',
      timestamp: 2,
      metadata: { m: [2] },
    },
    {
      type: E.CUSTOM,
      name: 'on_interrupt',
      value: '[{"id":"literal"}]',
      timestamp: 3,
      metadata: { m: [3] },
    },
  ] satisfies AGUIEvent[])(
    'owns selected root terminal fields without settling $type',
    (event) => {
      const previous = running();
      const value = applyObservation(
        previous,
        {
          ...event,
          rawEvent: new Error('raw'),
          extension: () => undefined,
        } as AGUIEvent,
        'legacy-observation'
      );
      expect(value.run?.terminal).toEqual(event);
      expect(value.run?.terminal).not.toBe(event);
      expect(value.run?.outcome).toBeUndefined();
      expect(value.status).toBe('running');
      expect(value.transcript).toBe(previous.transcript);
      expect(Object.isFrozen(value.run?.terminal?.metadata?.['m'])).toBe(true);
    }
  );
  it('does not retain unselected observations or child interrupts', () => {
    const previous = running();
    for (const event of [
      { type: E.RAW, event: {} },
      { type: E.STEP_STARTED, stepName: 'step' },
      { type: E.STEP_FINISHED, stepName: 'step' },
      { type: E.REASONING_START, messageId: 'r' },
      { type: E.REASONING_END, messageId: 'r' },
      { type: E.CUSTOM, name: 'other', value: {} },
      { type: E.CUSTOM, name: 'on_interrupt', value: {}, subagentRunId: '' },
    ] satisfies AGUIEvent[])
      expect(applyObservation(previous, event)).toBe(previous);
  });
  const duplicateCalls: Message[] = ['a', 'b'].map((id) => ({
    id,
    role: 'assistant',
    toolCalls: [
      {
        id: 'c',
        type: 'function',
        function: { name: 'f', arguments: 'invalid literal' },
      },
    ],
  }));
  it.each([
    [
      { id: 'a', role: 'user', content: 'a' },
      { id: 'a', role: 'assistant' },
    ] as Message[],
    duplicateCalls,
  ])(
    'rejects ambiguous initial and snapshot identities atomically',
    (...messages) => {
      expect(() => initialObservation(messages)).toThrow(/Duplicate/);
      const previous = running();
      expect(() =>
        applyObservation(previous, { type: E.MESSAGES_SNAPSHOT, messages })
      ).toThrow(/Duplicate/);
      expect(previous.transcript).toEqual([]);
    }
  );
  it('rejects invalid state patches and nonportable terminal payload atomically', () => {
    const previous = running();
    expect(() =>
      applyObservation(previous, {
        type: E.STATE_DELTA,
        delta: [{ op: 'remove', path: '/missing' }],
      })
    ).toThrow();
    expect(() =>
      applyObservation(previous, {
        type: E.RUN_FINISHED,
        threadId: 'thread',
        runId: 'run',
        result: new Date(),
      })
    ).toThrow();
    expect(previous.state).toEqual({});
    expect(previous.run?.terminal).toBeUndefined();
  });
});
