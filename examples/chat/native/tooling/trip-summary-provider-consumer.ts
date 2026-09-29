import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Client } from '@langchain/langgraph-sdk';
import {
  createApplication,
  type ApplicationSnapshot,
} from '../shared/application.js';
import { createThreadDirectory } from '../shared/directory.js';
import {
  prompt,
  nextPrompt,
  summaryArgs,
  summaryText,
  expectedClientTools,
} from './trip-summary-provider-contract.js';

const [apiUrl, modelUrl, resultPath, ownerCleanupPath, controlUrl] =
  process.argv.slice(2);
assert.ok(apiUrl && modelUrl && resultPath && ownerCleanupPath && controlUrl);
type Message = {
  id: string;
  type: string;
  content: unknown;
  tool_call_id?: string;
  tool_calls?: { id: string; name: string; args: unknown }[];
};
type ModelEntry = {
  body: {
    tools: {
      type: string;
      function: { name: string; description: string; parameters: unknown };
    }[];
    messages: {
      role: string;
      content: unknown;
      tool_call_id?: string;
      tool_calls?: {
        id: string;
        function: { name: string; arguments: string };
      }[];
    }[];
  };
};
const api = new Client<{ messages: Message[] }>({
  apiUrl,
  apiKey: null,
  callerOptions: { maxRetries: 0 },
  timeoutMs: 20_000,
});
type Application = ReturnType<typeof createApplication>;
const applications = new Set<Application>(),
  threads = new Set<string>();
let creationPending = false;
const controller = new AbortController(),
  signal = controller.signal;
const abort = () => controller.abort();
const timer = setTimeout(abort, 120_000);
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
function retire(app: Application) {
  app.stop();
  app.dispose();
  applications.delete(app);
}
function waitFor(
  app: Application,
  predicate: (snapshot: ApplicationSnapshot) => boolean
) {
  return new Promise<ApplicationSnapshot>((resolve, reject) => {
    let release = () => {};
    const finish = (error?: unknown) => {
      release();
      signal.removeEventListener('abort', cancelled);
      if (error) reject(error);
      else resolve(app.getSnapshot());
    };
    const cancelled = () => finish(new Error('Summary proof aborted'));
    const check = () => {
      const snapshot = app.getSnapshot();
      if (signal.aborted) cancelled();
      else if (
        snapshot.list.status === 'error' ||
        snapshot.selection.status === 'error' ||
        snapshot.selection.status === 'missing'
      )
        finish(new Error('Summary admission failed'));
      else if (predicate(snapshot)) finish();
    };
    release = app.subscribe(check);
    signal.addEventListener('abort', cancelled, { once: true });
    check();
  });
}
const admitted = (s: ApplicationSnapshot) =>
  s.list.status === 'ready' && s.selection.status === 'ready';
const settled = (s: ApplicationSnapshot) =>
  !s.submission.active && s.submission.outcome !== null;
const cards = (app: Application) =>
  app.getSnapshot().messages.flatMap((row) => row.tripSummaries);
