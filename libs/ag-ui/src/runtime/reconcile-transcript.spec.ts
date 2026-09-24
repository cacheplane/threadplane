import type { Message } from '@ag-ui/client';
import { describe, expect, it } from 'vitest';
import { reconcileTranscript } from './reconcile-transcript';
import { ownTranscript, type Transcript } from './transcript';

const reasoning = {
  id: 'reasoning',
  role: 'reasoning',
  content: 'thinking',
} satisfies Message;
const activity = {
  id: 'activity',
  role: 'activity',
  activityType: 'progress',
  content: { steps: ['working'] },
} satisfies Message;
const user = (id: string, content = id): Message => ({
  id,
  role: 'user',
  content,
});

function richMessages() {
  return [
    {
      id: 'system',
      role: 'system',
      content: 'policy',
      name: 'policy-name',
      metadata: { nested: [null] },
    },
    {
      id: 'developer',
      role: 'developer',
      content: 'developer',
      encryptedValue: 'developer-encrypted',
    },
    {
      id: 'user',
      role: 'user',
      subagentRunId: '',
      content: [
        { type: 'text', text: 'inspect' },
        {
          type: 'image',
          source: { type: 'data', value: 'aW1hZ2U=', mimeType: 'image/png' },
          metadata: { nested: [null] },
        },
        {
          type: 'audio',
          source: {
            type: 'url',
            value: 'https://example.test/audio',
            mimeType: 'audio/wav',
          },
        },
        {
          type: 'video',
          source: { type: 'data', value: 'dmlkZW8=', mimeType: 'video/mp4' },
        },
        {
          type: 'document',
          source: { type: 'url', value: 'https://example.test/document' },
        },
        {
          type: 'binary',
          data: 'YmluYXJ5',
          mimeType: 'application/octet-stream',
          filename: 'file.bin',
          id: 'file',
        },
      ],
    },
    {
      id: 'assistant',
      role: 'assistant',
      name: 'assistant-name',
      subagentRunId: 'child',
      encryptedValue: 'message-encrypted',
      metadata: { nested: [{ value: 'corrected', subagentRunId: null }] },
      toolCalls: [
        {
          id: 'call',
          type: 'function',
          function: { name: 'weather', arguments: '{  "city": "Paris" }\n' },
          encryptedValue: 'call-encrypted',
          metadata: { nested: [null, 'call'] },
        },
      ],
    },
    {
      id: 'tool',
      role: 'tool',
      toolCallId: 'call',
      content: 'result',
      error: 'provider error',
      encryptedValue: 'result-encrypted',
      metadata: { nested: [null] },
    },
    { ...reasoning, encryptedValue: 'reasoning-encrypted' },
    activity,
  ] satisfies Message[];
}

function expectFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectFrozen(child);
}

