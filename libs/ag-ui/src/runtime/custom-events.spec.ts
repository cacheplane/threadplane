import { ok } from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import type { RunAgentInput } from '@ag-ui/client';
import type { AgentSessionCustomEvent } from '@threadplane/core';
import { createAgentSession } from './agent-session';
import { createSession, type Session } from './create-session';

/** Each request answers with the next run's events between its lifecycle. */
function wire(...runs: unknown[][]) {
  let index = 0;
  return vi.fn(async (_url: string, init: RequestInit) => {
    const input = JSON.parse(String(init.body)) as RunAgentInput;
    const ids = { threadId: input.threadId, runId: input.runId };
    return new Response(
      [
        { type: 'RUN_STARTED', ...ids },
        ...(runs[index++] ?? []),
        { type: 'RUN_FINISHED', ...ids },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(''),
      { headers: { 'content-type': 'text/event-stream' } }
    );
  });
}
/** The factory always supplies the optional listener method. */
function listen(
  owner: Pick<Session, 'onCustomEvent'>,
  listener: (event: AgentSessionCustomEvent) => void
) {
  ok(owner.onCustomEvent);
  return owner.onCustomEvent(listener);
}
const custom = (name: string, value: unknown) => ({
  type: 'CUSTOM',
  name,
  value,
});
const owners = {
  plain: (fetch: ReturnType<typeof wire>): Session =>
    createSession({ threadId: 't', url: 'unused', fetch }),
  'client-tool': (fetch: ReturnType<typeof wire>): Session =>
    createSession(
      { threadId: 't', url: 'unused', fetch },
      { f: { description: 'f', handler: async () => 'done' } }
    ),
};

describe.each(Object.entries(owners))('%s AG-UI session custom events', (_, create) => {
  it('delivers CUSTOM events other than on_interrupt as owned plain data', async () => {
    const value = { args: ['a'] };
    const owner = create(
      wire([
        custom('a2ui-partial', value),
        custom('encoded', '{"step":2}'),
        custom('text', 'not json'),
        custom('on_interrupt', '{"question":"?"}'),
      ])
    );
    const events: AgentSessionCustomEvent[] = [];
    listen(owner, (event) => {
      events.push(event);
      if (event.name === 'a2ui-partial') value.args.push('mutated');
    });
    expect(await owner.submit('hello')).toBe('success');
    expect(events).toEqual([
      { name: 'a2ui-partial', data: { args: ['a'] } },
      { name: 'encoded', data: { step: 2 } },
      { name: 'text', data: 'not json' },
    ]);
    expect(Object.isFrozen(events[0])).toBe(true);
    expect(Object.isFrozen(events[0].data)).toBe(true);
    expect(owner.getSnapshot()).not.toHaveProperty('events');
  });

  it('does not replay earlier events and stops delivery on release', async () => {
    const owner = create(wire([custom('first', 1)], [custom('second', 2)]));
    const early = vi.fn();
    const release = listen(owner, early);
    expect(await owner.submit('one')).toBe('success');
    const late = vi.fn();
    listen(owner, late);
    release();
    release();
    expect(await owner.submit('two')).toBe('success');
    expect(early.mock.calls).toEqual([[{ name: 'first', data: 1 }]]);
    expect(late.mock.calls).toEqual([[{ name: 'second', data: 2 }]]);
  });

  it('isolates a throwing listener from the run and other listeners', async () => {
    const owner = create(wire([custom('tick', 1), custom('tock', 2)]));
    const after = vi.fn();
    listen(owner, () => {
      throw new Error('listener failed');
    });
    listen(owner, after);
    expect(await owner.submit('hello')).toBe('success');
    expect(after.mock.calls).toEqual([
      [{ name: 'tick', data: 1 }],
      [{ name: 'tock', data: 2 }],
    ]);
  });

  it('delivers no later event once a listener disposes the session', async () => {
    const owner = create(wire([custom('tick', 1), custom('tock', 2)]));
    const names: string[] = [];
    listen(owner, (event) => {
      names.push(event.name);
      void owner.dispose();
    });
    expect(await owner.submit('hello')).toBe('aborted');
    expect(names).toEqual(['tick']);
    const afterDispose = vi.fn();
    const release = listen(owner, afterDispose);
    expect(() => release()).not.toThrow();
    expect(afterDispose).not.toHaveBeenCalled();
  });
});

describe('plain AG-UI session disposal', () => {
  it('stops the current pass when a listener disposes the session', async () => {
    const owner = owners.plain(wire([custom('tick', 1)]));
    const second = vi.fn();
    listen(owner, () => void owner.dispose());
    listen(owner, second);
    expect(await owner.submit('hello')).toBe('aborted');
    expect(second).not.toHaveBeenCalled();
  });
});

describe('core AG-UI session view custom events', () => {
  it('forwards listeners to the native session', async () => {
    const native = createSession({
      threadId: 't',
      url: 'unused',
      fetch: wire([custom('tick', { n: 1 })]),
    });
    const session = createAgentSession(native);
    const listener = vi.fn();
    listen(session, listener);
    expect(await session.submit('hello')).toBe('success');
    expect(listener).toHaveBeenCalledWith({ name: 'tick', data: { n: 1 } });
  });

  it('has no listener method when the native session has none', () => {
    const session = createAgentSession({
      getSnapshot: () => {
        throw new Error('unused');
      },
      subscribe: () => () => undefined,
      submit: async () => 'success',
      stop: async () => undefined,
      dispose: async () => undefined,
    });
    expect(session.onCustomEvent).toBeUndefined();
  });
});
