import {
  EventType,
  type Message,
  type ReasoningEncryptedValueEvent,
} from '@ag-ui/client';
import { describe, expect, it } from 'vitest';
import { applyEncryptedValue } from './encrypted-messages';
import { ownTranscript, requestMessages, type Transcript } from './transcript';

const encrypted = (
  subtype: 'message' | 'tool-call' = 'message',
  entityId = 'a',
  encryptedValue = '雪\u0000+/=\nnot-json'
): ReasoningEncryptedValueEvent => ({
  type: EventType.REASONING_ENCRYPTED_VALUE,
  subtype,
  entityId,
  encryptedValue,
});
const call = (id = 'c') => ({
  id,
  type: 'function' as const,
  function: { name: 'tool', arguments: '{ raw ' },
  metadata: { nested: { keep: true } },
});
function calls(transcript: Transcript) {
  const owner = transcript[0];
  if (owner.role !== 'assistant' || !owner.toolCalls)
    throw new Error('Expected calls');
  return owner.toolCalls;
}
function frozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) frozen(child);
}

describe('private opaque encrypted value observation', () => {
  it.each([
    'user',
    'assistant',
    'tool',
    'system',
    'developer',
    'reasoning',
  ] as const)('updates only encryptedValue on %s messages', (role) => {
    const message = {
      id: 'a',
      role,
      content: 'raw data',
      ...(role === 'tool' && { toolCallId: 'c' }),
      metadata: { nested: { keep: true } },
      subagentRunId: 'child',
      opaque: { keep: true },
    };
    const previous = ownTranscript([
      message as Message,
      { id: 'u', role: 'user', content: 'other' },
    ]);
    const event = encrypted();
    Object.defineProperties(event, {
      metadata: {
        get: () => {
          throw new Error('metadata must remain unread');
        },
      },
      subagentRunId: {
        get: () => {
          throw new Error('attribution must remain unread');
        },
      },
    });
    const next = applyEncryptedValue(previous, event);
    expect(next).toStrictEqual([
      { ...message, encryptedValue: '雪\u0000+/=\nnot-json' },
      previous[1],
    ]);
    expect(next[0].metadata).toBe(previous[0].metadata);
    expect(next[1]).toBe(previous[1]);
    expect(previous[0]).not.toHaveProperty('encryptedValue');
    frozen(next);
  });

  it('changes only the selected call and necessary shells, preserving function, metadata and other references', () => {
    const previous = ownTranscript([
      {
        id: 'a',
        role: 'assistant',
        content: 'keep',
        subagentRunId: 'child',
        metadata: { owner: true },
        toolCalls: [call(), call('other')],
      },
      { id: 'u', role: 'user', content: 'other' },
    ]);
    const next = applyEncryptedValue(previous, encrypted('tool-call', 'c', ''));
    expect(calls(next)[0]).toStrictEqual({ ...call(), encryptedValue: '' });
    expect(calls(next)[0].function).toBe(calls(previous)[0].function);
    expect(calls(next)[0].metadata).toBe(calls(previous)[0].metadata);
    expect(calls(next)[1]).toBe(calls(previous)[1]);
    expect(calls(next)).not.toBe(calls(previous));
    expect(next[0]).not.toBe(previous[0]);
    expect(next[0].metadata).toBe(previous[0].metadata);
    expect(next[0].subagentRunId).toBe('child');
    expect(next[1]).toBe(previous[1]);
    expect(calls(previous)[0]).not.toHaveProperty('encryptedValue');
    frozen(next);
  });

  it.each(['message', 'tool-call'] as const)(
    'reads used %s event fields once and leaves event metadata/attribution unread',
    (subtype) => {
      const counts: Record<string, number> = {};
      const event = encrypted(subtype, 'a', '');
      for (const key of ['subtype', 'entityId', 'encryptedValue'] as const) {
        const value = event[key];
        Object.defineProperty(event, key, {
          get: () => {
            counts[key] = (counts[key] ?? 0) + 1;
            return value;
          },
        });
      }
      for (const key of ['metadata', 'subagentRunId'])
        Object.defineProperty(event, key, {
          get: () => {
            throw new Error('unused');
          },
        });
      const previous = ownTranscript([
        { id: 'a', role: 'assistant', toolCalls: [call('a')] },
      ]);
      const next = applyEncryptedValue(previous, event);
      expect(next).not.toBe(previous);
      expect(counts).toEqual({ subtype: 1, entityId: 1, encryptedValue: 1 });
    }
  );

  it.each(['', '__proto__', 'constructor', '雪\u0000'])(
    'selects opaque message and call ID %s',
    (id) => {
      const previous = ownTranscript([
        { id, role: 'assistant', toolCalls: [call(id)] },
      ]);
      const message = applyEncryptedValue(
        previous,
        encrypted('message', id, '')
      );
      expect(message[0]).toHaveProperty('encryptedValue', '');
      expect(
        calls(applyEncryptedValue(message, encrypted('tool-call', id)))[0]
      ).toHaveProperty('encryptedValue', '雪\u0000+/=\nnot-json');
    }
  );

  it('preserves exact identity for missing, activity and equal targets', () => {
    const previous = ownTranscript([
      {
        id: 'a',
        role: 'assistant',
        encryptedValue: '',
        toolCalls: [{ ...call(), encryptedValue: '' }],
      },
      { id: 'activity', role: 'activity', activityType: 'status', content: {} },
    ]);
    for (const event of [
      encrypted('message', 'missing'),
      encrypted('tool-call', 'missing'),
      encrypted('message', 'activity'),
      encrypted('message', 'a', ''),
      encrypted('tool-call', 'c', ''),
    ])
      expect(applyEncryptedValue(previous, event)).toBe(previous);
  });

  it.each(['user', 'activity'] as const)(
    'rejects duplicate selected message IDs even for a %s no-op',
    (role) => {
      const previous = ownTranscript([
        { id: 'a', role: 'assistant', encryptedValue: '' },
        role === 'activity'
          ? { id: 'a', role, activityType: 'status', content: {} }
          : { id: 'a', role, content: '' },
      ]);
      expect(() =>
        applyEncryptedValue(previous, encrypted('message', 'a', ''))
      ).toThrow(TypeError);
    }
  );

  it.each(['same-owner', 'different-owner', 'owner-id'])(
    'rejects ambiguous %s call targets before equal-value no-op',
    (kind) => {
      const selected = { ...call(), encryptedValue: '' };
      const messages: Message[] = [
        {
          id: 'a',
          role: 'assistant',
          toolCalls: [selected, ...(kind === 'same-owner' ? [selected] : [])],
        },
      ];
      if (kind === 'different-owner')
        messages.push({ id: 'b', role: 'assistant', toolCalls: [selected] });
      if (kind === 'owner-id')
        messages.push({ id: 'a', role: 'user', content: '' });
      expect(() =>
        applyEncryptedValue(
          ownTranscript(messages),
          encrypted('tool-call', 'c', '')
        )
      ).toThrow(TypeError);
    }
  );

  it('does not validate unrelated duplicate history', () => {
    const previous = ownTranscript([
      { id: 'x', role: 'assistant', toolCalls: [call('other'), call('other')] },
      { id: 'x', role: 'user', content: '' },
      { id: 'a', role: 'assistant', toolCalls: [call()] },
    ]);
    expect(
      applyEncryptedValue(previous, encrypted('message', 'a'))[2]
    ).toHaveProperty('encryptedValue', '雪\u0000+/=\nnot-json');
    expect(
      applyEncryptedValue(previous, encrypted('tool-call', 'c'))[2]
    ).not.toBe(previous[2]);
  });

  it('prepares fresh mutable request messages preserving encrypted bytes and excluding activity', () => {
    const seed = ownTranscript([
      { id: 'a', role: 'assistant', toolCalls: [call()] },
      { id: 'activity', role: 'activity', activityType: 'status', content: {} },
    ]);
    const message = applyEncryptedValue(seed, encrypted());
    const observed = applyEncryptedValue(
      message,
      encrypted('tool-call', 'c', 'opaque-call')
    );
    const outgoing = requestMessages(observed);
    expect(outgoing).toStrictEqual([
      {
        id: 'a',
        role: 'assistant',
        encryptedValue: '雪\u0000+/=\nnot-json',
        toolCalls: [{ ...call(), encryptedValue: 'opaque-call' }],
      },
    ]);
    if (outgoing[0].role !== 'assistant' || !outgoing[0].toolCalls)
      throw new Error('Expected calls');
    outgoing[0].encryptedValue = 'mutated';
    outgoing[0].toolCalls[0].encryptedValue = 'mutated';
    outgoing[0].toolCalls[0].function.arguments = 'mutated';
    expect(observed[0]).toHaveProperty(
      'encryptedValue',
      '雪\u0000+/=\nnot-json'
    );
    expect(calls(observed)[0]).toMatchObject({
      encryptedValue: 'opaque-call',
      function: { arguments: '{ raw ' },
    });
    expect(message[0]).not.toBe(observed[0]);
    expect(seed[0]).not.toHaveProperty('encryptedValue');
  });
});
