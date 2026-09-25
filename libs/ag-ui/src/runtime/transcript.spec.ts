import { describe, expect, it } from 'vitest';
import type { Message, RunAgentInput } from '@ag-ui/client';
import { ownTranscript, requestMessages, type Transcript } from './transcript';

function richMessages() {
  return [
    { id: 'system', role: 'system', content: 'system', name: 'policy' },
    { id: 'developer', role: 'developer', content: 'developer' },
    {
      id: 'user',
      role: 'user',
      subagentRunId: '',
      content: [
        { type: 'text', text: 'look' },
        {
          type: 'image',
          source: { type: 'data', value: 'aW1hZ2U=', mimeType: 'image/png' },
          metadata: { nested: [null, { label: 'image' }] },
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
          id: 'file',
          filename: 'file.bin',
        },
      ],
    },
    {
      id: 'assistant',
      role: 'assistant',
      subagentRunId: 'child',
      encryptedValue: 'opaque-message',
      content: undefined,
      metadata: {
        nested: [{ label: 'original', nullable: null, optional: undefined }],
      },
      toolCalls: [
        {
          id: 'call',
          type: 'function',
          function: { name: 'weather', arguments: '{  "city": "Paris" }' },
          encryptedValue: 'opaque-call',
          metadata: { nested: ['call'] },
        },
      ],
    },
    {
      id: 'result',
      role: 'tool',
      toolCallId: 'call',
      content: 'result',
      error: 'provider-error',
      encryptedValue: 'opaque-result',
      metadata: { nested: [null] },
    },
    {
      id: 'reasoning',
      role: 'reasoning',
      content: 'reasoning',
      encryptedValue: 'opaque-reasoning',
    },
    {
      id: 'activity',
      role: 'activity',
      activityType: 'progress',
      content: { steps: [{ label: 'working' }] },
    },
  ] satisfies Message[];
}

function expectFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectFrozen(child);
}

