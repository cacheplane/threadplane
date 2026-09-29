import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Client } from '@langchain/langgraph-sdk';
import { createSession, type LangGraphSession } from '@threadplane/langgraph';
import {
  createApplication,
  type ApplicationSnapshot,
} from '../shared/application.js';
import { createThreadDirectory } from '../shared/directory.js';

const [apiUrl, modelUrl, resultPath, ownerCleanupPath] = process.argv.slice(2);
assert.ok(apiUrl && modelUrl && resultPath && ownerCleanupPath);
const prompt =
  'I want to clean up old database backups older than 90 days. Walk me through what you would delete, and call request_approval before doing anything destructive so I can review your plan.';
type Message = {
  type: string;
  content: unknown;
  tool_call_id?: string;
  tool_calls?: { id: string; name: string }[];
};
const api = new Client<{ messages: Message[] }>({
  apiUrl,
  apiKey: null,
  callerOptions: { maxRetries: 0 },
  timeoutMs: 20_000,
});
const owners = new Set<LangGraphSession>();
type Application = ReturnType<typeof createApplication>;
const applications = new Set<Application>();
const threads = new Set<string>();
let creationPending = false;
const controller = new AbortController();
const abort = () => controller.abort();
const timer = setTimeout(abort, 90_000);
process.once('SIGTERM', abort);
process.once('SIGINT', abort);
const signal = controller.signal;
function own(threadId: string) {
  const session = createSession({
    assistantId: 'chat',
    apiUrl,
    threadId,
    clientOptions: { maxRetries: 0 },
  });
  owners.add(session);
  return session;
}
function ownApplication(threadId: string) {
  let url = apiUrl + '/?thread=' + encodeURIComponent(threadId);
  const application = createApplication({
    history: {
      currentUrl: () => url,
      push: (next) => {
        url = next;
      },
      subscribe: () => () => {},
    },
    directory: createThreadDirectory({
      apiBase: apiUrl,
      browserOrigin: new URL(apiUrl).origin,
    }),
    assistantId: 'chat',
    apiUrl,
  });
  applications.add(application);
  application.start();
  return application;
}
function retireApplication(application: Application) {
  application.stop();
  // The application contract retires its admission synchronously. It does not
  // expose a promise for its private session disposal.
  application.dispose();
  applications.delete(application);
}
function waitFor(
  application: Application,
  predicate: (snapshot: ApplicationSnapshot) => boolean
) {
  return new Promise<ApplicationSnapshot>((resolve, reject) => {
    let release = () => {};
    const finish = (error?: unknown) => {
      release();
      signal.removeEventListener('abort', cancelled);
      if (error) reject(error);
      else resolve(application.getSnapshot());
    };
    const cancelled = () => finish(new Error('Application proof aborted'));
    const check = () => {
      const snapshot = application.getSnapshot();
      if (signal.aborted) cancelled();
      else if (
        snapshot.list.status === 'error' ||
        snapshot.selection.status === 'error' ||
        snapshot.selection.status === 'missing'
      )
        finish(new Error('Application history admission failed'));
      else if (predicate(snapshot)) finish();
    };
    release = application.subscribe(check);
    signal.addEventListener('abort', cancelled, { once: true });
    check();
  });
}
const admitted = (snapshot: ApplicationSnapshot) =>
  snapshot.list.status === 'ready' && snapshot.selection.status === 'ready';
const settled = (snapshot: ApplicationSnapshot) =>
  !snapshot.submission.active && snapshot.submission.outcome !== null;
