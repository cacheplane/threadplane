import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCanonicalProvider, type Options } from './canonical-provider';
import {
  scenarios,
  prompts,
  listPrompt,
  seed,
  remaining,
  deletionResult,
  emptyListResult,
  title,
  type Scenario,
  type Backup,
} from './backup-provider-contract';
import { expectedClientTools } from './trip-summary-provider-contract';

type Capture = Awaited<ReturnType<typeof runCanonicalProvider>>;
type Call = { id: string; name: string; args: unknown };
type Message = {
  type: string;
  content: string;
  tool_call_id?: string;
  tool_calls?: Call[];
};
type State = {
  values: { backups: Backup[]; messages: Message[] };
  next: string[];
};
type Case = {
  scenario: Scenario;
  threadId: string;
  checkpoint: unknown;
  setup: State;
  paused: State;
  saved: State;
  final: State;
  interrupt: {
    id: string;
    value: { type: string; reason: string; ids: string[] };
  };
  restored: {
    backups: Backup[];
    tools: { content: string; tool_call_id: string }[];
    cards: number;
  };
};
type ModelMessage = {
  role: string;
  content: unknown;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }[];
};
const toolsOf = (state: State) =>
  state.values.messages
    .filter((message) => message.type === 'tool')
    .map(({ content, tool_call_id }) => ({ content, tool_call_id }));
const callsOf = (state: State) =>
  state.values.messages.flatMap((message) => message.tool_calls ?? []);
const streamOptions = {
  stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
  stream_subgraphs: true,
  stream_resumable: true,
  on_disconnect: 'continue',
};

