import { describe, expect, it } from 'vitest';
import type { RunAgentInput } from '@ag-ui/client';
import { createSession } from './create-session';
import { initialObservation, type SessionSnapshot } from './session-observation';
import { createPublication } from './session-publication';

const withState = (previous: SessionSnapshot, state: unknown): SessionSnapshot =>
  Object.freeze({ ...previous, state: state as SessionSnapshot['state'] });

describe('session plan', () => {
  it('reads the plan from the todos state key, skipping malformed steps', () => {
    const store = createPublication(
      initialObservation([], {
        todos: [
          { content: ' Find flights ', status: 'completed' },
          { content: 'Compare fares', status: 'in_progress' },
          { content: '', status: 'pending' },
          { content: 'Book', status: 'unknown' },
          { content: 'Pick seats', status: 'pending' },
        ],
      })
    );
    expect(store.getSnapshot().plan).toEqual([
      { label: 'Find flights', status: 'completed' },
      { label: 'Compare fares', status: 'in_progress' },
      { label: 'Pick seats', status: 'pending' },
    ]);
    expect(Object.isFrozen(store.getSnapshot().plan)).toBe(true);
    expect(Object.isFrozen(store.getSnapshot().plan?.[0])).toBe(true);
  });

  it('leaves plan absent when the state declares no todos', () => {
    const store = createPublication(initialObservation([], { count: 1 }));
    expect('plan' in store.getSnapshot()).toBe(false);
    store.publish(withState(store.getSnapshot(), { todos: 'not a list' }));
    expect('plan' in store.getSnapshot()).toBe(false);
  });

  it('shares unchanged steps and the whole list across state updates', () => {
    const store = createPublication(
      initialObservation([], {
        todos: [
          { content: 'One', status: 'in_progress' },
          { content: 'Two', status: 'pending' },
        ],
      })
    );
    const first = store.getSnapshot().plan;
    store.publish(
      withState(store.getSnapshot(), {
        other: 1,
        todos: [
          { content: 'One', status: 'in_progress' },
          { content: 'Two', status: 'pending' },
        ],
      })
    );
    expect(store.getSnapshot().plan).toBe(first);
    store.publish(
      withState(store.getSnapshot(), {
        todos: [
          { content: 'One', status: 'completed' },
          { content: 'Two', status: 'pending' },
        ],
      })
    );
    const second = store.getSnapshot().plan;
    expect(second).not.toBe(first);
    expect(second?.[0]).toEqual({ label: 'One', status: 'completed' });
    expect(second?.[1]).toBe(first?.[1]);
  });

  it('keeps the plan reference when the state reference is unchanged', () => {
    const store = createPublication(
      initialObservation([], { todos: [{ content: 'One', status: 'pending' }] })
    );
    const plan = store.getSnapshot().plan;
    store.publish(Object.freeze({ ...store.getSnapshot(), status: 'running' as const }));
    expect(store.getSnapshot().status).toBe('running');
    expect(store.getSnapshot().plan).toBe(plan);
  });

  it('drops the plan when the state no longer holds todos', () => {
    const store = createPublication(
      initialObservation([], { todos: [{ content: 'One', status: 'pending' }] })
    );
    store.publish(withState(store.getSnapshot(), {}));
    expect('plan' in store.getSnapshot()).toBe(false);
  });

  it('follows server state snapshots and deltas during a run', async () => {
    const fetcher = async (_url: string, init: RequestInit) => {
      const input = JSON.parse(String(init.body)) as RunAgentInput;
      const events = [
        { type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId },
        {
          type: 'STATE_SNAPSHOT',
          snapshot: {
            todos: [
              { content: 'Search', status: 'in_progress' },
              { content: 'Summarize', status: 'pending' },
            ],
          },
        },
        {
          type: 'STATE_DELTA',
          delta: [
            { op: 'replace', path: '/todos/0/status', value: 'completed' },
            { op: 'replace', path: '/todos/1/status', value: 'in_progress' },
          ],
        },
        { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId },
      ];
      return new Response(
        events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''),
        { headers: { 'content-type': 'text/event-stream' } }
      );
    };
    const session = createSession({ threadId: 't', url: 'unused', fetch: fetcher });
    const plans: unknown[] = [];
    session.subscribe(() => plans.push(session.getSnapshot().plan));
    try {
      expect(await session.submit('go')).toBe('success');
      expect(plans).toContainEqual([
        { label: 'Search', status: 'in_progress' },
        { label: 'Summarize', status: 'pending' },
      ]);
      expect(session.getSnapshot().plan).toEqual([
        { label: 'Search', status: 'completed' },
        { label: 'Summarize', status: 'in_progress' },
      ]);
    } finally {
      await session.dispose();
    }
  });
});
