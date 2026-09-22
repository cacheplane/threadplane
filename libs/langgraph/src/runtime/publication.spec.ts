import { streamingDelivery } from '@threadplane/core';
import { describe, expect, it } from 'vitest';
import { createPublication } from './publication';
import { deferred } from './testing/deferred';
import type { LangGraphSnapshot } from './langgraph-snapshot';

function snapshot(content = 'one'): LangGraphSnapshot {
  return {
    status: 'idle',
    values: undefined,
    interrupts: [],
    messages: [
      {
        id: 'm',
        role: 'assistant',
        content,
        delivery: streamingDelivery('g'),
        toolCallIds: ['t'],
      },
    ],
    toolCalls: [
      {
        id: 't',
        name: 'search',
        status: 'complete',
        args: { words: ['first'] },
        result: { hits: ['found'] },
      },
    ],
  };
}

describe('private snapshot publication', () => {
  it('owns and shares the reconnect descriptor, including removing it from an otherwise equal aggregate', () => {
    const descriptor = { runId: 'run' };
    const publication = createPublication({
      ...snapshot(),
      reconnect: descriptor,
    });
    const before = publication.getSnapshot();
    descriptor.runId = 'mutated';
    expect(before.reconnect).toEqual({ runId: 'run' });
    expect(Object.isFrozen(before.reconnect)).toBe(true);
    let calls = 0;
    publication.subscribe(() => calls++);
    publication.publish({ ...snapshot(), reconnect: { runId: 'run' } });
    expect(publication.getSnapshot()).toBe(before);
    expect(calls).toBe(0);
    publication.publish(snapshot());
    expect(publication.getSnapshot().reconnect).toBeUndefined();
    expect(calls).toBe(1);
  });

  it('owns interrupt payloads and suppresses equal aggregate publications', () => {
    const payload = { nested: [1] };
    const publication = createPublication({
      ...snapshot(),
      interrupts: [{ id: 'a', value: payload, namespace: ['root'] }],
    });
    const before = publication.getSnapshot();
    expect(before.interrupts).toEqual([
      { id: 'a', value: { nested: [1] }, namespace: ['root'] },
    ]);
    payload.nested.push(2);
    expect(before.interrupts[0].value).toEqual({ nested: [1] });
    expect(Object.isFrozen(before.interrupts[0].namespace)).toBe(true);
    let calls = 0;
    publication.subscribe(() => calls++);
    publication.publish({
      ...snapshot(),
      interrupts: [{ id: 'a', value: { nested: [1] }, namespace: ['root'] }],
    });
    expect(publication.getSnapshot()).toBe(before);
    expect(calls).toBe(0);
    expect(() =>
      publication.publish({
        ...snapshot('Invalid'),
        values: { count: 9 },
        interrupts: [{ value: new Date() }],
      } as unknown as LangGraphSnapshot)
    ).toThrow(TypeError);
    expect(publication.getSnapshot()).toBe(before);
  });
  it('leaves the aggregate unchanged if application values ownership throws', () => {
    const publication = createPublication(snapshot());
    const before = publication.getSnapshot();
    expect(() =>
      publication.publish({
        ...snapshot('candidate'),
        values: { bad: new Date(0) },
      } as unknown as LangGraphSnapshot)
    ).toThrow(TypeError);
    expect(publication.getSnapshot()).toBe(before);
  });

  it('owns application values and suppresses equal queued aggregate publications', () => {
    const data = { stable: { x: 1 }, count: 1 };
    const publication = createPublication({ ...snapshot(), values: data });
    const first = publication.getSnapshot() as LangGraphSnapshot;
    expect(first.values).toEqual(data);
    expect(first.values).not.toBe(data);
    data.stable.x = 9;
    expect(first.values?.['stable']).toEqual({ x: 1 });
    const seen: LangGraphSnapshot[] = [];
    for (let index = 0; index < 2; index++)
      publication.subscribe(() => {
        if (publication.getSnapshot().status === 'running') {
          const values = { stable: { x: 1 }, count: 2 };
          const interrupts = [
            { id: 'queued', value: { choices: ['continue'] } },
          ];
          publication.publish({ ...snapshot('two'), values, interrupts });
          values.count = 99;
          interrupts[0].value.choices.push('late mutation');
        }
      });
    publication.subscribe(() =>
      seen.push(publication.getSnapshot() as LangGraphSnapshot)
    );
    publication.publish({ ...first, status: 'running' });
    expect(seen).toHaveLength(2);
    expect(seen[1].values).toEqual({ stable: { x: 1 }, count: 2 });
    expect(seen[1].values?.['stable']).toBe(first.values?.['stable']);
    expect(seen[1].interrupts).toEqual([
      { id: 'queued', value: { choices: ['continue'] } },
    ]);
    expect(seen[1].messages[0].content).toBe('two');
    expect(Object.isFrozen(seen[1].values)).toBe(true);
  });

  it('does not turn unsupported SDK instances into apparently portable tool data', () => {
    const input = snapshot();
    const invalid = {
      ...input,
      toolCalls: [{ ...input.toolCalls[0], args: new Date() }],
    };
    expect(() =>
      createPublication(invalid as unknown as LangGraphSnapshot)
    ).toThrow(TypeError);
    const publication = createPublication({
      ...input,
      toolCalls: [{ id: 't', name: 'search', status: 'running', args: {} }],
    });
    expect(() =>
      publication.publish({
        ...input,
        toolCalls: [
          { id: 't', name: 'search', status: 'running', args: new Date() },
        ],
      } as unknown as LangGraphSnapshot)
    ).toThrow(TypeError);
  });
  it('caches repeated reads per session and observes only actual changes', () => {
    const one = createPublication(snapshot());
    const two = createPublication(snapshot('two'));
    let calls = 0;
    one.subscribe(() => calls++);
    const original = one.getSnapshot();
    expect(calls).toBe(0);
    two.publish({ ...two.getSnapshot(), status: 'running' });
    expect(one.getSnapshot()).toBe(original);
    one.publish(snapshot());
    expect(one.getSnapshot()).toBe(original);
    expect(calls).toBe(0);
    one.publish({ ...original, status: 'running' });
    expect(calls).toBe(1);
    expect(one.getSnapshot()).not.toBe(original);
    expect(one.getSnapshot().messages).toBe(original.messages);
    expect(original.status).toBe('idle');
  });

  it('owns ingress and old snapshots, retaining unchanged siblings on later publication', () => {
    const ids = ['t'];
    const args = { words: ['first'] };
    const result = { hits: ['found'] };
    const error = Object.assign(new Error('Failed'), {
      kind: 'server' as const,
      retryable: true,
      cause: { value: [] },
    });
    const incoming = {
      ...snapshot(),
      error,
      messages: [
        {
          id: 'm',
          role: 'assistant' as const,
          content: 'one',
          delivery: streamingDelivery('g'),
          toolCallIds: ids,
        },
      ],
      toolCalls: [
        { id: 't', name: 'search', status: 'complete' as const, args, result },
      ],
    };
    const publication = createPublication(incoming);
    const before = publication.getSnapshot();
    ids.push('new');
    args.words.push('second');
    result.hits.push('later');
    error.message = 'Changed';
    incoming.messages[0].content = 'changed';
    expect(before.messages[0].content).toBe('one');
    expect(before.messages[0].toolCallIds).toEqual(['t']);
    expect(before.toolCalls[0]).toMatchObject({
      args: { words: ['first'] },
      result: { hits: ['found'] },
    });
    expect(before.error?.message).toBe('Failed');
    expect(before.error).not.toHaveProperty('cause');
    expect(before.error).not.toHaveProperty('stack');
    publication.publish({
      ...before,
      messages: [...before.messages, { ...before.messages[0], id: 'm2' }],
    });
    expect(publication.getSnapshot().messages[0]).toBe(before.messages[0]);
    expect(before.messages).toHaveLength(1);
    expect(Object.isFrozen(before.messages)).toBe(true);
    expect(Object.isFrozen(before.messages[0].toolCallIds)).toBe(true);
    expect(Object.isFrozen(before.toolCalls[0].args)).toBe(true);
    expect(
      Object.isFrozen(
        (before.toolCalls[0].args as { words: readonly string[] }).words
      )
    ).toBe(true);
  });

  it('suppresses equal queued publications captured by separate listeners', () => {
    const publication = createPublication(snapshot());
    const seen: string[] = [];
    for (let index = 0; index < 2; index++) {
      publication.subscribe(() => {
        if (publication.getSnapshot().status === 'running') {
          publication.publish(snapshot('two'));
        }
      });
    }
    publication.subscribe(() => {
      const value = publication.getSnapshot();
      seen.push(`${value.status}:${value.messages[0].content}`);
    });
    publication.publish({ ...snapshot(), status: 'running' });
    expect(seen).toEqual(['running:one', 'idle:two']);
  });

  it('retains current identity when another publication supplies an equal owned snapshot', () => {
    const publication = createPublication(snapshot());
    const other = createPublication(snapshot());
    const before = publication.getSnapshot();
    let calls = 0;
    publication.subscribe(() => calls++);
    expect(other.getSnapshot().messages).not.toBe(before.messages);
    expect(other.getSnapshot().toolCalls).not.toBe(before.toolCalls);
    publication.publish(other.getSnapshot());
    expect(publication.getSnapshot()).toBe(before);
    expect(calls).toBe(0);
  });

  it('reuses equal current siblings and new owned members from another publication', () => {
    const publication = createPublication(snapshot());
    const before = publication.getSnapshot();
    const other = createPublication({
      ...snapshot(),
      messages: [
        snapshot().messages[0],
        { ...snapshot('two').messages[0], id: 'second' },
      ],
    });
    const incoming = other.getSnapshot();
    publication.publish(incoming);
    const after = publication.getSnapshot();
    expect(after.messages[0]).toBe(before.messages[0]);
    expect(after.messages[1]).toBe(incoming.messages[1]);
    expect(after.toolCalls).toBe(before.toolCalls);
    expect(before.messages).toHaveLength(1);
  });

  it('commits the aggregate before listeners and runs nested commands after the complete notification pass', async () => {
    const publication = createPublication(snapshot());
    const seen: string[] = [];
    let nested!: Promise<void>;
    publication.subscribe(() => {
      const value = publication.getSnapshot();
      seen.push(`first:${value.status}:${value.messages[0].content}`);
      if (value.status === 'running')
        nested = publication.command(() => {
          seen.push('command');
          publication.publish({ ...publication.getSnapshot(), status: 'idle' });
        });
    });
    publication.subscribe(() => {
      const value = publication.getSnapshot();
      seen.push(`second:${value.status}:${value.messages[0].content}`);
    });
    publication.publish({ ...snapshot('two'), status: 'running' });
    await nested;
    expect(seen).toEqual([
      'first:running:two',
      'second:running:two',
      'command',
      'first:idle:two',
      'second:idle:two',
    ]);
  });

  it('captures deferred publication ingress before returning to a listener', () => {
    const publication = createPublication(snapshot());
    const seen: string[] = [];
    publication.subscribe(() => {
      if (publication.getSnapshot().status === 'running') {
        const mutable = { ...snapshot('queued'), status: 'error' as const };
        publication.publish(mutable);
        mutable.messages = [];
      }
    });
    publication.subscribe(() =>
      seen.push(
        `${publication.getSnapshot().status}:${
          publication.getSnapshot().messages[0].content
        }`
      )
    );
    publication.publish({ ...snapshot('two'), status: 'running' });
    expect(seen).toEqual(['running:two', 'error:queued']);
  });

  it('supports idempotent unsubscription and defers newly registered listeners to the next pass', () => {
    const publication = createPublication(snapshot());
    const seen: string[] = [];
    let removeSecond = () => {
      /* replaced before notification */
    };
    let added = false;
    publication.subscribe(() => {
      seen.push('first');
      removeSecond();
      removeSecond();
      if (!added) {
        publication.subscribe(() => seen.push('new'));
        added = true;
      }
    });
    removeSecond = publication.subscribe(() => seen.push('second'));
    publication.publish({ ...snapshot(), status: 'running' });
    expect(seen).toEqual(['first']);
    publication.publish(snapshot('next'));
    expect(seen).toEqual(['first', 'first', 'new']);
  });

  it('isolates throwing listeners and even a throwing error reporter', () => {
    const failure = new Error('listener');
    const reported: unknown[] = [];
    const publication = createPublication(snapshot(), (error) => {
      reported.push(error);
      throw new Error('reporter');
    });
    const seen: string[] = [];
    publication.subscribe(() => {
      throw failure;
    });
    publication.subscribe(() => seen.push(publication.getSnapshot().status));
    publication.publish({ ...snapshot(), status: 'running' });
    publication.publish(snapshot());
    expect(reported).toEqual([failure, failure]);
    expect(seen).toEqual(['running', 'idle']);
  });

  it('settles independent commands without waiting on a prior asynchronous effect', async () => {
    const publication = createPublication(snapshot());
    const effect = deferred<string>();
    const slow = publication.command(() => effect.promise);
    const fast = publication.command(() => 'fast');
    await expect(fast).resolves.toBe('fast');
    effect.resolve('slow');
    await expect(slow).resolves.toBe('slow');
    await expect(
      publication.command(() => {
        throw new Error('command');
      })
    ).rejects.toThrow('command');
    await expect(publication.command(() => 'still works')).resolves.toBe(
      'still works'
    );
  });

  it('makes a command publication visible before that command continues', async () => {
    const publication = createPublication(snapshot());
    await publication.command(() => {
      publication.publish({ ...publication.getSnapshot(), status: 'running' });
      expect(publication.getSnapshot().status).toBe('running');
    });
  });
});
