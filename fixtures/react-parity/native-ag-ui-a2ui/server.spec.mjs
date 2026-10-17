import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const subject = await import('./server.mjs').catch((error) => {
  if (
    error.code === 'ERR_MODULE_NOT_FOUND' &&
    error.url === new URL('./server.mjs', import.meta.url).href
  )
    return {};
  throw error;
});
function worker() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.finish = () => {
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', 0, null);
    child.emit('close', 0, null);
  };
  return child;
}
test('import is inert and exports an explicit launcher', () =>
  assert.equal(typeof subject.createA2uiServer, 'function'));
for (const [name, line] of [
  ['invalid JSON', '{bad}\n'],
  ['oversized line', 'x'.repeat(65)],
  ['incomplete line', '{"ready":true}'],
]) {
  test(`worker rejects ${name} and retains failure`, async () => {
    assert.equal(typeof subject.createWorkerChannel, 'function');
    const child = worker();
    const channel = subject.createWorkerChannel(child, {
      maxBytes: 64,
      timeoutMs: 100,
    });
    const pending = channel.receive();
    child.stdout.write(line);
    if (name === 'incomplete line') child.finish();
    await assert.rejects(pending);
    assert.ok(channel.receipt.errors.length);
    child.finish();
    await channel.close();
  });
}
for (const event of ['exit', 'error'])
  test(`worker ${event} rejects pending receive without hanging`, async () => {
    assert.equal(typeof subject.createWorkerChannel, 'function');
    const child = worker();
    const channel = subject.createWorkerChannel(child, { timeoutMs: 100 });
    const pending = channel.receive();
    child.emit(event, event === 'error' ? new Error('spawn failed') : 2);
    await assert.rejects(pending);
    child.finish();
    await channel.close();
  });