/** Concrete backup evidence only, after the shared lifetime confirms cleanup. */
export function acceptBackupCapture(
  capture: Capture,
  evidenceDirectory?: string
) {
  assert.equal(capture.scenario, 'backup-effect');
  assert.equal(
    capture.testOperations,
    false,
    'Test operations cannot publish accepted backup evidence'
  );
  assert.equal(capture.cleanupConfirmed, true, 'Confirmed cleanup required');
  const cases = capture.proof.cases as Case[];
  assert.deepEqual(
    cases.map((item) => item.scenario),
    scenarios
  );
  assert.equal(new Set(cases.map((item) => item.threadId)).size, 3);
  assert.deepEqual(capture.controls, []);
  assert.equal(
    capture.requests.length,
    51,
    'Observed complete backup application request footprint'
  );
  assert.deepEqual(capture.forwardedRequests, capture.requests);
  for (const request of capture.requests) {
    assert.equal(request.forwarded, true);
    assert.equal(request.status, request.method === 'DELETE' ? 204 : 200);
    assert.equal(request.upstreamStatus, request.status);
    assert.equal(request.upstreamComplete, true);
    assert.equal(request.downstreamFinished, true);
    assert.equal(request.phase, undefined);
  }
  const searches = capture.requests.filter((q) => q.path === '/threads/search');
  assert.equal(
    searches.length,
    6,
    'Six actual default-owner directory admissions'
  );
  for (const request of searches) {
    assert.equal(request.method, 'POST');
    assert.deepEqual(request.body, { limit: 50, offset: 0 });
  }
  const creates = capture.requests.filter((q) => q.path === '/threads');
  assert.equal(creates.length, 3);
  creates.forEach((request, index) => {
    assert.equal(request.method, 'POST');
    assert.deepEqual(request.body, {
      metadata: { title: title(scenarios[index]), graph_id: 'chat' },
    });
  });
  const journal = capture.proof.modelJournal as {
    body: {
      messages: ModelMessage[];
      tools: { type: string; function: { name: string } }[];
    };
  }[];
  assert.equal(
    journal.length,
    8,
    'Only authored initial and server-tool continuation rounds'
  );
  let modelIndex = 0;
  const classified = new Set([...searches, ...creates]);
  for (const item of cases) {
    const { scenario, threadId } = item;
    assert.ok(threadId);
    assert.deepEqual(item.setup.values, {
      messages: [],
      backups: seed(scenario),
    });
    assert.deepEqual(item.setup.next, ['generate']);
    assert.deepEqual(item.paused.values.backups, seed(scenario));
    assert.deepEqual(toolsOf(item.paused), []);
    assert.match(item.interrupt.id, /^[0-9a-f]{32}$/);
    assert.deepEqual(item.interrupt.value, {
      type: 'approval_request',
      reason:
        'Delete 1 backups (2.5 GB): proof-delete. This permanently removes them from storage and cannot be undone.',
      ids: ['proof-delete'],
    });
    const [call, ...extra] = callsOf(item.paused);
    assert.deepEqual(extra, []);
    assert.ok(call?.id);
    assert.equal(call.name, 'delete_backups');
    assert.deepEqual(call.args, { ids: ['proof-delete'] });
    assert.deepEqual(callsOf(item.saved), [call]);
    assert.deepEqual(item.saved.values.backups, remaining(scenario));
    assert.deepEqual(item.saved.next, []);
    const savedTools = toolsOf(item.saved);
    assert.equal(savedTools.length, 1);
    assert.equal(savedTools[0].tool_call_id, call.id);
    assert.deepEqual(
      JSON.parse(savedTools[0].content),
      deletionResult(scenario)
    );
    assert.deepEqual(item.final.values.backups, remaining(scenario));
    assert.deepEqual(item.final.next, []);
    const finalTools = toolsOf(item.final);
    if (scenario === 'empty') {
      const finalCalls = callsOf(item.final);
      assert.equal(finalCalls.length, 2);
      assert.deepEqual(finalCalls[0], call);
      assert.ok(finalCalls[1].id && finalCalls[1].id !== call.id);
      assert.equal(finalCalls[1].name, 'list_backups');
      assert.deepEqual(finalCalls[1].args, { older_than_days: 0 });
      assert.equal(finalTools.length, 2);
      assert.deepEqual(finalTools[0], savedTools[0]);
      assert.equal(finalTools[1].tool_call_id, finalCalls[1].id);
      assert.deepEqual(JSON.parse(finalTools[1].content), emptyListResult);
    } else assert.deepEqual(item.final, item.saved);
    assert.deepEqual(item.restored, {
      backups: remaining(scenario),
      tools: finalTools,
      cards: 0,
    });
    for (const [state, humans] of [
      [item.paused, [prompts[scenario]]],
      [item.saved, [prompts[scenario]]],
      [
        item.final,
        [prompts[scenario], ...(scenario === 'empty' ? [listPrompt] : [])],
      ],
    ] as const)
      assert.deepEqual(
        state.values.messages
          .filter((m) => m.type === 'human')
          .map((m) => m.content),
        humans
      );
    const requests = capture.requests.filter(
      (q) =>
        q.path === '/threads/' + threadId ||
        q.path.startsWith('/threads/' + threadId + '/')
    );
    requests.forEach((q) => classified.add(q));
    const setup = requests[0];
    assert.equal(setup.method, 'POST');
    assert.equal(setup.path, '/threads/' + threadId + '/state');
    assert.deepEqual(setup.body, { values: { backups: seed(scenario) } });
    assert.ok(
      capture.requests.indexOf(creates[scenarios.indexOf(scenario)]) <
        capture.requests.indexOf(setup)
    );
    assert.equal(
      requests.filter((q) => q.method === 'POST' && q.path.endsWith('/state'))
        .length,
      1,
      'Only the explicit pre-application seed may write state'
    );
    // Every operation is classified; provider-generated run IDs alone may vary.
    assert.deepEqual(
      requests.map(
        (q) =>
          q.method +
          ' ' +
          q.path
            .slice(('/threads/' + threadId).length)
            .replace(/^\/runs\/[^/]+$/, '/runs/:id')
      ),
      [
        'POST /state',
        'GET /state',
        'GET ',
        'POST /history',
        'POST /runs/:id',
        'GET /runs/:id',
        'GET /state',
        'POST /runs/:id',
        'GET /runs/:id',
        'GET /state',
        ...(scenario === 'empty'
          ? ['POST /runs/:id', 'GET /runs/:id', 'GET /state']
          : []),
        'GET ',
        'POST /history',
        'DELETE ',
      ]
    );
    for (const q of requests) {
      if (q.path.endsWith('/history')) assert.deepEqual(q.body, { limit: 10 });
      if (q.method === 'GET' || q.method === 'DELETE')
        assert.equal(q.body, undefined);
    }
    const runs = requests.filter(
      (q) => q.method === 'POST' && q.path.endsWith('/runs/stream')
    );
    const caseIndex = scenarios.indexOf(scenario);
    const position = (q: (typeof capture.requests)[number]) =>
      capture.requests.indexOf(q);
    const directoryRequests = searches.filter(
      (q) =>
        position(q) > position(creates[caseIndex]) &&
        (caseIndex === 2 || position(q) < position(creates[caseIndex + 1]))
    );
    assert.equal(directoryRequests.length, 2);
    assert.ok(
      position(directoryRequests[0]) > position(requests[1]) &&
        position(directoryRequests[0]) < position(runs[0]),
      'Initial directory admission follows setup and precedes submission'
    );
    const finalRead = requests
      .filter((q) => q.method === 'GET' && q.path.endsWith('/state'))
      .at(-1)!;
    const deletion = requests.at(-1)!;
    assert.ok(
      position(directoryRequests[1]) > position(finalRead) &&
        position(directoryRequests[1]) < position(deletion),
      'Fresh directory admission follows effect and precedes thread cleanup'
    );
    assert.equal(runs.length, scenario === 'empty' ? 3 : 2);
    runs.forEach((request, index) => {
      if (index === 1)
        assert.deepEqual(request.body, {
          assistant_id: 'chat',
          input: null,
          command: {
            resume: {
              [item.interrupt.id]:
                scenario === 'decline' ? 'denied' : 'approved',
            },
          },
          ...streamOptions,
        });
      else {
        const body = request.body as { input: { messages: { id: string }[] } };
        const id = body.input.messages[0].id;
        assert.match(id, /^[0-9a-f-]{36}$/);
        assert.deepEqual(body, {
          assistant_id: 'chat',
          input: {
            messages: [
              {
                type: 'human',
                id,
                content: index === 0 ? prompts[scenario] : listPrompt,
              },
            ],
            client_tools: expectedClientTools,
          },
          ...streamOptions,
        });
      }
    });
    const rounds = journal.slice(
      modelIndex,
      modelIndex + (scenario === 'empty' ? 4 : 2)
    );
    modelIndex += rounds.length;
    rounds.forEach((entry, index) => {
      const clientDefinitions = entry.body.tools.filter(
        (tool) => tool.function.name === 'show_trip_summary'
      );
      assert.deepEqual(
        clientDefinitions,
        expectedClientTools.map((definition) => ({
          type: 'function',
          function: definition,
        }))
      );
      assert.ok(
        entry.body.tools.some((tool) => tool.function.name === 'delete_backups')
      );
      assert.ok(
        entry.body.tools.some((tool) => tool.function.name === 'list_backups')
      );
      assert.deepEqual(
        entry.body.messages
          .filter((m) => m.role === 'user')
          .map((m) => m.content),
        [prompts[scenario], ...(index >= 2 ? [listPrompt] : [])]
      );
      const expectedTools =
        index === 0 ? [] : index === 3 ? finalTools : savedTools;
      assert.deepEqual(
        entry.body.messages
          .filter((m) => m.role === 'tool')
          .map(({ content, tool_call_id }) => ({ content, tool_call_id })),
        expectedTools
      );
      const modelCalls = entry.body.messages
        .flatMap((m) => m.tool_calls ?? [])
        .map((c) => ({
          id: c.id,
          name: c.function.name,
          args: JSON.parse(c.function.arguments),
        }));
      assert.deepEqual(
        modelCalls,
        (index === 0 ? [] : index === 3 ? callsOf(item.final) : [call]).map(
          ({ id, name, args }) => ({ id, name, args })
        )
      );
    });
  }
  assert.equal(
    classified.size,
    capture.requests.length,
    'No unclassified provider traffic'
  );
  const result = {
    ...capture,
    accepted: true as const,
    limits: [
      'Installed default application and pinned canonical graph, with deterministic model replay. This proves routing, approval and checkpoint effects, not live-model obedience.',
      'Exactly three SDK setup seed writes precede application admission. The graph owns every backup effect; the application only submits text and addressed approval decisions.',
      'Only demo checkpoint inventory changes. No external storage deletion, transaction guarantee, concurrent-owner serialization, universal interrupt occurrence identity or cancellation rollback is claimed.',
      'Cleanup confirms synchronous application retirement and completed known-thread deletion while the provider remains alive; no asynchronous application disposal API is invented.',
    ],
  };
  if (evidenceDirectory) {
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(
      join(evidenceDirectory, 'evidence.json'),
      JSON.stringify(result, null, 2),
      { flag: 'wx' }
    );
  }
  return result;
}
export async function runBackupProvider(options: Options) {
  const capture = await runCanonicalProvider('backup-effect', options);
  if (capture.testOperations) return capture;
  return acceptBackupCapture(capture, options.evidenceDirectory);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(__dirname, 'backup-provider.ts')
) {
  const controller = new AbortController(),
    abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  const evidenceDirectory = mkdtempSync(
    join(tmpdir(), 'native-backup-evidence-')
  );
  runBackupProvider({
    root: resolve(__dirname, '../../../..'),
    signal: controller.signal,
    evidenceDirectory,
  })
    .then((result) => {
      assert.equal(result.accepted, true);
      console.log(
        'Canonical installed backup proof passed: ' +
          evidenceDirectory +
          '; requests=' +
          result.requests.length
      );
    })
    .catch((error) => {
      console.error(error);
      console.error('Evidence: ' + evidenceDirectory);
      process.exitCode = 1;
    })
    .finally(() => {
      process.removeListener('SIGINT', abort);
      process.removeListener('SIGTERM', abort);
    });
}
