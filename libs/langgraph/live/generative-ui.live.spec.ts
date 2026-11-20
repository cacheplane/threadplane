import { onAgentStateUpdate, type PlainValue } from '@threadplane/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveSession, startLiveBackend, type LiveBackend } from './backend';

/**
 * Render-store updates against the generative-UI graph: after its tools have
 * produced the dashboard's data, a node writes `state_update` custom events
 * that map render-store paths to values.
 */
let backend: LiveBackend;
const sessions: { dispose(): Promise<void> }[] = [];

beforeAll(async () => {
  backend = await startLiveBackend({
    python: 'cockpit/chat/generative-ui/python',
    graph: 'c-generative-ui',
    fixtures: [
      'cockpit/chat/generative-ui/angular/e2e/fixtures/c-generative-ui.json',
    ],
  });
});
afterAll(async () => {
  await Promise.allSettled(sessions.map((session) => session.dispose()));
  await backend?.stop();
});

describe('render-store updates', () => {
  it('delivers the state_update events a run emits through the core helper', async () => {
    const session = liveSession(backend);
    sessions.push(session);
    const updates: Readonly<Record<string, PlainValue>>[] = [];
    const events: string[] = [];
    const release = onAgentStateUpdate(session, (update) =>
      updates.push(update)
    );
    session.onCustomEvent((event) => events.push(event.name));

    expect(
      await session.submit('Show me a dashboard of airline operations.')
    ).toBe('success');

    // The graph emitted at least one update, and each maps paths to values.
    expect(updates.length).toBeGreaterThan(0);
    expect(events.filter((name) => name === 'state_update')).toHaveLength(
      updates.length
    );
    const paths = updates.flatMap((update) => Object.keys(update));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => path.startsWith('/'))).toBe(true);
    expect(updates.every((update) => Object.isFrozen(update))).toBe(true);

    // The updates are the dashboard data the graph also saved in its state:
    // each `/slot/field` value is the saved `dashboard[slot][field]`.
    const dashboard = session.getSnapshot().state?.['dashboard'] as
      | Record<string, PlainValue>
      | undefined;
    expect(dashboard).toBeDefined();
    const merged = Object.assign({}, ...updates) as Record<string, PlainValue>;
    for (const [path, value] of Object.entries(merged)) {
      const [slot, field] = path.slice(1).split('/');
      const saved = dashboard?.[slot];
      expect(
        field === undefined
          ? saved
          : (saved as Record<string, PlainValue> | undefined)?.[field],
        path
      ).toEqual(value);
    }

    // Events are not state: a listener added now hears nothing of that run,
    // and a released one hears nothing of the next.
    const late: unknown[] = [];
    onAgentStateUpdate(session, (update) => late.push(update));
    release();
    const heard = updates.length;
    expect(late).toEqual([]);
    expect(await session.submit('Filter to only the cancelled flights.')).toBe(
      'success'
    );
    expect(updates).toHaveLength(heard);
    expect(late.length).toBeGreaterThan(0);
  });
});
