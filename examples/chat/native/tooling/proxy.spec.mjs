import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { startProxy, readProxyConfiguration } from './proxy.mjs';

const deadlineMs = 2000;
function deadline(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Owned resource deadline exceeded')),
        deadlineMs
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
async function upstream(t, handler) {
  const server = http.createServer(handler);
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
async function proxy(t, target, extra = {}) {
  const owned = await startProxy({ target, ...extra });
  t.after(() => owned.close());
  return owned;
}
function raw(url, path, options = {}) {
  let request;
  return deadline(
    new Promise((resolve, reject) => {
      request = http.request(url, { path, ...options }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString(),
          })
        );
        response.on('error', reject);
      });
      request.on('error', reject);
      request.end(options.body);
    })
  ).finally(() => request?.destroy());
}

test('optional asset allowlist snapshots bytes and never permits API shadowing or unsafe routes', async (t) => {
  const origin = await upstream(t, (_, res) => res.end('api'));
  const bytes = Buffer.from('verified app');
  const assets = new Map([
    ['/index.html', { bytes, contentType: 'text/html' }],
  ]);
  const owned = await proxy(t, origin.url, { assets });
  bytes.fill(0);
  assets.clear();
  assert.equal((await raw(owned.url, '/index.html')).body, 'verified app');
  assert.equal((await raw(owned.url, '/api')).body, 'api');
  for (const path of [
    '/api',
    '/api/threads',
    '/../secret',
    '/%2e%2e/secret',
    '/asset?x=1',
  ])
    await assert.rejects(
      startProxy({
        target: origin.url,
        assets: new Map([[path, { bytes, contentType: 'text/html' }]]),
      }),
      /asset route/
    );
});

test('configuration requires an explicit valid fixed upstream and keeps public values out', () => {
  for (const target of [
    '',
    'invalid',
    'file:///tmp/server',
    'https://user:pass@example.test',
    'https://example.test/?a=1',
    'https://example.test/#x',
    'https://example.test/base/../escape',
    'https://example.test/base/%2e%2e/escape',
    'https://example.test\\base\\..\\escape',
  ]) {
    assert.throws(
      () => readProxyConfiguration({ NATIVE_LANGGRAPH_URL: target }),
      /NATIVE_LANGGRAPH_URL/
    );
  }
  assert.deepEqual(
    readProxyConfiguration({
      NATIVE_LANGGRAPH_URL: 'https://example.test/base/',
      NATIVE_LANGGRAPH_API_KEY: 'owned-key',
      NATIVE_ASSISTANT_ID: 'assistant',
    }),
    { target: 'https://example.test/base/', apiKey: 'owned-key' }
  );
  assert.throws(
    () =>
      readProxyConfiguration({
        NATIVE_LANGGRAPH_URL: 'https://example.test',
        NATIVE_LANGGRAPH_API_KEY: 'secret\nheader',
      }),
    /API_KEY/
  );
});

test('preserves exact path, query, body and only needed browser headers with server-owned authentication', async (t) => {
  const requests = [];
  const origin = await upstream(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks).toString(),
    });
    res.writeHead(200, {
      'content-type': 'application/json',
      'x-accel-buffering': 'no',
    });
    res.end('{"ok":true}');
  });
  const owned = await proxy(t, origin.url + '/deployment/base/', {
    apiKey: 'owned-key',
  });
  const body = '{"input":{"text":"é"}}';
  const result = await raw(
    owned.url,
    '/api/threads/a%2Fb/runs?x=%2f&x=one+two&empty=&q=%25',
    {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'last-event-id': 'event-7',
        authorization: 'Bearer browser-key',
        'x-api-key': 'browser-key',
        cookie: 'secret=cookie',
        'x-unneeded': 'no',
      },
    }
  );
  assert.equal(result.body, '{"ok":true}');
  assert.equal(result.headers['content-type'], 'application/json');
  assert.equal(result.headers['x-accel-buffering'], 'no');
  assert.equal(
    requests[0].url,
    '/deployment/base/threads/a%2Fb/runs?x=%2f&x=one+two&empty=&q=%25'
  );
  assert.equal(requests[0].body, body);
  assert.equal(requests[0].headers['x-api-key'], 'owned-key');
  assert.equal(requests[0].headers['last-event-id'], 'event-7');
  for (const name of ['authorization', 'cookie', 'x-unneeded'])
    assert.equal(requests[0].headers[name], undefined);
  await raw(owned.url, '/api?root=%2f');
  assert.equal(requests[1].url, '/deployment/base?root=%2f');
});

