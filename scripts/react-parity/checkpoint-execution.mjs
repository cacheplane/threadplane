import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

const thread = 'checkpoint-thread';
const root = `/api/threads/${thread}/`;
const modes = ['values', 'messages-tuple', 'updates', 'custom', 'checkpoints'];
const checkpoint = (id) => ({ thread_id: thread, checkpoint_ns: '', checkpoint_id: id, checkpoint_map: { '': id } });
const human = (id, content) => ({ id, type: 'human', content });
const assistant = (id, content) => ({ id, type: 'ai', content });
const sse = (event, data, id) => `${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const saved = (id, messages, parent = null, pending = false) => ({
  checkpoint: checkpoint(id), parent_checkpoint: parent ? checkpoint(parent) : null,
  created_at: '2026-09-24T00:00:00Z', metadata: { run_id: `run-${id}` },
  values: { stage: id, messages }, next: pending ? ['approval'] : [],
  tasks: pending ? [{ id: 'pending-approval', name: 'approval', error: null, result: null, interrupts: [{ id: 'approval', value: 'Approve P?' }] }] : [],
});

// Expectations are fixture-owned, never derived from a requested checkpoint,
// production helpers, selected UI state or the preceding request's routing.
const sequence = [
  ['POST', 'history', 'B/A/P'],
  ['POST', 'state/checkpoint', 'A'],
  ['POST', 'runs/stream', 'A', 'Fork A', 'A1'],
  ['GET', 'runs/run-A1', 'success'],
  ['POST', 'state/checkpoint', 'A1'],
  ['POST', 'runs/stream', 'A1', 'Continue branch', 'A2'],
  ['GET', 'runs/run-A2', 'success'],
  ['POST', 'state/checkpoint', 'A2'],
  ['POST', 'state/checkpoint', 'A2'],
  ['POST', 'state/checkpoint', 'P'],
  ['POST', 'runs/stream', 'A2', 'Drop branch', 'A3'],
  ['GET', 'runs/run-A3', 'running'],
  ['GET', 'runs/run-A3/stream', 'drop-cursor'],
  ['GET', 'runs/run-A3', 'success'],
  ['POST', 'state/checkpoint', 'A3'],
];

/** Independent bounded HTTP oracle; global latest B never follows the branch. */
export function createCheckpointRoutes() {
  const requests = [];
  const a = saved('A', [human('a-user', 'Source A'), assistant('a-answer', 'Answer A')]);
  const b = saved('B', [assistant('b-answer', 'Global B')], 'A');
  const p = saved('P', [assistant('p-answer', 'Pending P')], 'A', true);
  const states = { A: a, B: b, P: p };
  const responses = new Set();
  const frame = (state) => sse('checkpoints', {
    config: { configurable: { ...state.checkpoint, run_id: state.metadata.run_id } },
    values: state.values, next: state.next, tasks: state.tasks.map(({ id, name }) => ({ id, name })),
  }, `cursor-${state.checkpoint.checkpoint_id}`);
  return {
    requests,
    assertComplete() { assert.deepEqual(requests.map(({ method, path, target }) => [method, path, target]), sequence.map(step => step.slice(0, 3)), 'entire checkpoint request sequence'); },
    async handle(request, response, pathname) {
      if (!pathname.startsWith(root)) return false;
      const expected = sequence[requests.length];
      assert.ok(expected, 'no extra checkpoint operations');
      const [method, path, target, prompt, output] = expected;
      const url = new URL(request.url, 'http://fixture');
      assert.equal(request.method, method, `checkpoint step ${requests.length}: method`);
      assert.equal(pathname, root + path, `checkpoint step ${requests.length}: path`);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      const body = raw ? JSON.parse(raw) : undefined;
      let result;
      let stream = false;
      if (path.endsWith('/stream') && method === 'GET') {
        assert.equal(body, undefined, 'join has no body');
        // The installed SDK BaseClient serializes array query values as JSON.
        assert.deepEqual([...url.searchParams], [['cancel_on_disconnect', '0'], ['stream_mode', JSON.stringify(modes)]], 'exact checkpoint join modes');
        assert.equal(request.headers['last-event-id'], target, 'exact checkpoint join cursor');
        result = frame(states.A3);
        stream = true;
      } else {
        assert.equal(url.search, '', 'no unexpected checkpoint query');
        if (path === 'history') {
          assert.deepEqual(body, { limit: 10 }, 'bounded history request');
          result = [b, a, p];
        } else if (path === 'state/checkpoint') {
          assert.deepEqual(body, { checkpoint: checkpoint(target) }, 'exact saved checkpoint read');
          assert.ok(states[target], 'saved checkpoint exists');
          result = states[target];
        } else if (path === 'runs/stream') {
          const message = body?.input?.messages?.[0];
          assert.equal(typeof message?.id, 'string');
          assert.ok(message.id.length > 0);
          assert.deepEqual(body, {
            assistant_id: 'fixture-assistant', checkpoint: checkpoint(target),
            input: { messages: [human(message.id, prompt)], client_tools: [{ name: 'weather', description: 'Current weather' }, { name: 'count', description: 'Count values' }] },
            stream_mode: modes, stream_subgraphs: true, stream_resumable: true, on_disconnect: 'continue',
          }, 'exact branch creation routing, input, catalog and modes');
          const messages = [...states[target].values.messages, human(message.id, prompt), assistant(`answer-${output}`, output === 'A3' ? 'Branch partial recovered A3' : `Branch ${output}`)];
          states[output] = saved(output, messages, target);
          result = output === 'A3'
            ? sse('values', { stage: 'A2-running', messages: [...messages.slice(0, -1), assistant('answer-A3', 'Branch partial')] }, 'drop-cursor')
            : frame(states[output]);
          stream = true;
        } else {
          assert.equal(body, undefined, 'status has no body');
          result = { thread_id: thread, run_id: path.slice('runs/'.length), status: target };
        }
      }
      requests.push({ method, path, target, ...(body === undefined ? {} : { body }), ...(path.endsWith('/stream') && method === 'GET' ? { lastEventId: request.headers['last-event-id'], modes: url.searchParams.getAll('stream_mode') } : {}) });
      responses.add(response);
      response.once('close', () => responses.delete(response));
      response.writeHead(200, stream ? { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...(output ? { 'content-location': `/threads/${thread}/runs/run-${output}` } : {}) } : { 'content-type': 'application/json' });
      response.end(stream ? result : JSON.stringify(result));
      return true;
    },
    close() { for (const response of responses) response.destroy(); },
  };
}

/** Identical assertions run against both installed native observers. */
export async function runCheckpointScenarios(page, server) {
  await page.goto(`${server.url}/?checkpoints`);
  const field = (id) => page.getByTestId(`checkpoint-${id}`);
  const click = (name) => page.getByRole('button', { name, exact: true }).click();
  const command = async (label, count, outcome) => {
    await click(label);
    await expect(field('finished')).toHaveText(String(count));
    assert.deepEqual(server.errors.map(String), [], `${label}: wire oracle errors`);
    await expect(field('outcome')).toHaveText(outcome);
  };
  const observed = async () => Promise.all(['text', 'values', 'history', 'status'].map(id => field(id).textContent()));
  await expect(field('status')).toHaveText('idle');
  await expect(field('text')).toHaveText('');
  await expect(field('values')).toHaveText('unobserved');
  await expect(field('history')).toHaveText('unobserved');
  await expect(field('selected')).toHaveText('none');
  await expect(field('finished')).toHaveText('0');
  assert.deepEqual(server.checkpoints.requests, [], 'checkpoint mount is inert');
  await command('Load', 1, 'loaded');
  await expect(field('text')).toHaveText('Global B');
  const history = await field('history').textContent();
  assert.deepEqual(JSON.parse(history).map(entry => entry.checkpoint.checkpoint_id), ['B', 'A', 'P']);
  const loaded = await observed();
  for (const id of ['A', 'B', 'A']) {
    await click(`Select ${id}`);
    await expect(field('selected')).toHaveText(id);
    assert.deepEqual(await observed(), loaded, 'selection leaves observed state untouched');
  }
  assert.equal(server.checkpoints.requests.length, 1, 'selection performs no I/O');
  await expect(field('handlers')).toHaveText('0');

  await command('Fork selected', 2, 'success');
  await expect(field('text')).toHaveText('Source A\nAnswer A\nFork A\nBranch A1');
  await expect(field('values')).toHaveText('{"stage":"A1"}');
  await expect(field('status')).toHaveText('idle');
  assert.equal(server.checkpoints.requests.length, 5);

  await click('Select B');
  await command('Continue branch', 3, 'success');
  await expect(field('selected')).toHaveText('B');
  await expect(field('text')).toHaveText('Source A\nAnswer A\nFork A\nBranch A1\nContinue branch\nBranch A2');
  await expect(field('values')).toHaveText('{"stage":"A2"}');
  await command('Load', 4, 'loaded');
  await expect(field('history')).toHaveText(history);
  await expect(field('values')).toHaveText('{"stage":"A2"}');
  assert.equal(server.checkpoints.requests.length, 9);

  await click('Select P');
  const beforeRejected = await observed();
  await command('Fork selected', 5, 'rejected');
  assert.deepEqual(await observed(), beforeRejected, 'pending fork publishes no optimistic state');
  assert.equal(server.checkpoints.requests.length, 10);

  await command('Drop branch', 6, 'interrupted');
  await expect(field('status')).toHaveText('error');
  await expect(field('reconnect')).toHaveText('run-A3');
  await expect(field('text')).toContainText('Branch partial');
  assert.equal(server.checkpoints.requests.length, 12, 'no automatic reconnect');
  await command('Reconnect branch', 7, 'success');
  await expect(field('status')).toHaveText('idle');
  await expect(field('reconnect')).toHaveText('');
  await expect(field('values')).toHaveText('{"stage":"A3"}');
  await expect(field('text')).toHaveText('Source A\nAnswer A\nFork A\nBranch A1\nContinue branch\nBranch A2\nDrop branch\nBranch partial recovered A3');
  assert.equal((await field('text').innerText()).split('Branch partial').length - 1, 1);

  await click('Dispose');
  await expect(field('owner')).toHaveText('disposed');
  const disposed = await observed();
  await command('Continue branch', 8, 'aborted');
  await command('Fork selected', 9, 'aborted');
  assert.deepEqual(await observed(), disposed);
  await expect(field('handlers')).toHaveText('0');
  server.checkpoints.assertComplete();
  assert.deepEqual(server.errors, []);
  return ['checkpoint inert mount, explicit history and local selection', 'completed A fork and exact A1 confirmation', 'branch continuation and exact A2 load despite selected B', 'pending P rejection without optimistic publication', 'branch clean EOF and explicit cursor reconnect to A3', 'disposed checkpoint commands abort without I/O'];
}
