import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  collectProvenance,
  resolveArtifacts,
  runReview,
} from './review-native-ag-ui.mjs';
import { createReviewServer } from '../../fixtures/react-parity/native-ag-ui/server.mjs';

async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'bounded fixture observation');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const body = (reviewId, role = 'a', command = 'First') => ({
  threadId: `${reviewId}-${role}`,
  runId: randomUUID(),
  messages: [{ id: randomUUID(), role: 'user', content: command }],
  state:
    command === 'First'
      ? {
          model: 'review-small',
          reasoning_effort: 'low',
          gen_ui_mode: 'inline',
        }
      : {},
  tools: [],
  context: [],
  forwardedProps: {},
});
const agent = (server, reviewId, value, role = 'a', signal) =>
  fetch(`${server.url}/agent?review=${reviewId}&owner=${role}`, {
    method: 'POST',
    body: JSON.stringify(value),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(3000)])
      : AbortSignal.timeout(3000),
  });
const control = (server, reviewId, action) =>
  fetch(`${server.url}/control`, {
    method: 'POST',
    body: JSON.stringify({ reviewId, action }),
    signal: AbortSignal.timeout(3000),
  });
async function consume(response, pattern) {
  const reader = response.body.getReader();
  let text = '';
  while (!pattern.test(text)) {
    const value = await reader.read();
    assert.equal(value.done, false, 'expected SSE bytes before EOF');
    text += new TextDecoder().decode(value.value);
  }
  return { reader, text };
}
async function serverTest(action) {
  const server = await createReviewServer({
    bundle: '/* test */',
    provenance: { fixture: true },
  });
  try {
    await action(server);
  } finally {
    await server.close();
  }
}

test(
  'full independent oracle sequence retains complete native history and observes physical closures',
  { timeout: 8000 },
  () =>
    serverTest(async (server) => {
      const reviewId = randomUUID();
      const first = body(reviewId);
      const initial = await agent(server, reviewId, first);
      assert.equal(initial.status, 200);
      const { reader, text } = await consume(initial, /TOOL_CALL_ARGS/);
      assert.match(text, /"type":"STATE_DELTA"/);
      assert.match(
        text,
        /"op":"replace","path":"\/reasoning_effort","value":"high"/
      );
      assert.doesNotMatch(text, /STATE_SNAPSHOT/);
      assert.equal(server.stats().requests[0].closed, false);
      assert.equal(
        (await control(server, reviewId, 'advance-first')).status,
        200
      );
      let suffix = '';
      while (!suffix.includes('RUN_FINISHED'))
        suffix += new TextDecoder().decode((await reader.read()).value);
      assert.match(suffix, /suspended/);
      await reader.cancel();
      await until(() => server.stats().requests[0].closed);
      const answer = {
        id: `${first.runId}-answer`,
        role: 'assistant',
        content: 'Hello',
        toolCalls: [
          {
            id: `${first.runId}-call`,
            type: 'function',
            function: { name: 'weather', arguments: '{"city":"Paris"}' },
          },
        ],
        subagentRunId: 'worker',
      };
      const result = {
        id: `${first.runId}-result`,
        role: 'tool',
        toolCallId: `${first.runId}-call`,
        content: '{"temperature":20}',
        subagentRunId: 'worker',
      };
      const second = body(reviewId, 'a', 'Second');
      second.messages = [...first.messages, answer, result, ...second.messages];
      second.state = {
        count: 2,
        model: 'review-large',
        reasoning_effort: 'medium',
        gen_ui_mode: 'panel',
      };
      const next = await agent(server, reviewId, second);
      assert.equal(next.status, 200);
      const nextStream = await consume(next, /Next answer/);
      assert.equal(
        (await control(server, reviewId, 'complete-second')).status,
        200
      );
      await nextStream.reader.cancel();
      await until(() => server.stats().requests[1].closed);
      const other = await agent(
        server,
        reviewId,
        body(reviewId, 'b', 'Other'),
        'b'
      );
      assert.equal(other.status, 200);
      const held = await consume(other, /Other answer/);
      const cancelable = body(reviewId, 'a', 'Cancelable');
      cancelable.messages = [
        ...second.messages,
        {
          id: `${second.runId}-answer`,
          role: 'assistant',
          content: 'Next answer',
        },
        ...cancelable.messages,
      ];
      cancelable.state = { count: 2 };
      const last = await agent(server, reviewId, cancelable);
      assert.equal(last.status, 200);
      const lastStream = await consume(last, /Cancelable answer/);
      await lastStream.reader.cancel();
      await until(() => server.stats().requests[3].closed);
      assert.equal(server.stats().requests[2].closed, false);
      await held.reader.cancel();
      await until(() =>
        server.stats().requests.every((request) => request.closed)
      );
      assert.equal(server.stats().requests.length, 4);
      assert.ok(server.stats().requests.every((request) => request.verified));
      assert.deepEqual(server.stats().errors, []);
    })
);