test('rejects other namespaces and traversal without contacting upstream', async (t) => {
  let calls = 0;
  const origin = await upstream(t, (_, res) => {
    calls++;
    res.end('wrong');
  });
  const owned = await proxy(t, origin.url + '/base');
  for (const path of [
    '/apix',
    '/',
    '/api-other',
    '/api/../escape',
    '/api/%2e%2e/escape',
    '/api/a/%2E./escape',
    '/api/a%5cb',
    '/api/a%2f..%2fb',
    '/api//else',
    '/api/%ZZ',
  ]) {
    const result = await raw(owned.url, path);
    assert.ok([400, 404].includes(result.status), path);
  }
  assert.equal(calls, 0);
});

for (const status of [401, 403, 404, 422, 500, 503])
  test(`safe readable ${status} failure preserves classification without exposing body`, async (t) => {
    const origin = await upstream(t, (_, res) => {
      res.writeHead(status, { 'retry-after': '2' });
      res.end('private-upstream-secret');
    });
    const owned = await proxy(t, origin.url);
    const result = await raw(owned.url, '/api/threads');
    assert.equal(result.status, status);
    assert.match(result.headers['content-type'], /application\/json/);
    assert.ok(JSON.parse(result.body).error.length > 8);
    assert.doesNotMatch(result.body, /private-upstream-secret/);
    assert.equal(result.headers['retry-after'], '2');
  });

test('redirects cannot contact another server and safe runtime locations are relative to SDK API base', async (t) => {
  let escaped = 0;
  const outside = await upstream(t, (_, res) => {
    escaped++;
    res.end('escaped');
  });
  const origin = await upstream(t, (req, res) => {
    if (req.url === '/base/redirect') {
      res.writeHead(307, { location: outside.url + '/secret' });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      location: origin.url + '/base/threads/t/runs/r/stream?cursor=%2f',
      'content-location': '/base/threads/t/runs/r',
      'cache-control': 'no-cache',
      'set-cookie': 'secret=cookie; HttpOnly; Secure',
    });
    res.end('event: values\ndata: {"ok":true}\n\n');
  });
  const owned = await proxy(t, origin.url + '/base');
  const direct = await raw(origin.url, '/base/threads');
  assert.deepEqual(direct.headers['set-cookie'], [
    'secret=cookie; HttpOnly; Secure',
  ]);
  const result = await raw(owned.url, '/api/threads');
  assert.equal(result.headers.location, '/threads/t/runs/r/stream?cursor=%2f');
  assert.equal(result.headers['content-location'], '/threads/t/runs/r');
  assert.equal(result.headers['cache-control'], 'no-cache');
  assert.equal(result.headers['set-cookie'], undefined);
  assert.equal(result.body, 'event: values\ndata: {"ok":true}\n\n');
  const redirect = await raw(owned.url, '/api/redirect');
  assert.equal(redirect.status, 502);
  assert.equal(redirect.headers.location, undefined);
  assert.equal(escaped, 0);
});

for (const type of ['application/json', 'text/event-stream'])
  test(`downstream abort physically closes held ${type} upstream`, async (t) => {
    let closedResolve;
    const closed = new Promise((resolve) => {
      closedResolve = resolve;
    });
    const origin = await upstream(t, (_, res) => {
      res.on('close', closedResolve);
      res.writeHead(200, { 'content-type': type });
      res.write(
        type === 'application/json' ? '{"held":' : 'event: values\ndata: 1\n\n'
      );
    });
    const owned = await proxy(t, origin.url);
    const client = http.get(owned.url + '/api/stream');
    t.after(() => client.destroy());
    const [response] = await deadline(once(client, 'response'));
    await deadline(once(response, 'data'));
    response.destroy();
    client.destroy();
    await deadline(closed);
  });

