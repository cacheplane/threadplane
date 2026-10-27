import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { Client } from '@langchain/langgraph-sdk';
const { createChatThemingFixture } = await import(
  './chat-theming-fixture.mjs'
).catch(() => ({}));

async function fixture(t, options) {
  assert.equal(
    typeof createChatThemingFixture,
    'function',
    'Local fixture must exist'
  );
  const handle = createChatThemingFixture(options);
  const server = createServer(async (req, res) => {
    if (
      !(await handle(req, res, new URL(req.url, 'http://localhost').pathname))
    )
      res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    try {
      await handle.close();
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
    assert.deepEqual(handle.receipt().active, {
      children: 0,
      streams: 0,
      histories: 0,
      handlers: 0,
    });
    assert.equal(handle.receipt().responseOpen, 0);
    for (const child of handle.receipt().children) {
      assert.equal(child.reaped, true);
      assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
      assert.throws(() => process.kill(-child.pgid, 0), { code: 'ESRCH' });
    }
    await assert.rejects(fetch(base, { signal: AbortSignal.timeout(500) }));
    console.log(
      'THEMING_FIXTURE_CLOSURE',
      JSON.stringify({
        receipt: handle.receipt(),
        observedPidAndPgidAbsence: 'ESRCH',
        listenerClosed: true,
      })
    );
  });
  const client = new Client({
    apiUrl: base + '/api',
    apiKey: null,
    callerOptions: { maxRetries: 0 },
  });
  const control = async (path) => {
    const response = await fetch(base + path, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 200);
  };
  const get = async (path) =>
    await (
      await fetch(base + path, { signal: AbortSignal.timeout(3000) })
    ).json();
  const thread = randomUUID();
  await client.threads.create({ threadId: thread, ifExists: 'raise' });
  const stream = (content) =>
    client.runs.stream(thread, 'c-theming', {
      input: { messages: [{ type: 'human', id: randomUUID(), content }] },
      streamMode: ['messages-tuple', 'values'],
    });
  return { handle, base, client, control, get, thread, stream };
}

test('SDK observes actual compiled graph, chosen thread, distinct runs and confirmed saved history', async (t) => {
  const f = await fixture(t);
  const runs = [];
  for (const text of ['Explain lift', 'Continue aviation']) {
    const events = [];
    for await (const event of f.stream(text)) events.push(event);
    runs.push(events[0].data.run_id);
    assert(events.some((e) => e.event === 'messages' && e.data[0].content));
    const history = await f.client.threads.getHistory(f.thread, { limit: 1 });
    assert.equal(history[0].checkpoint.thread_id, f.thread);
    assert.equal(history[0].checkpoint.checkpoint_ns, '');
    assert.deepEqual(history[0].next, []);
    assert.equal(history[0].values.messages.at(-2).content, text);
  }
  assert.notEqual(runs[0], runs[1]);
  const captures = await f.get('/__captures');
  assert.equal(captures.length, 2);
  for (const capture of captures) {
    assert.equal(capture.proof.actualCompiledGraph, true);
    assert.equal(capture.proof.networkConnectAttempts, 0);
    assert.equal(capture.proof.titleMessageCallbacks, 0);
    assert.equal(
      capture.proof.sourceSha256,
      createHash('sha256')
        .update(readFileSync('cockpit/chat/theming/python/src/graph.py'))
        .digest('hex')
    );
    assert.equal(
      capture.proof.lockSha256,
      createHash('sha256')
        .update(readFileSync('cockpit/chat/theming/python/uv.lock'))
        .digest('hex')
    );
    assert.equal(capture.threadId, f.thread);
    assert.equal(
      capture.sseSha256,
      createHash('sha256').update(capture.sse).digest('hex')
    );
    assert.doesNotMatch(capture.sse, /generate_title|Authored metadata title/);
  }
  assert.equal(captures[0].titleUpdates.length, 1);
  assert.equal(captures[1].titleUpdates.length, 0);
  const requests = await f.get('/__requests');
  assert.equal(requests.filter((r) => r.path.endsWith('/threads')).length, 1);
  assert.equal(
    requests.filter((r) => r.path.endsWith('/runs/stream')).length,
    2
  );
});

test('held graph stream and saved history release independently and close drains owned work', async (t) => {
  const f = await fixture(t);
  const pending = (async () => {
    for await (const _ of f.stream('Hold')) {
      /* consume actual chunks */
    }
  })();
  for (let i = 0; i < 200 && !(await f.get('/__lifetime')).active.streams; i++)
    await new Promise((r) => setTimeout(r, 20));
  assert.equal((await f.get('/__lifetime')).active.streams, 1);
  await f.control('/__release');
  await pending;
  await f.control('/__history/hold');
  const history = f.client.threads.getHistory(f.thread, { limit: 1 });
  for (
    let i = 0;
    i < 100 && !(await f.get('/__lifetime')).active.histories;
    i++
  )
    await new Promise((r) => setTimeout(r, 10));
  assert.equal((await f.get('/__lifetime')).active.histories, 1);
  await f.control('/__release-history');
  assert.equal((await history)[0].values.messages.length, 2);
  await f.handle.close();
  assert.equal(f.handle.receipt().closed, true);
  await f.handle.close();
});

test('fixture rejects unsupported assistant and malformed or oversized inputs without a child', async (t) => {
  const f = await fixture(t);
  for (const body of [
    '{',
    JSON.stringify({ assistant_id: 'other', input: { messages: [] } }),
    'x'.repeat(65537),
  ]) {
    const r = await fetch(`${f.base}/api/threads/${f.thread}/runs/stream`, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(3000),
    });
    assert([400, 413].includes(r.status));
  }
  assert.equal(f.handle.receipt().children.length, 0);
});

