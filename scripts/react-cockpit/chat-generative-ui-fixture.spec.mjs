import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { test } from 'node:test';
import { Client } from '@langchain/langgraph-sdk';
import { build } from 'esbuild';
const { createChatGenerativeUiFixture } = await import(
  './chat-generative-ui-fixture.mjs'
).catch(() => ({}));

async function fixture(t) {
  assert.equal(
    typeof createChatGenerativeUiFixture,
    'function',
    'Generative UI fixture exists'
  );
  const handle = createChatGenerativeUiFixture();
  const server = createServer(async (req, res) => {
    if (
      !(await handle(req, res, new URL(req.url, 'http://localhost').pathname))
    ) {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await handle.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = new Client({
    apiUrl: base + '/api',
    callerOptions: { maxRetries: 0 },
  });
  const control = async (body) => {
    const r = await fetch(base + '/__configure', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 200);
  };
  const thread = randomUUID();
  await client.threads.create({ threadId: thread, ifExists: 'raise' });
  const submit = async (content, id = randomUUID()) => {
    const events = [];
    for await (const event of client.runs.stream(thread, 'c-generative-ui', {
      input: { messages: [{ type: 'human', id, content }] },
      streamMode: [
        'messages-tuple',
        'values',
        'updates',
        'custom',
        'checkpoints',
      ],
      streamSubgraphs: true,
      streamResumable: true,
      onDisconnect: 'continue',
    }))
      events.push(event);
    return {
      events,
      id,
      run: events.find((e) => e.event === 'metadata').data.run_id,
    };
  };
  return { base, client, thread, submit, control };
}

test(
  'installed SDK consumes actual graph initial, filter, structural and prose turns',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const initial = await f.submit('  Show me the dashboard  ');
    const states = initial.events
      .filter((e) => e.event === 'values')
      .map((e) => e.data);
    const before = states.find((s) =>
      s.messages.some(
        (m) => m.name === 'render_spec' && m.content !== 'rendered'
      )
    );
    const after = states.find((s) =>
      s.messages.some(
        (m) => m.name === 'render_spec' && m.content === 'rendered'
      )
    );
    const raw = before.messages.find((m) => m.name === 'render_spec');
    const parent = before.messages.find((m) =>
      m.tool_calls?.some((c) => c.id === raw.tool_call_id)
    );
    assert.equal(parent.content, '');
    assert.equal(
      after.messages.find((m) => m.id === parent.id).content,
      raw.content
    );
    assert.deepEqual(
      before.messages.map((m) => m.id),
      after.messages.map((m) => m.id)
    );
    assert.deepEqual(
      after.messages.find((m) => m.id === parent.id).tool_calls,
      parent.tool_calls
    );
    assert.deepEqual(
      new Set(
        Object.values(JSON.parse(raw.content).elements).map((e) => e.type)
      ),
      new Set([
        'dashboard_grid',
        'container',
        'stat_card',
        'line_chart',
        'bar_chart',
        'data_grid',
      ])
    );
    let saved = await f.client.threads.getState(f.thread);
    assert.equal(Object.keys(saved.values.dashboard).length, 7);
    assert.equal(saved.values.dashboard.on_time.value, '84.2%');
    assert.equal(saved.values.completed_turn_id, initial.id);
    assert.deepEqual(
      saved.values.completed_message_ids,
      saved.values.messages.map((m) => m.id)
    );
    assert.equal(
      (await f.client.runs.get(f.thread, initial.run)).status,
      'success'
    );
    assert.equal(saved.metadata.run_id, undefined);
    assert.deepEqual(saved.next, []);
    assert.deepEqual(saved.tasks, []);
    const original = structuredClone(saved);
    const filtered = await f.submit('Filter to cancelled flights only');
    saved = await f.client.threads.getState(f.thread);
    assert.deepEqual(
      saved.values.messages.slice(0, original.values.messages.length),
      original.values.messages
    );
    assert.deepEqual(
      saved.values.dashboard.recent_disruptions.map((r) => r.type),
      ['cancelled', 'cancelled', 'cancelled']
    );
    const calls = filtered.events
      .filter((e) => e.event === 'values')
      .at(-1)
      .data.messages.slice(original.values.messages.length)
      .flatMap((m) => m.tool_calls ?? []);
    assert.deepEqual(
      calls.map((c) => [c.name, c.args]),
      [['query_recent_disruptions', { type: 'cancelled' }]]
    );
    const dashboard = saved.values.dashboard;
    await f.submit('Remove the table');
    saved = await f.client.threads.getState(f.thread);
    assert.deepEqual(saved.values.dashboard, dashboard);
    const count = saved.values.messages.length;
    await f.submit('Why is on-time performance low?');
    saved = await f.client.threads.getState(f.thread);
    assert.deepEqual(saved.values.dashboard, dashboard);
    assert.deepEqual(
      saved.values.messages.slice(count).flatMap((m) => m.tool_calls ?? []),
      []
    );
    const history = await f.client.threads.getHistory(f.thread, { limit: 100 });
    assert.deepEqual(history[0], saved);
    assert.deepEqual(
      await f.client.threads.getState(f.thread, original.checkpoint),
      original
    );
    assert(
      !initial.events.some(
        (e) =>
          e.event === 'messages' &&
          e.data[1].langgraph_node === 'generate_title'
      )
    );
    assert(
      !initial.events.some(
        (e) =>
          e.event === 'messages' &&
          e.data[1].langgraph_node === 'wrap_spec_into_ai'
      )
    );
    const requests = await (await fetch(f.base + '/__requests')).json();
    assert.equal(
      requests.filter((r) => r.path.endsWith('/runs/stream')).length,
      4
    );
    assert.equal(
      requests.find((r) => r.path.endsWith('/runs/stream')).body.input
        .messages[0].content,
      '  Show me the dashboard  '
    );
    await writeFile(
      '/tmp/threadplane-genui-sdk-events.json',
      JSON.stringify(initial.events)
    );
  }
);

test(
  'fault controls change delivered evidence without changing graph checkpoints',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    await f.control({ failTitle: true });
    const first = await f.submit('Show dashboard');
    const baseline = await f.client.threads.getState(f.thread);
    for (const fault of [
      'missing-terminal',
      'stale-terminal',
      'foreign-terminal',
      'old-message',
      'old-data',
      'incomplete-tools',
      'malformed-layout',
      'missing-dashboard',
      'disagreeing-dashboard',
      'pending-tasks',
      'task-error',
    ]) {
      await f.control({ stateFault: fault });
      assert.notDeepEqual(
        await f.client.threads.getState(f.thread),
        baseline,
        fault
      );
    }
    await f.control({ stateFault: null, runStatus: 'running' });
    assert.equal(
      (await f.client.runs.get(f.thread, first.run)).status,
      'running'
    );
    await f.control({ runStatus: 'error' });
    assert.equal(
      (await f.client.runs.get(f.thread, first.run)).status,
      'error'
    );
    await f.control({ runStatus: null });
    assert.deepEqual(await f.client.threads.getState(f.thread), baseline);
    await assert.rejects(f.client.runs.get(f.thread, randomUUID()));
  }
);

test(
  'actual native session records live raw result, loads wrapped result, and owns exact run check',
  { timeout: 60000 },
  async (t) => {
    const directory = await mkdtemp('/tmp/threadplane-genui-session-');
    t.after(() => rm(directory, { recursive: true, force: true }));
    const output = directory + '/harness.mjs';
    await build({
      entryPoints: ['libs/langgraph/src/runtime/create-session.ts'],
      outfile: output,
      bundle: true,
      platform: 'node',
      format: 'esm',
      tsconfig: 'tsconfig.base.json',
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });
    const { createSession } = await import(output);
    const f = await fixture(t);
    const session = createSession({
      assistantId: 'c-generative-ui',
      threadId: f.thread,
      apiUrl: f.base + '/api',
    });
    t.after(() => session.dispose());
    assert.equal(await session.submit('Show dashboard'), 'success');
    const live = structuredClone(session.getSnapshot());
    await session.load();
    const saved = session.getSnapshot();
    await writeFile(
      '/tmp/threadplane-genui-session-evidence.json',
      JSON.stringify({ live, saved }, null, 2)
    );
    const liveRender = live.toolCalls.find((c) => c.name === 'render_spec');
    const savedRender = saved.toolCalls.find((c) => c.name === 'render_spec');
    assert(liveRender);
    assert(savedRender);
    assert.deepEqual(JSON.parse(liveRender.result), liveRender.args);
    assert.equal(savedRender.result, 'rendered');
    const semanticMessages = (messages) =>
      messages.map(({ delivery, ...message }) => ({
        ...message,
        delivery: { ...delivery, generation: 'canonicalized' },
      }));
    assert.deepEqual(
      semanticMessages(live.messages),
      semanticMessages(saved.messages)
    );
    assert.deepEqual(live.values, saved.values);
    assert.deepEqual(liveRender.args, savedRender.args);
    const normalizeCalls = (calls) =>
      calls.map((call) =>
        call.name === 'render_spec' ? { ...call, result: 'rendered' } : call
      );
    assert.deepEqual(
      normalizeCalls(live.toolCalls),
      normalizeCalls(saved.toolCalls)
    );
    const requests = await (await fetch(f.base + '/__requests')).json();
    assert.equal(
      requests.filter(
        (r) => /\/runs\/[^/]+$/.test(r.path) && r.method === 'GET'
      ).length,
      1
    );
    assert.equal(
      requests.filter((r) => r.path.endsWith('/runs/stream')).length,
      1
    );
  }
);

test(
  'delayed stream abort owns cleanup and never replays a submit',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    await f.control({ holdStream: true });
    const controller = new AbortController();
    const iterator = f.client.runs.stream(f.thread, 'c-generative-ui', {
      input: {
        messages: [
          { type: 'human', id: randomUUID(), content: 'Show dashboard' },
        ],
      },
      streamMode: ['values'],
      signal: controller.signal,
    });
    const first = await iterator.next();
    assert.equal(first.value.event, 'metadata');
    controller.abort();
    await iterator.return();
    await new Promise((r) => setTimeout(r, 30));
    await fetch(f.base + '/__release', { method: 'POST' });
    const requests = await (await fetch(f.base + '/__requests')).json();
    assert.equal(
      requests.filter((r) => r.path.endsWith('/runs/stream')).length,
      1
    );
    assert.equal((await (await fetch(f.base + '/__lifetime')).json()).held, 0);
  }
);

