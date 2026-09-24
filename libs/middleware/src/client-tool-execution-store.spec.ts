import { describe, expect, it } from 'vitest';
import { createInMemoryClientToolExecutionStore } from './langgraph/client-tool-execution-store';
import type { ClientToolExecutionRecord, ClientToolResult } from './langgraph/client-tool-execution-store';

const key = { threadId: 'thread-1', toolCallId: 'call-1' };
const result: ClientToolResult = { ok: true, value: { temp: 72 } };

describe('createInMemoryClientToolExecutionStore', () => {
  it('keeps distinct thread and call tuples independent even with embedded separators', async () => {
    const store = createInMemoryClientToolExecutionStore();
    const first = { threadId: 'a\0b', toolCallId: 'c' };
    const second = { threadId: 'a', toolCallId: 'b\0c' };

    await expect(store.claim(first)).resolves.toBe('claimed');
    await expect(store.claim(second)).resolves.toBe('claimed');
    await store.record(first, { ok: true, value: 'first' });
    await store.record(second, { ok: true, value: 'second' });

    for (const [identity, value] of [[first, 'first'], [second, 'second']] as const) {
      const saved = { status: 'done', result: { ok: true, value } };
      await expect(store.claim(identity)).resolves.toEqual(saved);
      await expect(store.lookup(identity.threadId, [identity.toolCallId])).resolves.toEqual({
        [identity.toolCallId]: saved,
      });
    }
  });

  it('does not reuse a completed result from a different separator-containing tuple', async () => {
    const store = createInMemoryClientToolExecutionStore();
    await store.record({ threadId: 'a\0b', toolCallId: 'c' }, result);
    await expect(store.claim({ threadId: 'a', toolCallId: 'b\0c' })).resolves.toBe('claimed');
  });

  it('preserves empty, escaped and Unicode string identities', async () => {
    const store = createInMemoryClientToolExecutionStore();
    const tuples = [['', ''], ['', '\0'], ['\0', ''], ['a"', 'b\\'], ['a', '"b\\'], ['雪', '😀']] as const;
    for (const [threadId, toolCallId] of tuples) {
      await expect(store.claim({ threadId, toolCallId })).resolves.toBe('claimed');
    }
    for (const [threadId, toolCallId] of tuples) {
      await expect(store.claim({ threadId, toolCallId })).resolves.toEqual({ status: 'executing' });
    }
  });

  it('returns special call IDs as detached enumerable own lookup entries', async () => {
    const store = createInMemoryClientToolExecutionStore();
    const ids = ['__proto__', 'constructor', 'toString', 'ordinary'];
    for (const toolCallId of ids) await store.record({ threadId: 'thread-1', toolCallId }, result);

    const found = await store.lookup('thread-1', [...ids, 'missing']);
    const expected = Object.fromEntries(ids.map(id => [id, { status: 'done', result }]));
    expect(Object.getPrototypeOf(found)).toBe(Object.prototype);
    expect(Object.keys(found)).toEqual(ids);
    for (const id of ids) expect(Object.hasOwn(found, id)).toBe(true);
    expect(Object.hasOwn(found, 'missing')).toBe(false);
    expect(JSON.parse(JSON.stringify(found))).toEqual(expected);
    found['__proto__'].status = 'failed';
    await expect(store.lookup('thread-1', ['__proto__'])).resolves.toEqual({
      ['__proto__']: { status: 'done', result },
    });
  });

  it('claims a new tool-call execution', async () => {
    const store = createInMemoryClientToolExecutionStore();

    await expect(store.claim(key)).resolves.toBe('claimed');
  });

  it('returns executing for a second claim before a result is recorded', async () => {
    const store = createInMemoryClientToolExecutionStore();

    await store.claim(key);

    await expect(store.claim(key)).resolves.toEqual({ status: 'executing' });
  });

  it('returns the stored done result after record', async () => {
    const store = createInMemoryClientToolExecutionStore();

    await store.claim(key);
    await store.record(key, result);

    await expect(store.claim(key)).resolves.toEqual({ status: 'done', result });
  });

  it('looks up only requested known records', async () => {
    const store = createInMemoryClientToolExecutionStore();
    await store.claim(key);
    await store.record(key, result);
    await store.claim({ threadId: 'thread-1', toolCallId: 'call-2' });

    await expect(store.lookup('thread-1', ['call-1', 'missing'])).resolves.toEqual({
      'call-1': { status: 'done', result },
    });
  });

  it('does not expose mutable internal records through lookup', async () => {
    const store = createInMemoryClientToolExecutionStore();
    await store.claim(key);
    await store.record(key, result);

    const first = await store.lookup('thread-1', ['call-1']);
    (first['call-1'] as ClientToolExecutionRecord).status = 'failed';

    await expect(store.lookup('thread-1', ['call-1'])).resolves.toEqual({
      'call-1': { status: 'done', result },
    });
  });
});
