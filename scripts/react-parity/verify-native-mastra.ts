import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createServer,
  request,
  type ClientRequest,
  type Server,
} from 'node:http';
import type { RunAgentInput } from '@ag-ui/client';
// This standalone integration uses the actual private source owner, never a
// copied reducer or a provider-specific client translation.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { createSession } from '../../libs/ag-ui/src/runtime/create-session';
// eslint-disable-next-line @nx/enforce-module-boundaries
import type { NativeResponse } from '../../libs/ag-ui/src/runtime/decision';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Test-only local service composition; no package API is introduced.
import {
  bounded,
  waitUntil,
  startScriptedService,
  type ScriptedService,
} from '../../deployments/ag-ui-mastra/test/scripted-service.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const prompt = 'Please reserve the North Pines campsite for 2 nights.';
const reservation =
  '"Reserved North Pines for 2 night(s) — total $90. Confirmation TP-0288."';
const declined =
  '"Reservation for North Pines was declined by the user. Nothing was booked."';
type ScenarioName = 'approve' | 'decline' | 'cancel' | 'lost-terminal';
type WireEvent = { type: string; [key: string]: unknown };
interface Exchange {
  scenario: ScenarioName;
  input: RunAgentInput;
  upstreamEvents: WireEvent[];
  upstreamClosed: boolean;
  downstreamClosed: boolean;
  suppressed: number;
}
interface Scenario {
  name: ScenarioName;
  threadId: string;
  userId?: string;
  response?: NativeResponse;
  exchanges: Exchange[];
}
const address = (server: Server) => {
  const value = server.address();
  assert.ok(value && typeof value !== 'string');
  return `http://127.0.0.1:${value.port}`;
};

/** Only validated unpredictable IDs are learned from requests. All other
 * envelope fields are authored here independently of owner snapshots. */
function expectedInput(
  scenario: Scenario,
  input: RunAgentInput,
  ids: Set<string>
) {
  assert.match(input.runId, uuid);
  assert.ok(
    !ids.has(input.runId),
    'every physical request uses a fresh run ID'
  );
  assert.ok(scenario.exchanges.length < 2, 'at most two requests per scenario');
  if (!scenario.exchanges.length) {
    assert.equal(input.messages.length, 1);
    const userId = input.messages[0].id;
    assert.match(userId, uuid);
    assert.ok(userId !== input.runId && !ids.has(userId));
    scenario.userId = userId;
    ids.add(userId);
  }
  const expected = {
    threadId: scenario.threadId,
    runId: input.runId,
    messages: [{ id: scenario.userId, role: 'user', content: prompt }],
    state: { proof: scenario.name },
    tools: [],
    context: [],
    forwardedProps: {},
    ...(scenario.exchanges.length && { resume: [scenario.response] }),
  };
  assert.deepEqual(input, expected, 'independent complete native envelope');
  ids.add(input.runId);
}

async function observer(
  service: ScriptedService,
  scenarios: Map<string, Scenario>
) {
  const exchanges: Exchange[] = [],
    errors: string[] = [],
    ids = new Set<string>();
  const pending = new Set<ClientRequest>();
  let posts = 0;
  const server = createServer(async (incoming, outgoing) => {
    try {
      assert.equal(incoming.method, 'POST');
      posts++;
      const scenario = scenarios.get(incoming.url ?? '');
      assert.ok(scenario, 'known owned scenario route');
      let body = '';
      incoming.setEncoding('utf8');
      await bounded(
        (async () => {
          for await (const chunk of incoming) {
            body += String(chunk);
            assert.ok(body.length < 1_000_000);
          }
        })(),
        'downstream request body'
      );
      const input = JSON.parse(body) as RunAgentInput;
      expectedInput(scenario, input, ids);
      const exchange: Exchange = {
        scenario: scenario.name,
        input,
        upstreamEvents: [],
        upstreamClosed: false,
        downstreamClosed: false,
        suppressed: 0,
      };
      exchanges.push(exchange);
      scenario.exchanges.push(exchange);
      outgoing.once('close', () => {
        exchange.downstreamClosed = true;
      });
      // Buffer the actual service response so the fault removes exactly one
      // conclusive root frame, preserving every other frame byte-for-byte.
      const upstreamText = await bounded(
        new Promise<string>((resolve, reject) => {
          const upstream = request(
            `${service.baseUrl}/agent/mastra`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-internal-token': service.token,
              },
            },
            (response) => {
              let text = '';
              response.setEncoding('utf8');
              response.once('close', () => {
                exchange.upstreamClosed = true;
              });
              response.on('data', (chunk: string) => {
                text += chunk;
              });
              response.once('error', reject);
              response.once('end', () => {
                if (response.statusCode !== 200)
                  reject(
                    new Error(`Local service status ${response.statusCode}`)
                  );
                else resolve(text);
              });
            }
          );
          pending.add(upstream);
          upstream.once('close', () => pending.delete(upstream));
          upstream.once('error', reject);
          upstream.setTimeout(10000, () =>
            upstream.destroy(new Error('Local upstream timed out'))
          );
          upstream.end(body);
        }),
        'actual provider response'
      );
      const frames = upstreamText.split('\n\n').filter(Boolean);
      const downstream: string[] = [];
      for (const frame of frames) {
        assert.ok(frame.startsWith('data: '), 'literal service SSE frame');
        const event = JSON.parse(frame.slice(6)) as WireEvent;
        exchange.upstreamEvents.push(event);
        const terminal =
          event.type === 'RUN_FINISHED' &&
          event['threadId'] === input.threadId &&
          event['runId'] === input.runId &&
          event['subagentRunId'] === undefined;
        if (scenario.name === 'lost-terminal' && input.resume && terminal)
          exchange.suppressed++;
        else downstream.push(frame);
      }
      outgoing.writeHead(200, { 'content-type': 'text/event-stream' });
      outgoing.end(downstream.join('\n\n') + '\n\n');
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end('local proof failed');
    }
  });
  const close = async () => {
    for (const upstream of pending) upstream.destroy();
    const closed = new Promise<void>((resolve, reject) =>
      server.close((error) =>
        error &&
        (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING'
          ? reject(error)
          : resolve()
      )
    );
    server.closeAllConnections();
    await bounded(closed, 'observer close');
  };
  try {
    await bounded(
      new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      }),
      'observer start'
    );
  } catch (error) {
    await close();
    throw error;
  }
  return {
    url: address(server),
    exchanges,
    errors,
    posts: () => posts,
    close,
  };
}