for (const [name, mutate] of [
  [
    'missing application field',
    (value) => {
      delete value.state.model;
    },
  ],
  [
    'extra application field',
    (value) => {
      value.state.extra = true;
    },
  ],
  [
    'missing envelope field',
    (value) => {
      delete value.tools;
    },
  ],
  [
    'extra envelope field',
    (value) => {
      value.extra = true;
    },
  ],
  [
    'wrapped state',
    (value) => {
      value.state = { state: {} };
    },
  ],
  [
    'wrong initial state',
    (value) => {
      value.state = { count: 1 };
    },
  ],
  [
    'history replay',
    (value) => {
      value.messages.unshift({
        id: randomUUID(),
        role: 'assistant',
        content: 'invented',
      });
    },
  ],
  [
    'unknown scenario',
    (value) => {
      value.messages[0].content = 'Unexpected';
    },
  ],
  [
    'wrong order',
    (value) => {
      value.messages[0].content = 'Second';
    },
  ],
  [
    'duplicate run/user identity',
    (value) => {
      value.messages[0].id = value.runId;
    },
  ],
  [
    'wrong thread role',
    (value) => {
      value.threadId = value.threadId.replace(/-a$/, '-b');
    },
  ],
]) {
  test(`oracle rejects ${name} with a recorded failing verdict`, () =>
    serverTest(async (server) => {
      const reviewId = randomUUID(),
        value = body(reviewId);
      mutate(value);
      const response = await agent(server, reviewId, value);
      assert.equal(response.status, 422);
      assert.match((await response.json()).error, /.+/);
      await until(() => server.stats().requests[0]?.closed);
      assert.equal(server.stats().requests[0].verified, false);
      assert.equal(server.stats().errors.length, 1);
    }));
}

test('review IDs isolate admission; abort closes one response without touching the other', () =>
  serverTest(async (server) => {
    const a = randomUUID(),
      b = randomUUID(),
      controller = new AbortController();
    const first = await agent(server, a, body(a), 'a', controller.signal);
    const second = await agent(server, b, body(b));
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const other = await consume(second, /TOOL_CALL_ARGS/);
    controller.abort();
    await until(() => server.stats().requests[0].closed);
    assert.equal(server.stats().requests[1].closed, false);
    assert.equal((await control(server, a, 'advance-first')).status, 422);
    await other.reader.cancel();
  }));

for (const [name, mutate] of [
  [
    'later state replay',
    (next) => {
      next.state = {};
    },
  ],
  [
    'later missing history',
    (next) => {
      next.messages.splice(1, 1);
    },
  ],
  [
    'later altered tool result',
    (next) => {
      next.messages[2].content = 'invented';
    },
  ],
  [
    'reused run identity',
    (next, first) => {
      next.runId = first.runId;
    },
  ],
  [
    'reused user identity',
    (next, first) => {
      next.messages.at(-1).id = first.messages[0].id;
    },
  ],
]) {
  test(
    `oracle rejects ${name} after an accepted first request`,
    { timeout: 4000 },
    () =>
      serverTest(async (server) => {
        const id = randomUUID(),
          first = body(id);
        const response = await agent(server, id, first);
        const { reader } = await consume(response, /TOOL_CALL_ARGS/);
        assert.equal((await control(server, id, 'advance-first')).status, 200);
        await reader.cancel();
        await until(() => server.stats().requests[0].closed);
        const next = body(id, 'a', 'Second');
        next.state = {
          count: 2,
          model: 'review-large',
          reasoning_effort: 'medium',
          gen_ui_mode: 'panel',
        };
        next.messages = [
          { id: first.messages[0].id, role: 'user', content: 'First' },
          {
            id: `${first.runId}-answer`,
            role: 'assistant',
            content: 'Hello',
            subagentRunId: 'worker',
            toolCalls: [
              {
                id: `${first.runId}-call`,
                type: 'function',
                function: { name: 'weather', arguments: '{"city":"Paris"}' },
              },
            ],
          },
          {
            id: `${first.runId}-result`,
            role: 'tool',
            toolCallId: `${first.runId}-call`,
            content: '{"temperature":20}',
            subagentRunId: 'worker',
          },
          ...next.messages,
        ];
        mutate(next, first);
        const rejected = await agent(server, id, next);
        assert.equal(rejected.status, 422);
        await rejected.json();
        await until(() => server.stats().requests[1].closed);
        assert.equal(server.stats().requests[1].verified, false);
        assert.equal(server.stats().errors.length, 1);
      })
  );
}

