import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadState } from '@langchain/langgraph-sdk';
import { createSession } from './create-session';
import type { AgentTransport, StreamEvent } from './transport.types';
import { controlledTransport } from './testing/controlled-transport';
import { deferred } from './testing/deferred';

const ai = (content: string, id = 'shared') => ({ type: 'ai', id, content });
const child = (content: string, namespace = ['child']): StreamEvent => ({
  type: 'messages',
  namespace,
  messageMetadata: {},
  messages: [ai(content)],
});
const full = (content: string, namespace?: string[]): StreamEvent => ({
  type: 'values',
  namespace,
  data: { messages: [ai(content)] },
});
const cleanups: (() => Promise<void>)[] = [];
function fixture() {
  const streams: ReturnType<typeof controlledTransport<StreamEvent>>[] = [];
  const starts = Array.from({ length: 8 }, () => deferred<void>());
  const acks: ReturnType<typeof deferred<void>>[] = [];
  const stream = vi.fn<AgentTransport['stream']>((_a, _t, _p, signal) => {
    const index = streams.length;
    const controlled = controlledTransport<StreamEvent>({ signal });
    streams.push(controlled);
    starts[index].resolve();
    const iterator: AsyncIterableIterator<StreamEvent> = {
      [Symbol.asyncIterator]() {
        return iterator;
      },
      next() {
        acks[index]?.resolve();
        return controlled.stream.next();
      },
      return() {
        acks[index]?.resolve();
        return controlled.stream.return();
      },
    };
    return iterator;
  });
  const history = vi.fn(async (): Promise<ThreadState[]> => []);
  const handler = vi.fn((args: { input: string }) => args.input);
  const write = vi.fn(async () => undefined);
  const session = createSession({
    assistantId: 'a',
    threadId: 't',
    transport: { stream, getHistory: history, updateState: write },
    tools: { work: { description: 'Work', handler } },
  });
  const f = {
    session,
    stream,
    streams,
    history,
    handler,
    write,
    started: (index = 0) => starts[index].promise,
    async emit(event: StreamEvent, index = 0) {
      acks[index] = deferred<void>();
      streams[index].release(event);
      await acks[index].promise;
    },
  };
  cleanups.push(async () => {
    await session.dispose();
    streams.forEach((stream) => stream.finish());
  });
  return f;
}
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('private subgraph observations', () => {
  it('preserves custom root error wrapper fields when capturing event routing', async () => {
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      transport: {
        async *stream() {
          yield { type: 'error', status: 401, message: 'Custom auth failure' };
        },
      },
    });
    expect(await session.submit('Go')).toBe('error');
    expect(session.getSnapshot().error).toMatchObject({
      kind: 'auth',
      status: 401,
    });
    await session.dispose();
  });
  it('starts inert and isolates sibling/nested repeated IDs with immutable sharing', async () => {
    const f = fixture();
    expect(f.session.getSnapshot().subgraphs).toEqual([]);
    expect(f.stream).not.toHaveBeenCalled();
    const run = f.session.submit('Go');
    await f.started();
    for (const namespace of [['a|b'], ['a', 'b'], ['sibling']])
      await f.emit(child('A', namespace));
    const before = f.session.getSnapshot();
    expect(before.subgraphs.map((entry) => entry.namespace)).toEqual([
      ['a|b'],
      ['a', 'b'],
      ['sibling'],
    ]);
    expect(before.messages.map((message) => message.content)).toEqual(['Go']);
    await f.emit(child('B', ['a', 'b']));
    const next = f.session.getSnapshot();
    expect(next.messages).toBe(before.messages);
    expect(next.values).toBe(before.values);
    expect(next.subgraphs[0]).toBe(before.subgraphs[0]);
    expect(next.subgraphs[2]).toBe(before.subgraphs[2]);
    expect(next.subgraphs[1].messages[0].content).toBe('AB');
    await f.emit({ ...child('Root'), namespace: undefined });
    expect(f.session.getSnapshot().subgraphs).toBe(next.subgraphs);
    await f.session.stop();
    expect(await run).toBe('aborted');
    expect(
      f.session.getSnapshot().subgraphs[1].messages[0].delivery
    ).toMatchObject({ outcome: 'aborted' });
    expect(Object.isFrozen(next.subgraphs[1].namespace)).toBe(true);
  });

  it.each(['success', 'paused'] as const)(
    'finalizes shorter and empty child canonical text at %s closure',
    async (outcome) => {
      const f = fixture();
      const run = f.session.submit('Go');
      await f.started();
      await f.emit(child('Long provisional'));
      await f.emit(child('Other long provisional', ['empty']));
      await f.emit(full('Short', ['child']));
      await f.emit(full('', ['empty']));
      await f.emit(
        outcome === 'success'
          ? full('Root')
          : { type: 'updates', data: { __interrupt__: [] } }
      );
      f.streams[0].finish();
      expect(await run).toBe(outcome);
      expect(
        f.session
          .getSnapshot()
          .subgraphs.map((entry) => entry.messages[0].content)
      ).toEqual(['Short', '']);
      expect(
        f.session.getSnapshot().subgraphs[0].messages[0].delivery
      ).toMatchObject({ outcome });
    }
  );

  it('owns values/interrupts, protects child errors, and never executes child tools', async () => {
    const f = fixture();
    const run = f.session.submit('Go');
    await f.started();
    const nested = { count: [1] };
    await f.emit({
      type: 'values|child|nested',
      namespace: ['child', 'nested'],
      data: {
        nested,
        messages: [
          {
            ...ai('Child'),
            tool_calls: [
              { id: 'child-tool', name: 'work', args: { input: 'bad' } },
            ],
          },
        ],
      },
    });
    nested.count.push(2);
    await f.emit({
      type: 'updates|child|nested',
      data: { __interrupt__: [{ id: 'ask', value: { confirm: true } }] },
    });
    await f.emit({
      type: 'error|child|nested',
      data: { message: 'SECRET', cause: new Error('SECRET') },
    });
    await f.emit(full('Root'));
    f.streams[0].finish();
    expect(await run).toBe('success');
    const snapshot = f.session.getSnapshot();
    expect(snapshot.subgraphs[0].values).toEqual({ nested: { count: [1] } });
    expect(snapshot.subgraphs[0].interrupts).toEqual([
      { id: 'ask', value: { confirm: true } },
    ]);
    expect(snapshot.subgraphs[0].error).toMatchObject({
      kind: 'server',
      recovery: 'none',
    });
    expect(JSON.stringify(snapshot)).not.toContain('SECRET');
    expect(snapshot.subgraphs[0].messages[0].delivery).toMatchObject({
      outcome: 'error',
    });
    expect(snapshot.interrupts).toEqual([]);
    expect(snapshot.toolCalls).toEqual([]);
    expect(f.handler).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
    expect(f.stream).toHaveBeenCalledTimes(1);
  });

  it.each(['values', 'updates', 'error'] as const)(
    'child %s evidence cannot complete/pause root or authorize resume',
    async (type) => {
      const f = fixture();
      const run = f.session.submit('Go');
      await f.started();
      await f.emit({
        type,
        namespace: ['child'],
        data:
          type === 'values'
            ? { messages: [ai('Done')] }
            : { __interrupt__: [] },
      });
      f.streams[0].finish();
      expect(await run).toBe('interrupted');
      expect(f.session.getSnapshot().interrupts).toEqual([]);
      await expect(f.session.resume()).rejects.toThrow();
    }
  );

  it('ignores conflicting/malformed namespace paths and irrelevant child events', async () => {
    const f = fixture();
    const run = f.session.submit('Go');
    await f.started();
    for (const event of [
      { type: 'values|a', namespace: ['b'], data: { count: 1 } },
      { type: 'values|a|', data: { count: 1 } },
      { type: 'values|', data: { count: 1 } },
      { type: 'messages', namespace: [''], messages: [ai('Bad')] },
      { type: 'custom|a', data: { count: 1 } },
      { type: 'updates|a', data: { node: { count: 1 } } },
      { type: 'values|a' },
    ] satisfies StreamEvent[])
      await f.emit(event);
    expect(f.session.getSnapshot().subgraphs).toEqual([]);
    await f.session.stop();
    await run;
  });

  it.each(['stop', 'submit', 'dispose', 'throw'] as const)(
    'atomically rejects child getters that %s',
    async (action) => {
      const f = fixture();
      const run = f.session.submit('Go');
      await f.started();
      await f.emit(child('Kept'));
      let nested: Promise<unknown> | undefined;
      let fired = false;
      await f.emit({
        type: 'values|bad',
        data: {
          messages: [ai('Rejected')],
          get value() {
            if (!fired) {
              fired = true;
              if (action === 'throw') throw new Error('SECRET');
              nested =
                action === 'submit'
                  ? f.session.submit('New')
                  : f.session[action]();
            }
            return 99;
          },
        },
      });
      await run;
      expect(fired).toBe(true);
      expect(
        f.session
          .getSnapshot()
          .subgraphs.some((entry) => entry.namespace[0] === 'bad')
      ).toBe(false);
      expect(f.session.getSnapshot().values).toBeUndefined();
      if (action === 'submit') {
        await f.started(1);
        await f.session.stop();
      }
      await nested;
    }
  );

  it('retains observations on rejected submit and failed history, clears admitted submit/accepted history', async () => {
    const f = fixture();
    const run = f.session.submit('Go');
    await f.started();
    await f.emit(child('Saved'));
    await f.emit(full('Root'));
    f.streams[0].finish();
    await run;
    const before = f.session.getSnapshot().subgraphs;
    await f.session.submit('Abort', { signal: AbortSignal.abort() });
    await expect(
      f.session.submit({
        message: 'Bad',
        state: {
          get bad(): never {
            throw new Error('Bad');
          },
        },
      })
    ).rejects.toThrow();
    expect(f.session.getSnapshot().subgraphs).toBe(before);
    f.history.mockRejectedValueOnce(new Error('No'));
    await expect(f.session.load?.()).rejects.toThrow();
    expect(f.session.getSnapshot().subgraphs).toBe(before);
    await f.session.load?.();
    expect(f.session.getSnapshot().subgraphs).toEqual([]);
    const next = f.session.submit('Again');
    await f.started(1);
    await f.emit(child('Again'), 1);
    await f.emit(full('Root'), 1);
    f.streams[1].finish();
    await next;
    const last = f.session.submit('Fresh');
    await f.started(2);
    expect(f.session.getSnapshot().subgraphs).toEqual([]);
    await f.session.stop();
    await last;
  });

  it('retains untouched children across resume and refreshes only active child evidence/generation', async () => {
    const f = fixture();
    const run = f.session.submit('Go');
    await f.started();
    await f.emit(child('Old'));
    await f.emit(full('Untouched', ['untouched']));
    await f.emit({
      type: 'updates|child',
      data: { __interrupt__: [{ id: 'ask', value: true }] },
    });
    await f.emit({ type: 'error|child', data: { message: 'Private' } });
    await f.emit({ type: 'updates', data: { __interrupt__: [] } });
    f.streams[0].finish();
    expect(await run).toBe('paused');
    const before = f.session.getSnapshot();
    const resumed = f.session.resume(true);
    await f.started(1);
    expect(f.session.getSnapshot().subgraphs).toBe(before.subgraphs);
    await f.emit(child('New'), 1);
    const active = f.session.getSnapshot().subgraphs[0];
    expect(active.messages[0].content).toBe('New');
    expect(active.messages[0].delivery.generation).not.toBe(
      before.subgraphs[0].messages[0].delivery.generation
    );
    expect(active.error).toBeUndefined();
    expect(active.interrupts).toEqual([]);
    expect(f.session.getSnapshot().subgraphs[1]).toBe(before.subgraphs[1]);
    await f.emit(full('Done'), 1);
    f.streams[1].finish();
    expect(await resumed).toBe('success');
    expect(f.session.getSnapshot().subgraphs[1]).toBe(before.subgraphs[1]);
  });

  it('settles supersession/disposal and ignores frames from abandoned physical streams', async () => {
    const f = fixture();
    const first = f.session.submit('First');
    await f.started();
    await f.emit(child('Old'));
    const second = f.session.submit('Second');
    await f.started(1);
    expect(await first).toBe('interrupted');
    f.streams[0].release(full('Late', ['late']));
    await f.emit(child('Current'), 1);
    await f.session.dispose();
    expect(await second).toBe('aborted');
    const final = f.session.getSnapshot();
    expect(final.subgraphs.map((entry) => entry.namespace)).toEqual([
      ['child'],
    ]);
    expect(final.subgraphs[0].messages[0]).toMatchObject({
      content: 'Current',
      delivery: { outcome: 'aborted' },
    });
    f.streams[1].release(full('Late again', ['late']));
    await Promise.resolve();
    expect(f.session.getSnapshot()).toBe(final);
  });

  it.each(['closure', 'check'] as const)(
    'root %s recovery settles observations without fabricating child history',
    async (mode) => {
      const f = fixture();
      const run = f.session.submit('Go');
      await f.started();
      await f.emit(child('Observed'));
      const history = () => [
        {
          values: {
            messages: [
              ...(f.stream.mock.calls[0][2] as { messages: unknown[] })
                .messages,
              ai('Recovered'),
            ],
          },
          tasks: [],
          next: [],
        } as unknown as ThreadState,
      ];
      if (mode === 'closure')
        f.history.mockImplementationOnce(async () => history());
      f.streams[0].finish();
      expect(await run).toBe(mode === 'closure' ? 'success' : 'interrupted');
      if (mode === 'check') {
        f.history.mockImplementationOnce(async () => history());
        await f.session.checkStatus?.();
      }
      const snapshot = f.session.getSnapshot();
      expect(snapshot.subgraphs).toHaveLength(1);
      expect(snapshot.subgraphs[0].messages[0]).toMatchObject({
        content: 'Observed',
        delivery: { outcome: 'success' },
      });
    }
  );

  it('reconnects anonymous children from the exact last committed cursor after a rejected child event', async () => {
    const join = vi.fn<NonNullable<AgentTransport['joinStream']>>(
      async function* () {
        yield {
          type: 'messages|child',
          sseId: '3',
          messageMetadata: {},
          messages: [{ type: 'ai', content: 'B' }],
        };
        yield {
          type: 'values|child',
          sseId: '4',
          data: { messages: [{ type: 'ai', content: '' }] },
        };
        yield { ...full('Root'), sseId: '5' };
      }
    );
    const status = vi.fn<NonNullable<AgentTransport['getRunStatus']>>(
      async () => 'success'
    );
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      transport: {
        async *stream(_a, _t, _input, _signal, settings) {
          settings?.onRunCreated?.({ run_id: 'run', thread_id: 't' });
          yield {
            type: 'messages|child',
            sseId: '1',
            messageMetadata: {},
            messages: [{ type: 'ai', content: 'A' }],
          };
          yield {
            type: 'values|bad',
            sseId: '2',
            data: {
              messages: [ai('Rejected')],
              get bad() {
                throw new Error('SECRET');
              },
            },
          };
        },
        joinStream: join,
        getRunStatus: status,
      },
    });
    expect(await session.submit('Go')).toBe('interrupted');
    const before = session.getSnapshot().subgraphs[0].messages[0];
    const observations: string[] = [];
    session.subscribe(() =>
      observations.push(session.getSnapshot().subgraphs[0].messages[0].content)
    );
    expect(await session.reconnect()).toBe('success');
    expect(join.mock.calls[0].slice(0, 3)).toEqual(['t', 'run', '1']);
    expect(observations).toContain('AB');
    const after = session.getSnapshot();
    expect(after.subgraphs).toHaveLength(1);
    expect(after.subgraphs[0].messages[0]).toMatchObject({
      id: before.id,
      content: '',
      delivery: { outcome: 'success' },
    });
    expect(after.subgraphs[0].messages[0].delivery.generation).not.toBe(
      before.delivery.generation
    );
    await session.dispose();
  });

  it('resets child baselines for root tool handoff and reconnects only second-step deliveries', async () => {
    let physical = 0;
    const handler = vi.fn((args: { input: string }) => args.input);
    const status = vi
      .fn<NonNullable<AgentTransport['getRunStatus']>>()
      .mockResolvedValueOnce('success')
      .mockResolvedValueOnce('running')
      .mockResolvedValueOnce('success');
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      tools: { work: { description: 'Work', handler } },
      transport: {
        async *stream(_a, _t, _input, _signal, settings) {
          physical += 1;
          settings?.onRunCreated?.({
            run_id: `run-${physical}`,
            thread_id: 't',
          });
          if (physical === 1) {
            yield { ...child('First', ['failed']), sseId: '1' };
            yield { type: 'error|failed', sseId: '2' };
            yield { ...full('First', ['reused']), sseId: '3' };
            yield {
              type: 'values',
              sseId: '4',
              data: {
                messages: [
                  {
                    ...ai('Tool'),
                    tool_calls: [
                      { id: 'work', name: 'work', args: { input: 'value' } },
                    ],
                  },
                ],
              },
            };
          } else {
            yield { ...child('Second', ['reused']), sseId: '5' };
            yield {
              type: 'messages|anonymous',
              sseId: '6',
              messageMetadata: {},
              messages: [{ type: 'ai', content: 'Second anonymous' }],
            };
          }
        },
        async *joinStream() {
          yield { ...full('Final', ['reused']), sseId: '7' };
          yield {
            type: 'values|anonymous',
            sseId: '8',
            data: { messages: [{ type: 'ai', content: 'Final anonymous' }] },
          };
          yield { ...full('Root'), sseId: '9' };
        },
        getRunStatus: status,
        updateState: async () => undefined,
      },
    });
    expect(await session.submit('Go')).toBe('interrupted');
    expect(handler).toHaveBeenCalledTimes(1);
    const before = session.getSnapshot();
    expect(before.subgraphs[1].messages[0].content).toBe('Second');
    const failed = before.subgraphs[0];
    const anonymous = before.subgraphs[2].messages[0];
    const seen: unknown[] = [];
    session.subscribe(() => seen.push(session.getSnapshot().subgraphs[0]));
    expect(await session.reconnect()).toBe('success');
    expect(seen.every((entry) => entry === failed)).toBe(true);
    expect(session.getSnapshot().subgraphs[0]).toBe(failed);
    expect(session.getSnapshot().subgraphs[1].messages[0]).toMatchObject({
      content: 'Final',
      delivery: { outcome: 'success' },
    });
    expect(session.getSnapshot().subgraphs[2].messages[0].id).toBe(
      anonymous.id
    );
    expect(physical).toBe(2);
    await session.dispose();
  });
});
