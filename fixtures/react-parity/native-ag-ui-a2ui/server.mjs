import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const MAX_BYTES = 16 * 1024 * 1024;
const workerPath = fileURLToPath(
  new URL('./compiled_worker.py', import.meta.url)
);
function errorEvidence() {
  return {
    errors: [],
    errorCount: 0,
    errorOverflow: 0,
    errorEvidenceComplete: true,
  };
}
function recordError(receipt, error) {
  receipt.errorCount = Math.min(
    Number.MAX_SAFE_INTEGER,
    receipt.errorCount + 1
  );
  if (receipt.errors.length < 63)
    receipt.errors.push(String(error).slice(0, 1024));
  else {
    if (!receipt.errorOverflow)
      receipt.errors.push('Error evidence overflow; verification fails');
    receipt.errorOverflow = Math.min(
      Number.MAX_SAFE_INTEGER,
      receipt.errorOverflow + 1
    );
    receipt.errorEvidenceComplete = false;
  }
}
export function pidAbsent(pid, signal = process.kill) {
  try {
    signal(pid, 0);
    return false;
  } catch (error) {
    if (error.code === 'ESRCH') return true;
    throw new Error('Process absence unknown', { cause: error });
  }
}

/** Bounded single-response protocol; stdio closure is separately retained. */
export function createWorkerChannel(
  child,
  { maxBytes = MAX_BYTES, timeoutMs = 20000 } = {}
) {
  const receipt = {
    ...errorEvidence(),
    stdoutClosed: false,
    stderrClosed: false,
    childClosed: false,
    stderr: '',
    lines: 0,
  };
  let buffer = Buffer.alloc(0),
    pending,
    queued,
    failure;
  const fail = (error) => {
    failure ??= error;
    recordError(receipt, error);
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(failure);
      pending = undefined;
    }
  };
  child.on('error', (error) =>
    fail(new Error('Worker spawn/error', { cause: error }))
  );
  child.on('exit', (code) => {
    if (pending) fail(new Error(`Worker exited ${code}`));
  });
  child.on('close', () => {
    receipt.childClosed = true;
    if (buffer.length) fail(new Error('Incomplete worker line'));
    if (pending) fail(new Error('Worker closed'));
  });
  child.stdout.on('data', (chunk) => {
    if (failure) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > maxBytes)
      return fail(new Error('Worker line oversized'));
    const end = buffer.indexOf(10);
    if (end < 0) return;
    if (end !== buffer.length - 1)
      return fail(new Error('Unsolicited worker lines'));
    let value;
    try {
      value = JSON.parse(buffer.subarray(0, end).toString('utf8'));
      assert.ok(value && typeof value === 'object' && !Array.isArray(value));
    } catch (error) {
      return fail(new Error('Invalid worker line', { cause: error }));
    }
    buffer = Buffer.alloc(0);
    receipt.lines++;
    if (pending) {
      const waiting = pending;
      pending = undefined;
      clearTimeout(waiting.timer);
      waiting.resolve(value);
    } else if (queued) fail(new Error('Unsolicited worker response'));
    else queued = value;
  });
  child.stdout.on('error', fail);
  child.stdout.on('end', () => {
    receipt.stdoutClosed = true;
    if (buffer.length) fail(new Error('Incomplete worker line'));
  });
  child.stderr.on('data', (chunk) => {
    receipt.stderr += chunk.toString();
    if (Buffer.byteLength(receipt.stderr) > 65536) {
      receipt.stderr = receipt.stderr.slice(0, 65536);
      fail(new Error('Worker stderr oversized'));
    }
  });
  child.stderr.on('end', () => {
    receipt.stderrClosed = true;
  });
  child.stderr.on('error', fail);
  child.stdin.on('error', fail);
  return {
    receipt,
    receive() {
      if (failure) return Promise.reject(failure);
      if (pending)
        return Promise.reject(new Error('Concurrent worker receive'));
      if (queued) {
        const value = queued;
        queued = undefined;
        return Promise.resolve(value);
      }
      if (receipt.childClosed)
        return Promise.reject(new Error('Worker closed'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => fail(new Error('Worker response deadline')),
          timeoutMs
        );
        pending = { resolve, reject, timer };
      });
    },
    async close() {
      if (pending) fail(new Error('Worker channel closing'));
      child.stdin.end();
      const until = Date.now() + 2000;
      while (
        (!receipt.childClosed ||
          !receipt.stdoutClosed ||
          !receipt.stderrClosed) &&
        Date.now() < until
      )
        await delay(5);
      assert.ok(
        receipt.childClosed && receipt.stdoutClosed && receipt.stderrClosed,
        'Worker close/drain unknown'
      );
    },
  };
}
export function createRequestGate({ maxRequests = 4, maxEvents = 512 } = {}) {
  const runs = new Set();
  let thread,
    active = false;
  return {
    admit(input) {
      assert.ok(!active, 'Request active');
      assert.ok(
        input &&
          typeof input.threadId === 'string' &&
          input.threadId &&
          typeof input.runId === 'string' &&
          input.runId &&
          Array.isArray(input.messages),
        'Invalid request identity'
      );
      assert.ok(!runs.has(input.runId), 'duplicate request');
      assert.ok(!thread || thread === input.threadId, 'Foreign thread');
      assert.ok(runs.size < maxRequests, 'Request count bound');
      thread = input.threadId;
      runs.add(input.runId);
      active = true;
    },
    validate(events, input) {
      assert.ok(
        Array.isArray(events) && events.length <= maxEvents,
        'Event count bound'
      );
      for (const event of events)
        if (event.type === 'RUN_STARTED' || event.type === 'RUN_FINISHED') {
          assert.equal(event.threadId, input.threadId, 'Foreign thread');
          assert.equal(event.runId, input.runId, 'Foreign run');
        }
    },
    finish() {
      active = false;
    },
  };
}
function processIdentity(pid) {
  return execFileSync(
    '/bin/ps',
    ['-o', 'pid=,lstart=,args=', '-p', String(pid)],
    { encoding: 'utf8', timeout: 1000, maxBuffer: 65536 }
  ).trim();
}
function deadline(operation, milliseconds, label) {
  let timer;
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}
function captureChild(child, receipt) {
  // These facts belong to the acquired child, independently of channel setup.
  child.stdout.once('end', () => {
    receipt.stdoutClosed = true;
  });
  child.stderr.once('end', () => {
    receipt.stderrClosed = true;
  });
}