test('partial upstream failure terminates downstream and shutdown aborts held requests; double close is inert', async (t) => {
  let upstreamResponse;
  let closedResolve;
  const closed = new Promise((resolve) => {
    closedResolve = resolve;
  });
  const origin = await upstream(t, (_, res) => {
    upstreamResponse = res;
    res.on('close', closedResolve);
    res.writeHead(200);
    res.write('partial');
  });
  const owned = await proxy(t, origin.url);
  const client = http.get(owned.url + '/api/stream');
  t.after(() => client.destroy());
  const [response] = await deadline(once(client, 'response'));
  response.on('error', () => {});
  await deadline(once(response, 'data'));
  const ended = new Promise((resolve) => response.once('close', resolve));
  upstreamResponse.destroy();
  await deadline(ended);
  await deadline(closed);
  await deadline(owned.close());
  await deadline(owned.close());
});

test('shutdown physically closes active upstream and releases port', async (t) => {
  let closedResolve;
  const closed = new Promise((resolve) => {
    closedResolve = resolve;
  });
  const origin = await upstream(t, (_, res) => {
    res.on('close', closedResolve);
    res.writeHead(200);
    res.write('held');
  });
  const owned = await proxy(t, origin.url);
  const client = http.get(owned.url + '/api/stream');
  t.after(() => client.destroy());
  const [response] = await deadline(once(client, 'response'));
  response.on('error', () => {});
  await deadline(once(response, 'data'));
  await deadline(owned.close());
  await deadline(closed);
  const replacement = await proxy(t, origin.url, {
    port: Number(new URL(owned.url).port),
  });
  await replacement.close();
});

test('occupied port rejects safely while its owner remains reachable; network errors are readable', async (t) => {
  const origin = await upstream(t, (_, res) => res.end('owner'));
  await assert.rejects(
    startProxy({ target: origin.url, port: origin.server.address().port }),
    /port|listen/i
  );
  assert.equal((await raw(origin.url, '/')).body, 'owner');
  const unused = await proxy(t, origin.url);
  const deadUrl = unused.url;
  await unused.close();
  const owned = await proxy(t, deadUrl);
  const result = await raw(owned.url, '/api/threads');
  assert.equal(result.status, 502);
  assert.match(result.body, /reach|unavailable/i);
  assert.doesNotMatch(result.body, /127\.0\.0\.1/);
});

for (const uploading of [false, true])
  test(`cancellation ${
    uploading ? 'during upload' : 'before response headers'
  } closes upstream`, async (t) => {
    let reachedResolve, closedResolve;
    const reached = new Promise((resolve) => {
      reachedResolve = resolve;
    });
    const closed = new Promise((resolve) => {
      closedResolve = resolve;
    });
    const origin = await upstream(t, (req, res) => {
      res.on('close', closedResolve);
      req.once('data', reachedResolve);
      req.on('error', () => {});
      if (!uploading) {
        req.resume();
        reachedResolve();
      }
    });
    const owned = await proxy(t, origin.url);
    const client = http.request(owned.url + '/api/held', {
      method: uploading ? 'POST' : 'GET',
    });
    client.on('error', () => {});
    t.after(() => client.destroy());
    if (uploading) client.write('{"input":"unfinished');
    else client.end();
    await deadline(reached);
    client.destroy();
    await deadline(closed);
  });

test('slow downstream bounds upstream progress and resuming delivers every byte', async (t) => {
  const total = 64 * 1024 * 1024;
  const chunk = Buffer.alloc(64 * 1024, 97);
  let produced = 0;
  const origin = await upstream(t, (_, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    function pump() {
      while (produced < total) {
        produced += chunk.length;
        if (!res.write(chunk)) {
          res.once('drain', pump);
          return;
        }
      }
      res.end();
    }
    pump();
  });
  const owned = await proxy(t, origin.url);
  const client = http.get(owned.url + '/api/large');
  t.after(() => client.destroy());
  const [response] = await deadline(once(client, 'response'));
  response.pause();
  // Wait for TCP windows to fill; the timer is referenced and resources are
  // always registered for cleanup before an assertion can fail.
  await new Promise((resolve) => setTimeout(resolve, 100));
  const first = produced;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(
    first < total / 2,
    `Paused browser allowed ${first} upstream bytes`
  );
  assert.ok(
    produced - first < 4 * 1024 * 1024,
    'Upstream must stop making unbounded progress'
  );
  let received = 0;
  response.on('data', (data) => {
    received += data.length;
    assert.ok(data.every((byte) => byte === 97));
  });
  const finished = deadline(once(response, 'end'));
  response.resume();
  await finished;
  assert.equal(received, total);
});

