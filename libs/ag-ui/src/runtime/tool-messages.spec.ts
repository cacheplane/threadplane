import { EventType, type Message } from '@ag-ui/client';
import { describe, expect, it } from 'vitest';
import { applyToolMessage, type ToolMessageEvent } from './tool-messages';
import { ownTranscript, requestMessages, type Transcript } from './transcript';

const start = (
  toolCallId = 'c',
  parentMessageId?: string
): ToolMessageEvent => ({
  type: EventType.TOOL_CALL_START,
  toolCallId,
  toolCallName: 'weather',
  ...(parentMessageId !== undefined && { parentMessageId }),
});
const args = (delta: string, toolCallId = 'c'): ToolMessageEvent => ({
  type: EventType.TOOL_CALL_ARGS,
  toolCallId,
  delta,
});
const end = (toolCallId = 'c'): ToolMessageEvent => ({
  type: EventType.TOOL_CALL_END,
  toolCallId,
});
const result = (
  messageId = 'r',
  toolCallId = 'c',
  content = 'raw'
): ToolMessageEvent => ({
  type: EventType.TOOL_CALL_RESULT,
  messageId,
  toolCallId,
  content,
});
const call = (id = 'c', arguments_ = '') => ({
  id,
  type: 'function' as const,
  function: { name: 'weather', arguments: arguments_ },
});
function calls(transcript: Transcript, index = 0) {
  const owner = transcript[index];
  if (owner.role !== 'assistant' || !owner.toolCalls)
    throw new Error('Expected assistant tool calls');
  return owner.toolCalls;
}
function frozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) frozen(child);
}

