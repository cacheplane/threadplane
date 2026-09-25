import {
  EventType,
  type ActivitySnapshotEvent,
  type ActivityDeltaEvent,
} from '@ag-ui/client';
import { describe, expect, it } from 'vitest';
import { applyActivityMessage } from './activity-messages';
import { ownTranscript, type Transcript } from './transcript';

function snapshot(
  overrides: Record<string, unknown> = {}
): ActivitySnapshotEvent {
  // Omitted replace exercises the helper's default independently of SDK parsing.
  return {
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: 'a',
    activityType: 'new',
    content: { value: 2 },
    ...overrides,
  } as unknown as ActivitySnapshotEvent;
}
function delta(
  patch: unknown[] = [],
  overrides: Record<string, unknown> = {}
): ActivityDeltaEvent {
  return {
    type: EventType.ACTIVITY_DELTA,
    messageId: 'a',
    activityType: 'old',
    patch,
    ...overrides,
  };
}
const activity = {
  id: 'a',
  role: 'activity' as const,
  activityType: 'old',
  content: { value: 1 },
  subagentRunId: 'child',
  metadata: { keep: { old: true }, overwrite: { old: true } },
  opaque: { keep: true },
};
function seed(): Transcript {
  return ownTranscript([{ id: 'u', role: 'user', content: 'hello' }, activity]);
}
function frozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) frozen(child);
}
function unread(): never {
  throw new Error('ignored field was read');
}

