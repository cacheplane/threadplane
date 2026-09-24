import { EventType, type Message } from '@ag-ui/client';
import { describe, expect, it } from 'vitest';
import { applyTextMessage, type TextMessageEvent } from './text-messages';
import { ownTranscript } from './transcript';

const families = [
  {
    role: 'assistant',
    start: EventType.TEXT_MESSAGE_START,
    content: EventType.TEXT_MESSAGE_CONTENT,
    end: EventType.TEXT_MESSAGE_END,
  },
  {
    role: 'reasoning',
    start: EventType.REASONING_MESSAGE_START,
    content: EventType.REASONING_MESSAGE_CONTENT,
    end: EventType.REASONING_MESSAGE_END,
  },
] as const;

function expectFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectFrozen(child);
}

describe('private text and reasoning accumulation', () => {
  it.each(['developer', 'system', 'assistant', 'user'] as const)(
    'creates and appends exact content for the %s text role',
    (role) => {
      const previous = ownTranscript([]);
      const started = applyTextMessage(previous, {
        type: EventType.TEXT_MESSAGE_START,
        messageId: role,
        role,
        name: 'speaker',
      });
      expect(started).toStrictEqual([
        { id: role, role, content: '', name: 'speaker' },
      ]);
      const content = applyTextMessage(started, {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: role,
        delta: ' \n café 🧭\t',
      });
      expect(content[0].content).toBe(' \n café 🧭\t');
      expect(started[0].content).toBe('');
      expect(previous).toEqual([]);
      expectFrozen(content);
    }
  );

  it('defaults an omitted text role and ignores event-only data', () => {
    const event = {
      type: EventType.TEXT_MESSAGE_START,
      messageId: 'a',
      timestamp: 123,
      get rawEvent() {
        throw new Error('rawEvent must not be read');
      },
    } as TextMessageEvent;
    expect(applyTextMessage(ownTranscript([]), event)).toStrictEqual([
      { id: 'a', role: 'assistant', content: '' },
    ]);
  });

  it('interleaves text and reasoning while preserving all old observations', () => {
    const user = ownTranscript([
      { id: 'u', role: 'user', content: 'question' },
    ]);
    const text = applyTextMessage(user, {
      type: EventType.TEXT_MESSAGE_START,
      messageId: 'a',
      role: 'assistant',
    });
    const reasoning = applyTextMessage(text, {
      type: EventType.REASONING_MESSAGE_START,
      messageId: 'r',
      role: 'reasoning',
    });
    const thought = applyTextMessage(reasoning, {
      type: EventType.REASONING_MESSAGE_CONTENT,
      messageId: 'r',
      delta: '考える\n',
    });
    const answer = applyTextMessage(thought, {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'a',
      delta: ' yes ',
    });
    const final = applyTextMessage(answer, {
      type: EventType.REASONING_MESSAGE_CONTENT,
      messageId: 'r',
      delta: '🧠',
    });
    expect(final.map((message) => message.content)).toEqual([
      'question',
      ' yes ',
      '考える\n🧠',
    ]);
    expect(reasoning.map((message) => message.content)).toEqual([
      'question',
      '',
      '',
    ]);
    expect(thought[2].content).toBe('考える\n');
    expect(final[0]).toBe(user[0]);
    expect(final[1]).toBe(answer[1]);
    expect(answer[2]).toBe(thought[2]);
    expectFrozen(final);
  });

  it.each(families)(
    'merges $role metadata at every stage, including empty content',
    (family) => {
      const previous = ownTranscript([]);
      const start: TextMessageEvent = {
        type: family.start,
        role: family.role,
        messageId: 'm',
        metadata: { keep: 1, replace: { old: true } },
      } as TextMessageEvent;
      const started = applyTextMessage(previous, start);
      expect(started[0].metadata).toEqual(start.metadata);
      const repeat = applyTextMessage(started, {
        ...start,
        metadata: { replace: { start: true } },
      });
      const content = applyTextMessage(repeat, {
        type: family.content,
        messageId: 'm',
        delta: 'text',
        metadata: { replace: { content: true }, content: 2 },
      });
      const empty = applyTextMessage(content, {
        type: family.content,
        messageId: 'm',
        delta: '',
        metadata: { replace: { empty: true }, empty: 3 },
      });
      expect(empty[0].content).toBe('text');
      expect(empty[0].metadata).toEqual({
        keep: 1,
        replace: { empty: true },
        content: 2,
        empty: 3,
      });
      const ended = applyTextMessage(empty, {
        type: family.end,
        messageId: 'm',
        metadata: { replace: { end: true } },
      });
      expect(ended[0].metadata).toEqual({
        keep: 1,
        replace: { end: true },
        content: 2,
        empty: 3,
      });
      expect(ended[0].content).toBe('text');
      expect(started[0].metadata).toEqual({ keep: 1, replace: { old: true } });
      expectFrozen(ended);
    }
  );

  it.each(families)(
    'keeps stable $role no-ops and permits a supplied empty metadata update',
    (family) => {
      const previous = ownTranscript([
        { id: 'm', role: family.role, content: 'keep' },
      ]);
      const start = {
        type: family.start,
        role: family.role,
        messageId: 'm',
      } as TextMessageEvent;
      const content = {
        type: family.content,
        messageId: 'm',
        delta: '',
      } as TextMessageEvent;
      const end = { type: family.end, messageId: 'm' } as TextMessageEvent;
      for (const event of [start, start, content, end, end]) {
        expect(applyTextMessage(previous, event)).toBe(previous);
      }
      expect(
        applyTextMessage(previous, { ...content, metadata: {} })[0]
      ).toStrictEqual({
        ...previous[0],
        metadata: {},
      });
    }
  );

  it('preserves opaque tool fields, name, content and attribution on later events', () => {
    const source = {
      id: 'm',
      role: 'assistant',
      name: 'original',
      content: 'before',
      subagentRunId: 'original-child',
      encryptedValue: 'opaque',
      toolCalls: [
        {
          id: 'call',
          type: 'function',
          function: { name: 'tool', arguments: '{  "x":' },
          encryptedValue: 'call-opaque',
          metadata: { keep: [1] },
        },
      ],
      metadata: { old: true },
    } satisfies Message;
    const previous = ownTranscript([source]);
    const repeated = applyTextMessage(previous, {
      type: EventType.TEXT_MESSAGE_START,
      role: 'assistant',
      messageId: 'm',
      name: 'replacement',
      subagentRunId: 'other-child',
      metadata: { start: true },
    });
    const content = applyTextMessage(repeated, {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'm',
      delta: ' after',
      subagentRunId: '',
      metadata: { content: true },
    });
    const ended = applyTextMessage(content, {
      type: EventType.TEXT_MESSAGE_END,
      messageId: 'm',
      subagentRunId: 'other',
      metadata: { end: true },
    });
    expect(ended[0]).toStrictEqual({
      ...source,
      content: 'before after',
      metadata: { old: true, start: true, content: true, end: true },
    });
    expect(previous).toStrictEqual([source]);
    expectFrozen(ended);
  });

  it.each(families)(
    'treats undefined $role content as empty for a nonempty append',
    (family) => {
      // Local captured records can predate content even though the SDK requires
      // reasoning content in wire snapshots; this helper defines that fallback.
      const previous = ownTranscript([
        { id: 'm', role: family.role },
      ] as Message[]);
      const next = applyTextMessage(previous, {
        type: family.content,
        messageId: 'm',
        delta: 'first',
      });
      expect(next[0].content).toBe('first');
      expect(previous[0]).not.toHaveProperty('content');
      expect(
        applyTextMessage(previous, {
          type: family.content,
          messageId: 'm',
          delta: '',
        })
      ).toBe(previous);
    }
  );

  it.each(families)(
    'captures $role creation attribution, including empty strings',
    (family) => {
      for (const subagentRunId of [undefined, null, '', 'child']) {
        const event = {
          type: family.start,
          role: family.role,
          messageId: 'm',
          subagentRunId,
        } as TextMessageEvent;
        const result = applyTextMessage(ownTranscript([]), event);
        if (typeof subagentRunId === 'string')
          expect(result[0].subagentRunId).toBe(subagentRunId);
        else expect(result[0]).not.toHaveProperty('subagentRunId');
      }
    }
  );

  it.each(['__proto__', 'constructor', 'toString', ''])(
    'uses %s as an ordinary ID',
    (messageId) => {
      const start = applyTextMessage(ownTranscript([]), {
        type: EventType.TEXT_MESSAGE_START,
        role: 'assistant',
        messageId,
      });
      const result = applyTextMessage(start, {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: 'ok',
      });
      expect(result).toStrictEqual([
        { id: messageId, role: 'assistant', content: 'ok' },
      ]);
    }
  );

  it.each(families)(
    'fails atomically for missing or duplicate $role targets',
    (family) => {
      const single = {
        id: 'm',
        role: family.role,
        content: 'keep',
      } satisfies Message;
      const previous = ownTranscript([single]);
      for (const type of [family.content, family.end]) {
        expect(() =>
          applyTextMessage(previous, {
            type,
            messageId: 'secret-missing',
            delta: 'secret-delta',
          } as TextMessageEvent)
        ).toThrow(TypeError);
      }
      const duplicate = ownTranscript([single, single]);
      for (const type of [family.start, family.content, family.end]) {
        expect(() =>
          applyTextMessage(duplicate, {
            type,
            role: family.role,
            messageId: 'm',
            delta: 'secret-delta',
          } as TextMessageEvent)
        ).toThrow(TypeError);
      }
      expect(previous).toStrictEqual([single]);
      expect(duplicate).toStrictEqual([single, single]);
    }
  );

  it('checks only target uniqueness; full transcript admission belongs to the caller', () => {
    const previous = ownTranscript([
      { id: 'unrelated', role: 'user', content: 'one' },
      { id: 'unrelated', role: 'user', content: 'two' },
      { id: 'm', role: 'assistant', content: 'yes' },
    ]);
    const next = applyTextMessage(previous, {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'm',
      delta: '!',
    });
    expect(next[2].content).toBe('yes!');
    expect(next[0]).toBe(previous[0]);
    expect(next[1]).toBe(previous[1]);
  });

  it('rejects incompatible roles at START, CONTENT and END without exposing payloads', () => {
    const records: Message[] = [
      { id: 'secret-id', role: 'user', content: 'keep' },
      { id: 'secret-id', role: 'reasoning', content: 'keep' },
      { id: 'secret-id', role: 'tool', toolCallId: 'call', content: 'keep' },
      { id: 'secret-id', role: 'activity', activityType: 'test', content: {} },
    ];
    for (const record of records) {
      for (const family of families) {
        for (const type of [family.start, family.content, family.end]) {
          if (
            record.role === family.role ||
            (record.role === 'user' &&
              family.role === 'assistant' &&
              type !== family.start)
          )
            continue;
          const previous = ownTranscript([record]);
          let failure: unknown;
          try {
            applyTextMessage(previous, {
              type,
              role: family.role,
              messageId: 'secret-id',
              delta: 'secret-delta',
              metadata: { secret: 'secret-metadata' },
            } as TextMessageEvent);
          } catch (error) {
            failure = error;
          }
          expect(failure).toBeInstanceOf(TypeError);
          expect(String(failure)).not.toMatch(/secret/);
          expect(previous).toStrictEqual([record]);
        }
      }
    }
  });

  it('rejects content appended to multimodal data, even an empty delta', () => {
    const source = {
      id: 'm',
      role: 'user',
      content: [{ type: 'text', text: 'keep image caption' }],
    } satisfies Message;
    const previous = ownTranscript([source]);
    for (const delta of ['', 'append']) {
      expect(() =>
        applyTextMessage(previous, {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'm',
          delta,
        })
      ).toThrow(TypeError);
    }
    expect(previous).toStrictEqual([source]);
  });

  it('captures incoming metadata despite frozen external parents and later caller mutation', () => {
    const nested = { values: ['before'] };
    const metadata = Object.freeze({ nested });
    const event = Object.freeze({
      type: EventType.TEXT_MESSAGE_START,
      role: 'assistant',
      messageId: 'm',
      metadata,
    } as const);
    const next = applyTextMessage(ownTranscript([]), event);
    nested.values.push('later');
    expect(next[0].metadata).toStrictEqual({ nested: { values: ['before'] } });
    expect(next[0].metadata).not.toBe(metadata);
    expectFrozen(next);
    expect(Object.isFrozen(nested)).toBe(false);
  });

  it('rejects unsupported incoming metadata before shallow spreading can hide it', () => {
    class Metadata {
      keep = true;
    }
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const failure = new Error('getter failure');
    const getter = {
      get value(): never {
        throw failure;
      },
    };
    const invalid = [
      new Date(),
      new Metadata(),
      { cycle },
      { fn: () => undefined },
      getter,
    ];
    const previous = ownTranscript([
      {
        id: 'm',
        role: 'assistant',
        content: 'keep',
        metadata: { original: true },
      },
    ]);
    for (const metadata of invalid) {
      for (const type of [
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
      ] as const) {
        expect(() =>
          applyTextMessage(previous, {
            type,
            role: 'assistant',
            messageId: 'm',
            delta: 'new',
            metadata,
          } as TextMessageEvent)
        ).toThrow();
      }
      expect(() =>
        applyTextMessage(ownTranscript([]), {
          type: EventType.TEXT_MESSAGE_START,
          role: 'assistant',
          messageId: 'new',
          metadata,
        } as TextMessageEvent)
      ).toThrow();
    }
    expect(previous).toStrictEqual([
      {
        id: 'm',
        role: 'assistant',
        content: 'keep',
        metadata: { original: true },
      },
    ]);
  });

  it('captures each needed event field once and never reads irrelevant fields', () => {
    const reads: Record<string, number> = {};
    const values = {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'm',
      delta: '!',
      metadata: { incoming: true },
    };
    const event = Object.fromEntries(
      Object.keys(values).map((key) => [key, undefined])
    );
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
    const result = applyTextMessage(
      ownTranscript([{ id: 'm', role: 'assistant', content: 'yes' }]),
      event as TextMessageEvent
    );
    expect(result[0].content).toBe('yes!');
    expect(reads).toEqual({ type: 1, messageId: 1, delta: 1, metadata: 1 });
  });
});

describe('retained negative controls', () => {
  it('a naive mutable append rewrites an earlier observation', () => {
    const messages = [{ id: 'm', role: 'assistant', content: 'before' }];
    const observation = [...messages];
    messages[0].content += ' after';
    expect(observation[0].content).not.toBe('before');
    expect(observation[0].content).toBe('before after');
  });

  it('a content-only reducer loses an empty-delta metadata event', () => {
    const previous = ownTranscript([
      { id: 'm', role: 'assistant', content: 'text', metadata: { keep: true } },
    ]);
    const event = {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'm',
      delta: '',
      metadata: { arrived: true },
    } as const;
    const contentOnly = event.delta
      ? [{ ...previous[0], content: previous[0].content + event.delta }]
      : previous;
    expect(contentOnly[0].metadata).not.toHaveProperty('arrived');
    expect(applyTextMessage(previous, event)[0].metadata).toEqual({
      keep: true,
      arrived: true,
    });
  });
});