test(
  'unknown and repeated controls fail without emitting into the held response',
  { timeout: 4000 },
  () =>
    serverTest(async (server) => {
      const id = randomUUID(),
        response = await agent(server, id, body(id));
      const { reader } = await consume(response, /TOOL_CALL_ARGS/);
      assert.equal((await control(server, id, 'unknown')).status, 422);
      assert.equal((await control(server, id, 'complete-second')).status, 422);
      assert.equal((await control(server, id, 'advance-first')).status, 200);
      assert.equal((await control(server, id, 'advance-first')).status, 422);
      await reader.cancel();
      await until(() => server.stats().requests[0].closed);
      assert.equal(server.stats().errors.length, 3);
    })
);

test('runner import is inert and unknown CLI flags fail without artifacts or Chromium', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-harness-import-'));
  try {
    const url = new URL('./review-native-ag-ui.mjs', import.meta.url).href;
    const imported = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`],
      { cwd: root, encoding: 'utf8', timeout: 3000 }
    );
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, '');
    assert.equal(imported.stderr, '');
    const cli = spawnSync(
      process.execPath,
      [new URL(url).pathname, '--unknown'],
      { cwd: root, encoding: 'utf8', timeout: 3000 }
    );
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /Usage:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('invalid control phase is rejected explicitly and shutdown is idempotent', async () => {
  const server = await createReviewServer({ bundle: '', provenance: {} });
  try {
    assert.equal(
      (await control(server, randomUUID(), 'complete-second')).status,
      422
    );
    assert.equal(server.stats().errors.length, 1);
    const id = randomUUID();
    const response = await agent(server, id, body(id));
    assert.equal(response.status, 200);
    await consume(response, /TOOL_CALL_ARGS/);
    const closing = server.close();
    assert.equal(server.close(), closing);
    await closing;
    assert.ok(server.stats().requests[0].closed);
    await assert.rejects(fetch(server.url));
  } finally {
    await server.close();
  }
});

test('missing prerequisites give the exact build command without launching anything', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-harness-artifacts-'));
  try {
    assert.throws(
      () => resolveArtifacts(root),
      /NX_DAEMON=false NX_TUI=false npx nx run-many -t build -p core,angular,react --skip-nx-cache/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('compiled entry resolution follows actual package exports and rejects missing implementation', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-harness-artifacts-'));
  try {
    for (const [name, entry] of [
      ['core', 'src/index.js'],
      ['react', 'src/index.js'],
      ['angular', 'fesm2022/threadplane-angular.mjs'],
    ]) {
      const folder = join(root, 'dist/libs', name);
      mkdirSync(join(folder, entry.startsWith('src') ? 'src' : 'fesm2022'), {
        recursive: true,
      });
      writeFileSync(
        join(folder, 'package.json'),
        JSON.stringify({
          name: `@threadplane/${name}`,
          exports: {
            '.': { default: `./${entry}` },
            ...(name === 'core' ? {} : { './chat': { default: './chat.js' } }),
          },
        })
      );
      writeFileSync(join(folder, entry), 'export {};');
      if (name !== 'core') writeFileSync(join(folder, 'chat.js'), 'export {};');
    }
    const artifacts = resolveArtifacts(root);
    assert.equal(
      artifacts['@threadplane/react'],
      join(root, 'dist/libs/react/src/index.js')
    );
    assert.equal(
      artifacts['@threadplane/angular'],
      join(root, 'dist/libs/angular/fesm2022/threadplane-angular.mjs')
    );
    assert.equal(
      artifacts['@threadplane/react/chat'],
      join(root, 'dist/libs/react/chat.js')
    );
    assert.equal(
      artifacts['@threadplane/angular/chat'],
      join(root, 'dist/libs/angular/chat.js')
    );
    rmSync(artifacts['@threadplane/angular/chat']);
    assert.throws(() => resolveArtifacts(root), /prebuilt angular/);
    writeFileSync(artifacts['@threadplane/angular/chat'], 'export {};');
    rmSync(artifacts['@threadplane/react']);
    assert.throws(() => resolveArtifacts(root), /prebuilt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('provenance hashes transitive local inputs and reports only scoped tracked/untracked changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-harness-provenance-'));
  try {
    const write = (path, value) => {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), value);
    };
    const runtime = 'libs/ag-ui/src/lib/internal/copy-data.ts';
    const compiled = 'dist/libs/react/src/use-agent.js';
    const runner = 'scripts/react-parity/review-native-ag-ui.mjs';
    write(runtime, 'original');
    write(compiled, 'compiled');
    write(runner, 'runner');
    write(
      'package-lock.json',
      JSON.stringify({
        packages: {
          'node_modules/react': { version: '19.2.4' },
          'node_modules/typescript': { version: '5.9.3' },
        },
      })
    );
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-qm',
        'baseline',
      ],
      { cwd: root }
    );
    const extra = 'fixtures/react-parity/native-ag-ui/browser.tsx';
    write(extra, 'browser');
    write('unrelated-secret.txt', 'must not appear');
    const metafile = {
      inputs: {
        [runtime]: {},
        [compiled]: {},
        [extra]: {},
        'node_modules/react/index.js': {},
      },
    };
    const options = {
      root,
      metafile,
      bundle: 'bundle',
      additionalInputs: [runner],
    };
    const before = collectProvenance(options);
    write(runtime, 'changed');
    const after = collectProvenance(options);
    assert.notDeepEqual(before.inputs, after.inputs);
    assert.deepEqual(after.git.modified, [runtime]);
    assert.deepEqual(after.git.untracked, [extra]);
    assert.ok(after.inputs.some((input) => input.path === compiled));
    assert.ok(after.inputs.some((input) => input.path === runner));
    assert.equal(after.versions.typescript, '5.9.3');
    assert.match(after.bundleSha256, /^[a-f0-9]{64}$/);
    assert.match(after.packageLockSha256, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(after).includes(root));
    assert.ok(!JSON.stringify(after).includes('unrelated-secret'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const failure of ['launch', 'verification', 'browser-close']) {
  test(`runner closes only owned resources after ${failure} failure`, async () => {
    const events = [];
    const browser = {
      close: async () => {
        events.push('browser-close');
        if (failure === 'browser-close') throw new Error(failure);
      },
    };
    await assert.rejects(
      runReview(
        { verify: true, log: () => undefined },
        {
          buildFixture: async () => ({ bundle: '', provenance: {} }),
          createReviewServer: async () => ({
            url: 'http://127.0.0.1:1',
            close: async () => {
              events.push('server-close');
            },
          }),
          launchBrowser: async () => {
            if (failure === 'launch') throw new Error(failure);
            return browser;
          },
          verifyBrowser: async () => {
            if (failure === 'verification') throw new Error(failure);
            return {};
          },
        }
      ),
      new RegExp(failure)
    );
    assert.deepEqual(
      events,
      failure === 'launch'
        ? ['server-close']
        : ['browser-close', 'server-close']
    );
  });
}

test('manual mode prints provenance and waits for its signal without launching a browser', async () => {
  const controller = new AbortController(),
    events = [];
  await runReview(
    {
      signal: controller.signal,
      log: (value) => {
        events.push(value);
        controller.abort();
      },
    },
    {
      buildFixture: async () => ({ bundle: '', provenance: { checked: true } }),
      createReviewServer: async () => ({
        url: 'http://127.0.0.1:1',
        close: async () => {
          events.push('closed');
        },
      }),
      launchBrowser: async () => {
        throw new Error('manual must not launch');
      },
    }
  );
  assert.equal(events[0].mode, 'manual');
  assert.deepEqual(events[0].provenance, { checked: true });
  assert.equal(events[1], 'closed');
});

test(
  'verification interrupted by a signal promptly closes its browser and server',
  { timeout: 2000 },
  async () => {
    const controller = new AbortController(),
      events = [];
    await assert.rejects(
      runReview(
        {
          verify: true,
          signal: controller.signal,
          log: () => assert.fail('interrupted proof cannot pass'),
        },
        {
          buildFixture: async () => ({ bundle: '', provenance: {} }),
          createReviewServer: async () => ({
            close: async () => {
              events.push('server-close');
            },
          }),
          launchBrowser: async () => ({
            close: async () => {
              events.push('browser-close');
            },
          }),
          verifyBrowser: async () => {
            controller.abort();
            return new Promise(() => undefined);
          },
        }
      ),
      /interrupted/
    );
    assert.deepEqual(events, ['browser-close', 'server-close']);
  }
);