/** Explicit launch only, with reviewed owned locked Python and HOME/tmpdir. */
export async function createA2uiServer({
  python,
  environment,
  home,
  tmpdir,
  spawnWorker,
  closeWorker,
  registerWorker,
  createHttpServer = createServer,
  timeoutMs = 20000,
} = {}) {
  const records = [],
    errors = errorEvidence(),
    sockets = new Set(),
    responses = new Set();
  let child, childReceipt, channel, server, identity, closing, ready;
  const gate = createRequestGate();
  const closure = {
    worker: false,
    listener: false,
    sockets: false,
    responses: false,
  };
  async function close() {
    return (closing ??= (async () => {
      for (const response of responses) response.destroy();
      for (const socket of sockets) socket.destroy();
      const failures = [];
      if (server)
        try {
          await deadline(
            new Promise((resolve, reject) =>
              server.close((error) =>
                error && error.code !== 'ERR_SERVER_NOT_RUNNING'
                  ? reject(error)
                  : resolve()
              )
            ),
            timeoutMs,
            'Listener closure unknown'
          );
          closure.listener = true;
        } catch (error) {
          failures.push(error);
        }
      else closure.listener = true;
      if (child)
        try {
          if (closeWorker) await closeWorker(child);
          else {
            child.stdin.end();
            child.stdout.resume();
            child.stderr.resume();
            for (const signal of ['SIGTERM', 'SIGKILL']) {
              const until = Date.now() + Math.min(timeoutMs, 1000);
              while (!childReceipt?.childClosed && Date.now() < until)
                await delay(5);
              if (
                !childReceipt?.childClosed &&
                child.pid &&
                !pidAbsent(child.pid)
              ) {
                assert.ok(
                  identity,
                  'Worker identity unknown; termination forbidden'
                );
                assert.equal(
                  processIdentity(child.pid),
                  identity,
                  'Worker identity changed; termination forbidden'
                );
                child.kill(signal);
              }
            }
          }
          if (channel) await channel.close();
          else {
            child.stdout.resume();
            child.stderr.resume();
            const until = Date.now() + Math.min(timeoutMs, 2000);
            while (
              (!childReceipt?.childClosed ||
                !child.stdout.readableEnded ||
                !child.stderr.readableEnded) &&
              Date.now() < until
            )
              await delay(5);
            assert.ok(
              childReceipt?.childClosed &&
                child.stdout.readableEnded &&
                child.stderr.readableEnded,
              'Acquired worker close/drain unknown'
            );
          }
          if (!closeWorker && child.pid)
            assert.ok(pidAbsent(child.pid), 'Worker absence unknown');
          closure.worker = true;
        } catch (error) {
          failures.push(error);
        }
      else closure.worker = true;
      closure.sockets = sockets.size === 0;
      closure.responses = responses.size === 0;
      if (
        !errors.errorEvidenceComplete ||
        (childReceipt && !childReceipt.errorEvidenceComplete) ||
        (channel && !channel.receipt.errorEvidenceComplete)
      )
        failures.push(
          new Error('Error evidence overflow; fixture acceptance failed')
        );
      if (!Object.values(closure).every(Boolean))
        failures.push(new Error('Resource closure unknown'));
      if (failures.length)
        throw new AggregateError(failures, 'Fixture cleanup failed');
    })());
  }
  const stats = () =>
    structuredClone({
      ready,
      requests: records,
      ...errors,
      closure,
      child: childReceipt,
      worker: channel?.receipt,
    });
  try {
    if (!spawnWorker) {
      assert.ok(
        python && environment && home && tmpdir,
        'Explicit owned Python/environment/home/tmpdir required'
      );
      spawnWorker = () =>
        spawn(python, ['-u', workerPath], {
          env: {
            PATH: '/usr/bin:/bin',
            HOME: home,
            TMPDIR: tmpdir,
            VIRTUAL_ENV: environment,
            PYTHONNOUSERSITE: '1',
            PYTHONDONTWRITEBYTECODE: '1',
            OPENAI_API_KEY: 'offline-unused-not-a-secret',
            LANGSMITH_TRACING: 'false',
            LANGCHAIN_TRACING_V2: 'false',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
    }
    child = spawnWorker();
    childReceipt = {
      ...errorEvidence(),
      childClosed: false,
      stdoutClosed: false,
      stderrClosed: false,
    };
    child.once('close', () => {
      childReceipt.childClosed = true;
    });
    child.on('error', (error) => recordError(childReceipt, error));
    if (!closeWorker && child.pid) {
      identity = processIdentity(child.pid);
      assert.ok(
        identity.includes(workerPath),
        'Owned worker identity required'
      );
    }
    captureChild(child, childReceipt);
    channel = createWorkerChannel(child, { timeoutMs });
    registerWorker?.(child);
    const initial = await channel.receive();
    ready = initial.ready;
    assert.ok(
      ready && Number.isInteger(ready.pid),
      'Worker ready identity required'
    );
    if (!closeWorker)
      assert.equal(ready.pid, child.pid, 'Exact child required');
    server = createHttpServer(async (request, response) => {
      if (records.length >= 12) {
        recordError(errors, 'HTTP request count bound');
        request.destroy();
        response.destroy();
        return;
      }
      const record = {
        method: request.method,
        url: request.url,
        readerClosed: false,
        responseClosed: false,
        sentWire: [],
      };
      records.push(record);
      responses.add(response);
      response.once('close', () => {
        record.responseClosed = true;
        responses.delete(response);
      });
      request.once('close', () => {
        record.readerClosed = true;
      });
      request.once('error', (error) => {
        record.readerError = String(error).slice(0, 1024);
      });
      response.once('error', (error) => {
        record.responseError = String(error).slice(0, 1024);
      });
      const timer = setTimeout(() => {
        recordError(errors, 'HTTP deadline');
        request.destroy();
        response.destroy();
      }, timeoutMs);
      let admitted = false;
      try {
        assert.equal(request.url, '/agent', 'Exact endpoint required');
        assert.equal(request.method, 'POST', 'POST required');
        assert.equal(
          request.headers.host,
          `127.0.0.1:${server.address().port}`,
          'Owned host required'
        );
        let bytes = 0;
        const parts = [];
        for await (const chunk of request) {
          bytes += chunk.length;
          assert.ok(bytes <= 2_000_000, 'HTTP body bound');
          parts.push(chunk);
        }
        record.rawBody = Buffer.concat(parts).toString('utf8');
        record.body = JSON.parse(record.rawBody);
        gate.admit(record.body);
        admitted = true;
        const pending = channel.receive();
        child.stdin.write(record.rawBody + '\n');
        const output = await pending;
        record.worker = output;
        assert.ok(!output.error, output.error);
        gate.validate(output.events, record.body);
        assert.ok(
          Array.isArray(output.wire) &&
            output.wire.length === output.events.length &&
            output.wire.every((value) => typeof value === 'string'),
          'Actual serialized event wire required'
        );
        assert.ok(
          Buffer.byteLength(output.wire.join('')) <= MAX_BYTES,
          'HTTP output bound'
        );
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
        });
        record.status = 200;
        for (const wire of output.wire) {
          assert.ok(!response.destroyed, 'HTTP reader closed before delivery');
          response.write(wire);
          record.sentWire.push(wire);
        }
        response.end();
      } catch (error) {
        record.error = String(error).slice(0, 1024);
        recordError(errors, record.error);
        if (!response.headersSent && !response.destroyed) {
          record.status = 422;
          response.writeHead(422, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: record.error }));
        } else response.destroy();
      } finally {
        clearTimeout(timer);
        if (admitted) gate.finish();
      }
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await deadline(
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      }),
      timeoutMs,
      'Listener startup deadline'
    );
    const origin = `http://127.0.0.1:${server.address().port}`;
    return {
      url: origin + '/agent',
      stats,
      close,
      fetch: (input, init) => {
        const url = new URL(
          typeof input === 'string' || input instanceof URL ? input : input.url
        );
        if (
          url.href !== origin + '/agent' ||
          (init?.method ?? input?.method) !== 'POST'
        ) {
          recordError(errors, 'Denied non-owned HTTP target/method');
          throw new Error('Only exact owned loopback POST endpoint allowed');
        }
        return fetch(input, { ...init, redirect: 'error' });
      },
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      const failure = new AggregateError(
        [error, cleanup],
        'Startup and cleanup failed',
        { cause: error }
      );
      failure.fixtureClosure = stats();
      throw failure;
    }
    error.fixtureClosure = stats();
    throw error;
  }
}