describe('private raw tool observation', () => {
  it('creates an owner without invented content and reuses an existing assistant', () => {
    expect(applyToolMessage(ownTranscript([]), start())).toStrictEqual([
      { id: 'c', role: 'assistant', toolCalls: [call()] },
    ]);
    const previous = ownTranscript([
      {
        id: 'a',
        role: 'assistant',
        content: 'keep',
        metadata: { parent: true },
      },
    ]);
    const next = applyToolMessage(previous, {
      ...start('c', 'a'),
      metadata: { tool: true },
    });
    expect(next).toStrictEqual([
      { ...previous[0], toolCalls: [{ ...call(), metadata: { tool: true } }] },
    ]);
    expect(previous[0]).not.toHaveProperty('toolCalls');
    frozen(next);
  });

  it('retains exact partial and invalid JSON while interleaving calls and old observations', () => {
    const seed = ownTranscript([
      { id: 'u', role: 'user', content: 'question' },
    ]);
    const first = applyToolMessage(seed, start('c', 'a'));
    const partial = applyToolMessage(first, args('{  "city":'));
    const parallel = applyToolMessage(partial, start('c2', 'a'));
    const second = applyToolMessage(parallel, args('not-json\t', 'c2'));
    const final = applyToolMessage(second, args(' "Paris" }\n'));
    expect(calls(final, 1).map((c) => c.function.arguments)).toEqual([
      '{  "city": "Paris" }\n',
      'not-json\t',
    ]);
    expect(calls(partial, 1)[0].function.arguments).toBe('{  "city":');
    expect(calls(first, 1)[0].function.arguments).toBe('');
    expect(calls(final, 1)[1]).toBe(calls(second, 1)[1]);
    expect(final[0]).toBe(seed[0]);
    expect(seed).toHaveLength(1);
    frozen(final);
  });

  it('shallow merges START, empty ARGS and END metadata without replacing function data', () => {
    const previous = ownTranscript([
      {
        id: 'a',
        role: 'assistant',
        toolCalls: [
          {
            ...call('c', 'raw'),
            function: { ...call().function, arguments: 'raw', opaque: [1] },
            encryptedValue: 'secret',
          },
        ],
      },
    ] as unknown as Message[]);
    let next = previous;
    for (const [index, event] of [start('c', 'a'), args(''), end()].entries()) {
      next = applyToolMessage(next, {
        ...event,
        metadata: { [`stage${index}`]: true, nested: { index } },
      });
      expect(calls(next)[0].function).toBe(calls(previous)[0].function);
    }
    expect(calls(next)[0].metadata).toStrictEqual({
      stage0: true,
      stage1: true,
      stage2: true,
      nested: { index: 2 },
    });
    expect(calls(next)[0].encryptedValue).toBe('secret');
    const appended = applyToolMessage(next, args('!'));
    expect(calls(appended)[0].function).toStrictEqual({
      name: 'weather',
      arguments: 'raw!',
      opaque: [1],
    });
    for (const event of [start('c', 'a'), args(''), end()])
      expect(applyToolMessage(next, event)).toBe(next);
  });

  it('inserts results before trailing text in arrival order and replays in place', () => {
    const previous = ownTranscript([
      { id: 'a', role: 'assistant', toolCalls: [call(), call('c2')] },
      { id: 'other', role: 'tool', toolCallId: 'unrelated', content: 'keep' },
      { id: 'text', role: 'assistant', content: 'after' },
    ]);
    const first = applyToolMessage(previous, result('r2', 'c2'));
    const second = applyToolMessage(first, result());
    const replay = applyToolMessage(second, result('r2', 'c2', 'replacement'));
    const distinct = applyToolMessage(replay, result('r3'));
    expect(distinct.map((m) => m.id)).toEqual([
      'a',
      'other',
      'r2',
      'r',
      'r3',
      'text',
    ]);
    expect(replay[2].content).toBe('replacement');
    expect(first[2].content).toBe('raw');
    expect(replay[0]).toBe(previous[0]);
    expect(replay[4]).toBe(previous[2]);
    expect(applyToolMessage(replay, result('r2', 'c2', 'replacement'))).toBe(
      replay
    );
    expect(
      applyToolMessage(previous, result('orphan', 'missing')).at(-1)
    ).toStrictEqual({
      id: 'orphan',
      role: 'tool',
      toolCallId: 'missing',
      content: 'raw',
    });
    frozen(distinct);
  });

  it('preserves result attribution and opaque data on replacement', () => {
    const previous = ownTranscript([
      {
        id: 'r',
        role: 'tool',
        toolCallId: 'c',
        content: 'old',
        name: 'original',
        subagentRunId: 'child',
        encryptedValue: 'opaque',
        error: 'opaque-error',
        metadata: { keep: [1], replace: { old: true } },
      },
    ] as unknown as Message[]);
    const next = applyToolMessage(previous, {
      ...result(),
      subagentRunId: 'new-child',
      metadata: { replace: { new: true } },
    });
    expect(next[0]).toStrictEqual({
      ...previous[0],
      content: 'raw',
      metadata: { keep: [1], replace: { new: true } },
    });
    expect(next[0].metadata?.keep).toBe(previous[0].metadata?.keep);
  });

  it.each(['', '__proto__', 'constructor', 'toString'])(
    'treats %s IDs and empty child attribution as opaque',
    (id) => {
      const started = applyToolMessage(ownTranscript([]), {
        ...start(id, id),
        subagentRunId: '',
      });
      expect(started[0].id).toBe(id);
      expect(started[0].subagentRunId).toBe('');
      expect(calls(started)[0].id).toBe(id);
      const observed = applyToolMessage(started, {
        ...result('result', id),
        subagentRunId: '',
      });
      expect(observed[1].subagentRunId).toBe('');
    }
  );

  it('rejects changed START names and explicit parents, including an empty parent, atomically', () => {
    const previous = ownTranscript([
      { id: 'a', role: 'assistant', toolCalls: [call('c', 'retained')] },
    ]);
    for (const event of [
      { ...start('c', 'a'), toolCallName: 'changed' },
      start('c', 'other'),
      start('c', ''),
    ]) {
      expect(() => applyToolMessage(previous, event)).toThrow(TypeError);
    }
    expect(applyToolMessage(previous, start())).toBe(previous);
    expect(calls(previous)[0].function.arguments).toBe('retained');
  });

  it('rejects missing calls, nonassistant parents and incompatible result targets without payload dumps', () => {
    const previous = ownTranscript([
      { id: 'secret-id', role: 'user', content: 'secret-content' },
      { id: 'r', role: 'tool', toolCallId: 'other', content: 'keep' },
    ]);
    for (const event of [
      args('secret-delta'),
      end(),
      start('c', 'secret-id'),
      result('secret-id'),
      result('r'),
    ]) {
      let failure: unknown;
      try {
        applyToolMessage(previous, event);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(TypeError);
      expect(String(failure)).not.toMatch(/secret/);
    }
    expect(previous[0].content).toBe('secret-content');
  });

  it('checks all selected ambiguities even for no-ops, without validating unrelated history', () => {
    const owner = { id: 'a', role: 'assistant' as const, toolCalls: [call()] };
    const histories: Message[][] = [
      [{ ...owner, toolCalls: [call(), call()] }],
      [owner, { ...owner, id: 'b' }],
      [owner, { id: 'a', role: 'user', content: 'collision' }],
      [owner, owner],
    ];
    for (const history of histories)
      for (const event of [start(), args(''), end(), result()]) {
        expect(() => applyToolMessage(ownTranscript(history), event)).toThrow(
          TypeError
        );
      }
    const duplicateResults = ownTranscript([
      owner,
      { id: 'r', role: 'tool', toolCallId: 'c', content: 'raw' },
      { id: 'r', role: 'tool', toolCallId: 'c', content: 'raw' },
    ]);
    expect(() => applyToolMessage(duplicateResults, result())).toThrow(
      TypeError
    );
    const duplicateParents = ownTranscript([
      { id: 'a', role: 'assistant' },
      { id: 'a', role: 'assistant' },
    ]);
    expect(() => applyToolMessage(duplicateParents, start('c', 'a'))).toThrow(
      TypeError
    );
    const unrelated = ownTranscript([
      owner,
      { id: 'other', role: 'user', content: 'one' },
      { id: 'other', role: 'user', content: 'two' },
    ]);
    expect(applyToolMessage(unrelated, end())).toBe(unrelated);
  });

  it('owns incoming metadata below frozen parents and produces independent mutable request graphs', () => {
    const nested = { values: ['before'] };
    const metadata = Object.freeze({ nested });
    const started = applyToolMessage(ownTranscript([]), {
      ...start(),
      metadata,
    });
    const observed = applyToolMessage(started, { ...result(), metadata });
    nested.values.push('later');
    expect(calls(observed)[0].metadata).toStrictEqual({
      nested: { values: ['before'] },
    });
    expect(observed[1].metadata).toStrictEqual({
      nested: { values: ['before'] },
    });
    const outgoing = requestMessages(observed);
    const again = requestMessages(observed);
    (outgoing[1].metadata?.nested as { values: string[] }).values.push(
      'outgoing'
    );
    expect(again[1].metadata).toStrictEqual({ nested: { values: ['before'] } });
    expect(observed[1].metadata).toStrictEqual(again[1].metadata);
    frozen(observed);
    expect(Object.isFrozen(nested)).toBe(false);
  });

  it('preserves special keys, undefined, sparse array extensions and null prototypes', () => {
    const array = new Array(3);
    array[1] = undefined;
    Object.defineProperty(array, 'extra', {
      value: { keep: true },
      enumerable: true,
    });
    const payload = Object.assign(Object.create(null), {
      array,
      undefined: undefined,
    });
    Object.defineProperty(payload, '__proto__', {
      value: { safe: true },
      enumerable: true,
    });
    const metadata = { payload, constructor: 'data' };
    Object.defineProperty(metadata, '__proto__', {
      value: { key: true },
      enumerable: true,
    });
    const next = applyToolMessage(ownTranscript([]), { ...start(), metadata });
    const owned = calls(next)[0].metadata;
    if (!owned) throw new Error('Expected metadata');
    expect(Object.hasOwn(owned, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(owned.payload)).toBe(null);
    const ownedPayload = owned.payload as typeof payload;
    expect(Object.hasOwn(ownedPayload, 'undefined')).toBe(true);
    expect(Object.hasOwn(ownedPayload.array, 0)).toBe(false);
    expect(Object.hasOwn(ownedPayload.array, 1)).toBe(true);
    expect(ownedPayload.array.extra).toEqual({ keep: true });
    expect(ownedPayload.__proto__).toEqual({ safe: true });
    frozen(next);
  });

  it('rejects unsupported metadata atomically at every stage before publishing any data', () => {
    class Metadata {
      value = true;
    }
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const failure = new Error('getter failure');
    const invalid = [
      new Metadata(),
      { fn: () => undefined },
      { symbol: Symbol('x') },
      cycle,
      {
        get value(): never {
          throw failure;
        },
      },
    ];
    const previous = ownTranscript([
      { id: 'c', role: 'assistant', toolCalls: [call('c', 'keep')] },
    ]);
    for (const metadata of invalid)
      for (const event of [start(), args('new'), end(), result()]) {
        expect(() =>
          applyToolMessage(previous, { ...event, metadata })
        ).toThrow();
        expect(calls(previous)[0].function.arguments).toBe('keep');
        expect(previous).toHaveLength(1);
      }
    expect(() =>
      applyToolMessage(ownTranscript([]), {
        ...start(),
        metadata: new Metadata(),
      })
    ).toThrow(TypeError);
  });

  it.each([start('c', 'a'), args('!'), end(), result()])(
    'reads selected event fields once for $type and ignores unrelated fields',
    (template) => {
      const values = { ...template, metadata: { nested: true } };
      const reads: Record<string, number> = {};
      const event = {};
      for (const [key, value] of Object.entries(values))
        Object.defineProperty(event, key, {
          get() {
            reads[key] = (reads[key] ?? 0) + 1;
            return value;
          },
        });
      Object.defineProperty(event, 'rawEvent', {
        get() {
          throw new Error('irrelevant');
        },
      });
      if (
        template.type !== EventType.TOOL_CALL_START &&
        template.type !== EventType.TOOL_CALL_RESULT
      )
        Object.defineProperty(event, 'subagentRunId', {
          get() {
            throw new Error('irrelevant attribution');
          },
        });
      const previous = ownTranscript([
        { id: 'a', role: 'assistant', toolCalls: [call()] },
      ]);
      applyToolMessage(previous, event as ToolMessageEvent);
      expect(reads).toEqual(
        Object.fromEntries(Object.keys(values).map((key) => [key, 1]))
      );
    }
  );
});