for (const phase of ['stream', 'history'])
  test(`close observes the original held ${phase} response close`, async (t) => {
    const f = await fixture(t);
    if (phase === 'history') await f.control('/__history/hold');
    const pending =
      phase === 'stream'
        ? (async () => {
            try {
              for await (const _ of f.stream('Hold')) {
                /* consume */
              }
            } catch {
              /* expected owned close */
            }
          })()
        : (async () => {
            try {
              for await (const _ of f.stream('Explain lift')) {
                /* consume */
              }
              await f.client.threads.getHistory(f.thread);
            } catch {
              /* expected owned close */
            }
          })();
    const field = phase === 'stream' ? 'streams' : 'histories';
    for (let i = 0; i < 200 && !(await f.get('/__lifetime')).active[field]; i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal((await f.get('/__lifetime')).active[field], 1);
    await f.handle.close();
    await pending;
    assert.equal(f.handle.receipt().responseOpen, 0);
  });

for (const [name, options] of [
  ['deadline', { wireTimeoutMs: 1 }],
  ['output', { wireOutputBytes: 64 }],
])
  test(`real compiled child ${name} bound rejects and reaps its registered group`, async (t) => {
    const f = await fixture(t, options);
    await assert.rejects(async () => {
      for await (const _ of f.stream('Explain lift')) {
        /* consume */
      }
    });
    const receipt = f.handle.receipt();
    assert.equal(receipt.children.length, 1);
    assert.equal(receipt.children[0].reaped, true);
    assert.equal(receipt.active.children, 0);
  });

test(
  'owned proof server shutdown drains an observed child and closes its actual listener',
  { timeout: 15000 },
  async (t) => {
    const within = async (promise, ms, label) => {
      let timer;
      try {
        return await Promise.race([
          promise,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error(label)), ms);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    await assert.rejects(
      fetch('http://127.0.0.1:4644', { signal: AbortSignal.timeout(300) })
    );
    const child = spawn(
      process.execPath,
      ['scripts/react-cockpit/serve.mjs', 'chat-theming', '--no-parent'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const abort = new AbortController();
    const workDeadline = setTimeout(() => abort.abort(), 8000);
    const ended = once(child, 'close');
    void ended.catch(() => {
      /* awaited by bounded main and final cleanup barriers */
    });
    let pending = Promise.resolve(),
      output = '',
      diagnostic = '',
      outputBytes = 0,
      diagnosticBytes = 0,
      overflow = false;
    const signals = [];
    const signalOwned = (signal) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        signals.push({
          signal,
          pid: child.pid,
          result: child.kill(signal) ? 'sent' : 'not-sent',
        });
      } catch (error) {
        signals.push({ signal, pid: child.pid, result: error.code });
      }
    };
    // Register final cleanup before any awaited readiness or protocol acquisition.
    t.after(async () => {
      clearTimeout(workDeadline);
      abort.abort();
      signalOwned('SIGKILL');
      try {
        await within(
          Promise.all([ended, pending]),
          2000,
          'Owned server final cleanup/reap deadline exceeded'
        );
        assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
      } finally {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
      }
    });
    child.stdout.on('data', (bytes) => {
      output += bytes.subarray(0, Math.max(0, 65536 - outputBytes)).toString();
      outputBytes += bytes.length;
      if (outputBytes > 65536) {
        overflow = true;
        abort.abort();
        signalOwned('SIGKILL');
      }
    });
    child.stderr.on('data', (bytes) => {
      diagnostic += bytes
        .subarray(0, Math.max(0, 16384 - diagnosticBytes))
        .toString();
      diagnosticBytes += bytes.length;
      if (diagnosticBytes > 16384) {
        overflow = true;
        abort.abort();
        signalOwned('SIGKILL');
      }
    });
    const base = 'http://127.0.0.1:4644';
    let ready = false;
    const readinessDeadline = Date.now() + 3000;
    while (Date.now() < readinessDeadline) {
      try {
        if (
          (
            await fetch(base + '/__lifetime', {
              signal: AbortSignal.timeout(300),
            })
          ).ok
        ) {
          ready = true;
          break;
        }
      } catch {
        /* owned start */
      }
      if (child.exitCode !== null || child.signalCode !== null || overflow)
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert(ready && !overflow, diagnostic);
    const client = new Client({
      apiUrl: base + '/api',
      apiKey: null,
      callerOptions: { maxRetries: 0 },
    });
    const id = randomUUID();
    await within(
      client.threads.create({
        threadId: id,
        ifExists: 'raise',
        signal: abort.signal,
      }),
      1500,
      'Owned SDK thread creation deadline exceeded'
    );
    pending = (async () => {
      try {
        for await (const _ of client.runs.stream(id, 'c-theming', {
          input: {
            messages: [
              { type: 'human', id: randomUUID(), content: 'Explain lift' },
            ],
          },
          signal: abort.signal,
        })) {
          /* observed work */
        }
      } catch {
        /* owned shutdown or request abort */
      }
    })();
    let observed;
    const observationDeadline = Date.now() + 2000;
    while (Date.now() < observationDeadline) {
      observed = await (
        await fetch(base + '/__lifetime', { signal: AbortSignal.timeout(300) })
      ).json();
      if (observed.active.children === 1) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(observed?.active.children, 1);
    signalOwned('SIGTERM');
    const result = await within(
      ended,
      4000,
      'Owned server failed bounded shutdown'
    );
    abort.abort();
    await within(
      pending,
      1500,
      'Owned SDK stream did not settle after server close'
    );
    assert.equal(overflow, false, 'Owned server output bounds');
    assert.equal(result[0], 0, diagnostic);
    const final = JSON.parse(output.trim().split('\n').at(-1));
    assert.equal(final.listenersClosed, true);
    assert.deepEqual(final.chatThemingFixtureClosed.active, {
      children: 0,
      streams: 0,
      histories: 0,
      handlers: 0,
    });
    assert.equal(final.chatThemingFixtureClosed.responseOpen, 0);
    for (const record of final.chatThemingFixtureClosed.children) {
      assert.equal(record.reaped, true);
      assert.throws(() => process.kill(record.pid, 0), { code: 'ESRCH' });
      assert.throws(() => process.kill(-record.pgid, 0), { code: 'ESRCH' });
    }
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
    await assert.rejects(fetch(base, { signal: AbortSignal.timeout(500) }));
    console.log(
      'THEMING_SERVER_CLOSURE',
      JSON.stringify({
        observed,
        final,
        serverPid: child.pid,
        serverExit: result,
        serverPidAbsence: 'ESRCH',
        pythonChildPidAndPgidAbsence: 'ESRCH',
        serverGroupAbsence: 'not tested: spawn is not detached',
        listenerClosed: true,
        signals,
        outputBytes,
        diagnosticBytes,
        pendingSettled: true,
        cleanupBoundMs: 2000,
      })
    );
  }
);

test('cancel for a completed run cannot close the current held run or rewrite terminal success', async (t) => {
  const f = await fixture(t);
  let completed;
  for await (const event of f.stream('Explain lift'))
    if (event.event === 'metadata') completed = event.data.run_id;
  const pending = (async () => {
    for await (const _ of f.stream('Hold')) {
      /* consume */
    }
  })();
  for (let i = 0; i < 200 && !(await f.get('/__lifetime')).active.streams; i++)
    await new Promise((r) => setTimeout(r, 20));
  await f.client.runs.cancel(f.thread, completed);
  assert.equal((await f.get('/__lifetime')).active.streams, 1);
  assert.equal(
    (await f.client.runs.get(f.thread, completed)).status,
    'success'
  );
  await f.control('/__release');
  await pending;
});

/** A real HTTP request split at specified original byte offsets; no interception. */
async function fragmentedPost(url, bytes, split) {
  return new Promise((resolve, reject) => {
    let tail,
      deadline,
      settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(tail);
      clearTimeout(deadline);
      if (error) reject(error);
      else resolve(value);
    };
    const request = httpRequest(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': bytes.length,
        },
        signal: AbortSignal.timeout(12000),
      },
      (response) => {
        const chunks = [];
        let count = 0;
        response.on('data', (chunk) => {
          count += chunk.length;
          if (count > 2 * 1024 * 1024) {
            request.destroy(Error('Fragmented test response bound'));
            return;
          }
          chunks.push(chunk);
        });
        response.once('error', (error) => finish(error));
        response.once('aborted', () =>
          finish(Error('Fragmented test response aborted'))
        );
        response.once('end', () => {
          try {
            const body = new TextDecoder('utf-8', { fatal: true }).decode(
              Buffer.concat(chunks, count)
            );
            finish(null, { status: response.statusCode, body });
          } catch (error) {
            finish(error);
          }
        });
      }
    );
    request.once('error', (error) => finish(error));
    deadline = setTimeout(() => {
      const error = Error('Fragmented request deadline');
      request.destroy(error);
      finish(error);
    }, 12000);
    request.write(bytes.subarray(0, split));
    tail = setTimeout(() => request.end(bytes.subarray(split)), 40);
  });
}

for (const text of ['Explain lift ASCII', 'Explain lift ✈ café'])
  test(
    `fragmented original UTF-8 input is preserved through actual graph/history: ${text}`,
    { timeout: 15000 },
    async (t) => {
      const f = await fixture(t);
      const id = randomUUID();
      const bytes = Buffer.from(
        JSON.stringify({
          assistant_id: 'c-theming',
          input: { messages: [{ type: 'human', id, content: text }] },
          stream_mode: ['messages-tuple', 'values'],
        })
      );
      const split = text.includes('✈')
        ? bytes.indexOf(Buffer.from('✈')) + 1
        : bytes.indexOf(Buffer.from('ASCII')) + 2;
      const response = await fragmentedPost(
        `${f.base}/api/threads/${f.thread}/runs/stream`,
        bytes,
        split
      );
      assert.equal(response.status, 200);
      const recorded = (await f.get('/__requests')).find((r) =>
        r.path.endsWith('/runs/stream')
      );
      const captures = await f.get('/__captures');
      const saved = await f.client.threads.getHistory(f.thread, { limit: 1 });
      console.log(
        'THEMING_FRAGMENTED_OBSERVED',
        JSON.stringify({
          original: text,
          recorded: recorded.body.input.messages[0].content,
          saved: saved[0].values.messages.find((m) => m.id === id).content,
          proof: captures[0].proof,
          requestBodyBase64: bytes.toString('base64'),
          chunksBase64: [
            bytes.subarray(0, split).toString('base64'),
            bytes.subarray(split).toString('base64'),
          ],
        })
      );
      assert.equal(recorded.body.input.messages[0].content, text);
      assert.equal(
        captures[0].savedMessages.find((m) => m.id === id).content,
        text
      );
      assert.equal(
        saved[0].values.messages.find((m) => m.id === id).content,
        text
      );
      assert.equal(captures[0].proof.actualCompiledGraph, true);
      assert.equal(captures[0].proof.networkConnectAttempts, 0);
      assert.equal(captures[0].sse, response.body);
      console.log(
        'THEMING_FRAGMENTED_UTF8',
        JSON.stringify({
          text,
          requestBodyBase64: bytes.toString('base64'),
          requestSha256: createHash('sha256').update(bytes).digest('hex'),
          split,
          chunksBase64: [
            bytes.subarray(0, split).toString('base64'),
            bytes.subarray(split).toString('base64'),
          ],
          status: response.status,
          originalSseBase64: Buffer.from(response.body).toString('base64'),
          originalSseSha256: createHash('sha256')
            .update(response.body)
            .digest('hex'),
          recorded: recorded.body,
          saved: saved[0],
          proof: captures[0].proof,
        })
      );
    }
  );

test(
  'invalid UTF-8 and fragmented byte overflow are rejected before creating any graph child',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const prefix = Buffer.from(
      JSON.stringify({
        assistant_id: 'c-theming',
        input: {
          messages: [
            { type: 'human', id: randomUUID(), content: 'PLACEHOLDER' },
          ],
        },
      })
    );
    const offset = prefix.indexOf(Buffer.from('PLACEHOLDER'));
    const malformedResults = [];
    for (const invalidBytes of [
      [0xc3, 0x28],
      [0xe2, 0x9c],
      [0xc0, 0xaf],
    ]) {
      const malformed = Buffer.concat([
        prefix.subarray(0, offset),
        Buffer.from(invalidBytes),
        prefix.subarray(offset + 'PLACEHOLDER'.length),
      ]);
      const invalid = await fragmentedPost(
        `${f.base}/api/threads/${f.thread}/runs/stream`,
        malformed,
        offset + 1
      );
      assert.equal(invalid.status, 400);
      assert.equal(f.handle.receipt().children.length, 0);
      malformedResults.push({
        malformedBase64: malformed.toString('base64'),
        invalidBytes,
        status: invalid.status,
      });
    }
    const oversized = Buffer.from(JSON.stringify({ text: '✈'.repeat(22000) }));
    assert(oversized.length > 65536);
    const overflow = await fragmentedPost(
      `${f.base}/api/threads/${f.thread}/runs/stream`,
      oversized,
      32001
    );
    assert.equal(overflow.status, 413);
    assert.equal(f.handle.receipt().children.length, 0);
    console.log(
      'THEMING_UTF8_REJECTIONS',
      JSON.stringify({
        malformedResults,
        oversizedBytes: oversized.length,
        overflowStatus: overflow.status,
        children: 0,
      })
    );
  }
);
