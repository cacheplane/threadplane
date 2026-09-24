import { describe, expect, it } from 'vitest';
import { createInMemoryClientToolExecutionStore } from './langgraph/client-tool-execution-store';

const key = { threadId: 'thread-1', toolCallId: 'call-1' };
const invocation = 'opaque invocation';
const result = '{"ok":true,"value":{"temp":72}}';

describe('createInMemoryClientToolExecutionStore', () => {
  it('grants one owner under contention and no authority to observers', async () => {
    const store = createInMemoryClientToolExecutionStore();
    const acquisitions = await Promise.all(
      Array.from({ length: 20 }, () => store.acquire(key, invocation))
    );
    const owners = acquisitions.filter((a) => a.status === 'acquired');
    expect(owners).toHaveLength(1);
    expect(owners[0].token.length).toBeGreaterThan(20);
    expect(acquisitions.filter((a) => a.status === 'unavailable')).toHaveLength(
      19
    );
    await expect(store.acquire(key, 'different')).resolves.toEqual({
      status: 'conflict',
    });
  });
  it('only the original owner can settle; observers cannot replace the completed effect', async () => {
    const store = createInMemoryClientToolExecutionStore();
    await expect(
      store.settle(key, { invocation, token: 'forged', result })
    ).resolves.toBe('rejected');
    const owner = await store.acquire(key, invocation);
    expect(owner.status).toBe('acquired');
    if (owner.status !== 'acquired') throw new Error('No owner');
    await expect(
      store.settle(key, { invocation, token: 'forged', result })
    ).resolves.toBe('rejected');
    await expect(
      store.settle(key, { invocation: 'other', token: owner.token, result })
    ).resolves.toBe('rejected');
    await expect(
      store.settle(key, { invocation, token: owner.token, result })
    ).resolves.toBe('accepted');
    await expect(
      store.settle(key, { invocation, token: owner.token, result })
    ).resolves.toBe('accepted');
    await expect(
      store.settle(key, {
        invocation,
        token: owner.token,
        result: 'foreign replacement',
      })
    ).resolves.toBe('rejected');
    const observer = await store.acquire(key, invocation);
    expect(observer).toEqual({ status: 'complete', result });
    Object.assign(observer, { result: 'mutated', token: owner.token });
    await expect(store.acquire(key, invocation)).resolves.toEqual({
      status: 'complete',
      result,
    });
    await expect(store.acquire(key, 'other')).resolves.toEqual({
      status: 'conflict',
    });
  });
  it('acknowledges non-reusable completion once and never permits takeover', async () => {
    const store = createInMemoryClientToolExecutionStore();
    const owner = await store.acquire(key, invocation);
    if (owner.status !== 'acquired') throw new Error('No owner');
    const settlement = { invocation, token: owner.token, result: null };
    await expect(store.settle(key, settlement)).resolves.toBe('accepted');
    await expect(store.settle(key, settlement)).resolves.toBe('rejected');
    await expect(store.settle(key, { ...settlement, result })).resolves.toBe(
      'rejected'
    );
    await expect(store.acquire(key, invocation)).resolves.toEqual({
      status: 'unavailable',
    });
    await expect(store.acquire(key, 'other')).resolves.toEqual({
      status: 'conflict',
    });
  });
  it('preserves framed thread/call identities, special keys, escapes, empty and Unicode strings', async () => {
    const store = createInMemoryClientToolExecutionStore();
    const tuples = [
      ['a\0b', 'c'],
      ['a', 'b\0c'],
      ['', ''],
      ['', '\0'],
      ['\0', ''],
      ['a"', 'b\\'],
      ['a', '"b\\'],
      ['雪', '😀'],
      ['t', '__proto__'],
      ['t', 'constructor'],
      ['t', 'toString'],
      ['other', '__proto__'],
    ];
    for (const [threadId, toolCallId] of tuples) {
      const identity = { threadId, toolCallId };
      const owner = await store.acquire(identity, invocation);
      if (owner.status !== 'acquired') throw new Error('Identity collided');
      await expect(
        store.settle(identity, {
          invocation,
          token: owner.token,
          result: JSON.stringify(identity),
        })
      ).resolves.toBe('accepted');
    }
    for (const [threadId, toolCallId] of tuples)
      await expect(
        store.acquire({ threadId, toolCallId }, invocation)
      ).resolves.toEqual({
        status: 'complete',
        result: JSON.stringify({ threadId, toolCallId }),
      });
  });
  it('captures each key and settlement scalar getter once', async () => {
    const store = createInMemoryClientToolExecutionStore();
    const reads = { thread: 0, call: 0, invocation: 0, token: 0, result: 0 };
    const identity = {
      get threadId() {
        reads.thread++;
        return key.threadId;
      },
      get toolCallId() {
        reads.call++;
        return key.toolCallId;
      },
    };
    const owner = await store.acquire(identity, invocation);
    if (owner.status !== 'acquired') throw new Error('No owner');
    expect(reads).toEqual({
      thread: 1,
      call: 1,
      invocation: 0,
      token: 0,
      result: 0,
    });
    await expect(
      store.settle(identity, {
        get invocation() {
          reads.invocation++;
          return invocation;
        },
        get token() {
          reads.token++;
          return owner.token;
        },
        get result() {
          reads.result++;
          return result;
        },
      })
    ).resolves.toBe('accepted');
    expect(reads).toEqual({
      thread: 2,
      call: 2,
      invocation: 1,
      token: 1,
      result: 1,
    });
  });
});
