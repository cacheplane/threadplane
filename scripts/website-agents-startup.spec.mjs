import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nodeTest from 'node:test';

const test = (name, fn) => nodeTest(name, { timeout: 15_000 }, fn);
const wrapperUrl = new URL('./website-agents-startup.mjs', import.meta.url)
  .href;
const coreUrl = new URL('./website-angular-startup.mjs', import.meta.url).href;
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const options = {
  poolLabel: 'Agents pool',
  readyMessage: 'Website Agents servers ready',
  shutdownGraceMs: 1000,
};
const topics = ['planning', 'filesystem', 'subagents', 'skills', 'memory'];
const manifest = () =>
  topics.map((topic, index) => ({
    command: `npx nx run cockpit-deep-agents-${topic}-python:smoke && node scripts/react-cockpit/serve.mjs deep-agents-${topic} --no-parent`,
    cwd: '../..',
    url: `http://127.0.0.1:${4628 + index}`,
    reuseExistingServer: false,
    timeout: 180000,
  }));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

test('manifest preserves every original shell chain, workspace and deadline', async () => {
  const { parseAgentServers } = await import(wrapperUrl);
  const descriptors = manifest();
  assert.deepEqual(
    parseAgentServers(JSON.stringify(descriptors)),
    descriptors.map((descriptor, i) => ({
      command: 'sh',
      args: ['-c', descriptor.command],
      cwd: root,
      url: descriptor.url,
      timeout: 180000,
      name: topics[i],
    }))
  );
});

test('manifest fails closed on missing, duplicate, mismatched or changed descriptors', async () => {
  const { parseAgentServers } = await import(wrapperUrl);
  for (const change of [
    { command: [manifest()[0].command] },
    { command: manifest()[0].command + '; echo unsafe' },
    { command: manifest()[0].command + '\n' },
    { command: manifest()[1].command },
    { command: manifest()[0].command.replace(' && ', ' ; ') },
    { cwd: '.' },
    { reuseExistingServer: true },
    { timeout: 179999 },
    { timeout: undefined },
    { timeout: '180000' },
    { env: {} },
    { url: 'http://127.0.0.1:4629' },
    { url: 'https://127.0.0.1:4628' },
    { url: 'http://example.com:4628' },
    { url: 'http://user@127.0.0.1:4628' },
    { url: 'http://127.0.0.1:4628/other' },
    { url: 'http://127.0.0.1:4628?x=1' },
    { url: 'http://127.0.0.1:4628#fragment' },
  ]) {
    const descriptors = manifest();
    descriptors[0] = { ...descriptors[0], ...change };
    assert.throws(
      () => parseAgentServers(JSON.stringify(descriptors)),
      /Invalid Agents/
    );
  }
  for (const value of [
    undefined,
    'null',
    '{}',
    '{',
    '[]',
    JSON.stringify(manifest().slice(1)),
    JSON.stringify([...manifest(), manifest()[0]]),
    JSON.stringify([...manifest().slice(0, 4), manifest()[0]]),
  ]) {
    assert.throws(() => parseAgentServers(value), /Invalid Agents/);
  }
});

async function port() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const value = server.address().port;
  await new Promise((done) => server.close(done));
  return value;
}

const quote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;
const node = (source) => `${quote(process.execPath)} -e ${quote(source)}`;
function chain(
  value,
  name,
  { smokeDelay = 0, timeout = 3000, smoke, server } = {}
) {
  const prerequisite =
    smoke ??
    `console.error('smoke-start-${name}');setTimeout(()=>console.error('smoke-pass-${name}'),${smokeDelay})`;
  const service =
    server ??
    `console.error('server-start-${name}');require('node:http').createServer((req,res)=>res.end('ok')).listen(${value},'127.0.0.1')`;
  return {
    command: 'sh',
    args: ['-c', `${node(prerequisite)} && ${node(service)}`],
    url: `http://127.0.0.1:${value}`,
    timeout,
    name,
  };
}

