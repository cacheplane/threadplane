import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { reactCockpitConfiguration } from './configuration.mjs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { createServer } from 'node:http';

const origin = 'http://127.0.0.1:4645';
async function eventually(read, accept) {
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    const value = await read();
    if (accept(value)) return value;
    await delay(20);
  }
  assert.fail('Owned server milestone deadline');
}
const absent = (pid) =>
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
const empty = { children: 0, streams: 0, reads: 0, handlers: 0, responses: 0 };

for (const phase of ['current', 'stream']) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    test(
      `real serve drains held ${phase}, reset and ${signal} ownership`,
      { timeout: 20000 },
      async () => {
        // Refuse to take over any existing listener.
        await assert.rejects(
          fetch(origin, { signal: AbortSignal.timeout(200) })
        );
        const child = spawn(
          process.execPath,
          ['scripts/react-cockpit/serve.mjs', 'chat-debug', '--no-parent'],
          { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] }
        );
        let output = '',
          errors = '';
        child.stdout.on('data', (chunk) => {
          output += chunk;
        });
        child.stderr.on('data', (chunk) => {
          errors += chunk;
        });
        const exited = once(child, 'exit');
        const get = async (path) => (await fetch(origin + path)).json();
        const post = async (path, body) =>
          fetch(origin + path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body ?? {}),
          });
        try {
          await eventually(
            async () => {
              if (child.exitCode !== null)
                assert.fail(`Server exited: ${errors}`);
              try {
                return await get('/__lifetime');
              } catch {
                return null;
              }
            },
            (value) => value?.active !== undefined
          );
          assert.equal((await post('/__hold/unsupported')).status, 404);
          assert.equal((await fetch(origin + '/__reset')).status, 405);
          assert.deepEqual(await get('/__requests'), []);
          for (const action of ['reset', 'shutdown']) {
            const id = randomUUID();
            assert.equal(
              (
                await post('/api/threads', {
                  thread_id: id,
                  if_exists: 'raise',
                })
              ).status,
              200
            );
            await post('/__hold/' + phase);
            const pending =
              phase === 'stream'
                ? post(`/api/threads/${id}/runs/stream`, {
                    assistant_id: 'c-debug',
                    input: {
                      messages: [
                        {
                          type: 'human',
                          id: randomUUID(),
                          content: 'Explain lift',
                        },
                      ],
                    },
                  })
                    .then(async (res) => res.text())
                    .catch(() => '')
                : fetch(origin + `/api/threads/${id}/state`).catch(() => null);
            const lifetime = await eventually(
              () => get('/__lifetime'),
              (value) =>
                value.active[phase === 'stream' ? 'streams' : 'reads'] === 1
            );
            assert.equal(lifetime.active.children, 1);
            if (action === 'reset') {
              assert.equal((await post('/__reset')).status, 200);
              await pending;
              const reset = await eventually(
                () => get('/__lifetime'),
                (value) => Object.values(value.active).every((n) => n === 0)
              );
              assert.deepEqual(reset.active, empty);
              for (const worker of reset.children) {
                assert.equal(worker.reaped, true);
                absent(worker.pid);
                absent(-worker.pgid);
              }
            } else {
              child.kill(signal);
              const [code] = await exited;
              await pending;
              assert.equal(code, 0, errors);
            }
          }
          const closed = JSON.parse(output.trim().split('\n').at(-1));
          assert.equal(closed.listenersClosed, true);
          assert.equal(closed.parentServerOwned, false);
          assert.equal(closed.chatDebugFixtureClosed.closed, true);
          assert.deepEqual(closed.chatDebugFixtureClosed.active, empty);
          for (const worker of closed.chatDebugFixtureClosed.children) {
            assert.equal(worker.reaped, true);
            absent(worker.pid);
            absent(-worker.pgid);
          }
          absent(child.pid);
          await assert.rejects(fetch(origin));
          assert.equal(errors, '');
        } finally {
          if (child.exitCode === null) {
            child.kill('SIGTERM');
            await exited;
          }
        }
      }
    );
  }
}

test(
  'owned bind error exits nonzero after awaited fixture close',
  { timeout: 10000 },
  async () => {
    const occupied = createServer((_request, response) =>
      response.end('Owned occupancy sentinel')
    );
    await new Promise((resolve, reject) => {
      occupied.once('error', reject);
      occupied.listen(4645, '127.0.0.1', resolve);
    });
    try {
      const child = spawn(
        process.execPath,
        ['scripts/react-cockpit/serve.mjs', 'chat-debug', '--no-parent'],
        { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] }
      );
      let output = '',
        errors = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        errors += chunk;
      });
      const [code] = await once(child, 'close');
      assert.equal(code, 1, errors);
      const closed = JSON.parse(output.trim());
      assert.equal(closed.listenersClosed, true);
      assert.equal(closed.parentServerOwned, false);
      assert.equal(closed.chatDebugFixtureClosed.closed, true);
      assert.deepEqual(closed.chatDebugFixtureClosed.active, empty);
      absent(child.pid);
      assert.equal(
        await (await fetch(origin)).text(),
        'Owned occupancy sentinel'
      );
    } finally {
      occupied.closeAllConnections();
      await new Promise((resolve) => occupied.close(resolve));
    }
  }
);

test('debug has one exact closed native LangGraph allocation', () => {
  assert.deepEqual(reactCockpitConfiguration('chat-debug'), {
    topic: 'debug',
    library: 'chat',
    adapter: 'langgraph',
    appPath: 'cockpit/chat/debug/react',
    base: '/chat/debug/react/',
    port: 4645,
    project: 'cockpit-chat-debug-react',
  });
  assert.ok(Object.isFrozen(reactCockpitConfiguration('chat-debug')));
  for (const key of [
    'debug',
    '../chat-debug',
    'chat-debug/../../',
    'chat-debug-remote',
    '/chat/debug/react/',
  ])
    assert.throws(() => reactCockpitConfiguration(key), /Unsupported/);
  assert.equal(reactCockpitConfiguration('chat-theming').port, 4644);
  assert.equal(reactCockpitConfiguration('chat-messages').port, 4620);
  assert.equal(reactCockpitConfiguration('runtimes-aws-strands').port, 4643);
  const registry = readFileSync(
    'libs/cockpit-registry/src/lib/capability-registry.ts',
    'utf8'
  );
  assert.match(
    registry,
    /id: 'c-debug'[^\n]+port: 4509, react: \{ project: 'cockpit-chat-debug-react', port: 4645 \}, pythonPort: 5509/
  );
});

test('debug production inputs exclude local wire, fixture and controls', () => {
  const visit = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = resolve(dir, name);
      return statSync(path).isDirectory()
        ? visit(path)
        : /\.spec\.|fixture\.json$/.test(path)
        ? []
        : [path];
    });
  for (const path of visit(resolve('cockpit/chat/debug/react/src')))
    assert.doesNotMatch(
      readFileSync(path, 'utf8'),
      /chat-debug-(?:wire|fixture)|\/__(?:release|hold|reset|requests|captures|lifetime)/
    );
  assert.doesNotMatch(
    readFileSync('scripts/react-cockpit/build.mjs', 'utf8'),
    /chat-debug-fixture|chat-debug-wire/
  );
});
