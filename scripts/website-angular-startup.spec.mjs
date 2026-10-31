import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import nodeTest from 'node:test';

const test = (name, fn) => nodeTest(name, { timeout: 15_000 }, fn);

const moduleUrl = pathToFileURL(
  join(import.meta.dirname, 'website-angular-startup.mjs')
).href;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function port() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
function server(port, extra = '') {
  return `const http = require('node:http'); ${extra}; http.createServer((req,res)=>{res.end('ok')}).listen(${port},'127.0.0.1');`;
}
function entry(port, source, timeout = 2000) {
  return {
    command: process.execPath,
    args: ['-e', source],
    url: `http://127.0.0.1:${port}`,
    timeout,
    name: String(port),
  };
}
async function pool(t, entries, options = {}) {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { runPool } from ${JSON.stringify(
        moduleUrl
      )}; await runPool(${JSON.stringify(
        entries
      )}, {shutdownGraceMs:100,...${JSON.stringify(options)}});`,
    ],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  const exited = new Promise((resolve) =>
    child.on('exit', (code, signal) => resolve({ code, signal }))
  );
  t.after(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  });
  return {
    child,
    exited,
    output: () => output,
    async wait(text, timeout = 4000) {
      const end = Date.now() + timeout;
      while (!output.includes(text) && Date.now() < end) await delay(10);
      assert.ok(output.includes(text), `Missing ${text}: ${output}`);
    },
  };
}

test('callers can select a distinct pool label and readiness marker', async (t) => {
  const value = await port();
  const p = await pool(t, [entry(value, server(value))], {
    poolLabel: 'Agents pool',
    readyMessage: 'Website Agents servers ready',
  });
  await p.wait('Website Agents servers ready');
  assert.match(p.output(), /\[Agents pool\].*ready in/);
  assert.ok(!p.output().includes('Website Angular servers ready'));
  p.child.kill('SIGTERM');
  await p.exited;
});

test('two children await readiness concurrently; marker waits for every URL and queued deadlines start at launch', async (t) => {
  const ports = await Promise.all([port(), port(), port()]);
  const p = await pool(
    t,
    ports.map((value, i) =>
      entry(
        value,
        `console.error('launch-${i}');setTimeout(()=>{${server(value)}},${
          i === 2 ? 50 : 800
        });`,
        i === 2 ? 650 : 3000
      )
    )
  );
  await p.wait('launch-1');
  assert.ok(
    !p.output().includes(' ready in '),
    'both first children must launch before either is ready'
  );
  assert.ok(!p.output().includes('launch-2'));
  assert.ok(!p.output().includes('Website Angular servers ready'));
  await p.wait('Website Angular servers ready');
  assert.ok(p.output().includes('launch-2'));
  assert.ok(
    p.output().indexOf(' ready in ') < p.output().indexOf('launch-2'),
    'the queued child must wait for a readiness slot'
  );
  p.child.kill('SIGTERM');
  await p.exited;
});

test('readiness follows redirects, accepts 403, and falls back from root 404 to index.html', async (t) => {
  const ports = await Promise.all([port(), port(), port()]);
  const handlers = [
    "res.statusCode=302;res.setHeader('location','/done');if(req.url==='/done'){res.statusCode=200}res.end()",
    'res.statusCode=403;res.end()',
    "res.statusCode=req.url==='/index.html'?200:404;res.end()",
  ];
  const p = await pool(
    t,
    ports.map((value, i) =>
      entry(
        value,
        `require('node:http').createServer((req,res)=>{${handlers[i]}}).listen(${value},'127.0.0.1')`
      )
    )
  );
  await p.wait('Website Angular servers ready');
  p.child.kill('SIGTERM');
  await p.exited;
});

test('occupied endpoint rejects before launching any child and leaves existing server alive', async (t) => {
  const value = await port();
  const existing = spawn(process.execPath, ['-e', server(value)], {
    stdio: 'ignore',
  });
  t.after(() => existing.kill('SIGKILL'));
  await delay(200);
  const p = await pool(t, [entry(value, "console.log('SHOULD NOT LAUNCH')")]);
  await p.exited;
  assert.match(p.output(), /already available/);
  assert.doesNotMatch(p.output(), /SHOULD NOT LAUNCH/);
  assert.equal((await fetch(`http://127.0.0.1:${value}`)).status, 200);
});