test('browser configuration is absolute same-origin, trims assistant id and remains inert when missing', async () => {
  const source = readFileSync(
    new URL('../shared/browser.ts', import.meta.url),
    'utf8'
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext },
  });
  const { getBrowserConfiguration } = await import(
    'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64')
  );
  assert.deepEqual(
    getBrowserConfiguration(
      { assistantId: ' assistant ', apiBase: '/api' },
      'http://localhost:4311'
    ),
    {
      assistantId: 'assistant',
      apiUrl: 'http://localhost:4311/api',
      configured: true,
    }
  );
  assert.deepEqual(
    getBrowserConfiguration(
      { assistantId: ' ', apiBase: '/api' },
      'http://localhost:4311'
    ),
    { assistantId: '', apiUrl: 'http://localhost:4311/api', configured: false }
  );
});

test('authored Vite routing accepts only an owned loopback origin and the exact API namespace', async () => {
  const { createApiProxy } = await import('../react/vite.config.mts');
  assert.deepEqual(createApiProxy(), {});
  for (const origin of [
    'https://external.test',
    'http://localhost:1',
    'http://127.0.0.1:1/base',
    'http://user:pass@127.0.0.1:1',
    'http://127.0.0.1:1?x=1',
  ])
    assert.throws(() => createApiProxy(origin), /owned loopback/);
  const config = createApiProxy('http://127.0.0.1:4312');
  const [pattern] = Object.keys(config);
  const matcher = new RegExp(pattern);
  for (const path of ['/api', '/api?q=1', '/api/threads'])
    assert.ok(matcher.test(path), path);
  for (const path of ['/apix', '/api-other', '/some/api'])
    assert.equal(matcher.test(path), false, path);
  assert.equal(config[pattern].target, 'http://127.0.0.1:4312');
  assert.equal(config[pattern].followRedirects, false);
});

test('preserves compressed success bytes with encoding and strips encoding from safe error JSON', async (t) => {
  const { gzipSync } = await import('node:zlib');
  const payload = gzipSync(Buffer.from('{"ok":true}'));
  const origin = await upstream(t, (req, res) => {
    res.writeHead(req.url === '/error' ? 500 : 200, {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    });
    res.end(payload);
  });
  const owned = await proxy(t, origin.url);
  const result = await fetch(owned.url + '/api/success');
  assert.equal(result.headers.get('content-encoding'), 'gzip');
  assert.deepEqual(await result.json(), { ok: true });
  const error = await fetch(owned.url + '/api/error');
  assert.equal(error.status, 500);
  assert.equal(error.headers.get('content-encoding'), null);
  assert.match((await error.json()).error, /unavailable/);
});

test('retains safe SDK-relative runtime locations while rejecting unconfigured absolute locations', async (t) => {
  const cases = [
    [
      '/threads/t/runs/r/stream?cursor=%2f',
      '/threads/t/runs/r/stream?cursor=%2f',
    ],
    ['/base/threads/t/runs/r', '/threads/t/runs/r'],
    ['https://external.test/base/threads/t/runs/r', undefined],
    ['//external.test/base/threads/t/runs/r', undefined],
    ['/base/../outside', undefined],
  ];
  let next = 0;
  const origin = await upstream(t, (_, res) => {
    res.writeHead(200, { location: cases[next++][0] });
    res.end('ok');
  });
  cases.push([origin.url + '/outside', undefined]);
  const owned = await proxy(t, origin.url + '/base');
  for (const [, expected] of cases)
    assert.equal(
      (await raw(owned.url, '/api/threads')).headers.location,
      expected
    );
});

test('valid IPv6 upstream is reachable when local IPv6 is available', async (t) => {
  const server = http.createServer((_, res) => res.end('ipv6'));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      })
  );
  try {
    server.listen(0, '::1');
    await once(server, 'listening');
  } catch (error) {
    if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) {
      t.skip('Local IPv6 unavailable');
      return;
    }
    throw error;
  }
  const owned = await proxy(t, `http://[::1]:${server.address().port}/base`);
  const result = await raw(owned.url, '/api/threads');
  assert.equal(result.status, 200);
  assert.equal(result.body, 'ipv6');
});
