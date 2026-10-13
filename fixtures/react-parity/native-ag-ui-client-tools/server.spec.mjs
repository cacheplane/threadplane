import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createClientToolsServer,
  readProcessInventory,
  ownedGroupMembers,
} from './server.mjs';

test(
  'actual locked worker denies every CPython DNS resolver audit event before localhost-only resolution',
  { timeout: 25000 },
  () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const worker = fileURLToPath(
      new URL('./compiled_worker.py', import.meta.url)
    );
    const source = `import json, runpy, socket, sys
worker = runpy.run_path(sys.argv[1])
results = []
for name, event, invoke in [
    ('getaddrinfo', 'socket.getaddrinfo', lambda: socket.getaddrinfo('localhost', 0)),
    ('gethostbyname', 'socket.gethostbyname', lambda: socket.gethostbyname('localhost')),
    ('gethostbyname_ex', 'socket.gethostbyname', lambda: socket.gethostbyname_ex('localhost')),
    ('gethostbyaddr', 'socket.gethostbyaddr', lambda: socket.gethostbyaddr('127.0.0.1')),
    ('getnameinfo', 'socket.getnameinfo', lambda: socket.getnameinfo(('127.0.0.1', 0), socket.NI_NUMERICHOST | socket.NI_NUMERICSERV)),
]:
    baseline = len(worker['socket_attempts'])
    try:
        result = invoke()
        results.append({'name': name, 'event': event, 'blocked': False, 'result': result, 'recorded': worker['socket_attempts'][baseline:]})
    except Exception as error:
        results.append({'name': name, 'event': event, 'blocked': isinstance(error, RuntimeError), 'error': str(error), 'recorded': worker['socket_attempts'][baseline:]})
print(json.dumps({'python': sys.version.split()[0], 'results': results}))
`;
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/(?:API_KEY|TOKEN|SECRET|LANGSMITH|LANGCHAIN)/i.test(key)
      )
    );
    Object.assign(env, {
      UV_PROJECT_ENVIRONMENT:
        process.env.THREADPLANE_AG_UI_FIXTURE_ENVIRONMENT ??
        '/tmp/threadplane-agui-client-tools-native-fixture-env',
      UV_PYTHON: '3.12',
      LANGSMITH_TRACING: 'false',
      LANGCHAIN_TRACING_V2: 'false',
    });
    const result = JSON.parse(
      execFileSync(
        'uv',
        [
          'run',
          '--frozen',
          '--no-sync',
          '--project',
          'cockpit/ag-ui/client-tools/python',
          'python',
          '-c',
          source,
          worker,
        ],
        {
          cwd: root,
          env,
          encoding: 'utf8',
          timeout: 20000,
          maxBuffer: 1_000_000,
        }
      )
    );
    assert.match(result.python, /^3\.12\./);
    assert.equal(result.results.length, 5);
    for (const outcome of result.results) {
      assert.equal(outcome.blocked, true, JSON.stringify(outcome));
      assert.equal(
        outcome.error,
        'External socket operations and DNS forbidden in offline canonical worker'
      );
      assert.deepEqual(outcome.recorded, [outcome.event]);
    }
  }
);

test('process inventory is bounded and rejects failed or malformed ps output', () => {
  assert.throws(
    () =>
      readProcessInventory(() => {
        throw new Error('ps failed');
      }),
    /ps failed/
  );
  assert.throws(() => readProcessInventory(() => 'malformed'), /Malformed/);
  const rows = readProcessInventory((command, args, options) => {
    assert.equal(command, 'ps');
    assert.equal(options.timeout, 1000);
    assert.equal(options.maxBuffer, 4_000_000);
    return '100 99 100 Mon Oct 12 18:00:00 2026 python compiled_worker.py\n';
  });
  assert.equal(rows[0].pid, 100);
});
test('independent empty group inventory resolves an ambiguous signal-0 probe without signalling', () => {
  assert.deepEqual(ownedGroupMembers([], 100, new Map()), []);
});
test('group ownership rejects PID reuse and unrelated members before signalling', () => {
  const owner = {
    pid: 100,
    ppid: 99,
    pgid: 100,
    birth: 'original',
    command: 'python compiled_worker.py',
  };
  const owners = new Map([[100, owner]]);
  assert.deepEqual(ownedGroupMembers([owner], 100, owners), [owner]);
  assert.throws(
    () => ownedGroupMembers([{ ...owner, birth: 'reused' }], 100, owners),
    /termination forbidden/
  );
  assert.throws(
    () => ownedGroupMembers([{ ...owner, command: 'unrelated' }], 100, owners),
    /termination forbidden/
  );
  assert.throws(
    () => ownedGroupMembers([owner, { ...owner, pid: 101 }], 100, owners),
    /termination forbidden/
  );
});

test(
  'owned real compiled worker reports canonical identity and closes its process and port',
  { timeout: 30000 },
  async () => {
    const server = await createClientToolsServer();
    try {
      const stats = await (await fetch(server.url + '/stats')).json();
      assert.equal(stats.ready.pid, server.pid);
      assert.match(stats.ready.python, /^3\.12\./);
      assert.match(
        stats.ready.modules['src.graph'],
        /cockpit\/ag-ui\/client-tools\/python\/src\/graph.py$/
      );
      assert.match(
        stats.ready.modules['threadplane.middleware.langgraph.middleware'],
        /packages\/threadplane-middleware\/src/
      );
      assert.equal(stats.ready.versions['ag-ui-langgraph'], '0.0.45');
      assert.deepEqual(stats.requests, []);
    } finally {
      await server.close();
    }
    assert.equal(server.stats().closure.childAbsent, true);
    assert.equal(server.stats().closure.portAbsent, true);
  }
);
test(
  'invalid worker request fails closed without leaving owned resources',
  { timeout: 30000 },
  async () => {
    const server = await createClientToolsServer();
    try {
      const response = await fetch(server.url + '/agent', {
        method: 'POST',
        body: JSON.stringify({ invalid: true }),
      });
      assert.equal(response.status, 422);
      assert.ok(server.stats().errors.length);
    } finally {
      await server.close();
    }
    assert.equal(server.stats().closure.childAbsent, true);
    assert.equal(server.stats().closure.portAbsent, true);
  }
);
