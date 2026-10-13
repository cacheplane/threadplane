import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const defaultRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..'
);
const MAX_BYTES = 2_000_000;
const sha = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}
export function readProcessInventory(run = execFileSync) {
  const output = run('ps', ['-axo', 'pid=,ppid=,pgid=,lstart=,args='], {
    encoding: 'utf8',
    timeout: 1000,
    maxBuffer: 4_000_000,
  });
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line
        .trim()
        .match(
          /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+)$/
        );
      assert.ok(
        match,
        'Malformed process inventory; ownership remains unverified'
      );
      const [, pid, ppid, pgid, birth, command] = match;
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        pgid: Number(pgid),
        birth: birth.replace(/\s+/g, ' '),
        command,
      };
    });
}
export function ownedGroupMembers(inventory, pgid, owners) {
  const members = inventory.filter((row) => row.pgid === pgid);
  for (const member of members) {
    const owner = owners.get(member.pid);
    assert.ok(
      owner && member.birth === owner.birth && member.command === owner.command,
      'Ambiguous or unrelated group member; termination forbidden'
    );
  }
  return members;
}
async function portAbsent(port) {
  return new Promise((yes) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.setTimeout(1000, () => {
      socket.destroy();
      yes(false);
    });
    socket.once('connect', () => {
      socket.destroy();
      yes(false);
    });
    socket.once('error', (error) => {
      socket.destroy();
      yes(error.code === 'ECONNREFUSED');
    });
  });
}
export async function createClientToolsServer({
  root = defaultRoot,
  mode = 'nonstream',
  holdTerminal = false,
  environment = process.env.THREADPLANE_AG_UI_FIXTURE_ENVIRONMENT ??
    '/tmp/threadplane-agui-client-tools-native-fixture-env',
} = {}) {
  root = realpathSync(root);
  assert.ok(['nonstream', 'stream', 'unknown'].includes(mode));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/(?:API_KEY|TOKEN|SECRET|LANGSMITH|LANGCHAIN)/i.test(key)
    )
  );
  Object.assign(env, {
    UV_PROJECT_ENVIRONMENT: environment,
    UV_PYTHON: '3.12',
    LANGSMITH_TRACING: 'false',
    LANGCHAIN_TRACING_V2: 'false',
  });
  const worker = join(
    root,
    'fixtures/react-parity/native-ag-ui-client-tools/compiled_worker.py'
  );
  const child = spawn(
    'uv',
    [
      'run',
      '--frozen',
      '--no-sync',
      '--project',
      'cockpit/ag-ui/client-tools/python',
      'python',
      worker,
      mode,
    ],
    { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true }
  );
  const records = [],
    errors = [],
    sockets = new Set(),
    responses = new Set(),
    waiting = [];
  let ready,
    buffer = '',
    stderr = '',
    exited = false,
    closing,
    port,
    active = false;
  const ownedProcesses = new Map();
  const closure = {
    childAbsent: false,
    processGroupAbsent: false,
    portAbsent: false,
    responsesClosed: false,
    socketsClosed: false,
    stdinClosed: false,
  };
  const stats = () =>
    structuredClone({ ready, requests: records, errors, stderr, closure });
  const fail = (error) => {
    errors.push(String(error));
    for (const pending of waiting.splice(0)) pending.reject(error);
  };
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    if (stderr.length > MAX_BYTES) {
      stderr = stderr.slice(0, MAX_BYTES);
      fail(new Error('worker stderr bound'));
    }
  });
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.on('exit', (code, signal) => {
    exited = true;
    if (!closing) fail(new Error(`worker exited ${code}/${signal}`));
  });
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_BYTES) {
      fail(new Error('worker output bound'));
      child.kill('SIGTERM');
      return;
    }
    while (buffer.includes('\n')) {
      const at = buffer.indexOf('\n'),
        line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      try {
        const value = JSON.parse(line);
        const pending = waiting.shift();
        assert.ok(pending, 'unsolicited worker output');
        pending.resolve(value);
      } catch (error) {
        fail(error);
      }
    }
  });
  const receive = () => {
    const result = new Promise((resolve, reject) =>
      waiting.push({ resolve, reject })
    );
    let timer;
    return Promise.race([
      result,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('worker response timeout')),
          20000
        );
      }),
    ]).finally(() => clearTimeout(timer));
  };
  const server = createServer(async (request, response) => {
    request.setTimeout(15000, () => request.destroy());
    response.setTimeout(20000, () => response.destroy());
    responses.add(response);
    response.once('close', () => responses.delete(response));
    const json = (status, value) =>
      response
        .writeHead(status, { 'content-type': 'application/json' })
        .end(JSON.stringify(value));
    try {
      if (request.method === 'GET' && request.url === '/stats')
        return json(200, stats());
      if (request.method === 'POST' && request.url === '/release') {
        for (const record of records)
          if (record.held && !record.closed) {
            record.response.write(
              `data: ${JSON.stringify(record.events.at(-1))}\n\n`
            );
            record.response.end();
            record.held = false;
          }
        return json(200, { released: true });
      }
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/agent');
      assert.ok(
        !active && records.length < 12 && !exited,
        'bounded sequential requests'
      );
      active = true;
      const record = { closed: false, events: [], held: false };
      records.push(record);
      // The response itself is non-enumerable: stats retain only independent evidence.
      Object.defineProperty(record, 'response', { value: response });
      response.once('close', () => {
        record.closed = true;
      });
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        assert.ok(body.length <= MAX_BYTES, 'HTTP input bound');
      }
      record.body = JSON.parse(body);
      const pending = receive();
      child.stdin.write(body + '\n');
      const output = await pending;
      assert.ok(!output.error, output.error);
      assert.ok(Array.isArray(output.events) && output.events.length <= 256);
      record.events = output.events;
      record.observations = output.observations;
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
      });
      record.held = holdTerminal;
      const events = holdTerminal ? output.events.slice(0, -1) : output.events;
      for (const event of events)
        if (!response.destroyed)
          response.write(`data: ${JSON.stringify(event)}\n\n`);
      if (!holdTerminal) response.end();
    } catch (error) {
      errors.push(String(error));
      if (!response.headersSent) json(422, { error: String(error) });
      else response.destroy();
    } finally {
      if (request.url === '/agent') active = false;
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  async function close() {
    return (closing ??= (async () => {
      for (const response of responses) response.destroy();
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise((yes) => server.close(yes));
      child.stdin.end();
      closure.stdinClosed = true;
      // macOS can return EPERM for signal-0 against a vanished process group.
      // Inspect exact PGID membership independently before any owned-group signal.
      const groupAlive = () =>
        Number.isInteger(child.pid) &&
        readProcessInventory().some((row) => row.pgid === child.pid);
      const deadline = Date.now() + 1500;
      while (groupAlive() && Date.now() < deadline) await delay(20);
      if (groupAlive()) {
        ownedGroupMembers(readProcessInventory(), child.pid, ownedProcesses);
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      const killDeadline = Date.now() + 1500;
      while (groupAlive() && Date.now() < killDeadline) await delay(20);
      if (groupAlive()) {
        ownedGroupMembers(readProcessInventory(), child.pid, ownedProcesses);
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      const finalDeadline = Date.now() + 1500;
      while (
        ((child.pid && !exited) || (ready && alive(ready.pid))) &&
        Date.now() < finalDeadline
      )
        await delay(20);
      closure.childAbsent =
        (!child.pid || (exited && !alive(child.pid))) &&
        (!ready || !alive(ready.pid));
      closure.processGroupAbsent = !groupAlive();
      closure.portAbsent = port ? await portAbsent(port) : true;
      closure.responsesClosed = responses.size === 0;
      closure.socketsClosed = sockets.size === 0;
      assert.ok(
        Object.values(closure).every(Boolean),
        'All exact owned fixture resources closed'
      );
    })());
  }
  try {
    const initial = await receive();
    ready = initial.ready;
    assert.ok(ready && Number.isInteger(ready.pid));
    if (ready.pid !== child.pid)
      assert.equal(
        Number(
          execFileSync('ps', ['-o', 'ppid=', '-p', String(ready.pid)], {
            encoding: 'utf8',
          }).trim()
        ),
        child.pid,
        'ready worker is the exact spawned child descendant'
      );
    assert.equal(
      Number(
        execFileSync('ps', ['-o', 'pgid=', '-p', String(ready.pid)], {
          encoding: 'utf8',
        }).trim()
      ),
      child.pid,
      'worker belongs to only its owned process group'
    );
    const inventory = readProcessInventory();
    for (const pid of new Set([child.pid, ready.pid])) {
      const identity = inventory.find((row) => row.pid === pid);
      assert.ok(
        identity &&
          identity.pgid === child.pid &&
          identity.command.includes(worker),
        'Exact launched fixture source and process birth required'
      );
      ownedProcesses.set(pid, identity);
    }
    ownedGroupMembers(inventory, child.pid, ownedProcesses);
    assert.equal(ready.mode, mode);
    assert.match(ready.python, /^3\.12\./);
    assert.equal(ready.versions['ag-ui-langgraph'], '0.0.45');
    assert.equal(ready.versions['ag-ui-protocol'], '1.0.0');
    assert.equal(ready.versions.langgraph, '1.2.4');
    assert.equal(
      ready.modules['src.graph'],
      realpathSync(join(root, 'cockpit/ag-ui/client-tools/python/src/graph.py'))
    );
    assert.ok(
      ready.modules['threadplane.middleware.langgraph.middleware'].startsWith(
        join(root, 'packages/threadplane-middleware/src/')
      )
    );
    for (const source of ready.sources)
      assert.equal(source.sha256, sha(source.path));
    await new Promise((yes, no) => {
      server.once('error', no);
      server.listen(0, '127.0.0.1', yes);
    });
    port = server.address().port;
    return { url: `http://127.0.0.1:${port}`, pid: ready.pid, stats, close };
  } catch (error) {
    await close();
    error.fixtureClosure = stats();
    throw error;
  }
}