for (const [name, source] of [
  ['early exit', 'process.exit(7)'],
  ['launch error', null],
  [
    'deadline',
    "require('node:http').createServer(()=>{}).listen(PORT,'127.0.0.1')",
  ],
]) {
  test(`${name} stops the queue and fails without a readiness marker`, async (t) => {
    const ports = await Promise.all([port(), port(), port()]);
    const entries = ports.map((value) =>
      entry(value, 'setInterval(()=>{},1000)', 400)
    );
    entries[0] =
      source === null
        ? { ...entries[0], command: '/does-not-exist' }
        : entry(ports[0], source.replace('PORT', ports[0]), 400);
    entries[2] = entry(ports[2], "console.log('QUEUED CHILD LAUNCHED')");
    const started = Date.now();
    const p = await pool(t, entries);
    await p.exited;
    assert.ok(
      Date.now() - started < 2000,
      'shutdown must respect the child deadline even when HTTP never responds'
    );
    assert.doesNotMatch(
      p.output(),
      /Website Angular servers ready|QUEUED CHILD LAUNCHED/
    );
    assert.match(p.output(), /exited|ENOENT|timed out/);
  });
}

test('a child exit after readiness terminates the pool', async (t) => {
  const value = await port();
  const p = await pool(t, [
    entry(value, server(value, 'setTimeout(()=>process.exit(9),500)')),
  ]);
  await p.wait('Website Angular servers ready');
  await p.exited;
  assert.match(p.output(), /exited.*9/);
});

test('SIGTERM escalates for a stubborn grandchild in the owned process group', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'angular-pool-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'pid');
  const value = await port();
  const grandchild = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(
    file
  )},String(process.pid));setInterval(()=>{},1000)`;
  const p = await pool(t, [
    entry(
      value,
      server(
        value,
        `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(
          grandchild
        )}],{stdio:'ignore'});process.on('SIGTERM',()=>{})`
      )
    ),
  ]);
  await p.wait('Website Angular servers ready');
  await delay(100);
  const pid = Number(await readFile(file, 'utf8'));
  p.child.kill('SIGTERM');
  const result = await p.exited;
  assert.equal(result.signal, 'SIGKILL');
  await delay(100);
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});

test('CLI rejects descriptor drift before starting commands', async (t) => {
  const child = spawn(
    process.execPath,
    ['scripts/website-angular-startup.mjs'],
    {
      detached: true,
      env: {
        ...process.env,
        WEBSITE_ANGULAR_SERVERS: JSON.stringify([
          {
            command: 'node bad',
            cwd: '../..',
            url: 'http://localhost:4200',
            reuseExistingServer: false,
          },
        ]),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  t.after(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  });
  let output = '';
  child.stderr.on('data', (data) => {
    output += data;
  });
  await new Promise((resolve) => child.on('exit', resolve));
  assert.match(output, /Invalid Angular/);
});

test('manifest preserves Nx commands and default or original deadlines, and fails closed on drift', async () => {
  const { parseServers } = await import(moduleUrl);
  const descriptor = {
    command: 'npx nx run cockpit-chat-angular:serve:cockpit --port 4312',
    cwd: '../..',
    url: 'http://localhost:4312',
    reuseExistingServer: false,
  };
  const [normal, extended] = parseServers(
    JSON.stringify([descriptor, { ...descriptor, timeout: 180000 }])
  );
  assert.equal(normal.timeout, 60000);
  assert.equal(extended.timeout, 180000);
  assert.deepEqual(normal.args, [
    'nx',
    'run',
    'cockpit-chat-angular:serve:cockpit',
    '--port',
    '4312',
  ]);
  assert.equal(normal.cwd, resolveRoot());
  for (const change of [
    { url: 'http://example.com:4312' },
    { url: 'http://localhost:4313' },
    { cwd: '.' },
    { reuseExistingServer: true },
    { timeout: 0 },
    { timeout: '60000' },
    { env: {} },
    {
      command:
        'npx nx run cockpit-chat-angular:serve:cockpit --port 4312; echo unsafe',
    },
  ]) {
    assert.throws(
      () => parseServers(JSON.stringify([{ ...descriptor, ...change }])),
      /Invalid Angular/
    );
  }
  for (const value of ['null', '{}', '[]'])
    assert.throws(() => parseServers(value), /Invalid Angular/);
});

function resolveRoot() {
  return fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
}

test('an unowned process group rejects before spawning a server', async () => {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {runPool} from ${JSON.stringify(moduleUrl)};await runPool([])`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let output = '';
  child.stderr.on('data', (data) => {
    output += data;
  });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 1);
  assert.match(output, /own Unix process group/);
});