async function verifyCase(
  name: ScenarioName,
  service: ScriptedService,
  proxy: Awaited<ReturnType<typeof observer>>,
  scenarios: Map<string, Scenario>
) {
  const scenario: Scenario = { name, threadId: randomUUID(), exchanges: [] };
  scenarios.set(`/${name}`, scenario);
  const owner = createSession({
    threadId: scenario.threadId,
    url: `${proxy.url}/${name}`,
    state: { proof: name },
  });
  const observations: string[] = [];
  let notice: unknown;
  const release = owner.subscribe(() => {
    const snapshot = owner.getSnapshot();
    if (snapshot.run?.legacyInterrupt && notice === undefined) {
      notice = snapshot.run.legacyInterrupt.value;
      assert.equal(typeof notice, 'string');
      assert.equal(snapshot.run.terminal, undefined);
      assert.equal(snapshot.decision?.kind, 'unsupported');
      observations.push('notice');
    }
    if (
      snapshot.run?.terminal?.type === 'RUN_FINISHED' &&
      snapshot.decision?.kind === 'native' &&
      !observations.includes('native')
    )
      observations.push('native');
  });
  try {
    assert.equal(
      await bounded(owner.submit(prompt), `${name} pause`),
      'paused'
    );
    const paused = owner.getSnapshot();
    assert.deepEqual(observations, ['notice', 'native']);
    assert.equal(paused.decision?.kind, 'native');
    if (paused.decision?.kind !== 'native')
      throw new Error('Missing native decision');
    assert.equal(paused.decision.interrupts.length, 1);
    const interrupt = paused.decision.interrupts[0];
    assert.equal(typeof interrupt.id, 'string');
    assert.ok(interrupt.id.length > 0);
    assert.equal(interrupt.reason, 'mastra:tool_suspend');
    assert.equal(typeof interrupt.toolCallId, 'string');
    const first = scenario.exchanges[0];
    const rawNotice = first.upstreamEvents.find(
      (event) => event.type === 'CUSTOM'
    );
    assert.equal(
      notice,
      rawNotice?.['value'],
      'literal notice is retained without parsing'
    );
    assert.deepEqual(paused.transcript, [
      { id: scenario.userId, role: 'user', content: prompt },
    ]);
    assert.deepEqual(paused.state, { proof: name });
    const pendingPosts = proxy.posts(),
      providerPosts = service.stats().length;
    assert.equal(
      await bounded(owner.submit('ordinary bypass'), 'pending ordinary submit'),
      'error'
    );
    assert.equal(owner.getSnapshot(), paused);
    assert.equal(proxy.posts(), pendingPosts);
    assert.equal(service.stats().length, providerPosts);
    const pauseId = paused.decision.id;
    scenario.response =
      name === 'cancel'
        ? { interruptId: interrupt.id, status: 'cancelled' }
        : {
            interruptId: interrupt.id,
            status: 'resolved',
            payload: { approved: name !== 'decline' },
          };
    const done = owner.resume(pauseId, [scenario.response]);
    const claimed = owner.getSnapshot();
    assert.equal(claimed.transcript, paused.transcript);
    assert.equal(claimed.state, paused.state);
    assert.equal(
      await bounded(
        owner.resume(pauseId, [scenario.response]),
        'duplicate active claim'
      ),
      'error'
    );
    assert.equal(owner.getSnapshot(), claimed);
    const outcome = await bounded(done, `${name} resume`);
    assert.equal(outcome, name === 'lost-terminal' ? 'interrupted' : 'success');
    const final = owner.getSnapshot(),
      second = scenario.exchanges[1];
    assert.ok(second);
    assert.notEqual(first.input.runId, second.input.runId);
    const terminals = second.upstreamEvents.filter(
      (event) => event.type === 'RUN_FINISHED'
    );
    assert.equal(terminals.length, 1);
    assert.equal(terminals[0]['runId'], second.input.runId);
    assert.equal(terminals[0]['outcome'], undefined);
    const results = second.upstreamEvents.filter(
      (event) => event.type === 'TOOL_CALL_RESULT'
    );
    if (name === 'cancel') {
      assert.deepEqual(results, []);
      assert.equal(
        final.transcript.some((message) => message.role === 'tool'),
        false
      );
    } else {
      assert.equal(results.length, 1);
      assert.equal(results[0]['toolCallId'], interrupt.toolCallId);
      assert.equal(
        results[0]['content'],
        name === 'decline' ? declined : reservation
      );
      assert.ok(
        final.transcript.some(
          (message) =>
            message.role === 'tool' && message.content === results[0]['content']
        )
      );
    }
    if (name === 'lost-terminal') {
      assert.equal(second.suppressed, 1);
      assert.equal(final.run?.terminal, undefined);
      assert.equal(
        final.decision,
        claimed.decision,
        'accepted resume without terminal retains its captured uncertain attempt'
      );
      await bounded(owner.stop(), 'uncertain stop');
      assert.equal(owner.getSnapshot(), final);
      assert.equal(
        await bounded(
          owner.submit('unsafe retry'),
          'uncertain ordinary submit'
        ),
        'error'
      );
    } else {
      assert.equal(second.suppressed, 0);
      assert.equal(final.decision, undefined);
    }
    assert.equal(
      await bounded(
        owner.resume(pauseId, [scenario.response]),
        'stale or uncertain resume'
      ),
      'error'
    );
    assert.equal(owner.getSnapshot(), final);
    assert.equal(proxy.posts(), pendingPosts + 1);
    assert.equal(service.stats().length, providerPosts + 1);
    await waitUntil(
      () =>
        scenario.exchanges.every(
          (exchange) => exchange.upstreamClosed && exchange.downstreamClosed
        ) && service.stats().every((exchange) => exchange.closed),
      `${name} physical closure`
    );
    return {
      scenario: name,
      outcome,
      noticeBeforeNative: true,
      toolResult: results[0]?.['content'] ?? null,
      decision: final.decision ? 'uncertain' : 'cleared',
      requests: scenario.exchanges.length,
      closedBeforeCleanup: true,
    };
  } finally {
    release();
    await bounded(owner.dispose(), `${name} dispose`);
  }
}

