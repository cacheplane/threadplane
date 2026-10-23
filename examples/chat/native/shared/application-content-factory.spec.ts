import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSession } from '@threadplane/langgraph';
import {
  createApplication,
  type ApplicationOptions,
  type ApplicationSession,
} from './application.js';
import {
  createMessageContent,
  type MessageContent,
} from './message-content.js';
import type { Message } from '@threadplane/core';
import { applicationTools } from './trip-summary.js';

async function until(predicate: () => boolean) {
  const end = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < end, 'Expected content admission before deadline');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function fixture(events: string[]) {
  let url = 'http://example.test/?thread=a';
  const subscriptions = new Map<string, Set<() => void>>();
  const runtimes = new Map<
    string,
    ReturnType<ApplicationSession['getSnapshot']>
  >();
  const options: ApplicationOptions = {
    assistantId: 'assistant',
    apiUrl: 'http://example.test/api',
    history: {
      currentUrl: () => url,
      push(next) {
        url = next;
      },
      subscribe: () => () => {},
    },
    directory: {
      async get(id) {
        return { kind: 'ready', value: { id, title: id } };
      },
      async list() {
        return { kind: 'ready', value: [] };
      },
      async create() {
        return { kind: 'failed' };
      },
    },
    sessionFactory(id) {
      const session = createSession({
        tools: applicationTools,
        assistantId: 'assistant',
        apiUrl: 'http://example.test/api',
        threadId: id,
      });
      const message: Message = {
        id,
        role: 'assistant',
        content: id,
        delivery: { generation: id, phase: 'complete', outcome: 'success' },
      };
      const runtime = { ...session.getSnapshot(), messages: [message] };
      runtimes.set(id, runtime);
      const listeners = new Set<() => void>();
      subscriptions.set(id, listeners);
      return {
        ...session,
        getSnapshot: () => runtime,
        // No remote calls: initial runtime publication suffices for ownership.
        async load() {},
        subscribe(notify) {
          events.push(`subscribe:${id}`);
          listeners.add(notify);
          return () => {
            events.push(`release:${id}`);
            listeners.delete(notify);
          };
        },
        async dispose() {
          events.push(`session-dispose:${id}`);
          await session.dispose();
        },
      };
    },
  };
  return { options, subscriptions, runtimes };
}

test('content factory owns one owner per admitted session and updates before publication', async () => {
  const events: string[] = [];
  const { options, subscriptions, runtimes } = fixture(events);
  const owners: { updates: number; disposals: number }[] = [];
  const publications: {
    readonly id: string | null;
    readonly sessionId: string;
    readonly message: Message;
    readonly runtimeMessage: Message;
  }[] = [];
  const app = createApplication({
    ...options,
    contentFactory() {
      const work = { updates: 0, disposals: 0 };
      owners.push(work);
      const id = owners.length === 1 ? 'a' : 'b';
      const content = createMessageContent();
      let rows: readonly (MessageContent & { readonly sessionId: string })[] =
        [];
      return {
        getSnapshot: () => rows,
        update(messages, toolCalls) {
          assert.strictEqual(messages, runtimes.get(id)!.messages);
          assert.strictEqual(toolCalls, runtimes.get(id)!.toolCalls);
          content.update(messages, toolCalls);
          rows = content
            .getSnapshot()
            .map((row) => ({ ...row, sessionId: id }));
          work.updates++;
          events.push(`update:${id}`);
        },
        dispose() {
          work.disposals++;
          events.push(`content-dispose:${id}`);
          content.dispose();
        },
      };
    },
  });
  app.subscribe(() => {
    if (app.getSnapshot().runtime) {
      const state = app.getSnapshot();
      publications.push({
        id: state.selection.id,
        sessionId: state.messages[0]?.sessionId,
        message: state.messages[0]?.message,
        runtimeMessage: state.runtime!.messages[0],
      });
      events.push('published');
    }
  });
  app.start();
  await until(() => app.getSnapshot().runtime !== null);
  assert.equal(owners.length, 1);
  assert.ok(events.indexOf('update:a') < events.indexOf('published'));
  for (const notify of subscriptions.get('a')!) notify();
  assert.equal(owners.length, 1);
  assert.equal(owners[0].updates, 2);
  app.select('b');
  assert.deepEqual(events.slice(-3), [
    'release:a',
    'content-dispose:a',
    'session-dispose:a',
  ]);
  await until(() => app.getSnapshot().runtime !== null);
  assert.equal(owners.length, 2);
  assert.equal(subscriptions.get('a')!.size, 0);
  app.dispose();
  app.dispose();
  assert.deepEqual(
    owners.map((owner) => owner.disposals),
    [1, 1]
  );
  assert.equal(subscriptions.get('b')!.size, 0);
  assert.ok(publications.length >= 2);
  for (const publication of publications) {
    assert.equal(publication.sessionId, publication.id);
    assert.strictEqual(publication.message, publication.runtimeMessage);
  }
});

test('content factory reentry retires its returned stale owner before attachment or update', async () => {
  const events: string[] = [];
  const { options, subscriptions } = fixture(events);
  let factories = 0;
  let staleUpdates = 0;
  let staleDisposals = 0;
  const app = createApplication({
    ...options,
    contentFactory() {
      factories++;
      if (factories !== 1) return createMessageContent();
      app.select('b');
      return {
        getSnapshot: () => [],
        update() {
          staleUpdates++;
        },
        dispose() {
          staleDisposals++;
        },
      };
    },
  });
  app.start();
  await until(() => factories === 2 && app.getSnapshot().runtime !== null);
  assert.equal(app.getSnapshot().selection.id, 'b');
  assert.equal(staleDisposals, 1);
  assert.equal(staleUpdates, 0);
  assert.equal(subscriptions.get('a')!.size, 0);
  assert.equal(
    events.filter((event) => event === 'session-dispose:a').length,
    1
  );
  app.dispose();
  assert.equal(staleDisposals, 1);
});
