import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCanonicalProvider, type Options } from './canonical-provider';
import { expectedClientTools } from './trip-summary-provider-contract';

type Capture = Awaited<ReturnType<typeof runCanonicalProvider>>;

/** Concrete acceptance after the owned lifetime has confirmed cleanup. */
export function acceptApprovalCapture(
  capture: Capture,
  evidenceDirectory?: string
) {
  assert.equal(capture.scenario, 'approval');
  assert.equal(
    capture.testOperations,
    false,
    'Test operations cannot produce accepted approval evidence'
  );
  assert.equal(
    capture.cleanupConfirmed,
    true,
    'Confirmed cleanup required before approval acceptance'
  );
  const proof = capture.proof;
  const cases = proof.cases as {
    scenario: string;
    threadId: string;
    interrupt: { id: string };
    answer: string;
    unmatched?: string;
  }[];
  const searches = capture.requests.filter(
    (q) => q.method === 'POST' && q.path === '/threads/search'
  );
  assert.equal(
    searches.length,
    5,
    'Each default application owner must load its directory'
  );
  for (const request of searches) {
    assert.deepEqual(request.body, { limit: 50, offset: 0 });
    assert.equal(request.status, 200);
  }
  for (const item of cases) {
    assert.equal(
      capture.requests.filter(
        (q) => q.method === 'GET' && q.path === `/threads/${item.threadId}`
      ).length,
      item.scenario === 'loaded' ? 2 : 1,
      'Each default application owner must admit the selected thread'
    );
    const requests: typeof capture.requests = capture.requests.filter((q) =>
      q.path.startsWith(`/threads/${item.threadId}`)
    );
    // Require the actual admission and execution sequence, allowing only
    // the provider-generated run ID to vary.
    assert.deepEqual(
      requests.map(
        (q) =>
          `${q.method} ${q.path
            .slice(`/threads/${item.threadId}`.length)
            .replace(/^\/runs\/[^/]+$/, '/runs/:id')}`
      ),
      [
        'GET ',
        'POST /history',
        'POST /runs/:id',
        'GET /runs/:id',
        ...(item.scenario === 'loaded' ? ['GET ', 'POST /history'] : []),
        ...(item.unmatched
          ? ['POST /history', 'POST /runs/:id', 'GET /runs/:id']
          : []),
        'POST /runs/:id',
        'GET /runs/:id',
        'GET /state',
        'DELETE ',
      ]
    );
    for (const request of requests) {
      assert.equal(request.status, request.method === 'DELETE' ? 204 : 200);
      if (request.path.endsWith('/history'))
        assert.deepEqual(request.body, { limit: 10 });
    }
    const posts: {
      method: string;
      path: string;
      body?: unknown;
      status?: number;
    }[] = capture.requests.filter(
      (q) =>
        q.method === 'POST' &&
        q.path === `/threads/${item.threadId}/runs/stream`
    );
    assert.equal(
      posts.length,
      item.unmatched ? 3 : 2,
      'One physical POST per explicit submit or response'
    );
    const initial = posts[0].body as { input: { messages: { id: string }[] } };
    assert.deepEqual(initial, {
      assistant_id: 'chat',
      input: {
        messages: [
          {
            type: 'human',
            id: initial.input.messages[0].id,
            content: proof.prompt,
          },
        ],
        client_tools: expectedClientTools,
      },
      stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
      stream_subgraphs: true,
      stream_resumable: true,
      on_disconnect: 'continue',
    });
    const responses = posts
      .slice(1)
      .map((q) => q.body as Record<string, unknown>);
    assert.deepEqual(
      responses.map((q) => q.command),
      [
        ...(item.unmatched ? [{ resume: { [item.unmatched]: 'denied' } }] : []),
        { resume: { [item.interrupt.id]: item.answer } },
      ]
    );
    for (const body of responses) assert.equal(body.input, null);
    for (const post of posts) assert.equal(post.status, 200);
    assert.equal(
      capture.requests.filter(
        (q) => q.method === 'DELETE' && q.path === `/threads/${item.threadId}`
      ).length,
      1
    );
  }
  assert.equal(
    capture.requests.filter(
      (q) => q.method === 'POST' && /\/runs(?:\/|$)/.test(q.path)
    ).length,
    9
  );
  assert.equal(
    capture.requests.length,
    46,
    'Exact canonical application request footprint'
  );
  const result = {
    ...capture,
    accepted: true as const,
    limits: [
      'Normal submit and decision commands use the installed default application/session factory and real directory/history admission. The unmatched-ID raw-session substep is provider routing evidence, not application decision authority.',
      'Cleanup acknowledges synchronous application retirement, awaited raw-probe disposal and completed known-thread deletions. The private application dispose contract does not await its internal session disposal promise.',
      'A task may reuse its interrupt ID for successive pauses: the separate direct-graph feasibility probe establishes this limitation, not this HTTP proof. No remote atomicity or pause-occurrence identity is inferred from interrupt IDs.',
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

/** Actual approval entry; Operations are explicitly lifecycle-test-only. */
export async function runApprovalProvider(options: Options) {
  const capture = await runCanonicalProvider('approval', options);
  if (capture.testOperations) return capture;
  return acceptApprovalCapture(capture, options.evidenceDirectory);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(__dirname, 'approval-provider.ts')
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  const evidenceDirectory = mkdtempSync(
    join(tmpdir(), 'native-approval-evidence-')
  );
  runApprovalProvider({
    root: resolve(__dirname, '../../../..'),
    signal: controller.signal,
    evidenceDirectory,
  })
    .then((result) => {
      assert.equal(
        result.accepted,
        true,
        'Concrete approval acceptance required'
      );
      console.log(
        'Canonical installed approval proof passed: ' +
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