test('partial worker registration failure closes acquired child', async () => {
  assert.equal(typeof subject.createA2uiServer, 'function');
  const child = worker();
  let closed = false;
  await assert.rejects(
    subject.createA2uiServer({
      spawnWorker: () => child,
      closeWorker: async () => {
        closed = true;
        child.finish();
      },
      registerWorker: () => {
        throw new Error('registration');
      },
    }),
    /registration/
  );
  assert.equal(closed, true);
});
test('partial listener startup failure closes worker and listener', async () => {
  assert.equal(typeof subject.createA2uiServer, 'function');
  const child = worker();
  let closed = false;
  let listenerClosed = false;
  const listener = new EventEmitter();
  listener.listen = () => {
    throw new Error('listen failed');
  };
  listener.close = (done) => {
    listenerClosed = true;
    done();
  };
  listener.listening = false;
  const starting = subject.createA2uiServer({
    spawnWorker: () => child,
    closeWorker: async () => {
      closed = true;
      child.finish();
    },
    createHttpServer: () => listener,
  });
  queueMicrotask(() => child.stdout.write('{"ready":{"pid":1}}\n'));
  await assert.rejects(starting, /listen failed/);
  assert.equal(closed, true);
  assert.equal(listenerClosed, true);
});
test('failure during stdio registration still closes acquired child', async () => {
  const child = worker();
  let closed = false;
  child.stdout.on = () => {
    throw new Error('stdio registration');
  };
  await assert.rejects(
    subject.createA2uiServer({
      spawnWorker: () => child,
      closeWorker: async () => {
        closed = true;
        child.finish();
      },
    }),
    /stdio registration/
  );
  assert.equal(closed, true);
});
test('default cleanup owns the child even when channel data registration throws', async () => {
  const child = worker();
  const on = child.stdout.on.bind(child.stdout);
  child.stdout.on = (event, callback) => {
    if (event === 'data') throw new Error('partial channel data registration');
    return on(event, callback);
  };
  child.stdin.once('finish', () => child.finish());
  const failure = await subject
    .createA2uiServer({ timeoutMs: 10, spawnWorker: () => child })
    .catch((error) => error);
  assert.match(String(failure), /partial channel data registration/);
  assert.equal(failure.fixtureClosure.closure.worker, true);
  assert.equal(child.stdin.writableEnded, true);
  assert.equal(child.stdout.readableEnded, true);
  assert.equal(child.stderr.readableEnded, true);
});
test('unknown listener closure fails within deadline and still closes worker', async () => {
  const child = worker();
  let closed = false;
  const listener = new EventEmitter();
  listener.listen = () => {
    throw new Error('listen failed');
  };
  listener.close = () => {};
  const starting = subject.createA2uiServer({
    timeoutMs: 10,
    spawnWorker: () => child,
    closeWorker: async () => {
      closed = true;
      child.finish();
    },
    createHttpServer: () => listener,
  });
  queueMicrotask(() => child.stdout.write('{"ready":{"pid":1}}\n'));
  const outcome = await Promise.race([
    starting.catch((error) => error),
    new Promise((resolve) => setTimeout(() => resolve('hung'), 100)),
  ]);
  assert.notEqual(outcome, 'hung');
  assert.match(String(outcome), /cleanup failed/);
  assert.equal(closed, true);
  assert.equal(outcome.fixtureClosure.closure.listener, false);
  assert.equal(outcome.fixtureClosure.closure.worker, true);
});
test('silent listener acquisition times out and closes worker and listener', async () => {
  const child = worker();
  let workerClosed = false;
  let listenerClosed = false;
  const listener = new EventEmitter();
  listener.listen = () => {};
  listener.close = (callback) => {
    listenerClosed = true;
    callback();
  };
  const starting = subject.createA2uiServer({
    timeoutMs: 10,
    spawnWorker: () => child,
    closeWorker: async () => {
      workerClosed = true;
      child.finish();
    },
    createHttpServer: () => listener,
  });
  queueMicrotask(() => child.stdout.write('{"ready":{"pid":1}}\n'));
  const result = await Promise.race([
    starting.catch((error) => error),
    new Promise((resolve) => setTimeout(() => resolve('hung'), 100)),
  ]);
  assert.notEqual(result, 'hung');
  assert.match(String(result), /Listener startup deadline/);
  assert.equal(workerClosed, true);
  assert.equal(listenerClosed, true);
  assert.equal(result.fixtureClosure.closure.worker, true);
  assert.equal(result.fixtureClosure.closure.listener, true);
});
test('worker response deadline is retained and drained', async () => {
  const child = worker();
  const channel = subject.createWorkerChannel(child, { timeoutMs: 10 });
  await assert.rejects(channel.receive(), /deadline/);
  assert.ok(channel.receipt.errors.some((error) => error.includes('deadline')));
  child.finish();
  await channel.close();
});
test('request and event count limits reject excess rather than truncating', () => {
  const gate = subject.createRequestGate({ maxRequests: 1, maxEvents: 1 });
  const input = { threadId: 't', runId: 'r', messages: [] };
  gate.admit(input);
  gate.finish();
  assert.throws(() => gate.admit({ ...input, runId: 'second' }), /count/);
  assert.throws(
    () => gate.validate([{ type: 'RAW' }, { type: 'RAW' }], input),
    /count/
  );
});
test('foreign run/thread and duplicate request fail closed', () => {
  assert.equal(typeof subject.createRequestGate, 'function');
  const gate = subject.createRequestGate();
  const input = { threadId: 't', runId: 'r', messages: [] };
  gate.admit(input);
  assert.throws(() => gate.admit(input), /duplicate|active/);
  assert.throws(
    () =>
      gate.validate(
        [{ type: 'RUN_FINISHED', threadId: 'other', runId: 'r' }],
        input
      ),
    /thread/
  );
  assert.throws(
    () =>
      gate.validate(
        [{ type: 'RUN_FINISHED', threadId: 't', runId: 'other' }],
        input
      ),
    /run/
  );
});
test('signal permission uncertainty cannot be reported absent', () => {
  assert.equal(typeof subject.pidAbsent, 'function');
  assert.equal(
    subject.pidAbsent(2, () => {
      throw Object.assign(new Error(), { code: 'ESRCH' });
    }),
    true
  );
  assert.throws(
    () =>
      subject.pidAbsent(2, () => {
        throw Object.assign(new Error(), { code: 'EPERM' });
      }),
    /unknown/
  );
});
test('repeated channel errors retain bounded evidence with explicit overflow', async () => {
  const child = worker();
  const channel = subject.createWorkerChannel(child);
  for (let index = 0; index < 1000; index++)
    child.emit('error', new Error(`failure-${index}`));
  assert.ok(channel.receipt.errors.length <= 64);
  assert.ok(channel.receipt.errorOverflow > 0);
  assert.equal(channel.receipt.errorEvidenceComplete, false);
  assert.ok(channel.receipt.errors.some((error) => /overflow/.test(error)));
  child.finish();
  await channel.close();
});
test('repeated requests after the limit retain bounded errors and fail acceptance', async () => {
  const child = worker();
  let handle;
  const listener = new EventEmitter();
  listener.listen = (_port, _host, callback) => callback();
  listener.address = () => ({ port: 1 });
  listener.close = (callback) => callback();
  const starting = subject.createA2uiServer({
    spawnWorker: () => child,
    closeWorker: async () => child.finish(),
    createHttpServer: (handler) => {
      handle = handler;
      return listener;
    },
  });
  queueMicrotask(() => child.stdout.write('{"ready":{"pid":1}}\n'));
  const server = await starting;
  for (let index = 0; index < 1000; index++) {
    const request = new EventEmitter();
    request.method = 'GET';
    request.url = '/denied';
    request.destroy = () => request.emit('close');
    const response = new EventEmitter();
    response.destroy = () => response.emit('close');
    response.writeHead = () => {};
    response.end = () => response.emit('close');
    await handle(request, response);
  }
  const receipt = server.stats();
  assert.equal(receipt.requests.length, 12);
  assert.ok(receipt.errors.length <= 64);
  assert.ok(receipt.errorOverflow > 0);
  assert.equal(receipt.errorEvidenceComplete, false);
  assert.ok(receipt.errors.some((error) => /overflow/.test(error)));
  await assert.rejects(server.close(), /cleanup failed/);
});