test(
  'rejects altered request contracts and preserves raw nonempty render parents',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const post = (path, body) =>
      fetch(f.base + path, { method: 'POST', body: JSON.stringify(body) });
    assert.equal(
      (await post('/api/threads', { thread_id: f.thread })).status,
      400
    );
    const payload = {
      assistant_id: 'c-generative-ui',
      input: {
        messages: [{ type: 'human', id: 'exact', content: 'Show dashboard' }],
      },
      stream_mode: ['values'],
    };
    for (const body of [
      { ...payload, input: { ...payload.input, unexpected: true } },
      { ...payload, unexpected: true },
      { ...payload, stream_mode: ['invented'] },
    ]) {
      assert.equal(
        (await post(`/api/threads/${f.thread}/runs/stream`, body)).status,
        400
      );
    }
    await f.submit('Prose render dashboard');
    const saved = await f.client.threads.getState(f.thread);
    const parent = saved.values.messages.find((m) =>
      m.tool_calls?.some((c) => c.name === 'render_spec')
    );
    assert.equal(parent.content, 'Here is the layout.');
    assert.equal(
      JSON.parse(
        saved.values.messages.find((m) => m.name === 'render_spec').content
      ).root,
      'root'
    );
    const proofs = await (await fetch(f.base + '/__graph-proof')).json();
    assert(
      proofs.every(
        (p) =>
          p.actualCompiledGraph &&
          p.networkConnectAttempts === 0 &&
          p.titleMessageCallbacks === 0
      )
    );
    assert(
      proofs.every(
        (p) =>
          /^[a-f0-9]{64}$/.test(p.sourceSha256) &&
          /^[a-f0-9]{64}$/.test(p.lockSha256)
      )
    );
  }
);

