import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import { controlledTransport } from './testing/controlled-transport';
import { deferred } from './testing/deferred';
import type { AgentTransport, StreamEvent } from './transport.types';

const sessions: ReturnType<typeof createSession>[] = [];
function fixture() {
  const streams: ReturnType<typeof controlledTransport<StreamEvent>>[] = [];
  const starts = Array.from({ length: 2 }, () => deferred<void>());
  const stream = vi.fn<AgentTransport['stream']>((_a, _t, _input, signal) => {
    const index = streams.length;
    const controlled = controlledTransport<StreamEvent>({ signal });
    streams.push(controlled);
    starts[index].resolve();
    return controlled.stream;
  });
  const session = createSession({ assistantId: 'a', threadId: 't', transport: { stream } });
  sessions.push(session);
  return { session, streams, started: (index = 0) => starts[index].promise };
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
});

describe('session plan', () => {
  it('publishes the todos list in graph values as the snapshot plan, shared while it is unchanged', async () => {
    const f = fixture();
    expect(f.session.getSnapshot().plan).toBeUndefined();
    const run = f.session.submit('Compare the drafts');
    await f.started();
    const todos = [
      { content: 'Read both drafts', status: 'completed' },
      { content: 'Compare them', status: 'pending' },
    ];
    f.streams[0].release({ type: 'values', data: { todos, round: 1 } });
    await vi.waitFor(() =>
      expect(f.session.getSnapshot().plan).toEqual([
        { label: 'Read both drafts', status: 'completed' },
        { label: 'Compare them', status: 'pending' },
      ])
    );
    const plan = f.session.getSnapshot().plan;
    expect(Object.isFrozen(plan)).toBe(true);
    // Other values change; the plan keeps its identity.
    f.streams[0].release({ type: 'values', data: { todos, round: 2 } });
    await vi.waitFor(() => expect(f.session.getSnapshot().values).toMatchObject({ round: 2 }));
    expect(f.session.getSnapshot().plan).toBe(plan);
    f.streams[0].release({
      type: 'values',
      data: { todos: [todos[0], { ...todos[1], status: 'in_progress' }], round: 3 },
    });
    await vi.waitFor(() =>
      expect(f.session.getSnapshot().plan?.[1]).toEqual({ label: 'Compare them', status: 'in_progress' })
    );
    f.streams[0].finish();
    expect(await run).toBe('success');
  });

  it('has no plan when the values hold no todos list', async () => {
    const f = fixture();
    const run = f.session.submit('Hi');
    await f.started();
    f.streams[0].release({ type: 'values', data: { model: 'server' } });
    f.streams[0].finish();
    expect(await run).toBe('success');
    expect(f.session.getSnapshot().plan).toBeUndefined();
    expect('plan' in f.session.getSnapshot()).toBe(false);
  });
});