async function main() {
  let service: ScriptedService | undefined;
  let proxy: Awaited<ReturnType<typeof observer>> | undefined;
  const originalFetch = globalThis.fetch;
  const external: string[] = [];
  // Prevent accidental hosted model access in this standalone process. The
  // service's configured model endpoint and the native owner are loopback only.
  globalThis.fetch = (input, init) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url
    );
    if (url.hostname !== '127.0.0.1') {
      external.push(url.origin);
      return Promise.reject(
        new Error('Only owned loopback endpoints are allowed')
      );
    }
    return originalFetch(input, init);
  };
  try {
    service = await startScriptedService();
    const scenarios = new Map<string, Scenario>();
    proxy = await observer(service, scenarios);
    const results = [];
    for (const name of [
      'approve',
      'decline',
      'cancel',
      'lost-terminal',
    ] as const)
      results.push(await verifyCase(name, service, proxy, scenarios));
    assert.equal(proxy.posts(), 8);
    assert.equal(service.stats().length, 8);
    assert.deepEqual(proxy.errors, []);
    assert.deepEqual(external, []);
    const version = (path: string) =>
      (
        JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as {
          version: string;
        }
      ).version;
    console.log(
      JSON.stringify({
        mode: 'verified',
        model: 'scripted local Responses mock',
        scenarios: results,
        requests: proxy.exchanges.map(({ upstreamEvents, ...exchange }) => ({
          ...exchange,
          providerEventTypes: upstreamEvents.map((event) => event.type),
        })),
        providerPosts: service.stats().length,
        providerResponsesClosed: service
          .stats()
          .every((exchange) => exchange.closed),
        externalFetchAttempts: external.length,
        versions: {
          provider: version(
            '../../deployments/ag-ui-mastra/node_modules/@ag-ui/mastra/package.json'
          ),
          mastraCore: version(
            '../../deployments/ag-ui-mastra/node_modules/@mastra/core/package.json'
          ),
          libsql: version(
            '../../deployments/ag-ui-mastra/node_modules/@mastra/libsql/package.json'
          ),
          serviceClient: version(
            '../../deployments/ag-ui-mastra/node_modules/@ag-ui/client/package.json'
          ),
          ownerClient: version('../../node_modules/@ag-ui/client/package.json'),
        },
        serviceLockSha256: createHash('sha256')
          .update(
            readFileSync(
              new URL(
                '../../deployments/ag-ui-mastra/package-lock.json',
                import.meta.url
              )
            )
          )
          .digest('hex'),
      })
    );
  } finally {
    try {
      await proxy?.close();
    } finally {
      try {
        await service?.close();
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
