import { describe, expect, it, vi } from 'vitest';
import type { AgentSession, AgentSessionCustomEvent } from '@threadplane/core';
import { createSession } from './create-session';
import { controlledTransport } from './testing/controlled-transport';
import { deferred } from './testing/deferred';
import type { AgentTransport, StreamEvent } from './transport.types';

function fixture() {
  const streams: ReturnType<typeof controlledTransport<StreamEvent>>[] = [];
  const started = deferred<void>();
  const stream = vi.fn<AgentTransport['stream']>((_a, _t, _p, signal) => {
    const next = controlledTransport<StreamEvent>({ signal, ignoreAbort: true });
    streams.push(next);
    started.resolve();
    return next.stream;
  });
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    transport: { stream },
  });
  return { streams, started: started.promise, session };
}

let marks = 0;
/** Streams a marker message and resolves once it is published, so every frame
 * released before it has been processed. Custom frames alone publish nothing. */
function settled(
  session: AgentSession,
  stream: { release(value: StreamEvent): void }
) {
  const text = `mark-${++marks}`;
  const result = deferred<void>();
  const seen = () =>
    session.getSnapshot().messages.some((message) => message.content === text);
  const release = session.subscribe(() => {
    if (seen()) {
      release();
      result.resolve();
    }
  });
  stream.release(delta(text, text));
  return result.promise;
}

const custom = (data: unknown, type: StreamEvent['type'] = 'custom') =>
  ({ type, data }) as StreamEvent;
const delta = (content: string, id = 'answer'): StreamEvent => ({
  type: 'messages',
  messages: [{ type: 'AIMessageChunk', id, content }],
  messageMetadata: {},
});

describe('LangGraph session custom events', () => {
  it('delivers named, root and namespaced custom frames as owned plain data', async () => {
    const { streams, started, session } = fixture();
    const events: AgentSessionCustomEvent[] = [];
    session.onCustomEvent((event) => events.push(event));
    const payload = { name: 'a2ui-partial', data: { args: ['a'] } };
    void session.submit('Hello');
    await started;
    streams[0].release(custom(payload));
    streams[0].release(custom({ progress: 1 }, 'custom|child:1'));
    streams[0].release(custom('plain text'));
    await settled(session, streams[0]);
    payload.data.args.push('mutated');
    expect(events).toEqual([
      { name: 'a2ui-partial', data: { args: ['a'] } },
      { name: '', data: { progress: 1 } },
      { name: '', data: 'plain text' },
    ]);
    expect(Object.isFrozen(events[0])).toBe(true);
    expect(Object.isFrozen(events[0].data)).toBe(true);
    expect(session.getSnapshot()).not.toHaveProperty('events');
    streams[0].finish();
  });

  it('skips the subagent binding and payloads that are not plain data', async () => {
    const { streams, started, session } = fixture();
    const listener = vi.fn();
    session.onCustomEvent(listener);
    void session.submit('Hello');
    await started;
    streams[0].release(
      custom({
        type: 'threadplane.subagent_binding',
        namespace: 'tools:1',
        tool_call_id: 'call',
      })
    );
    streams[0].release(custom({ when: new Date(0) }));
    streams[0].release(delta('Hi'));
    await settled(session, streams[0]);
    expect(listener).not.toHaveBeenCalled();
    expect(session.getSnapshot().messages.some((m) => m.content === 'Hi')).toBe(true);
    streams[0].finish();
  });

  it('does not replay earlier events and stops delivery on release', async () => {
    const { streams, started, session } = fixture();
    const early = vi.fn();
    const release = session.onCustomEvent(early);
    void session.submit('Hello');
    await started;
    streams[0].release(custom({ name: 'first', data: 1 }));
    await settled(session, streams[0]);
    const late = vi.fn();
    session.onCustomEvent(late);
    release();
    release();
    streams[0].release(custom({ name: 'second', data: 2 }));
    await settled(session, streams[0]);
    expect(early.mock.calls).toEqual([[{ name: 'first', data: 1 }]]);
    expect(late.mock.calls).toEqual([[{ name: 'second', data: 2 }]]);
    streams[0].finish();
  });

  it('isolates a throwing listener from the run and other listeners', async () => {
    const { streams, started, session } = fixture();
    const after = vi.fn();
    session.onCustomEvent(() => {
      throw new Error('listener failed');
    });
    session.onCustomEvent(after);
    const outcome = session.submit('Hello');
    await started;
    streams[0].release(custom({ name: 'tick', data: 1 }));
    streams[0].release(delta('Still streaming'));
    await settled(session, streams[0]);
    expect(after).toHaveBeenCalledWith({ name: 'tick', data: 1 });
    expect(session.getSnapshot().status).toBe('running');
    expect(
      session
        .getSnapshot()
        .messages.some((message) => message.content === 'Still streaming')
    ).toBe(true);
    streams[0].finish();
    expect(await outcome).not.toBe('error');
  });

  it('delivers nothing after disposal, even to a listener disposing mid-pass', async () => {
    const { streams, started, session } = fixture();
    const second = vi.fn();
    session.onCustomEvent(() => void session.dispose());
    session.onCustomEvent(second);
    const outcome = session.submit('Hello');
    await started;
    streams[0].release(custom({ name: 'tick', data: 1 }));
    expect(await outcome).toBe('aborted');
    expect(second).not.toHaveBeenCalled();
    const afterDispose = vi.fn();
    const release = session.onCustomEvent(afterDispose);
    streams[0].release(custom({ name: 'late', data: 2 }));
    await Promise.resolve();
    expect(afterDispose).not.toHaveBeenCalled();
    expect(() => release()).not.toThrow();
  });
});
