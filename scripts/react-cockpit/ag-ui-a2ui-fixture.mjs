/** Private browser proof: positive bytes come only from owned canonical children. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir as systemTmpdir } from 'node:os';
import { join } from 'node:path';
import { createA2uiServer } from '../../fixtures/react-parity/native-ag-ui-a2ui/server.mjs';

const MAX_BODY = 2_000_000,
  MAX_WIRE = 16 * 1024 * 1024;
const fields = new Set([
  'threadId',
  'runId',
  'protocolVersion',
  'messages',
  'tools',
  'context',
  'state',
  'forwardedProps',
]);
const immutable = (value) => structuredClone(value);
const closedResource = (receipt) =>
  ['worker', 'listener', 'sockets', 'responses'].every(
    (key) => receipt?.closure?.[key] === true
  );
function deadline(operation, timeoutMs, label) {
  let timer;
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(label)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}
function inputBody(raw) {
  assert.ok(
    Buffer.isBuffer(raw) && raw.length <= MAX_BODY,
    'Request body bound'
  );
  const body = JSON.parse(raw.toString('utf8'));
  assert.ok(
    body && typeof body === 'object' && !Array.isArray(body),
    'Request object required'
  );
  assert.ok(
    Object.keys(body).every((key) => fields.has(key)),
    'Unreviewed request field'
  );
  assert.ok(
    body.protocolVersion === undefined || body.protocolVersion === '1.0',
    'Unsupported native protocolVersion'
  );
  assert.ok(
    typeof body.threadId === 'string' &&
      body.threadId.length > 0 &&
      body.threadId.length <= 256 &&
      !body.threadId.includes('\0'),
    'Exact nonempty threadId required'
  );
  assert.ok(
    typeof body.runId === 'string' &&
      body.runId.length > 0 &&
      body.runId.length <= 256,
    'Exact runId required'
  );
  assert.ok(Array.isArray(body.messages), 'Messages required');
  for (const key of ['tools', 'context'])
    assert.ok(
      body[key] === undefined || Array.isArray(body[key]),
      'Invalid ' + key
    );
  return body;
}
async function encodedBody(response) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(),
    parts = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      assert.ok(bytes <= MAX_WIRE, 'Canonical wire bound');
      parts.push(Buffer.from(next.value));
    }
    return Buffer.concat(parts);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export function createAgUiA2uiFixture({
  retain = mkdtempSync(
    join(systemTmpdir(), 'threadplane-native-a2ui-browser-')
  ),
  acquire = createA2uiServer,
  python,
  environment,
  home,
  tmpdir,
  timeoutMs = 20000,
  cleanupTimeoutMs = 3000,
} = {}) {
  mkdirSync(retain, { recursive: true });
  const generations = [],
    archived = [],
    usedThreads = new Set();
  let current,
    serial = Promise.resolve(),
    closed = false,
    unavailable = true,
    closing,
    resetting;
  function ownerReceipt(owner) {
    return {
      threadId: owner.threadId,
      retain: owner.retain,
      active: owner.active,
      posts: owner.posts,
      acquisitionFailure: owner.acquisitionFailure,
      stats: owner.resource?.stats(),
      errors: [...owner.errors],
    };
  }
  function generationReceipt(generation) {
    return {
      generation: generation.id,
      revoked: generation.revoked,
      posts: generation.posts,
      holds: generation.holds.size,
      proxyResponsesClosed: generation.responses.size === 0,
      owners: [...generation.owners.values()].map(ownerReceipt),
      requests: immutable(generation.requests),
      controls: immutable(generation.controls),
      closed: generation.closed,
    };
  }
  const receipt = () =>
    immutable({
      kind: 'private canonical per-thread A2UI browser fixture',
      unavailable,
      closed,
      current: current && generationReceipt(current),
      archived,
    });
  function save(generation) {
    writeFileSync(
      join(generation.retain, 'receipt.json'),
      JSON.stringify(generationReceipt(generation), null, 2) + '\n'
    );
  }
  function revoke(generation) {
    if (!generation || generation.revoked) return;
    generation.revoked = true;
    generation.hold = false;
    for (const hold of generation.holds) {
      hold.cleanup();
      hold.reject(Error('Generation revoked'));
    }
    generation.holds.clear();
    for (const controller of generation.controllers)
      controller.abort(Error('Generation revoked'));
    for (const [response, resource] of generation.responses) {
      resource.request.destroy();
      response.destroy();
    }
  }
  async function closeGeneration(generation) {
    if (!generation) return;
    return (generation.closing ??= (async () => {
      const failures = [];
      for (const owner of generation.owners.values()) {
        try {
          await deadline(
            owner.acquiring,
            timeoutMs + cleanupTimeoutMs,
            'Acquisition closure deadline'
          );
        } catch (error) {
          owner.errors.push(String(error).slice(0, 2048));
          failures.push(error);
        }
        try {
          if (owner.resource) {
            await deadline(
              owner.resource.close(),
              timeoutMs + cleanupTimeoutMs,
              'Owner closure deadline'
            );
            assert.ok(
              closedResource(owner.resource.stats()),
              'Owner closure unknown'
            );
          } else
            assert.ok(
              closedResource(owner.acquisitionFailure),
              'Partial acquisition closure unknown'
            );
        } catch (error) {
          owner.errors.push(String(error).slice(0, 2048));
          failures.push(error);
        }
      }
      await deadline(
        Promise.allSettled([
          ...generation.operations,
          ...[...generation.responses.values()].map(
            (resource) => resource.closed
          ),
        ]),
        timeoutMs + cleanupTimeoutMs,
        'Proxy closure deadline'
      ).catch((error) => failures.push(error));
      if (generation.responses.size)
        failures.push(Error('Browser response closure unknown'));
      generation.closed = failures.length === 0;
      const snapshot = generationReceipt(generation);
      archived.push(immutable(snapshot));
      writeFileSync(
        join(generation.retain, 'archived.json'),
        JSON.stringify(snapshot, null, 2) + '\n',
        { flag: 'wx' }
      );
      save(generation);
      if (failures.length)
        throw new AggregateError(
          failures,
          'Canonical generation closure failed'
        );
    })());
  }
  function reset() {
    assert.ok(!closed, 'Fixture closed');
    if (resetting) return resetting;
    unavailable = true;
    const previous = current;
    revoke(previous); // Synchronous authority revocation precedes all cleanup.
    const operation = serial.then(async () => {
      await closeGeneration(previous);
      assert.ok(!closed, 'Fixture closed');
      const id = generations.length + 1,
        directory = join(retain, 'generation-' + id);
      mkdirSync(directory);
      current = {
        id,
        retain: directory,
        revoked: false,
        closed: false,
        posts: 0,
        hold: false,
        fail: false,
        owners: new Map(),
        requests: [],
        controls: [{ kind: 'private-reset' }],
        holds: new Set(),
        controllers: new Set(),
        operations: new Set(),
        responses: new Map(),
      };
      generations.push(current);
      unavailable = false;
      save(current);
      return receipt();
    });
    serial = operation.catch(() => undefined);
    resetting = operation;
    void operation
      .finally(() => {
        resetting = undefined;
      })
      .catch(() => undefined);
    return resetting;
  }
  async function perform(generation, raw, body, signal) {
    let owner = generation.owners.get(body.threadId);
    if (!owner) {
      assert.ok(
        !usedThreads.has(body.threadId),
        'Thread identity reused across generations'
      );
      assert.ok(generation.owners.size < 8, 'Canonical owner bound');
      usedThreads.add(body.threadId);
      const directory = join(
        generation.retain,
        'owner-' + createHash('sha256').update(body.threadId).digest('hex')
      );
      mkdirSync(directory);
      owner = {
        threadId: body.threadId,
        retain: directory,
        active: false,
        posts: 0,
        runs: new Set(),
        errors: [],
      };
      generation.owners.set(body.threadId, owner);
      owner.acquiring = (async () => {
        try {
          owner.resource = await acquire({
            python,
            environment,
            home,
            tmpdir,
            threadId: body.threadId,
            retain: directory,
            timeoutMs,
          });
          assert.match(
            owner.resource.url,
            /^http:\/\/127\.0\.0\.1:\d+\/agent$/,
            'Exact loopback agent required'
          );
          writeFileSync(
            join(directory, 'start.json'),
            JSON.stringify(ownerReceipt(owner), null, 2) + '\n'
          );
          if (generation.revoked || closed) {
            await deadline(
              owner.resource.close(),
              timeoutMs + cleanupTimeoutMs,
              'Late acquired owner closure deadline'
            );
            const stats = owner.resource.stats();
            writeFileSync(
              join(directory, 'late-acquisition-closure.json'),
              JSON.stringify(stats, null, 2) + '\n'
            );
            assert.ok(
              closedResource(stats),
              'Late acquired owner closure unknown'
            );
          }
        } catch (error) {
          owner.acquisitionFailure = immutable(
            error.fixtureClosure ?? { closure: {} }
          );
          owner.errors.push(String(error).slice(0, 2048));
          save(generation);
          throw error;
        }
      })();
    }
    assert.ok(!owner.active, 'Canonical owner request active');
    assert.ok(owner.posts < 4 && generation.posts < 32, 'Canonical POST bound');
    assert.ok(!owner.runs.has(body.runId), 'Duplicate run identity');
    owner.active = true;
    owner.posts++;
    generation.posts++;
    owner.runs.add(body.runId);
    const record = {
      kind: 'actual-canonical-post',
      generation: generation.id,
      threadId: body.threadId,
      runId: body.runId,
      body,
      rawBody: raw.toString('utf8'),
      rawBase64: raw.toString('base64'),
      completed: false,
    };
    generation.requests.push(record);
    const controller = new AbortController();
    generation.controllers.add(controller);
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(
      () => controller.abort(Error('Proxy operation deadline')),
      timeoutMs
    );
    try {
      await deadline(
        owner.acquiring,
        timeoutMs,
        'Canonical acquisition deadline'
      );
      assert.ok(!generation.revoked && !closed, 'Generation revoked');
      const resource = owner.resource,
        url = resource.url;
      const upstream = await deadline(
        resource.fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: raw,
          redirect: 'error',
          signal: controller.signal,
        }),
        timeoutMs,
        'Canonical request deadline'
      );
      const bytes = await deadline(
        encodedBody(upstream),
        timeoutMs,
        'Canonical wire deadline'
      );
      assert.ok(!generation.revoked && !closed, 'Generation revoked');
      const result = {
        status: upstream.status,
        headers: Object.fromEntries(upstream.headers.entries()),
        bytes,
      };
      record.response = {
        status: result.status,
        headers: result.headers,
        rawBase64: bytes.toString('base64'),
        rawWire: bytes.toString('utf8'),
      };
      save(generation);
      clearTimeout(timer); // Canonical operation settled. A held browser delivery has separate ownership.
      if (generation.hold) {
        await new Promise((resolveHold, rejectHold) => {
          const hold = { record, resolve: resolveHold, reject: rejectHold };
          generation.holds.add(hold);
          record.held = true;
          const abortHold = () => {
            record.clientClosed = true; /* Preserve captured bytes until explicit release/reset. */
          };
          signal?.addEventListener('abort', abortHold, { once: true });
          if (signal?.aborted) abortHold();
          hold.cleanup = () => signal?.removeEventListener('abort', abortHold);
          const heldDeadline = setTimeout(() => {
            generation.holds.delete(hold);
            hold.cleanup();
            rejectHold(Error('Held delivery deadline'));
          }, timeoutMs);
          const cleanup = hold.cleanup;
          hold.cleanup = () => {
            clearTimeout(heldDeadline);
            cleanup();
          };
          save(generation);
        });
      }
      assert.ok(!generation.revoked && !closed, 'Generation revoked');
      record.completed = true;
      return result;
    } catch (error) {
      record.error = String(error).slice(0, 2048);
      if (!owner.resource) {
        unavailable = true;
        revoke(generation);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      owner.active = false;
      generation.controllers.delete(controller);
      signal?.removeEventListener('abort', abort);
      save(generation);
    }
  }
  function forward(raw, { signal } = {}) {
    let body;
    try {
      assert.ok(
        !closed && !unavailable && current && !current.revoked,
        'Fixture unavailable'
      );
      body = inputBody(raw);
      if (current.fail) {
        current.fail = false;
        current.requests.push({
          kind: 'fake-negative-transport',
          threadId: body.threadId,
          body,
          status: 503,
        });
        save(current);
        return Promise.resolve({
          status: 503,
          headers: { 'content-type': 'application/json' },
          bytes: Buffer.from(
            '{"error":"Deliberate private negative transport failure"}'
          ),
        });
      }
    } catch (error) {
      return Promise.reject(error);
    }
    const generation = current,
      operation = perform(generation, raw, body, signal);
    generation.operations.add(operation);
    void operation
      .finally(() => generation.operations.delete(operation))
      .catch(() => undefined);
    return operation;
  }
  function hold(enabled = true) {
    assert.ok(current && !unavailable, 'Fixture unavailable');
    current.hold = enabled;
    current.controls.push({ kind: 'private-hold', enabled });
    save(current);
  }
  function release() {
    assert.ok(current && !unavailable, 'Fixture unavailable');
    current.hold = false;
    for (const hold of current.holds) {
      hold.cleanup();
      hold.record.delivery = hold.record.clientClosed
        ? 'clientclosed-drop'
        : 'captured-old-response';
      hold.resolve();
    }
    current.holds.clear();
    current.controls.push({ kind: 'private-release' });
    save(current);
  }
  function failTransport() {
    assert.ok(current && !unavailable, 'Fixture unavailable');
    current.fail = true;
    current.controls.push({ kind: 'fake-negative-transport-next' });
    save(current);
  }
  function close() {
    closed = true;
    unavailable = true;
    for (const generation of generations) revoke(generation);
    return (closing ??= serial.then(async () => {
      const results = await Promise.allSettled(
        generations.map(closeGeneration)
      );
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length)
        throw new AggregateError(
          failures.map((result) => result.reason),
          'Fixture closure failed'
        );
      return receipt();
    }));
  }
  async function handle(request, response, pathname) {
    const controls = {
      '/__reset': ['POST', reset],
      '/__lifetime': ['GET', receipt],
      '/__requests': ['GET', () => receipt().current?.requests ?? []],
      '/__hold/stream': ['POST', () => hold()],
      '/__hold/off': ['POST', () => hold(false)],
      '/__release': ['POST', release],
      '/__fail-transport': ['POST', failTransport],
    };
    const json = (value, status = 200) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value ?? {}));
    };
    if (pathname.startsWith('/__')) {
      const control = Object.hasOwn(controls, pathname)
        ? controls[pathname]
        : undefined;
      if (!control) {
        json({}, 404);
        return true;
      }
      if (request.method !== control[0]) {
        json({}, 405);
        return true;
      }
      try {
        json(await control[1]());
      } catch {
        json({ error: 'Private fixture control failed' }, 503);
      }
      return true;
    }
    if (pathname !== '/ag-ui/a2ui/agent') return false;
    if (request.method !== 'POST') {
      json({}, 405);
      return true;
    }
    if (!current || unavailable || current.revoked) {
      json({}, 503);
      return true;
    }
    const generation = current;
    let settle;
    const resource = {
      request,
      closed: new Promise((resolveClosed) => {
        settle = resolveClosed;
      }),
    };
    generation.responses.set(response, resource);
    const settled = () => {
      generation.responses.delete(response);
      response.removeListener('finish', settled);
      response.removeListener('close', settled);
      settle();
    };
    response.once('finish', settled);
    response.once('close', settled);
    const controller = new AbortController();
    const cancel = () => {
      if (!response.writableEnded)
        controller.abort(Error('Browser reader closed'));
    };
    response.once('close', cancel);
    const timer = setTimeout(() => {
      request.destroy();
      controller.abort(Error('Browser body deadline'));
    }, timeoutMs);
    try {
      let count = 0;
      const parts = [];
      for await (const chunk of request) {
        count += chunk.length;
        assert.ok(count <= MAX_BODY, 'Request body bound');
        parts.push(chunk);
      }
      clearTimeout(timer);
      const result = await forward(Buffer.concat(parts), {
        signal: controller.signal,
      });
      if (response.destroyed) return true;
      response.writeHead(result.status, result.headers);
      response.end(result.bytes);
    } catch {
      if (!response.destroyed && !response.headersSent)
        json({ error: 'Private canonical fixture request rejected' }, 422);
      else response.destroy();
    } finally {
      clearTimeout(timer);
      response.removeListener('close', cancel);
    }
    return true;
  }
  return Object.assign(handle, {
    forward,
    reset,
    receipt,
    hold,
    release,
    failTransport,
    close,
  });
}