async function create(title: string) {
  creationPending = true;
  const thread = await api.threads.create({
    metadata: { title: 'Owned native summary proof: ' + title },
    signal,
  });
  assert.ok(thread.thread_id);
  threads.add(thread.thread_id);
  creationPending = false;
  return thread.thread_id;
}
async function journal(journalSignal = signal): Promise<ModelEntry[]> {
  const response = await fetch(modelUrl + '/__aimock/journal', {
    signal: journalSignal,
  });
  assert.equal(response.status, 200);
  return response.json();
}
async function barrier(path: string) {
  const response = await fetch(controlUrl + path, { signal });
  assert.equal(response.status, 200);
  return (await response.json()) as {
    path: string;
    forwarded: boolean;
    upstreamStatus?: number;
    upstreamComplete?: boolean;
    downstreamHeadersSent?: boolean;
    downstreamFinished?: boolean;
    downstreamClosedBeforeCleanup?: boolean;
  };
}
async function saved(id: string, persisted: boolean, humans: string[]) {
  const state = await api.threads.getState(id, undefined, { signal });
  const calls = state.values.messages
    .flatMap((m) => m.tool_calls ?? [])
    .filter((c) => c.name === 'show_trip_summary');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, summaryArgs);
  assert.deepEqual(
    state.values.messages
      .filter((m) => m.type === 'human')
      .map((m) => m.content),
    humans
  );
  const tools = state.values.messages.filter((m) => m.type === 'tool');
  assert.equal(tools.length, persisted ? 1 : 0);
  if (persisted) {
    assert.equal(tools[0].tool_call_id, calls[0].id);
    assert.equal(tools[0].content, summaryText);
  }
  return { call: calls[0], tool: tools[0], messages: state.values.messages };
}
async function restore(id: string, persisted: boolean) {
  const before = await journal();
  const app = own(id);
  await waitFor(app, admitted);
  assert.deepEqual(cards(app), []);
  if (persisted) assert.deepEqual(app.getSnapshot().runtime!.toolCalls, []);
  else {
    const pending = app.getSnapshot().runtime!.toolCalls;
    assert.equal(pending.length, 1);
    assert.deepEqual(pending[0], {
      id: pending[0].id,
      name: 'show_trip_summary',
      args: summaryArgs,
      status: 'pending',
    });
  }
  const tools = app.getSnapshot().messages.filter((row) => row.role === 'tool');
  assert.equal(tools.length, persisted ? 1 : 0);
  if (persisted) assert.equal(tools[0].markdown.document.content, summaryText);
  assert.deepEqual(await journal(), before);
  retire(app);
}
const cases: Record<string, unknown>[] = [];
let modelJournal: ModelEntry[] = [];
try {
  assert.equal((await journal()).length, 0);
  for (const scenario of [
    'positive',
    'held-stop',
    'held-selection',
    'rejected',
  ] as const) {
    const threadId = await create(scenario);
    const replacementId =
      scenario === 'held-selection' ? await create('replacement') : undefined;
    const app = own(threadId);
    await waitFor(app, admitted);
    const before = (await journal()).length;
    assert.equal(app.submit(prompt), true);
    if (scenario === 'positive') {
      assert.equal((await waitFor(app, settled)).submission.outcome, 'success');
      assert.equal(cards(app).length, 1);
      assert.equal(cards(app)[0].text, summaryText);
      const card = cards(app)[0];
      const first = await saved(threadId, true, [prompt]);
      assert.equal((await journal()).length, before + 1);
      assert.equal(app.submit(nextPrompt), true);
      assert.equal((await waitFor(app, settled)).submission.outcome, 'success');
      const second = await saved(threadId, true, [prompt, nextPrompt]);
      const entries = await journal();
      assert.equal(entries.length, before + 2);
      const input = entries.at(-1)!.body.messages;
      const toolInput = input.filter((m) => m.role === 'tool');
      assert.equal(toolInput.length, 1);
      assert.equal(toolInput[0].tool_call_id, first.call.id);
      assert.equal(toolInput[0].content, summaryText);
      const callInput = input
        .flatMap((m) => m.tool_calls ?? [])
        .filter((c) => c.function.name === 'show_trip_summary');
      assert.equal(callInput.length, 1);
      assert.equal(callInput[0].id, first.call.id);
      assert.deepEqual(
        JSON.parse(callInput[0].function.arguments),
        summaryArgs
      );
      assert.strictEqual(cards(app)[0], card);
      retire(app);
      await restore(threadId, true);
      cases.push({
        scenario,
        threadId,
        call: first.call,
        saved: first.tool,
        nextSaved: second.tool,
        localCard: true,
        nextTurn: true,
        restoredText: true,
      });
    } else if (scenario === 'held-stop' || scenario === 'held-selection') {
      const accepted = await barrier('/' + scenario + '/accepted');
      assert.equal(accepted.path, `/threads/${threadId}/state`);
      assert.equal(accepted.forwarded, true);
      assert.equal(accepted.upstreamStatus, 200);
      assert.equal(accepted.upstreamComplete, true);
      assert.equal(accepted.downstreamHeadersSent, false);
      assert.deepEqual(app.getSnapshot().submission, {
        active: true,
        outcome: null,
      });
      assert.equal(cards(app).length, 1);
      assert.equal(cards(app)[0].text, summaryText);
      const committed = await saved(threadId, true, [prompt]);
      const retained = app.getSnapshot(),
        bytes = JSON.stringify(retained);
      if (scenario === 'held-stop') app.stop();
      else app.select(replacementId!);
      const closed = await barrier('/' + scenario + '/closed');
      assert.equal(closed.downstreamClosedBeforeCleanup, true);
      assert.equal(closed.downstreamFinished, false);
      assert.equal(closed.downstreamHeadersSent, false);
      if (scenario === 'held-stop')
        assert.equal(
          (await waitFor(app, settled)).submission.outcome,
          'aborted'
        );
      else {
        await waitFor(
          app,
          (s) => admitted(s) && s.selection.id === replacementId
        );
        assert.deepEqual(app.getSnapshot().messages, []);
      }
      const replacement = app.getSnapshot();
      const after = await saved(threadId, true, [prompt]);
      assert.equal(after.tool.id, committed.tool.id);
      assert.strictEqual(app.getSnapshot(), replacement);
      assert.equal(JSON.stringify(retained), bytes);
      assert.equal((await journal()).length, before + 1);
      retire(app);
      await restore(threadId, true);
      cases.push({
        scenario,
        threadId,
        replacementId,
        call: committed.call,
        saved: committed.tool,
        accepted,
        closed,
        localCompleteWhileActive: true,
        retainedUnchanged: true,
        outcome: replacement.submission.outcome,
        selection: replacement.selection.id,
        restoredText: true,
      });
    } else {
      assert.equal((await waitFor(app, settled)).submission.outcome, 'error');
      const rejected = await barrier('/rejected/observed');
      assert.equal(rejected.path, `/threads/${threadId}/state`);
      assert.equal(rejected.forwarded, false);
      assert.equal(cards(app).length, 1);
      const state = await saved(threadId, false, [prompt]);
      assert.equal((await journal()).length, before + 1);
      retire(app);
      await restore(threadId, false);
      cases.push({
        scenario,
        threadId,
        call: state.call,
        rejected,
        outcome: 'error',
        localCard: true,
        restoredWithoutExecution: true,
      });
    }
  }
  modelJournal = await journal();
  assert.equal(modelJournal.length, 5);
  for (const entry of modelJournal) {
    const tools = entry.body.tools;
    assert.deepEqual(
      tools.filter((t) => t.function.name === 'show_trip_summary'),
      expectedClientTools.map((tool) => ({ type: 'function', function: tool }))
    );
    assert.deepEqual(
      tools.map((t) => t.function.name).sort(),
      [
        'search_documents',
        'request_approval',
        'research',
        'list_backups',
        'delete_backups',
        'render_a2ui_surface',
        'show_trip_summary',
      ].sort()
    );
  }
} finally {
  let diagnosticFailure: string | undefined;
  if (applications.size) {
    try {
      modelJournal = await journal(AbortSignal.timeout(2000));
    } catch (error) {
      diagnosticFailure =
        error instanceof Error ? error.message : 'Model journal unavailable';
    }
  }
  const snapshots = [...applications].map((app) => app.getSnapshot());
  const cleanup = await Promise.allSettled(
    [...applications]
      .map(async (app) => retire(app))
      .concat([...threads].map((id) => api.threads.delete(id)))
  );
  clearTimeout(timer);
  process.removeListener('SIGTERM', abort);
  process.removeListener('SIGINT', abort);
  writeFileSync(
    resultPath,
    JSON.stringify(
      { cases, modelJournal, prompt, nextPrompt, snapshots, diagnosticFailure },
      null,
      2
    ),
    { flag: 'wx' }
  );
  assert.deepEqual(
    cleanup.filter((r) => r.status === 'rejected'),
    [],
    'Every known application retired and thread deleted while provider alive'
  );
  assert.equal(
    diagnosticFailure,
    undefined,
    'Final model diagnostic unavailable after owner failure'
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
