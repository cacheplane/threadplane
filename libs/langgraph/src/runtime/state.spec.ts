import {
  type,
  type StandardSchemaV1,
  type StateDeclaration,
} from '@threadplane/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import { controlledTransport } from './testing/controlled-transport';
import { deferred } from './testing/deferred';
import type { AgentTransport, StreamEvent } from './transport.types';

interface Counter {
  readonly count: number;
  readonly label?: string;
}
/** Accepts a record with a numeric count and keeps only the declared fields. */
const counter = (
  produce: (value: Counter) => unknown = (value) => value
): StandardSchemaV1<unknown, Counter> => ({
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) => {
      const count = (value as { count?: unknown } | null)?.count;
      return typeof count === 'number'
        ? { value: produce({ count }) as Counter }
        : { issues: [{ message: 'count must be a number' }] };
    },
  },
});

const disposals: (() => Promise<void>)[] = [];
function fixture<D extends StateDeclaration | undefined = undefined>(
  stateType?: D
) {
  const streams: ReturnType<typeof controlledTransport<StreamEvent>>[] = [];
  const starts = Array.from({ length: 2 }, () => deferred<void>());
  const stream = vi.fn<AgentTransport['stream']>((_a, _t, _input, signal) => {
    const index = streams.length;
    const controlled = controlledTransport<StreamEvent>({ signal });
    streams.push(controlled);
    starts[index].resolve();
    return controlled.stream;
  });
  const session = createSession({
    assistantId: 'a',
    threadId: 't',
    transport: { stream },
    stateType,
  });
  disposals.push(() => session.dispose());
  const report = (data: unknown) =>
    streams[0].release({ type: 'values', data });
  return {
    session,
    stream,
    streams,
    report,
    started: (index = 0) => starts[index].promise,
  };
}
afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

describe('session state', () => {
  it('publishes the reported record unchecked for a type() declaration', async () => {
    const f = fixture(type<Counter>());
    expect(f.session.getSnapshot().state).toBeUndefined();
    const run = f.session.submit('Go');
    await f.started();
    f.report({ count: 'not a number', extra: true });
    await vi.waitFor(() =>
      expect(f.session.getSnapshot().state).toEqual({
        count: 'not a number',
        extra: true,
      })
    );
    expect(f.session.getSnapshot().stateIssues).toBeUndefined();
    f.streams[0].finish();
    expect(await run).toBe('success');
  });

  it('publishes the schema output, and withholds a rejected state at the last valid one', async () => {
    const f = fixture(counter());
    const run = f.session.submit('Go');
    await f.started();
    f.report({ count: 1, extra: true });
    await vi.waitFor(() =>
      expect(f.session.getSnapshot().state).toEqual({ count: 1 })
    );
    const valid = f.session.getSnapshot().state;
    expect(Object.isFrozen(valid)).toBe(true);
    const count: number | undefined = valid?.count;
    expect(count).toBe(1);

    f.report({ count: 'broken' });
    await vi.waitFor(() =>
      expect(f.session.getSnapshot().stateIssues).toEqual([
        'count must be a number',
      ])
    );
    expect(f.session.getSnapshot().state).toBe(valid);
    expect(f.session.getSnapshot().status).toBe('running');

    f.report({ count: 2 });
    await vi.waitFor(() =>
      expect(f.session.getSnapshot().state).toEqual({ count: 2 })
    );
    expect(f.session.getSnapshot().stateIssues).toBeUndefined();
    f.streams[0].finish();
    expect(await run).toBe('success');
  });

  it('reports a first state the schema rejects without failing the run', async () => {
    const f = fixture(counter());
    const run = f.session.submit('Go');
    await f.started();
    f.report({ messages: [] });
    await vi.waitFor(() =>
      expect(f.session.getSnapshot().stateIssues).toEqual([
        'count must be a number',
      ])
    );
    expect(f.session.getSnapshot().state).toBeUndefined();
    f.streams[0].finish();
    expect(await run).toBe('success');
    expect(f.session.getSnapshot().error).toBeUndefined();
  });

  it.each([
    ['a class instance', () => ({ count: 1, at: new Date(0) })],
    ['an array', () => [1]],
    ['a primitive', () => 1],
  ])('rejects schema output that is %s', async (_name, produce) => {
    const f = fixture(counter(produce));
    const run = f.session.submit('Go');
    await f.started();
    f.report({ count: 1 });
    await vi.waitFor(() =>
      expect(f.session.getSnapshot().stateIssues).toEqual([
        'The state schema must produce a plain data record.',
      ])
    );
    expect(f.session.getSnapshot().state).toBeUndefined();
    f.streams[0].finish();
    expect(await run).toBe('success');
  });

  it('checks a state once, not on every publication', async () => {
    const validate = vi.fn((value: unknown) => ({ value: value as Counter }));
    const f = fixture({
      '~standard': { version: 1, vendor: 'test', validate },
    } satisfies StandardSchemaV1<unknown, Counter>);
    const run = f.session.submit('Go');
    await f.started();
    f.report({ count: 1 });
    await vi.waitFor(() =>
      expect(f.session.getSnapshot().state).toEqual({ count: 1 })
    );
    const calls = validate.mock.calls.length;
    f.streams[0].release({
      type: 'messages',
      messageMetadata: {},
      messages: [{ id: 'answer', type: 'AIMessageChunk', content: 'Hi' }],
    });
    await vi.waitFor(() =>
      expect(f.session.getSnapshot().messages.length).toBeGreaterThan(1)
    );
    expect(validate).toHaveBeenCalledTimes(calls);
    f.streams[0].finish();
    await run;
  });

  it('sends submitted state with the first request of a typed session', async () => {
    const f = fixture(type<Counter>());
    const run = f.session.submit({ message: 'Go', state: { label: 'draft' } });
    await f.started();
    expect(f.stream.mock.calls[0][2]).toMatchObject({ label: 'draft' });
    f.streams[0].finish();
    await run;
  });
});