test(
  'data faults tolerate pre-dashboard stream/history and mutate only populated slots',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    for (const fault of ['old-data', 'disagreeing-dashboard']) {
      await f.control({ streamFault: fault, stateFault: fault });
      const { events } = await f.submit('Show dashboard');
      const values = events
        .filter((e) => e.event === 'values')
        .map((e) => e.data);
      const history = await f.client.threads.getHistory(f.thread, {
        limit: 100,
      });
      const populated = [...values, ...history.map((s) => s.values)].filter(
        (v) => v.dashboard?.on_time
      );
      assert(populated.length > 0);
      for (const value of populated) {
        if (fault === 'old-data')
          assert.equal(value.dashboard.on_time.value, '999%');
        else if ('recent_disruptions' in value.dashboard)
          assert.deepEqual(value.dashboard.recent_disruptions, []);
      }
    }
  }
);

test(
  'exact checkpoint and empty metadata reject malformed contracts',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const post = (path, body) =>
      fetch(f.base + path, { method: 'POST', body: JSON.stringify(body) });
    for (const metadata of [1, true, '', [], null])
      assert.equal(
        (await post('/api/threads', { thread_id: randomUUID(), metadata }))
          .status,
        400
      );
    await f.submit('Show dashboard');
    const saved = await f.client.threads.getState(f.thread);
    for (const body of [
      {},
      { checkpoint: null },
      { checkpoint: {} },
      { checkpoint: saved.checkpoint, extra: true },
      { checkpoint: { ...saved.checkpoint, extra: true } },
    ]) {
      assert.equal(
        (await post(`/api/threads/${f.thread}/state/checkpoint`, body)).status,
        400
      );
    }
  }
);

test(
  'actual failed graph retains task error in saved state and history',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    await f.control({ failAgent: true });
    const result = await f.submit('Show dashboard');
    assert.equal(
      (await f.client.runs.get(f.thread, result.run)).status,
      'error'
    );
    const saved = await f.client.threads.getState(f.thread);
    assert(
      saved.tasks.some(
        (task) =>
          typeof task.error === 'string' &&
          task.error.includes('Local title failure')
      )
    );
    const history = await f.client.threads.getHistory(f.thread, { limit: 100 });
    assert.deepEqual(history[0].tasks, saved.tasks);
  }
);