describe('private snapshot reconciliation', () => {
  it('retains old positions and omitted event-only references while replacing values', () => {
    const previous = ownTranscript([
      user('b', 'old b'),
      reasoning,
      user('a', 'old a'),
      activity,
    ]);
    const snapshot = [user('a', 'new a'), user('b', 'new b')];
    const result = reconcileTranscript(previous, snapshot);
    expect(result).toStrictEqual([
      snapshot[1],
      reasoning,
      snapshot[0],
      activity,
    ]);
    expect(result[0]).not.toBe(previous[0]);
    expect(result[0]).not.toBe(snapshot[1]);
    expect(result[1]).toBe(previous[1]);
    expect(result[3]).toBe(previous[3]);
    expectFrozen(result);
  });

  it('drops missing ordinary records and appends new IDs in snapshot order once', () => {
    const previous = ownTranscript([user('gone'), user('b'), reasoning]);
    const snapshot = [user('new-2'), user('b', 'corrected'), user('new-1')];
    expect(reconcileTranscript(previous, snapshot)).toStrictEqual([
      snapshot[1],
      reasoning,
      snapshot[0],
      snapshot[2],
    ]);
  });

  it.each(['activity', 'reasoning'] as const)(
    'treats a supplied %s role as authoritative only for that role',
    (role) => {
      const previous = ownTranscript([reasoning, activity]);
      const incoming = {
        ...(role === 'activity' ? activity : reasoning),
        id: 'new',
      };
      const retained = role === 'activity' ? previous[0] : previous[1];
      const result = reconcileTranscript(previous, [incoming]);
      expect(result).toStrictEqual([retained, incoming]);
      expect(result[0]).toBe(retained);
    }
  );

  it('drops omitted old event-only records when both role sets are supplied', () => {
    const snapshot = [
      { ...activity, id: 'new-activity' },
      { ...reasoning, id: 'new-reasoning' },
    ];
    expect(
      reconcileTranscript(ownTranscript([reasoning, activity]), snapshot)
    ).toStrictEqual(snapshot);
  });

  it('keeps only event-only roles for an empty snapshot and reuses stable retained-only results', () => {
    const previous = ownTranscript([user('gone'), reasoning, activity]);
    const result = reconcileTranscript(previous, []);
    expect(result).toStrictEqual([reasoning, activity]);
    expect(result).not.toBe(previous);
    expect(result[0]).toBe(previous[1]);
    expect(result[1]).toBe(previous[2]);
    expect(reconcileTranscript(result, [])).toBe(result);
    const empty = ownTranscript([]);
    expect(reconcileTranscript(empty, [])).toBe(empty);
  });

  it('preserves all seven rich roles and exact corrected argument bytes as complete replacement data', () => {
    const snapshot = richMessages();
    const previous = ownTranscript(
      snapshot.map((message) =>
        message.role === 'assistant'
          ? {
              ...message,
              metadata: { obsolete: { keep: false } },
              toolCalls: [
                {
                  ...message.toolCalls[0],
                  function: { name: 'weather', arguments: '{"city":' },
                  obsolete: true,
                },
              ],
            }
          : message
      )
    );
    const result = reconcileTranscript(previous, snapshot);
    expect(result).toStrictEqual(snapshot);
    const assistant = result.find((message) => message.role === 'assistant');
    expect(assistant?.toolCalls?.[0].function.arguments).toBe(
      '{  "city": "Paris" }\n'
    );
    expect(assistant?.metadata).not.toHaveProperty('obsolete');
    expect(assistant?.toolCalls?.[0]).not.toHaveProperty('obsolete');
    expectFrozen(result);
    expect(
      previous.find((message) => message.role === 'assistant')?.toolCalls?.[0]
        .function.arguments
    ).toBe('{"city":');
  });

  it('lets same-ID replacement win over event-only retention, including role changes', () => {
    const previous = ownTranscript([reasoning, activity, user('user')]);
    const snapshot = [
      user('reasoning', 'now user'),
      { id: 'activity', role: 'assistant' },
      { ...reasoning, id: 'user' },
    ] satisfies Message[];
    expect(reconcileTranscript(previous, snapshot)).toStrictEqual(snapshot);
  });

  it('does not merge omitted top-level or nested fields back into replacements', () => {
    const previous = ownTranscript([
      {
        id: 'a',
        role: 'assistant',
        content: 'old',
        encryptedValue: 'old',
        metadata: { keep: true, nested: { old: true } },
        toolCalls: [
          {
            id: 'call',
            type: 'function',
            function: { name: 'old', arguments: '{' },
          },
        ],
      },
    ]);
    const snapshot = [
      { id: 'a', role: 'assistant', metadata: { nested: {} } },
    ] satisfies Message[];
    expect(reconcileTranscript(previous, snapshot)).toStrictEqual(snapshot);
  });

  it('preserves null, empty and nested attribution in the transcript', () => {
    const snapshot = [
      {
        id: 'null',
        role: 'assistant',
        subagentRunId: null,
        metadata: { subagentRunId: null },
      },
      {
        id: 'empty',
        role: 'assistant',
        subagentRunId: '',
        metadata: { nested: { subagentRunId: '' } },
      },
    ] as unknown as Message[];
    expect(reconcileTranscript(ownTranscript([]), snapshot)).toStrictEqual(
      snapshot
    );
  });

  it.each(['previous', 'snapshot'] as const)(
    'rejects duplicate IDs in %s without exposing payload data',
    (side) => {
      const duplicates = [
        user('secret-id', 'secret-content'),
        { ...reasoning, id: 'secret-id' },
      ];
      const previous = ownTranscript(
        side === 'previous' ? duplicates : [reasoning]
      );
      const before = structuredClone(previous);
      const snapshot = side === 'snapshot' ? duplicates : [];
      expect(() => reconcileTranscript(previous, snapshot)).toThrow(TypeError);
      expect(() => reconcileTranscript(previous, snapshot)).toThrow(
        /^Duplicate message IDs in (previous transcript|snapshot)$/
      );
      expect(previous).toStrictEqual(before);
    }
  );

  it('handles special object-property IDs without collisions or inherited entries', () => {
    const previous = ownTranscript([
      user('__proto__'),
      user('constructor'),
      user('toString'),
    ]);
    const snapshot = [
      user('toString', 'new 3'),
      user('__proto__', 'new 1'),
      user('constructor', 'new 2'),
    ];
    expect(reconcileTranscript(previous, snapshot)).toStrictEqual([
      snapshot[1],
      snapshot[2],
      snapshot[0],
    ]);
  });

  it('detaches frozen snapshots and mutable nested caller data without freezing the caller', () => {
    const nested = { value: 'before' };
    const snapshot = Object.freeze([
      Object.freeze({
        id: 'user',
        role: 'user',
        content: 'hello',
        metadata: { nested },
      } satisfies Message),
    ]);
    const previous = ownTranscript([reasoning]);
    const result = reconcileTranscript(previous, snapshot);
    nested.value = 'after';
    expect(result).toStrictEqual([
      reasoning,
      { ...snapshot[0], metadata: { nested: { value: 'before' } } },
    ]);
    expect(Object.isFrozen(nested)).toBe(false);
    expectFrozen(result);
    expect(previous).toStrictEqual([reasoning]);
  });

  it('recaptures an owned snapshot without promising deep-equivalent reference reuse', () => {
    const previous = ownTranscript([user('a')]);
    const result = reconcileTranscript(previous, previous);
    expect(result).toStrictEqual(previous);
    expect(result).not.toBe(previous);
    expect(result[0]).not.toBe(previous[0]);
  });

  it.each([
    ['date', new Date()],
    ['map', new Map()],
    ['set', new Set()],
    ['typed array', new Uint8Array([1])],
  ])('rejects unsupported %s atomically', (_name, invalid) => {
    const previous = ownTranscript([reasoning, activity]);
    let current: Transcript = previous;
    const nested = { mutable: [] };
    expect(() => {
      current = reconcileTranscript(previous, [
        { ...user('a'), metadata: { nested, invalid } },
      ]);
    }).toThrow(TypeError);
    expect(current).toBe(previous);
    expect(previous).toStrictEqual([reasoning, activity]);
    expect(Object.isFrozen(nested)).toBe(false);
  });

  it('rejects cycles atomically and propagates throwing getters before inspecting previous IDs', () => {
    const previous = ownTranscript([reasoning, activity]);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      reconcileTranscript(previous, [{ ...user('a'), metadata: cyclic }])
    ).toThrow(TypeError);
    const failure = new Error('capture failed');
    const metadata = Object.defineProperty({}, 'failure', {
      enumerable: true,
      get: () => {
        throw failure;
      },
    });
    expect(() =>
      reconcileTranscript(previous, [{ ...user('a'), metadata }])
    ).toThrow(failure);
    // Capture must precede even duplicate-ID rejection in the owned previous input.
    const duplicates = ownTranscript([reasoning, reasoning]);
    expect(() =>
      reconcileTranscript(duplicates, [{ ...user('a'), metadata }])
    ).toThrow(failure);
    expect(previous).toStrictEqual([reasoning, activity]);
    expect(Object.isFrozen(cyclic)).toBe(false);
  });

  it('keeps independent negative controls for replacement, keep-old merge and role-first retention', () => {
    const oldAssistant = {
      id: 'assistant',
      role: 'assistant',
      toolCalls: [
        {
          id: 'call',
          type: 'function',
          function: { name: 'weather', arguments: '{"city":' },
        },
      ],
    } satisfies Message;
    const corrected = {
      ...oldAssistant,
      toolCalls: [
        {
          ...oldAssistant.toolCalls[0],
          function: { name: 'weather', arguments: '{ "city": "Paris" }' },
        },
      ],
    };
    const previous = ownTranscript([oldAssistant, reasoning, activity]);
    const snapshot = [corrected];
    const replacement = ownTranscript(snapshot);
    expect(replacement.map((message) => message.role)).not.toContain(
      'reasoning'
    );
    expect(replacement.map((message) => message.role)).not.toContain(
      'activity'
    );
    const keepOld = [
      ...previous,
      ...snapshot.filter(
        (incoming) => !previous.some((old) => old.id === incoming.id)
      ),
    ];
    expect(keepOld[0]).toEqual(oldAssistant);
    expect(keepOld[0]).not.toEqual(corrected);
    const changedRole = user('reasoning', 'corrected role');
    const roleFirst = previous
      .map((old) =>
        old.role === 'reasoning' || old.role === 'activity'
          ? old
          : [changedRole].find((incoming) => incoming.id === old.id)
      )
      .filter(Boolean);
    expect(roleFirst).toContain(previous[1]);
    expect(roleFirst).not.toContainEqual(changedRole);
    expect(reconcileTranscript(previous, snapshot)).toStrictEqual([
      corrected,
      reasoning,
      activity,
    ]);
    expect(
      reconcileTranscript(ownTranscript([reasoning]), [changedRole])
    ).toStrictEqual([changedRole]);
  });
});