test('HTTP 500, unsuccessful index fallback, and redirect loops never satisfy readiness', async (t) => {
  for (const handler of [
    'res.statusCode=500;res.end()',
    'res.statusCode=404;res.end()',
    "res.statusCode=302;res.setHeader('location','/loop');res.end()",
  ]) {
    const value = await port();
    const p = await pool(t, [
      entry(
        value,
        `require('node:http').createServer((req,res)=>{${handler}}).listen(${value},'127.0.0.1')`,
        300
      ),
    ]);
    await p.exited;
    assert.match(p.output(), /timed out/);
    assert.doesNotMatch(p.output(), /Website Angular servers ready/);
  }
});

test('Playwright waits for the actual stdout barrier and tears down its owned group', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'angular-playwright-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ports = await Promise.all([port(), port()]);
  const entries = ports.map((value, i) =>
    entry(value, `setTimeout(()=>{${server(value)}},${i * 300})`)
  );
  await writeFile(
    join(directory, 'pool.mjs'),
    `import {runPool} from ${JSON.stringify(
      moduleUrl
    )};await runPool(${JSON.stringify(entries)},{shutdownGraceMs:100});`
  );
  const require = createRequire(import.meta.url);
  const testModule = require.resolve('@playwright/test');
  await writeFile(
    join(directory, 'fixture.spec.cjs'),
    `const {test,expect}=require(${JSON.stringify(
      testModule
    )});test('all URLs ready',async({request})=>{for(const port of ${JSON.stringify(
      ports
    )})expect((await request.get('http://127.0.0.1:'+port)).status()).toBe(200)});`
  );
  await writeFile(
    join(directory, 'playwright.config.cjs'),
    `module.exports={testDir:${JSON.stringify(
      directory
    )},reporter:'line',outputDir:${JSON.stringify(
      join(directory, 'results')
    )},webServer:{command:'exec '+${JSON.stringify(
      process.execPath
    )}+' '+${JSON.stringify(
      join(directory, 'pool.mjs')
    )},wait:{stdout:/Website Angular servers ready/},timeout:5000,gracefulShutdown:{signal:'SIGTERM',timeout:1000}}};`
  );
  const child = spawn(
    process.execPath,
    [
      require.resolve('@playwright/test/cli'),
      'test',
      '--config',
      join(directory, 'playwright.config.cjs'),
    ],
    { cwd: resolveRoot(), stdio: ['ignore', 'pipe', 'pipe'] }
  );
  t.after(() => child.kill('SIGKILL'));
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 0, output);
  assert.match(output, /1 passed/);
  for (const value of ports)
    await assert.rejects(fetch(`http://127.0.0.1:${value}`));
});
