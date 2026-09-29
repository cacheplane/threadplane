import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Client } from '@langchain/langgraph-sdk';
import {
  createApplication,
  type ApplicationSnapshot,
} from '../shared/application.js';
import { createThreadDirectory } from '../shared/directory.js';
import {
  scenarios,
  prompts,
  listPrompt,
  seed,
  remaining,
  deletionResult,
  emptyListResult,
  title,
  type Backup,
} from './backup-provider-contract.js';

type Message = {
  id: string;
  type: string;
  content: string;
  tool_call_id?: string;
  tool_calls?: { id: string; name: string; args: unknown }[];
};
type Values = { messages: Message[]; backups: Backup[] };
const [apiUrl, modelUrl, resultPath, ownerCleanupPath] = process.argv.slice(2);
assert.ok(apiUrl && modelUrl && resultPath && ownerCleanupPath);
const api = new Client<Values>({
  apiUrl,
  apiKey: null,
  callerOptions: { maxRetries: 0 },
  timeoutMs: 20_000,
});
type Application = ReturnType<typeof createApplication>;
const applications = new Set<Application>();
const threads = new Set<string>();
let creationPending = false;
const controller = new AbortController();
const signal = controller.signal;
const abort = () => controller.abort();
const timer = setTimeout(abort, 90_000);
process.once('SIGTERM', abort);
process.once('SIGINT', abort);
function own(threadId: string) {
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
function retire(application: Application) {
  application.stop();
  // This is synchronous admission retirement, not an invented awaited API.
  application.dispose();
  applications.delete(application);
}
function waitFor(
  application: Application,
  predicate: (snapshot: ApplicationSnapshot) => boolean
) {
  return new Promise<ApplicationSnapshot>((resolve, reject) => {
    let release = () => {};
    const finish = (error?: Error) => {
      release();
      signal.removeEventListener('abort', cancelled);
      if (error) reject(error);
      else resolve(application.getSnapshot());
    };
    const cancelled = () => finish(new Error('Backup proof aborted'));
    const check = () => {
      const snapshot = application.getSnapshot();
      if (signal.aborted) cancelled();
      else if (
        snapshot.list.status === 'error' ||
        snapshot.selection.status === 'error' ||
        snapshot.selection.status === 'missing'
      )
        finish(new Error('Backup history admission failed'));
      else if (predicate(snapshot)) finish();
    };
    release = application.subscribe(check);
    signal.addEventListener('abort', cancelled, { once: true });
    check();
  });
}
const admitted = (s: ApplicationSnapshot) =>
  s.list.status === 'ready' && s.selection.status === 'ready';
const settled = (s: ApplicationSnapshot) =>
  !s.submission.active && s.submission.outcome !== null;
async function journal(cleanup = false) {
  const response = await fetch(modelUrl + '/__aimock/journal', {
    signal: cleanup ? AbortSignal.timeout(3000) : signal,
  });
  assert.equal(response.ok, true);
  return (await response.json()) as unknown[];
}
function rawTools(snapshot: ApplicationSnapshot) {
  return snapshot.messages
    .filter((row) => row.role === 'tool')
    .map((row) => ({
      content: row.message.content,
      tool_call_id: row.message.toolCallId,
    }));
}
function savedTools(values: Values) {
  return values.messages
    .filter((m) => m.type === 'tool')
    .map((m) => ({ content: m.content, tool_call_id: m.tool_call_id }));
}
function assertTranscript(snapshot: ApplicationSnapshot, values: Values) {
  const liveMessages = snapshot.runtime!.messages;
  assert.deepEqual(
    liveMessages.map((message) => message.id),
    values.messages.map((message) => message.id),
    'Live transcript must retain exactly the saved canonical message IDs: ' +
      JSON.stringify(liveMessages)
  );
}
const cases: Record<string, unknown>[] = [];
let modelJournal: unknown[] = [];
try {
  assert.deepEqual(await journal(), []);
  for (const scenario of scenarios) {
    creationPending = true;
    const thread = await api.threads.create({
      graphId: 'chat',
      metadata: { title: title(scenario) },
      signal,
    });
    assert.ok(thread.thread_id);
    threads.add(thread.thread_id);
    creationPending = false;
    const threadId = thread.thread_id;
    const seeded = seed(scenario);
    const checkpoint = await api.threads.updateState(threadId, {
      values: { backups: seeded },
      signal,
    });
    const setup = await api.threads.getState(threadId, undefined, { signal });
    assert.deepEqual(setup.values.backups, seeded);
    assert.deepEqual(setup.values.messages, []);
    assert.deepEqual(setup.next, ['generate']);
    let application = own(threadId);
    await waitFor(application, admitted);
    assert.deepEqual(
      application.getSnapshot().runtime!.values?.backups,
      seeded
    );
    assert.equal(application.submit(prompts[scenario]), true);
    const paused = await waitFor(application, settled);
    assert.equal(paused.submission.outcome, 'paused');
    assert.deepEqual(paused.runtime!.values?.backups, seeded);
    assert.equal(paused.runtime!.interrupts.length, 1);
    const decision = paused.decision;
    assert.ok(decision?.canRespond);
    assert.match(decision.id, /^[0-9a-f]{32}$/);
    const before = await api.threads.getState(threadId, undefined, { signal });
    assertTranscript(paused, before.values);
    assert.deepEqual(before.values.backups, seeded);
    assert.deepEqual(savedTools(before.values), []);
    const calls = before.values.messages.flatMap((m) => m.tool_calls ?? []);
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.name, 'delete_backups');
    assert.deepEqual(call.args, { ids: ['proof-delete'] });
    assert.ok(call.id);
    assert.equal(
      application.respond(
        decision.token,
        scenario === 'decline' ? 'decline' : 'approve'
      ),
      true
    );
    const completed = await waitFor(application, settled);
    assert.equal(completed.submission.outcome, 'success');
    assert.equal(completed.decision, null);
    assert.deepEqual(completed.runtime!.values?.backups, remaining(scenario));
    const after = await api.threads.getState(threadId, undefined, { signal });
    assertTranscript(completed, after.values);
    assert.deepEqual(after.next, []);
    assert.deepEqual(after.values.backups, remaining(scenario));
    const tools = savedTools(after.values);
    assert.equal(tools.length, 1);
    assert.equal(tools[0].tool_call_id, call.id);
    assert.deepEqual(JSON.parse(tools[0].content), deletionResult(scenario));
    assert.deepEqual(rawTools(completed), tools);
    let final = after;
    if (scenario === 'empty') {
      assert.equal(application.submit(listPrompt), true);
      const listed = await waitFor(application, settled);
      assert.equal(listed.submission.outcome, 'success');
      assert.deepEqual(listed.runtime!.values?.backups, []);
      final = await api.threads.getState(threadId, undefined, { signal });
      assertTranscript(listed, final.values);
      assert.deepEqual(final.values.backups, []);
      const listCalls = final.values.messages
        .flatMap((m) => m.tool_calls ?? [])
        .filter((c) => c.name === 'list_backups');
      assert.equal(listCalls.length, 1);
      assert.deepEqual(listCalls[0].args, { older_than_days: 0 });
      const results = savedTools(final.values);
      assert.equal(results.length, 2);
      assert.equal(results[1].tool_call_id, listCalls[0].id);
      assert.deepEqual(JSON.parse(results[1].content), emptyListResult);
      assert.deepEqual(rawTools(listed), results);
    }
    assert.deepEqual(
      final.values.messages
        .filter((m) => m.type === 'human')
        .map((m) => m.content),
      [prompts[scenario], ...(scenario === 'empty' ? [listPrompt] : [])]
    );
    retire(application);
    const beforeReload = await journal();
    application = own(threadId);
    const restored = await waitFor(application, admitted);
    assertTranscript(restored, final.values);
    assert.deepEqual(restored.runtime!.values?.backups, remaining(scenario));
    assert.deepEqual(rawTools(restored), savedTools(final.values));
    assert.equal(restored.decision, null);
    assert.ok(restored.messages.every((row) => row.tripSummaries.length === 0));
    assert.deepEqual(
      await journal(),
      beforeReload,
      'Fresh history observation must not invoke the model'
    );
    cases.push({
      scenario,
      threadId,
      checkpoint,
      setup,
      paused: before,
      interrupt: paused.runtime!.interrupts[0],
      saved: after,
      final,
      restored: {
        backups: restored.runtime!.values?.backups,
        tools: rawTools(restored),
        cards: restored.messages.flatMap((row) => row.tripSummaries).length,
      },
    });
    retire(application);
  }
  modelJournal = await journal();
  assert.equal(modelJournal.length, 8);
} finally {
  // Preserve partial diagnostics without allowing a journal failure to skip cleanup.
  try {
    modelJournal = await journal(true);
  } catch {
    /* Exercise failure remains authoritative. */
  }
  const cleanup = await Promise.allSettled([
    ...[...applications].map(async (application) => {
      retire(application);
    }),
    ...[...threads].map((threadId) => api.threads.delete(threadId)),
  ]);
  clearTimeout(timer);
  process.removeListener('SIGTERM', abort);
  process.removeListener('SIGINT', abort);
  writeFileSync(resultPath, JSON.stringify({ cases, modelJournal }, null, 2), {
    flag: 'wx',
  });
  assert.deepEqual(
    cleanup.filter((item) => item.status === 'rejected'),
    [],
    'All known applications retired and threads deleted while provider alive'
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