function pause(snapshot: NonNullable<ApplicationSnapshot['runtime']>) {
  assert.equal(snapshot.interrupts.length, 1);
  const interrupt = snapshot.interrupts[0];
  assert.match(interrupt.id!, /^[0-9a-f]{32}$/);
  assert.ok(
    interrupt.value &&
      typeof interrupt.value === 'object' &&
      !Array.isArray(interrupt.value)
  );
  assert.ok('type' in interrupt.value && 'reason' in interrupt.value);
  assert.equal(interrupt.value.type, 'approval_request');
  assert.equal(typeof interrupt.value.reason, 'string');
  assert.ok((interrupt.value.reason as string).length > 0);
  return interrupt;
}
async function journal() {
  const response = await fetch(modelUrl + '/__aimock/journal', { signal });
  assert.equal(response.ok, true);
  return (await response.json()) as {
    body: {
      messages: { role: string; content: unknown; tool_call_id?: string }[];
    };
  }[];
}
const cases: Record<string, unknown>[] = [];
try {
  assert.equal((await journal()).length, 0);
  for (const scenario of ['approve', 'deny', 'loaded', 'unmatched'] as const) {
    const answer = scenario === 'deny' ? 'denied' : 'approved';
    creationPending = true;
    const thread = await api.threads.create({
      metadata: { title: 'Owned native approval proof: ' + scenario },
      signal,
    });
    assert.equal(typeof thread.thread_id, 'string');
    assert.ok(thread.thread_id.length > 0);
    threads.add(thread.thread_id);
    creationPending = false;
    let application = ownApplication(thread.thread_id);
    await waitFor(application, admitted);
    assert.equal(application.submit(prompt), true);
    assert.equal(
      (await waitFor(application, settled)).submission.outcome,
      'paused'
    );
    const original = pause(application.getSnapshot().runtime!);
    if (scenario === 'loaded') {
      retireApplication(application);
      application = ownApplication(thread.thread_id);
      await waitFor(application, admitted);
      assert.deepEqual(pause(application.getSnapshot().runtime!), original);
    }
    let unmatched: string | undefined;
    if (scenario === 'unmatched') {
      unmatched =
        original.id === '0'.repeat(32) ? '1'.repeat(32) : '0'.repeat(32);
      const before = await journal();
      // Provider routing diagnostic only; application decisions never accept
      // an arbitrary ID or raw resume value.
      const session = own(thread.thread_id);
      assert.ok(session.load);
      await session.load({ signal });
      assert.equal(
        await session.resume({ [unmatched]: 'denied' }, { signal }),
        'paused'
      );
      assert.deepEqual(pause(session.getSnapshot()), original);
      assert.deepEqual(
        await journal(),
        before,
        'An unmatched interrupt ID must not reach the model continuation'
      );
      await session.dispose();
      owners.delete(session);
    }
    const decision = application.getSnapshot().decision;
    assert.ok(decision?.canRespond);
    assert.equal(decision.id, original.id);
    assert.equal(
      application.respond(
        decision.token,
        scenario === 'deny' ? 'decline' : 'approve'
      ),
      true
    );
    assert.equal(
      (await waitFor(application, settled)).submission.outcome,
      'success'
    );
    assert.equal(application.getSnapshot().runtime!.interrupts.length, 0);
    const state = await api.threads.getState(thread.thread_id, undefined, {
      signal,
    });
    assert.deepEqual(state.next, []);
    assert.deepEqual(
      state.values.messages
        .filter((m) => m.type === 'human')
        .map((m) => m.content),
      [prompt]
    );
    const calls = state.values.messages
      .flatMap((m) => m.tool_calls ?? [])
      .filter((c) => c.name === 'request_approval');
    assert.equal(calls.length, 1);
    const tools = state.values.messages.filter((m) => m.type === 'tool');
    assert.equal(tools.length, 1);
    assert.equal(tools[0].tool_call_id, calls[0].id);
    assert.equal(tools[0].content, 'Human response: ' + answer);
    const entries = await journal();
    const continuation = entries.at(-1)!.body.messages;
    assert.deepEqual(
      continuation.filter((m) => m.role === 'user').map((m) => m.content),
      [prompt]
    );
    assert.deepEqual(
      continuation
        .filter((m) => m.role === 'tool')
        .map((m) => ({ content: m.content, tool_call_id: m.tool_call_id })),
      [{ content: 'Human response: ' + answer, tool_call_id: calls[0].id }]
    );
    cases.push({
      scenario,
      threadId: thread.thread_id,
      interrupt: original,
      answer,
      ...(unmatched ? { unmatched } : {}),
      savedTool: tools[0],
      humanMessages: 1,
    });
    retireApplication(application);
  }
  const modelJournal = await journal();
  assert.equal(
    modelJournal.length,
    8,
    'Exactly initial and continuation model requests per owned thread; no title calls'
  );
  writeFileSync(
    resultPath,
    JSON.stringify({ cases, modelJournal, prompt }, null, 2),
    { flag: 'wx' }
  );
} finally {
  const cleanup = await Promise.allSettled([
    ...[...applications].map(async (application) => {
      retireApplication(application);
    }),
    ...[...owners].map(async (owner) => {
      await owner.dispose();
    }),
    ...[...threads].map((id) => api.threads.delete(id)),
  ]);
  clearTimeout(timer);
  process.removeListener('SIGTERM', abort);
  process.removeListener('SIGINT', abort);
  assert.deepEqual(
    cleanup.filter((result) => result.status === 'rejected'),
    [],
    'All application owners synchronously retired, raw probes disposed and threads deleted while the provider is alive'
  );
  assert.equal(
    creationPending,
    false,
    'Thread creation outcome was not confirmed'
  );
  writeFileSync(
    ownerCleanupPath,
    JSON.stringify({ ownersDisposed: true, threadsDeleted: true }),
    { flag: 'wx' }
  );
}