async function pool(t, entries, detached = true) {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {runPool} from ${JSON.stringify(
        coreUrl
      )};await runPool(${JSON.stringify(entries)},${JSON.stringify(options)})`,
    ],
    { detached, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data) => {
    stdout += data;
  });
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  const exited = new Promise((done) =>
    child.on('exit', (code, signal) => done({ code, signal }))
  );
  t.after(() => {
    try {
      detached ? process.kill(-child.pid, 'SIGKILL') : child.kill('SIGKILL');
    } catch {}
  });
  return {
    child,
    exited,
    stdout: () => stdout,
    stderr: () => stderr,
    async wait(text, stream = 'stderr') {
      const end = Date.now() + 5000;
      while (
        !(stream === 'stderr' ? stderr : stdout).includes(text) &&
        Date.now() < end
      )
        await delay(10);
      assert.ok(
        (stream === 'stderr' ? stderr : stdout).includes(text),
        `Missing ${text}: ${stdout}\n${stderr}`
      );
    },
  };
}

test('two complete shell chains run together, prerequisites precede servers, queued deadlines start at launch', async (t) => {
  const ports = await Promise.all(topics.map(() => port()));
  const p = await pool(
    t,
    ports.map((value, i) =>
      chain(value, topics[i], {
        smokeDelay: i < 2 ? 800 : 50,
        timeout: i < 2 ? 3000 : 650,
      })
    )
  );
  await p.wait('smoke-start-filesystem');
  assert.doesNotMatch(
    p.stderr(),
    /server-start-|smoke-start-subagents| ready in /
  );
  assert.doesNotMatch(p.stdout(), /Website Agents servers ready/);
  await p.wait('Website Agents servers ready', 'stdout');
  for (const topic of topics) {
    assert.ok(
      p.stderr().indexOf(`smoke-pass-${topic}`) <
        p.stderr().indexOf(`server-start-${topic}`),
      p.stderr()
    );
    assert.match(
      p.stderr(),
      new RegExp(`\\[Agents pool\\] ${topic} .* ready in `)
    );
  }
  assert.ok(
    p.stderr().indexOf(' ready in ') <
      p.stderr().indexOf('smoke-start-subagents'),
    p.stderr()
  );
  assert.match(p.stderr(), /\[Agents pool\] all servers ready in /);
  assert.doesNotMatch(p.stdout(), /Website Angular servers ready/);
  p.child.kill('SIGTERM');
  await p.exited;
});

test('failed smoke prevents its server, stops the queued chains and suppresses all-ready', async (t) => {
  const ports = await Promise.all([port(), port(), port()]);
  const p = await pool(t, [
    chain(ports[0], 'failed', {
      smoke: "console.error('failed-smoke');process.exit(7)",
    }),
    chain(ports[1], 'pending', { smokeDelay: 2000 }),
    chain(ports[2], 'queued'),
  ]);
  await p.exited;
  assert.match(p.stderr(), /failed-smoke/);
  assert.match(p.stderr(), /failed .*exited \(code 7/);
  assert.doesNotMatch(
    p.stderr(),
    /server-start-|smoke-start-queued|all servers ready/
  );
  assert.doesNotMatch(p.stdout(), /Website Agents servers ready/);
});

test('a smoke that never finishes consumes its original launch deadline and cancels the queue', async (t) => {
  const ports = await Promise.all([port(), port(), port()]);
  const p = await pool(t, [
    chain(ports[0], 'deadline', {
      smoke: "console.error('smoke-hung');setInterval(()=>{},1000)",
      timeout: 400,
    }),
    chain(ports[1], 'pending', { smokeDelay: 2000 }),
    chain(ports[2], 'queued'),
  ]);
  const started = Date.now();
  await p.exited;
  assert.ok(Date.now() - started < 2500, p.stderr());
  assert.match(p.stderr(), /deadline .*timed out after 400ms/);
  assert.doesNotMatch(
    p.stderr(),
    /server-start-|smoke-start-queued|all servers ready/
  );
});

test('a shell server exiting after all-ready shuts down the pool', async (t) => {
  const value = await port();
  const p = await pool(t, [
    chain(value, 'late', {
      server: `require('node:http').createServer((req,res)=>res.end('ok')).listen(${value},'127.0.0.1');setTimeout(()=>process.exit(9),700)`,
    }),
  ]);
  await p.wait('Website Agents servers ready', 'stdout');
  await p.exited;
  assert.match(p.stderr(), /late .*exited \(code 9/);
});

test('occupied URL and unowned process group reject before launching shell prerequisites', async (t) => {
  const value = await port();
  const existing = createHttpServer((request, response) => response.end('ok'));
  await new Promise((done) => existing.listen(value, '127.0.0.1', done));
  t.after(
    () =>
      new Promise((done) => {
        existing.closeAllConnections();
        existing.close(done);
      })
  );
  const p = await pool(t, [chain(value, 'occupied')]);
  await p.exited;
  assert.match(p.stderr(), /already available/);
  assert.doesNotMatch(p.stderr(), /smoke-start-/);
  assert.equal((await fetch(`http://127.0.0.1:${value}`)).status, 200);
  const unowned = await pool(t, [chain(value, 'unowned')], false);
  assert.equal((await unowned.exited).code, 1);
  assert.match(unowned.stderr(), /own Unix process group/);
  assert.doesNotMatch(unowned.stderr(), /smoke-start-/);
});

