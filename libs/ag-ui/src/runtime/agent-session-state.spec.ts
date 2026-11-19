import { describe, expect, it, vi } from 'vitest';
import { type, type StandardSchemaV1 } from '@threadplane/core';
import { createAgentSession, type NativeSession } from './agent-session';
import {
  initialObservation,
  type SessionSnapshot,
} from './session-observation';
import { bindingFixture } from './testing/binding-fixture';

interface Counter {
  readonly count: number;
  readonly label?: string;
}
/** A hand-written Standard Schema: `count` must be a number, and is doubled. */
function doubling(validate = vi.fn()): StandardSchemaV1<unknown, Counter> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate(value) {
        validate(value);
        const count = (value as { count?: unknown } | null)?.count;
        return typeof count === 'number'
          ? { value: { count: count * 2 } }
          : { issues: [{ message: 'count must be a number' }] };
      },
    },
  };
}
/** A native session whose snapshot the test replaces by hand. */
function controlled<TState = unknown>(
  first: SessionSnapshot,
  stateType?: NativeSession<TState>['stateType']
) {
  let snapshot = first;
  const listeners = new Set<() => void>();
  const native: NativeSession<TState> = {
    ...(stateType && { stateType }),
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => void listeners.delete(notify);
    },
    submit: vi.fn(async () => 'success' as const),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  return {
    native,
    publish(extra: Partial<SessionSnapshot>) {
      snapshot = Object.freeze({ ...snapshot, ...extra });
      for (const notify of [...listeners]) notify();
    },
  };
}

describe('createAgentSession state', () => {
  it('reports no state for a session created without one', () => {
    const source = controlled(initialObservation([]));
    const session = createAgentSession(source.native);
    expect(source.native.getSnapshot().state).toEqual({});
    expect('state' in session.getSnapshot()).toBe(false);
    expect('stateIssues' in session.getSnapshot()).toBe(false);
  });

  it('publishes the supplied state document by reference and tells subscribers when it changes', () => {
    const source = controlled(initialObservation([], { count: 1 }));
    const session = createAgentSession(source.native);
    const first = session.getSnapshot();
    expect(first.state).toBe(source.native.getSnapshot().state);
    expect(Object.isFrozen(first.state)).toBe(true);
    const notify = vi.fn();
    session.subscribe(notify);
    source.publish({ reasoningDurations: { missing: 5 } });
    expect(notify).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toBe(first);
    const next = Object.freeze({ count: 2 });
    source.publish({ state: next });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().state).toBe(next);
    // An empty document the backend reported is a state, unlike the default.
    const empty = Object.freeze({});
    source.publish({ state: empty });
    expect(session.getSnapshot().state).toBe(empty);
  });

  it('trusts a type() declaration without checking', () => {
    const source = controlled(
      initialObservation([], { count: 'three' }),
      type<Counter>()
    );
    const session = createAgentSession(source.native);
    expect(session.getSnapshot().state).toEqual({ count: 'three' });
    expect('stateIssues' in session.getSnapshot()).toBe(false);
  });

  it('checks each document once and publishes the schema output, frozen', () => {
    const validate = vi.fn();
    const source = controlled(
      initialObservation([], { count: 2 }),
      doubling(validate)
    );
    const session = createAgentSession(source.native);
    const first = session.getSnapshot();
    expect(first.state).toEqual({ count: 4 });
    expect(Object.isFrozen(first.state)).toBe(true);
    // The native document, which requests send, is not the schema output.
    expect(source.native.getSnapshot().state).toEqual({ count: 2 });
    source.publish({ status: 'running' });
    expect(session.getSnapshot().state).toBe(first.state);
    session.getSnapshot();
    expect(validate).toHaveBeenCalledTimes(1);
    source.publish({ state: Object.freeze({ count: 5 }) });
    expect(session.getSnapshot().state).toEqual({ count: 10 });
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it('keeps the last valid state and lists the issues when a document is rejected', () => {
    const source = controlled(
      initialObservation([], { count: 1 }),
      doubling()
    );
    const session = createAgentSession(source.native);
    const valid = session.getSnapshot().state;
    const notify = vi.fn();
    session.subscribe(notify);
    source.publish({ state: Object.freeze({ count: 'many' }) });
    expect(notify).toHaveBeenCalledTimes(1);
    const rejected = session.getSnapshot();
    expect(rejected.state).toBe(valid);
    expect(rejected.stateIssues).toEqual(['count must be a number']);
    expect(Object.isFrozen(rejected.stateIssues)).toBe(true);
    expect(rejected.status).toBe('idle');
    expect('error' in rejected).toBe(false);
    source.publish({ state: Object.freeze({ count: 3 }) });
    expect(session.getSnapshot().state).toEqual({ count: 6 });
    expect('stateIssues' in session.getSnapshot()).toBe(false);
  });

  it('has no state while the first document is rejected, and asks nothing about the default', () => {
    const validate = vi.fn();
    const untouched = controlled(initialObservation([]), doubling(validate));
    const quiet = createAgentSession(untouched.native).getSnapshot();
    expect('state' in quiet).toBe(false);
    expect('stateIssues' in quiet).toBe(false);
    expect(validate).not.toHaveBeenCalled();
    const source = controlled(initialObservation([], { count: null }), doubling());
    const snapshot = createAgentSession(source.native).getSnapshot();
    expect('state' in snapshot).toBe(false);
    expect(snapshot.stateIssues).toEqual(['count must be a number']);
  });

  it('rejects schema output that is not plain data', () => {
    const schema: StandardSchemaV1<unknown, { at: Date }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({ value: { at: new Date(0) } }),
      },
    };
    const source = controlled(initialObservation([], { at: 0 }), schema);
    const snapshot = createAgentSession(source.native).getSnapshot();
    expect('state' in snapshot).toBe(false);
    expect(snapshot.stateIssues).toEqual([
      'The state schema must produce plain data.',
    ]);
  });

  it('types and checks the state of a real session across a run', async () => {
    const fixture = bindingFixture({ stateType: doubling() });
    try {
      const session = createAgentSession(fixture.session);
      expect('state' in session.getSnapshot()).toBe(false);
      const run = session.submit({ message: 'Go', state: { count: 1 } });
      const exchange = await fixture.started();
      // The request carries the document as submitted, not the schema output.
      expect(exchange.body.state).toEqual({ count: 1 });
      expect(session.getSnapshot().state).toEqual({ count: 2 });
      exchange.emit({ type: 'STATE_SNAPSHOT', snapshot: { count: 4 } });
      await fixture.changed((snapshot) => (snapshot.state as { count: unknown }).count === 4);
      const count: number | undefined = session.getSnapshot().state?.count;
      expect(count).toBe(8);
      exchange.emit({
        type: 'STATE_DELTA',
        delta: [{ op: 'replace', path: '/count', value: 'lots' }],
      });
      await fixture.changed((snapshot) => (snapshot.state as { count: unknown }).count === 'lots');
      expect(session.getSnapshot()).toMatchObject({
        status: 'running',
        state: { count: 8 },
        stateIssues: ['count must be a number'],
      });
      exchange.emit({
        type: 'RUN_FINISHED',
        threadId: exchange.body.threadId,
        runId: exchange.body.runId,
      });
      exchange.end();
      await expect(run).resolves.toBe('success');
      expect(session.getSnapshot().status).toBe('idle');
    } finally {
      await fixture.cleanup();
    }
  });
});
