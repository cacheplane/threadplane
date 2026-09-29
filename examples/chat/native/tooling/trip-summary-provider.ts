import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCanonicalProvider, type Options } from './canonical-provider';
import {
  prompt,
  nextPrompt,
  summaryText,
  summaryArgs,
  expectedClientTools,
} from './trip-summary-provider-contract';

type Capture = Awaited<ReturnType<typeof runCanonicalProvider>>;
export function acceptTripSummaryCapture(
  capture: Capture,
  evidenceDirectory?: string
) {
  assert.equal(capture.scenario, 'trip-summary');
  assert.equal(
    capture.testOperations,
    false,
    'Test operations cannot produce accepted summary evidence'
  );
  assert.equal(capture.cleanupConfirmed, true, 'Confirmed cleanup required');
  const cases = capture.proof.cases as {
    scenario: string;
    threadId: string;
    replacementId?: string;
    call: { id: string; name: string; args: unknown };
    saved?: { id: string; content: string; tool_call_id: string };
    outcome?: string;
    selection?: string;
  }[];
  assert.deepEqual(
    cases.map((c) => c.scenario),
    ['positive', 'held-stop', 'held-selection', 'rejected']
  );
  assert.equal((capture.proof.modelJournal as unknown[]).length, 5);
  assert.equal(
    capture.requests.length,
    57,
    'Exact summary default-application request footprint'
  );
  assert.equal(capture.forwardedRequests.length, 56);
  assert.deepEqual(
    capture.forwardedRequests,
    capture.requests.filter((request) => request.forwarded)
  );
  assert.equal(
    capture.requests.filter((q) => q.method === 'POST' && q.path === '/threads')
      .length,
    5
  );
  assert.equal(
    capture.requests.filter(
      (q) => q.method === 'POST' && q.path === '/threads/search'
    ).length,
    8
  );
  for (const q of capture.requests.filter((q) => q.path === '/threads/search'))
    assert.deepEqual(q.body, { limit: 50, offset: 0 });
  for (const c of cases) {
    assert.equal(c.call.name, 'show_trip_summary');
    assert.deepEqual(c.call.args, summaryArgs);
    const requests = capture.requests.filter((q) =>
      q.path.startsWith('/threads/' + c.threadId)
    );
    const posts = requests.filter(
      (q) => q.method === 'POST' && q.path.endsWith('/runs/stream')
    );
    assert.equal(posts.length, c.scenario === 'positive' ? 2 : 1);
    posts.forEach((post, index) => {
      const body = post.body as { input: { messages: { id: string }[] } };
      const id = body.input.messages[0].id;
      assert.match(id, /^[0-9a-f-]{36}$/);
      assert.deepEqual(body, {
        assistant_id: 'chat',
        input: {
          messages: [
            { type: 'human', id, content: index === 0 ? prompt : nextPrompt },
          ],
          client_tools: expectedClientTools,
        },
        stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
        stream_subgraphs: true,
        stream_resumable: true,
        on_disconnect: 'continue',
      });
    });
    const writes = requests.filter(
      (q) => q.method === 'POST' && q.path.endsWith('/state')
    );
    assert.equal(writes.length, 1);
    const write = writes[0];
    assert.equal(write.phase, c.scenario);
    assert.deepEqual(write.body, {
      values: {
        messages: [
          {
            id: 'client-tool-result-' + c.call.id,
            role: 'tool',
            type: 'tool',
            tool_call_id: c.call.id,
            content: summaryText,
          },
        ],
      },
    });
    if (c.scenario === 'rejected') {
      assert.equal(write.forwarded, false);
      assert.equal(write.status, 503);
      assert.equal(write.upstreamStatus, undefined);
      assert.equal(c.outcome, 'error');
    } else {
      assert.equal(write.forwarded, true);
      assert.equal(write.upstreamStatus, 200);
      assert.equal(write.upstreamComplete, true);
      assert.equal(c.saved!.content, summaryText);
      assert.equal(c.saved!.tool_call_id, c.call.id);
    }
    if (c.scenario.startsWith('held-')) {
      assert.equal(write.downstreamHeadersSent, false);
      assert.equal(write.downstreamFinished, false);
      assert.equal(write.downstreamClosedBeforeCleanup, true);
      assert.equal(write.status, undefined);
    }
    assert.equal(requests.filter((q) => q.method === 'DELETE').length, 1);
    for (const q of requests.filter((q) => q.path.endsWith('/history')))
      assert.deepEqual(q.body, { limit: 10 });
    assert.deepEqual(
      requests.map(
        (q) =>
          q.method +
          ' ' +
          q.path
            .slice(('/threads/' + c.threadId).length)
            .replace(/^\/runs\/[^/]+$/, '/runs/:id')
      ),
      [
        'GET ',
        'POST /history',
        'POST /runs/:id',
        'GET /runs/:id',
        'POST /state',
        'GET /state',
        ...(c.scenario === 'positive'
          ? ['POST /runs/:id', 'GET /runs/:id', 'GET /state']
          : c.scenario.startsWith('held-')
          ? ['GET /state']
          : []),
        'GET ',
        'POST /history',
        'DELETE ',
      ]
    );
  }
  const replacement = cases[2].replacementId;
  assert.ok(replacement);
  assert.deepEqual(
    capture.requests
      .filter((q) => q.path.startsWith('/threads/' + replacement))
      .map(
        (q) => q.method + ' ' + q.path.slice(('/threads/' + replacement).length)
      ),
    ['GET ', 'POST /history', 'DELETE ']
  );
  assert.deepEqual(
    capture.controls.map((q) => q.path),
    [
      '/held-stop/accepted',
      '/held-stop/closed',
      '/held-selection/accepted',
      '/held-selection/closed',
      '/rejected/observed',
    ]
  );
  assert.ok(
    capture.controls.every((q) => q.method === 'GET' && q.status === 200)
  );
  for (const q of capture.requests)
    if (!q.phase?.startsWith('held-'))
      assert.equal(
        q.status,
        q.phase === 'rejected' ? 503 : q.method === 'DELETE' ? 204 : 200
      );
  const result = {
    ...capture,
    accepted: true as const,
    limits: [
      'Actual pinned canonical provider, installed default application, one authored summary catalog and explicit deterministic replay. This proves routing/binding/persistence, not live-model obedience or migration of the canonical full planner prompt.',
      'Held faults forward and fully drain one real committed write before withholding downstream acknowledgement. Stop/selection cancellation does not roll it back. Rejected fault is an owned local503 before forwarding, not a provider rejection.',
      'Cleanup confirms synchronous application retirement and completed known-thread deletion while provider alive; the application intentionally exposes no asynchronous disposal acknowledgement.',
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
export async function runTripSummaryProvider(options: Options) {
  const capture = await runCanonicalProvider('trip-summary', options);
  if (capture.testOperations) return capture;
  return acceptTripSummaryCapture(capture, options.evidenceDirectory);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(__dirname, 'trip-summary-provider.ts')
) {
  const controller = new AbortController(),
    abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  const evidenceDirectory = mkdtempSync(
    join(tmpdir(), 'native-summary-evidence-')
  );
  runTripSummaryProvider({
    root: resolve(__dirname, '../../../..'),
    signal: controller.signal,
    evidenceDirectory,
  })
    .then((result) => {
      assert.equal(result.accepted, true);
      console.log(
        'Canonical installed summary proof passed: ' +
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