describe('private activity observation', () => {
  it.each([undefined, true, false])(
    'creates an absent target with replace %s and owned content/metadata',
    (replace) => {
      const content = Object.freeze({ nested: { value: 2 } });
      const metadata = Object.freeze({ nested: { value: 3 } });
      const previous = ownTranscript([]);
      const next = applyActivityMessage(
        previous,
        snapshot({ replace, content, metadata, subagentRunId: '' })
      );
      content.nested.value = 99;
      metadata.nested.value = 99;
      expect(next).toStrictEqual([
        {
          id: 'a',
          role: 'activity',
          activityType: 'new',
          content: { nested: { value: 2 } },
          metadata: { nested: { value: 3 } },
          subagentRunId: '',
        },
      ]);
      expect(previous).toStrictEqual([]);
      frozen(next);
    }
  );

  it.each([undefined, true])(
    'replaces activity content/type with replace %s, merges metadata and retains opaque fields',
    (replace) => {
      const previous = seed();
      const next = applyActivityMessage(
        previous,
        snapshot({ replace, metadata: { overwrite: { new: true } } })
      );
      const expected = {
        ...activity,
        activityType: 'new',
        content: { value: 2 },
        metadata: { keep: { old: true }, overwrite: { new: true } },
      };
      Reflect.deleteProperty(expected, 'subagentRunId');
      expect(next[1]).toStrictEqual(expected);
    }
  );

  it.each([undefined, '', 'next-child'])(
    'replaces or clears attribution with %s',
    (subagentRunId) => {
      const previous = seed();
      const next = applyActivityMessage(previous, snapshot({ subagentRunId }));
      if (subagentRunId === undefined)
        expect(next[1]).not.toHaveProperty('subagentRunId');
      else expect(next[1].subagentRunId).toBe(subagentRunId);
      expect(next[0]).toBe(previous[0]);
      expect(next[1].metadata).toBe(previous[1].metadata);
      expect((next[1] as unknown as typeof activity).opaque).toBe(
        (previous[1] as unknown as typeof activity).opaque
      );
      expect(previous[1]).toStrictEqual(activity);
      frozen(next);
    }
  );

  it('replace false admits only owned shallow metadata and never reads ignored content/type/attribution', () => {
    const previous = seed();
    const metadata = { overwrite: { new: true } };
    const event = snapshot({ replace: false, metadata });
    Object.defineProperties(event, {
      content: { get: unread },
      activityType: { get: unread },
      subagentRunId: { get: unread },
    });
    const next = applyActivityMessage(previous, event);
    expect(next[1]).toStrictEqual({
      ...activity,
      metadata: { keep: { old: true }, overwrite: { new: true } },
    });
    expect(next[1].content).toBe(previous[1].content);
    expect(next[1].metadata?.['keep']).toBe(previous[1].metadata?.['keep']);
    metadata.overwrite.new = false;
    expect(next[1].metadata?.['overwrite']).toEqual({ new: true });
    frozen(next);
  });

  it('replace false without metadata preserves the exact transcript and ignores payload getters', () => {
    const previous = seed();
    const event = snapshot({ replace: false });
    Object.defineProperties(event, {
      content: { get: unread },
      activityType: { get: unread },
      subagentRunId: { get: unread },
    });
    expect(applyActivityMessage(previous, event)).toBe(previous);
  });

  it.each([undefined, true])(
    'replaces a nonactivity target in place with replace %s without transferring old data',
    (replace) => {
      const previous = ownTranscript([
        { id: 'u', role: 'user', content: 'keep' },
        {
          id: 'a',
          role: 'assistant',
          content: 'old',
          encryptedValue: 'secret',
          metadata: { old: true },
          subagentRunId: 'old',
        },
      ]);
      const next = applyActivityMessage(previous, snapshot({ replace }));
      expect(next).toStrictEqual([
        previous[0],
        {
          id: 'a',
          role: 'activity',
          activityType: 'new',
          content: { value: 2 },
        },
      ]);
      expect(next[0]).toBe(previous[0]);
      expect(previous[1]).toHaveProperty('encryptedValue', 'secret');
    }
  );

  it('ignores replace false nonactivity payload and metadata getters', () => {
    const previous = ownTranscript([{ id: 'a', role: 'user', content: 'old' }]);
    const event = snapshot({ replace: false });
    Object.defineProperties(event, {
      content: { get: unread },
      metadata: { get: unread },
      activityType: { get: unread },
    });
    expect(applyActivityMessage(previous, event)).toBe(previous);
  });

  it.each(['', '__proto__', 'constructor', '雪\u0000'])(
    'treats ID %s as opaque',
    (messageId) => {
      const first = applyActivityMessage(
        ownTranscript([]),
        snapshot({ messageId })
      );
      const next = applyActivityMessage(
        first,
        delta([{ op: 'replace', path: '/value', value: 4 }], { messageId })
      );
      expect(next[0]).toMatchObject({ id: messageId, content: { value: 4 } });
    }
  );

  it.each(['snapshot', 'delta'])(
    'rejects a duplicate selected ID before %s no-op and allows unrelated duplicates',
    (kind) => {
      const event =
        kind === 'snapshot' ? snapshot({ replace: false }) : delta();
      const duplicate = ownTranscript([
        { id: 'a', role: 'user', content: '' },
        { id: 'a', role: 'assistant' },
      ]);
      expect(() => applyActivityMessage(duplicate, event)).toThrow(TypeError);
      const unrelated = ownTranscript([
        { id: 'x', role: 'user', content: '' },
        { id: 'x', role: 'assistant' },
      ]);
      expect(() => applyActivityMessage(unrelated, event)).not.toThrow();
    }
  );

  it('owns portable null-prototype data, special keys, holes, undefined and array extensions', () => {
    const list = new Array(3);
    list[1] = undefined;
    Object.defineProperty(list, 'constructor', {
      value: { raw: true },
      enumerable: true,
    });
    const content = Object.assign(Object.create(null), { list });
    Object.defineProperty(content, '__proto__', {
      value: { data: true },
      enumerable: true,
    });
    const next = applyActivityMessage(ownTranscript([]), snapshot({ content }));
    const owned = next[0].content as unknown as typeof content;
    expect(Object.getPrototypeOf(owned)).toBeNull();
    expect(Object.hasOwn(owned, '__proto__')).toBe(true);
    expect(owned.__proto__).toEqual({ data: true });
    expect(Object.hasOwn(owned.list, 0)).toBe(false);
    expect(Object.hasOwn(owned.list, 1)).toBe(true);
    expect(owned.list.constructor).toEqual({ raw: true });
    list[1] = 'changed';
    expect(owned.list[1]).toBeUndefined();
    frozen(next);
  });

  it('reads each used snapshot field and nested getter once', () => {
    const values = {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: 'a',
      replace: true,
      activityType: 'new',
      content: {
        get value() {
          counts['nested'] = (counts['nested'] ?? 0) + 1;
          return 2;
        },
      },
      metadata: { value: 3 },
      subagentRunId: '',
    };
    const counts: Record<string, number> = {};
    const event = {};
    for (const [key, value] of Object.entries(values))
      Object.defineProperty(event, key, {
        get: () => {
          counts[key] = (counts[key] ?? 0) + 1;
          return value;
        },
      });
    const next = applyActivityMessage(
      ownTranscript([]),
      event as ActivitySnapshotEvent
    );
    expect(next[0]).toMatchObject({ content: { value: 2 } });
    expect(counts).toEqual({
      type: 1,
      messageId: 1,
      replace: 1,
      activityType: 1,
      content: 1,
      metadata: 1,
      subagentRunId: 1,
      nested: 1,
    });
  });

  it('retains special record and metadata keys as owned data properties', () => {
    const record = { ...activity };
    Object.defineProperty(record, '__proto__', {
      value: { retained: true },
      enumerable: true,
    });
    const metadata = Object.create(null);
    Object.defineProperty(metadata, '__proto__', {
      value: { incoming: true },
      enumerable: true,
    });
    metadata.constructor = { incoming: true };
    const previous = ownTranscript([record]);
    const next = applyActivityMessage(previous, snapshot({ metadata }));
    expect(Object.getPrototypeOf(next[0])).toBe(Object.prototype);
    expect(Object.hasOwn(next[0], '__proto__')).toBe(true);
    expect(Reflect.get(next[0], '__proto__')).toBe(
      Reflect.get(previous[0], '__proto__')
    );
    expect(Object.hasOwn(next[0].metadata ?? {}, '__proto__')).toBe(true);
    expect(next[0].metadata?.['__proto__']).toEqual({ incoming: true });
    expect(next[0].metadata?.['constructor']).toEqual({ incoming: true });
    metadata.__proto__.incoming = false;
    expect(next[0].metadata?.['__proto__']).toEqual({ incoming: true });
    frozen(next);
  });

  it('applies all six patch operations while retaining attribution and prior observations', () => {
    const previous = applyActivityMessage(
      seed(),
      snapshot({
        content: { list: [1, 2], a: { value: 1 } },
        subagentRunId: 'child',
      })
    );
    const next = applyActivityMessage(
      previous,
      delta(
        [
          { op: 'test', path: '/a/value', value: 1 },
          { op: 'replace', path: '/a/value', value: 2 },
          { op: 'add', path: '/list/-', value: 3 },
          { op: 'copy', from: '/a', path: '/copied' },
          { op: 'move', from: '/copied', path: '/moved' },
          { op: 'remove', path: '/list/0' },
        ],
        { activityType: 'patched', subagentRunId: 'ignored' }
      )
    );
    expect(next[1]).toMatchObject({
      content: { list: [2, 3], a: { value: 2 }, moved: { value: 2 } },
      activityType: 'patched',
      subagentRunId: 'child',
    });
    expect(previous[1].content).toEqual({ list: [1, 2], a: { value: 1 } });
    expect(next[0]).toBe(previous[0]);
    expect(next[1].metadata).toBe(previous[1].metadata);
    frozen(next);
  });

  it('captures root replacement data without interpreting portable shapes', () => {
    const value = { nested: { value: 2 }, optional: undefined };
    const previous = seed();
    const next = applyActivityMessage(
      previous,
      delta([{ op: 'replace', path: '', value }])
    );
    value.nested.value = 99;
    expect(next[1].content).toStrictEqual({
      nested: { value: 2 },
      optional: undefined,
    });
    frozen(next);
  });

  it('captures complete frozen patch parents with mutable descendants and each used delta field once', () => {
    const counts: Record<string, number> = {};
    const value = Object.create(null);
    const list = new Array(3);
    list[1] = { count: 2 };
    Object.defineProperty(list, 'extra', {
      value: { raw: true },
      enumerable: true,
    });
    value.list = list;
    Object.defineProperty(value, '__proto__', {
      value: { raw: true },
      enumerable: true,
    });
    Object.defineProperty(value, 'undefined', {
      get: () => {
        counts['nested'] = (counts['nested'] ?? 0) + 1;
        return undefined;
      },
      enumerable: true,
    });
    const patch = [Object.freeze({ op: 'replace', path: '', value })];
    Object.defineProperty(patch, 'extra', {
      get: () => {
        counts['patchExtension'] = (counts['patchExtension'] ?? 0) + 1;
        return { raw: true };
      },
      enumerable: true,
    });
    Object.freeze(patch);
    const metadata = Object.freeze({ nested: { raw: true } });
    const values = {
      type: EventType.ACTIVITY_DELTA,
      messageId: 'a',
      activityType: 'next',
      patch,
      metadata,
    };
    const event = {};
    for (const [key, captured] of Object.entries(values))
      Object.defineProperty(event, key, {
        get: () => {
          counts[key] = (counts[key] ?? 0) + 1;
          return captured;
        },
      });
    const previous = seed();
    const next = applyActivityMessage(previous, event as ActivityDeltaEvent);
    const content = next[1].content as unknown as typeof value;
    list[1].count = 99;
    metadata.nested.raw = false;
    expect(content.list[1]).toEqual({ count: 2 });
    expect(content.list.extra).toEqual({ raw: true });
    expect(Object.hasOwn(content.list, 0)).toBe(false);
    expect(Object.hasOwn(content, 'undefined')).toBe(true);
    expect(Object.getPrototypeOf(content)).toBeNull();
    expect(content.__proto__).toEqual({ raw: true });
    expect(next[1].metadata?.['nested']).toEqual({ raw: true });
    expect(counts).toEqual({
      type: 1,
      messageId: 1,
      activityType: 1,
      patch: 1,
      metadata: 1,
      nested: 1,
      patchExtension: 1,
    });
    expect(previous[1]).toStrictEqual(activity);
    frozen(next);
  });

  it.each([
    { patch: [] },
    { patch: [{ op: 'test', path: '/value', value: 1 }] },
  ])(
    'preserves no-op identity but permits a type change for patch %j',
    ({ patch }) => {
      const previous = seed();
      expect(applyActivityMessage(previous, delta(patch))).toBe(previous);
      const next = applyActivityMessage(
        previous,
        delta(patch, { activityType: 'changed' })
      );
      expect(next[1]).toMatchObject({ activityType: 'changed' });
      expect(next[1].content).toBe(previous[1].content);
    }
  );

  it('ignores missing and nonactivity delta targets without reading patch or metadata', () => {
    const previous = ownTranscript([{ id: 'a', role: 'assistant' }]);
    for (const messageId of ['a', 'absent']) {
      const event = delta([], { messageId });
      Object.defineProperties(event, {
        patch: { get: unread },
        metadata: { get: unread },
      });
      expect(applyActivityMessage(previous, event)).toBe(previous);
    }
  });

  it.each([undefined, { received: { badPatch: true } }])(
    'ignores an operational patch failure atomically while admitting metadata %j',
    (metadata) => {
      const previous = seed();
      const next = applyActivityMessage(
        previous,
        delta(
          [
            { op: 'replace', path: '/value', value: 2 },
            { op: 'replace', path: '/missing', value: 3 },
          ],
          { activityType: 'ignored', metadata }
        )
      );
      expect(next[1].content).toBe(previous[1].content);
      expect(next[1]).toMatchObject({
        activityType: 'old',
        subagentRunId: 'child',
      });
      if (!metadata) expect(next).toBe(previous);
      else {
        expect(next[1].metadata).toEqual({ ...activity.metadata, ...metadata });
        metadata.received.badPatch = false;
        expect(next[1].metadata?.['received']).toEqual({ badPatch: true });
      }
      expect(previous[1]).toStrictEqual(activity);
      frozen(next);
    }
  );

  it.each(['patch', 'metadata'])(
    'propagates nonportable %s capture errors instead of swallowing them as patch failures',
    (field) => {
      const previous = seed();
      const event = delta([{ op: 'replace', path: '/missing', value: 2 }], {
        metadata: { retained: true },
      });
      if (field === 'patch')
        event.patch.push({ op: 'add', path: '/ignored', value: new Date() });
      else event.metadata = { invalid: new Date() };
      expect(() => applyActivityMessage(previous, event)).toThrow(TypeError);
      expect(previous[1]).toStrictEqual(activity);
    }
  );

  it('reads complete patch and metadata once before the operational patch attempt', () => {
    let patchReads = 0;
    let metadataReads = 0;
    const event = delta();
    Object.defineProperties(event, {
      patch: {
        get: () => {
          patchReads++;
          return [{ op: 'replace', path: '/missing', value: 2 }];
        },
      },
      metadata: {
        get: () => {
          metadataReads++;
          throw new Error('metadata capture');
        },
      },
    });
    expect(() => applyActivityMessage(seed(), event)).toThrow(
      'metadata capture'
    );
    expect(patchReads).toBe(1);
    expect(metadataReads).toBe(1);
  });

  it('does not turn final ownership failure into a metadata-only result', () => {
    // Deliberately violates caller ownership to exercise the final capture boundary.
    const previous = [
      { ...activity, content: { value: 1, invalid: new Date() } },
    ] as unknown as Transcript;
    let latest = previous;
    expect(() => {
      latest = applyActivityMessage(
        previous,
        delta([{ op: 'replace', path: '/value', value: 2 }], {
          metadata: { received: true },
        })
      );
    }).toThrow(TypeError);
    expect(latest).toBe(previous);
    expect(previous[0].metadata).toBe(activity.metadata);
  });
});
