import { readFileSync } from 'node:fs';
import { Client } from '@langchain/langgraph-sdk';
import { createSession } from '@threadplane/langgraph';
import { it, expect, vi } from 'vitest';
import { captureAuthority, captureBaseline, captureTurn } from './authority';
import { projectIndex } from './index-projection';
import { projectReads } from './read-projection';
// Generated offline from the actual compiled Skills graph, deterministic injected
// LocalModel, InMemorySaver, deepagents 0.7.11; socket.connect was blocked.
// Full source capture script and history are private /tmp Task2 evidence.
const actual = JSON.parse(
  readFileSync(
    new URL('./fixtures/actual-skills-root.json', import.meta.url),
    'utf8'
  )
);
it.each([
  {
    name: 'preserves actual root skills_metadata across native run, installed SDK history, and native load',
    filtered: false,
  },
  {
    name: 'confirms filtered deployed public values through genuine native submit and installed SDK load',
    filtered: true,
  },
])('$name', async ({ filtered }) => {
  const requests: string[] = [];
  const fetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      ).pathname;
      requests.push(path);
      if (!path.startsWith('/threads/offline-skills-task2/'))
        throw Error('Unexpected offline request');
      if (path.endsWith('/state/checkpoint')) {
        expect(JSON.parse(init?.body as string).checkpoint).toEqual(
          actual.current.checkpoint
        );
      } else if (!path.endsWith('/state') && !path.endsWith('/history'))
        throw Error('Unsupported offline route');
      return new Response(
        JSON.stringify(
          path.endsWith('/history')
            ? actual.history
            : path.endsWith('/state/checkpoint')
            ? actual.exact
            : actual.current
        ),
        { headers: { 'content-type': 'application/json' } }
      );
    }
  );
  const sdk = new Client({
    apiUrl: 'http://offline.invalid',
    apiKey: null,
    callerOptions: { fetch, maxRetries: 0 },
  });
  const crypto = globalThis.crypto;
  vi.stubGlobal('crypto', { randomUUID: () => 'offline-human' });
  const session = createSession({
    assistantId: 'da-skills',
    threadId: 'offline-skills-task2',
    transport: {
      async *stream(_a, _t, payload) {
        expect((payload as any).messages[0]).toEqual({
          type: 'human',
          id: 'offline-human',
          content: 'Inspect bundled skills.',
        });
        // Model the observed deployed public key set, retaining the compiled
        // graph checkpoint unchanged. Both snapshots come from createSession.
        const publicValues = Object.fromEntries(
          Object.entries(actual.rootValues).filter(
            ([key]) =>
              !filtered ||
              (key !== 'skills_metadata' && key !== 'skills_load_errors')
          )
        );
        yield { type: 'values', data: publicValues };
      },
      getHistory: (thread) => sdk.threads.getHistory(thread),
    },
  });
  try {
    const outcome = await session.submit('Inspect bundled skills.');
    expect(outcome).toBe('success');
    const snapshot = session.getSnapshot();
    const observedState = await sdk.threads.getState('offline-skills-task2');
    const history = await sdk.threads.getHistory('offline-skills-task2');
    const loadedCheckpoint = await sdk.threads.getState(
      'offline-skills-task2',
      actual.current.checkpoint
    );
    await session.load?.();
    const loadedSnapshot = session.getSnapshot();
    if (filtered) {
      expect(Object.keys(snapshot.values ?? {})).toEqual(['files']);
      expect(Object.hasOwn(snapshot.values ?? {}, 'skills_metadata')).toBe(
        false
      );
    } else {
      expect(snapshot.values?.skills_metadata).toEqual(
        actual.current.values.skills_metadata
      );
    }
    expect(observedState).toEqual(history[0]);
    expect(loadedCheckpoint).toEqual(observedState);
    expect(loadedSnapshot.values?.skills_metadata).toEqual(
      actual.current.values.skills_metadata
    );
    expect(snapshot.toolCalls.map((c) => c.status)).toEqual([
      'complete',
      'complete',
    ]);
    expect(
      snapshot.toolCalls.every((c) => !Object.hasOwn(c, 'rawStatus'))
    ).toBe(true);
    const turn = captureTurn(captureBaseline(), {
      owner: 'owner',
      generation: 'generation',
      threadId: 'offline-skills-task2',
      humanId: 'offline-human',
      humanContent: 'Inspect bundled skills.',
    });
    const authority = captureAuthority({
      turn,
      owner: 'owner',
      generation: 'generation',
      threadId: 'offline-skills-task2',
      outcome,
      observedState,
      history,
      loadedCheckpoint,
      snapshot,
      loadedSnapshot,
    });
    expect(authority.kind).toBe('terminal');
    if (authority.kind !== 'terminal')
      throw Error('Unconfirmed actual fixture');
    const index = projectIndex({
      owner: 'owner',
      generation: 'generation',
      currentOwner: 'owner',
      currentGeneration: 'generation',
      source: 'checkpoint',
      values: authority.values,
    });
    const reads = projectReads(index, loadedSnapshot.toolCalls, authority);
    expect(Array.isArray(reads)).toBe(true);
    if (!Array.isArray(reads)) throw Error('Unavailable read evidence');
    expect(reads.map((r) => r.kind)).toEqual(['inspected', 'partial']);
    expect(requests).toHaveLength(4);
    expect(
      requests.filter((p) => p.endsWith('/state/checkpoint'))
    ).toHaveLength(1);
  } finally {
    await session.dispose();
    vi.stubGlobal('crypto', crypto);
    vi.unstubAllGlobals();
  }
});
