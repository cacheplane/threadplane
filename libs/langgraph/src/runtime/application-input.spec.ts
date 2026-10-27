import type { PlainValue } from '@threadplane/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import type { LangGraphSnapshot } from './langgraph-snapshot';
import { controlledTransport } from './testing/controlled-transport';
import { deferred } from './testing/deferred';
import type { AgentTransport, StreamEvent } from './transport.types';

const sessions: ReturnType<typeof createSession>[] = [];
function fixture() {
  const streams: ReturnType<typeof controlledTransport<StreamEvent>>[] = [];
  const starts = Array.from({ length: 4 }, () => deferred<void>());
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
  });
  const f = {
    session,
    streams,
    stream,
    started: (index = 0) => starts[index].promise,
  };
  sessions.push(session);
  return f;
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
});

describe('application submit input', () => {
  it('captures message, state and signal once before dispatch without publishing optimistic values', async () => {
    const f = fixture();
    const controller = new AbortController();
    const state = { model: 'original', itinerary: [{ city: 'Paris' }] };
    const message = vi.fn(() => 'Question');
    const readState = vi.fn(() => state);
    const signal = vi.fn(() => controller.signal);
    const observed: LangGraphSnapshot[] = [];
    f.session.subscribe(() => observed.push(f.session.getSnapshot()));
    const run = f.session.submit(
      {
        get message() {
          return message();
        },
        get state() {
          return readState();
        },
      },
      {
        get signal() {
          return signal();
        },
      }
    );
    state.model = 'changed';
    state.itinerary[0].city = 'London';
    await f.started();
    expect(f.stream.mock.calls[0][2]).toEqual({
      model: 'original',
      itinerary: [{ city: 'Paris' }],
      messages: [
        { type: 'human', id: expect.any(String), content: 'Question' },
      ],
    });
    expect(message).toHaveBeenCalledTimes(1);
    expect(readState).toHaveBeenCalledTimes(1);
    expect(signal).toHaveBeenCalledTimes(1);
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every((snapshot) => snapshot.values === undefined)).toBe(
      true
    );
    f.streams[0].release({
      type: 'values',
      data: {
        model: 'server',
        messages: [{ type: 'ai', id: 'answer', content: 'Done' }],
      },
    });
    f.streams[0].finish();
    expect(await run).toBe('success');
    expect(f.session.getSnapshot().values).toEqual({ model: 'server' });
    const prior = f.session.getSnapshot().values;
    const later = f.session.submit({
      message: 'Next',
      state: { model: 'next' },
    });
    await f.started(1);
    expect(f.session.getSnapshot().values).toBe(prior);
    expect(
      observed.every(
        (snapshot) => snapshot.values === undefined || snapshot.values === prior
      )
    ).toBe(true);
    await f.session.stop();
    await later;
    const plain = f.session.submit('Plain');
    await f.started(2);
    expect(Object.keys(f.stream.mock.calls[2][2] as object)).toEqual([
      'messages',
    ]);
    await f.session.stop();
    await plain;
  });

  for (const mode of ['disposed', 'aborted'] as const) {
    it(`does not traverse input when ${mode}`, async () => {
      const f = fixture();
      const controller = new AbortController();
      if (mode === 'disposed') await f.session.dispose();
      else controller.abort();
      const read = vi.fn(() => {
        throw new Error('must not read');
      });
      const before = f.session.getSnapshot();
      expect(
        await f.session.submit(
          {
            message: 'Ignored',
            get state() {
              return read();
            },
          },
          { signal: controller.signal }
        )
      ).toBe('aborted');
      expect(read).not.toHaveBeenCalled();
      expect(f.session.getSnapshot()).toBe(before);
      expect(f.stream).not.toHaveBeenCalled();
    });
  }

  for (const invalid of [
    'getter',
    'cycle',
    'instance',
    'root instance',
    'array',
  ] as const) {
    it(`rejects ${invalid} capture while preserving the active stream and snapshot`, async () => {
      const f = fixture();
      const active = f.session.submit('Active');
      await f.started();
      const before = f.session.getSnapshot();
      const cycle: Record<string, PlainValue> = {};
      cycle['self'] = cycle;
      const state =
        invalid === 'getter'
          ? {
              get bad(): never {
                throw new Error('capture failed');
              },
            }
          : invalid === 'cycle'
          ? cycle
          : invalid === 'instance'
          ? { nested: new Date(0) }
          : invalid === 'array'
          ? []
          : new Date(0);
      await expect(
        f.session.submit({ message: 'Rejected', state: state as never })
      ).rejects.toThrow();
      expect(f.session.getSnapshot()).toBe(before);
      expect(f.stream.mock.calls[0][3].aborted).toBe(false);
      expect(f.stream).toHaveBeenCalledTimes(1);
      f.streams[0].release({
        type: 'values',
        data: {
          messages: [{ type: 'ai', id: 'answer', content: 'Still active' }],
        },
      });
      f.streams[0].finish();
      expect(await active).toBe('success');
    });
  }

  for (const source of ['message', 'state', 'nested', 'signal'] as const) {
    for (const action of ['stop', 'dispose', 'submit'] as const) {
      it(`discards outer capture when ${source} getter invokes ${action}`, async () => {
        const f = fixture();
        const active = f.session.submit('Active');
        await f.started();
        let nested: Promise<unknown> | undefined;
        const invoke = () => {
          nested =
            action === 'submit'
              ? f.session.submit('Newer')
              : f.session[action]();
        };
        const read = vi.fn(() => ({ model: 'outer' }));
        const outer = f.session.submit(
          {
            get message() {
              if (source === 'message') invoke();
              return 'Outer';
            },
            get state() {
              if (source === 'state') invoke();
              return source === 'nested'
                ? {
                    get model() {
                      invoke();
                      return 'outer';
                    },
                  }
                : read();
            },
          },
          {
            get signal() {
              if (source === 'signal') invoke();
              return undefined;
            },
          }
        );
        // An invalid outer attempt must settle without replacing the command
        // that synchronously ran inside a caller getter.
        expect(await outer).toBe('aborted');
        expect(await active).toBe(
          action === 'submit' ? 'interrupted' : 'aborted'
        );
        expect(
          f.session
            .getSnapshot()
            .messages.some((message) => message.content === 'Outer')
        ).toBe(false);
        if (source === 'signal') expect(read).not.toHaveBeenCalled();
        if (action === 'submit') {
          await f.started(1);
          await f.session.stop();
        }
        await nested;
        expect(f.stream).toHaveBeenCalledTimes(action === 'submit' ? 2 : 1);
      });
    }
  }

  it('rechecks abort after state getters before superseding active work', async () => {
    const f = fixture();
    const active = f.session.submit('Active');
    await f.started();
    const before = f.session.getSnapshot();
    const controller = new AbortController();
    expect(
      await f.session.submit(
        {
          message: 'Outer',
          state: {
            get model() {
              controller.abort();
              return 'ignored';
            },
          },
        },
        { signal: controller.signal }
      )
    ).toBe('aborted');
    expect(f.session.getSnapshot()).toBe(before);
    expect(f.stream.mock.calls[0][3].aborted).toBe(false);
    await f.session.stop();
    await active;
  });
});