describe('private transcript ownership', () => {
  it.each([
    ['filter', 'payload'],
    ['constructor', null],
    ['constructor', 1],
  ])('selects messages without interpreting own %s payload', (key, value) => {
    const source = richMessages();
    Object.defineProperty(source, key as string, { value, enumerable: true });
    const output = requestMessages(ownTranscript(source));
    expect(output).toStrictEqual(
      richMessages().filter((message) => message.role !== 'activity')
    );
    expect(Object.hasOwn(output, key as string)).toBe(false);
  });

  it('skips top-level holes while retaining explicit undefined admission failure', () => {
    const source = new Array<Message>(3);
    source[1] = { id: 'user', role: 'user', content: 'hello' };
    expect(requestMessages(ownTranscript(source))).toEqual([source[1]]);
    const invalid = [undefined] as unknown as Message[];
    expect(() => requestMessages(ownTranscript(invalid))).toThrow(TypeError);
  });

  it('owns all roles and fields without aliasing caller data', () => {
    const source = richMessages();
    const expected = structuredClone(source);
    const owned = ownTranscript(source);
    expect(owned).toStrictEqual(expected);
    expectFrozen(owned);
    const assistant = source.find((message) => message.role === 'assistant');
    if (!assistant) throw new Error('fixture assistant missing');
    assistant.metadata.nested[0].label = 'changed';
    assistant.toolCalls[0].function.arguments = '{}';
    source.reverse();
    expect(owned).toStrictEqual(expected);
  });

  it('detaches even externally frozen parents with mutable children', () => {
    const nested = { value: 'before' };
    const source = Object.freeze([
      {
        id: 'user',
        role: 'user',
        content: 'hello',
        metadata: { nested },
      } satisfies Message,
    ]);
    Object.freeze(source[0]);
    const owned = ownTranscript(source);
    expect(Object.isFrozen(nested)).toBe(false);
    nested.value = 'after';
    expect(owned[0].metadata).toEqual({ nested: { value: 'before' } });
    expectFrozen(owned);
  });

  it('returns independent mutable requests with exact protocol data', () => {
    const source = richMessages();
    const owned = ownTranscript(source);
    const first = requestMessages(owned);
    const second = requestMessages(owned);
    const expected = structuredClone(
      source.filter((message) => message.role !== 'activity')
    );
    expect(first).toStrictEqual(expected);
    expect(second).toStrictEqual(expected);
    const assistant = first.find((message) => message.role === 'assistant');
    if (!assistant?.toolCalls || !assistant.metadata)
      throw new Error('fixture missing');
    expect(assistant.toolCalls[0].function.arguments).toBe(
      '{  "city": "Paris" }'
    );
    assistant.toolCalls[0].function.arguments = 'mutable';
    assistant.metadata.nested[0].label = 'mutable';
    first.reverse();
    expect(second).toStrictEqual(expected);
    expect(owned).toStrictEqual(source);
  });

  it('removes only activity and top-level null child tags', () => {
    const source = [
      {
        id: 'absent',
        role: 'developer',
        content: 'keep',
        metadata: { subagentRunId: null },
      },
      { id: 'empty', role: 'reasoning', content: 'keep', subagentRunId: '' },
      { id: 'null', role: 'assistant', subagentRunId: null },
      { id: 'undefined', role: 'assistant', subagentRunId: undefined },
      { id: 'child', role: 'assistant', subagentRunId: 'child' },
      {
        id: 'activity',
        role: 'activity',
        activityType: 'progress',
        content: {},
      },
    ] as unknown as Message[]; // SDK event schemas reject local null tags.
    const owned = ownTranscript(source);
    expect(requestMessages(owned)).toStrictEqual([
      source[0],
      source[1],
      { id: 'null', role: 'assistant' },
      source[3],
      source[4],
    ]);
    expect(owned).toStrictEqual(source);
  });

  it('captures repeatedly without changing older snapshots or trusting them by identity', () => {
    const source = richMessages();
    const first = ownTranscript(source);
    const again = ownTranscript(first);
    source[0].content = 'later';
    const later = ownTranscript(source);
    expect(again).toStrictEqual(first);
    expect(again).not.toBe(first);
    expect(again[0]).not.toBe(first[0]);
    expect(first[0].content).toBe('system');
    expect(later[0].content).toBe('later');
  });

  it('supports empty and activity-only inputs', () => {
    const empty = ownTranscript([]);
    expectFrozen(empty);
    expect(requestMessages(empty)).toEqual([]);
    expect(requestMessages(empty)).not.toBe(requestMessages(empty));
    const activity = ownTranscript([richMessages()[6]]);
    expect(requestMessages(activity)).toEqual([]);
    expect(activity).toHaveLength(1);
  });

  it('preserves null prototypes, dangerous own keys and optional undefined', () => {
    const data = Object.create(null);
    Object.defineProperties(data, {
      constructor: { value: { name: 'data' }, enumerable: true },
      optional: { value: undefined, enumerable: true },
    });
    Object.defineProperty(data, '__proto__', {
      value: { polluted: true },
      enumerable: true,
    });
    const source = [
      {
        id: 'user',
        role: 'user',
        content: 'hello',
        metadata: data,
      } satisfies Message,
    ];
    const owned = ownTranscript(source);
    const output = requestMessages(owned)[0].metadata;
    expect(Object.getPrototypeOf(owned[0].metadata)).toBe(null);
    expect(Object.getPrototypeOf(output)).toBe(null);
    expect(Object.keys(output ?? {})).toEqual([
      'constructor',
      'optional',
      '__proto__',
    ]);
    expect(output?.['__proto__']).toEqual({ polluted: true });
    expect(output?.constructor).toEqual({ name: 'data' });
    expect(Object.prototype).not.toHaveProperty('polluted');
    expectFrozen(owned);
  });

  it('preserves sparse array shape and enumerable array extensions as data', () => {
    const data = new Array(3);
    data[1] = { value: undefined };
    Object.defineProperty(data, 'extra', {
      value: { label: 'extra' },
      enumerable: true,
    });
    Object.defineProperty(data, '__proto__', {
      value: { label: 'safe' },
      enumerable: true,
    });
    const source = [
      {
        id: 'user',
        role: 'user',
        content: 'hello',
        metadata: { data },
      } satisfies Message,
    ];
    const owned = ownTranscript(source);
    const output = requestMessages(owned)[0].metadata?.data;
    expect(output).toStrictEqual(data);
    expect(output).toHaveLength(3);
    expect(Object.keys(output)).toEqual(['1', 'extra', '__proto__']);
    expect(0 in output).toBe(false);
    expect(2 in output).toBe(false);
    expect(output.extra).not.toBe(
      Object.getOwnPropertyDescriptor(data, 'extra')?.value
    );
    expect(Object.getPrototypeOf(output)).toBe(Array.prototype);
    expectFrozen(owned);
  });

  it('accepts shared acyclic data and owns each occurrence', () => {
    const shared = { values: [1, null, undefined] };
    const source = [
      {
        id: 'user',
        role: 'user',
        content: '',
        metadata: { left: shared, right: shared },
      } satisfies Message,
    ];
    const owned = ownTranscript(source);
    const output = requestMessages(owned)[0].metadata;
    expect(output).toEqual({ left: shared, right: shared });
    expect(output?.left).not.toBe(shared);
    expect(output?.right).not.toBe(shared);
    expectFrozen(owned);
  });

  it.each([
    ['date', new Date()],
    ['map', new Map()],
    ['set', new Set()],
    ['typed array', new Uint8Array([1])],
    ['function', () => undefined],
    ['symbol', Symbol('data')],
    ['bigint', BigInt(1)],
    [
      'class',
      new (class Data {
        value = 1;
      })(),
    ],
  ])(
    'rejects nonportable %s without changing input or earlier snapshots',
    (_name, invalid) => {
      const earlier = ownTranscript(richMessages());
      const valid = { mutable: ['before'] };
      const source = [
        {
          id: 'user',
          role: 'user',
          content: '',
          metadata: { valid, invalid },
        } satisfies Message,
      ];
      expect(() => ownTranscript(source)).toThrow(TypeError);
      expect(Object.isFrozen(valid)).toBe(false);
      expect(Object.isFrozen(valid.mutable)).toBe(false);
      valid.mutable.push('after');
      expect(earlier).toStrictEqual(richMessages());
    }
  );

  it('rejects ancestor cycles but leaves caller data mutable', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const source = [
      {
        id: 'user',
        role: 'user',
        content: '',
        metadata: cyclic,
      } satisfies Message,
    ];
    expect(() => ownTranscript(source)).toThrow(TypeError);
    expect(Object.isFrozen(cyclic)).toBe(false);
    const array: unknown[] = [];
    array.push(array);
    source[0].metadata = { array };
    expect(() => ownTranscript(source)).toThrow(TypeError);
  });

  it('propagates accessor failures atomically and ignores nonenumerable fields', () => {
    const error = { opaque: 'getter failed' };
    const valid = { mutable: [] };
    const metadata = { valid };
    Object.defineProperty(metadata, 'hidden', {
      get: () => {
        throw error;
      },
    });
    const source = [
      { id: 'user', role: 'user', content: '', metadata } satisfies Message,
    ];
    expect(ownTranscript(source)[0].metadata).toEqual({ valid });
    Object.defineProperty(metadata, 'failure', {
      enumerable: true,
      get: () => {
        throw error;
      },
    });
    let caught: unknown;
    try {
      ownTranscript(source);
    } catch (failure) {
      caught = failure;
    }
    expect(caught).toBe(error);
    expect(Object.isFrozen(valid)).toBe(false);
    expect(Object.isFrozen(valid.mutable)).toBe(false);
  });

  it('owns unknown own fields without interpreting roles, required fields or arguments', () => {
    const extension = { nested: [null, undefined] };
    const source = [
      { role: 'future', extension },
      {
        id: 'duplicate',
        role: 'assistant',
        toolCalls: [{ function: { arguments: '{ unfinished' } }],
      },
      { id: 'duplicate' },
    ] as unknown as Message[];
    expect(requestMessages(ownTranscript(source))).toStrictEqual(source);
    expectFrozen(ownTranscript(source));
  });

  it('retains the display-only reconstruction negative control', () => {
    const source = richMessages();
    const displayOnly = source.map(({ id, role, content }) => ({
      id,
      role,
      content,
    }));
    expect(displayOnly).not.toStrictEqual(source);
    expect(requestMessages(ownTranscript(source))).toStrictEqual(
      source.filter((message) => message.role !== 'activity')
    );
  });
});

// Compile-only checks exercise SDK unknown/any metadata through core DeepReadonly.
function readonlyContract(transcript: Transcript) {
  // @ts-expect-error The transcript array is readonly.
  transcript.push({ id: 'new', role: 'user', content: '' });
  const message = transcript[0];
  // @ts-expect-error Message fields are readonly.
  message.content = 'changed';
  if (message.metadata) {
    // @ts-expect-error Metadata cannot be assigned through the readonly record.
    message.metadata['nested'] = {};
    const nested = message.metadata['nested'];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      // @ts-expect-error Nested metadata remains readonly.
      nested['value'] = 'changed';
    }
  }
  if (message.role === 'user' && typeof message.content !== 'string') {
    // @ts-expect-error Nested content is readonly.
    message.content[0].type = 'text';
  }
  const outgoing: RunAgentInput['messages'] = requestMessages(transcript);
  outgoing.push({ id: 'new', role: 'user', content: '' });
}
void readonlyContract;