test('Agents one-second shutdown escalates through the shell to TERM-resistant grandchildren', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'agents-descendants-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pidFile = join(directory, 'pid');
  const value = await port();
  const grandchild = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(
    pidFile
  )},String(process.pid));console.error('grandchild-ready');setInterval(()=>{},1000)`;
  const p = await pool(t, [
    chain(value, 'stubborn', {
      server: `process.on('SIGTERM',()=>{});require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(
        grandchild
      )}],{stdio:'inherit'});require('node:http').createServer((req,res)=>res.end('ok')).listen(${value},'127.0.0.1')`,
    }),
  ]);
  await p.wait('Website Agents servers ready', 'stdout');
  await p.wait('grandchild-ready');
  const pid = Number(await readFile(pidFile, 'utf8'));
  const started = Date.now();
  p.child.kill('SIGTERM');
  assert.equal((await p.exited).signal, 'SIGKILL');
  assert.ok(
    Date.now() - started >= 900,
    'Agents retains its one-second TERM grace'
  );
  await delay(100);
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  await assert.rejects(fetch(`http://127.0.0.1:${value}`));
});

test('CLI validates the entire original manifest before any launch', async (t) => {
  const descriptors = manifest();
  descriptors[4].timeout = 1;
  const child = spawn(process.execPath, [fileURLToPath(wrapperUrl)], {
    detached: true,
    env: {
      ...process.env,
      WEBSITE_AGENTS_SERVERS: JSON.stringify(descriptors),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  });
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  const code = await new Promise((done) => child.on('exit', done));
  assert.equal(code, 1);
  assert.match(output, /^Invalid Agents server manifest\s*$/);
});

test('Playwright waits for the distinct Agents barrier and tears down the actual shell group', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'agents-playwright-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ports = await Promise.all([port(), port()]);
  const entries = ports.map((value, i) =>
    chain(value, topics[i], {
      smoke: `console.log('Website Angular servers ready');setTimeout(()=>console.error('smoke-pass-${i}'),${
        i === 0 ? 50 : 800
      })`,
    })
  );
  await writeFile(
    join(directory, 'pool.mjs'),
    `import {runPool} from ${JSON.stringify(
      coreUrl
    )};await runPool(${JSON.stringify(entries)},${JSON.stringify(options)})`
  );
  const require = createRequire(import.meta.url);
  await writeFile(
    join(directory, 'fixture.spec.cjs'),
    `const {test,expect}=require(${JSON.stringify(
      require.resolve('@playwright/test')
    )});test('all Agents URLs ready',async({request})=>{for(const port of ${JSON.stringify(
      ports
    )})expect((await request.get('http://127.0.0.1:'+port)).status()).toBe(200)})`
  );
  await writeFile(
    join(directory, 'playwright.config.cjs'),
    `module.exports={testDir:${JSON.stringify(
      directory
    )},reporter:'line',outputDir:${JSON.stringify(
      join(directory, 'results')
    )},webServer:{command:${JSON.stringify(
      `exec ${quote(process.execPath)} ${quote(join(directory, 'pool.mjs'))}`
    )},wait:{stdout:/Website Agents servers ready/},timeout:5000,gracefulShutdown:{signal:'SIGTERM',timeout:15000}}}`
  );
  const child = spawn(
    process.execPath,
    [
      require.resolve('@playwright/test/cli'),
      'test',
      '--config',
      join(directory, 'playwright.config.cjs'),
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  t.after(() => child.kill('SIGKILL'));
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  assert.equal(await new Promise((done) => child.on('exit', done)), 0, output);
  assert.match(output, /1 passed/);
  for (const value of ports)
    await assert.rejects(fetch(`http://127.0.0.1:${value}`));
});
