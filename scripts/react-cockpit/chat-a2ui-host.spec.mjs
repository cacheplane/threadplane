import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

async function until(predicate, message) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await delay(20);
  }
}
async function listening(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(200),
    });
    return true;
  } catch {
    return false;
  }
}
function absent(pid) {
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function host(t, mode, portOverride) {
  const port = portOverride ?? (await freePort()),
    parentPort = await freePort();
  const owned = mkdtempSync(join(tmpdir(), 'a2ui-host-'));
  // Library CI runs before static assets are built. Keep readiness independent of dist.
  const unbuiltAppPath = 'test-only-unbuilt/' + basename(owned);
  assert.equal(existsSync(join('dist', unbuiltAppPath)), false);
  const marker = join(owned, 'worker.json');
  const release = join(owned, 'release');
  const closed = join(owned, 'closed.json');
  const stub = join(owned, 'fixture.mjs');
  // A module-loader seam keeps controlled workers out of production options/environment.
  writeFileSync(
    stub,
    `
    import {spawn} from 'node:child_process';
    import {once} from 'node:events';
    import {existsSync,writeFileSync} from 'node:fs';
    import {setTimeout as delay} from 'node:timers/promises';
    export const fixtureConfiguration = () => Object.freeze({environment:'/controlled/environment',cache:'/controlled/cache'});
    export function createChatA2uiFixture({configuration}={}) {
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);
      const ended=once(child,'close');
      writeFileSync(${JSON.stringify(
        marker
      )},JSON.stringify({pid:child.pid,configuration}));
      const handle=async()=>false;
      let preparation;
      handle.configure=()=>preparation??=(async()=>{
        const deadline=Date.now()+600;
        while(!existsSync(${JSON.stringify(
          release
        )}) && Date.now()<deadline) await delay(20);
        if(${JSON.stringify(mode)}==='failure' || ${JSON.stringify(
      mode
    )}==='signal') throw Error('controlled preparation deadline');
      })();
      handle.close=async()=>{
        await preparation?.catch(()=>{});
        child.kill(); await ended;
        writeFileSync(${JSON.stringify(
          closed
        )},JSON.stringify({pid:child.pid,reaped:true}));
      };
      handle.receipt=()=>({worker:{pid:child.pid},proofs:[],requests:[]});
      return handle;
    }
  `
  );
  const loader = join(owned, 'loader.mjs');
  writeFileSync(
    loader,
    `export async function resolve(specifier,context,next){
    if(specifier==='./chat-a2ui-fixture.mjs' && context.parentURL.endsWith('/serve.mjs'))
      return {url:${JSON.stringify(
        pathToFileURL(stub).href
      )},shortCircuit:true};
    return next(specifier,context);
  }
  export async function load(url,context,next){
    const result=await next(url,context);
    if(url.endsWith('/scripts/react-cockpit/serve.mjs')) return {...result,source:String(result.source).replaceAll('configuration.appPath',${JSON.stringify(
      JSON.stringify(unbuiltAppPath)
    )}).replaceAll('configuration.port',String(${port})).replaceAll(\"listen(3000,\",\"listen(${parentPort},\")};
    return result;
  }`
  );
  const child = spawn(
    process.execPath,
    ['--loader', loader, 'scripts/react-cockpit/serve.mjs', 'chat-a2ui'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let output = '';
  child.stdout.on('data', (bytes) => (output += bytes));
  child.stderr.on('data', (bytes) => (output += bytes));
  let result;
  const ended = once(child, 'close').then(
    ([code, signal]) => (result = { code, signal })
  );
  t.after(async () => {
    if (!result) child.kill('SIGTERM');
    await Promise.race([ended, delay(2000)]);
    if (!result) {
      child.kill('SIGKILL');
      await ended;
    }
    if (existsSync(marker)) {
      const { pid } = JSON.parse(readFileSync(marker));
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  });
  await until(() => existsSync(marker) || result, 'worker acquired');
  assert.equal(result, undefined, output);
  return {
    child,
    ended,
    marker,
    release,
    closed,
    port,
    parentPort,
    get result() {
      return result;
    },
    get output() {
      return output;
    },
  };
}

test(
  'chat A2UI exposes neither listener until initial configuration proof completes',
  { timeout: 10000 },
  async (t) => {
    const h = await host(t, 'success');
    assert.equal(
      await listening(h.port),
      false,
      'browser listener must await graph readiness'
    );
    assert.equal(
      await listening(h.parentPort),
      false,
      'parent listener must await graph readiness'
    );
    writeFileSync(h.release, 'ready');
    const deadline = Date.now() + 4000;
    while (!(await listening(h.port))) {
      assert.ok(Date.now() < deadline, h.output);
      await delay(20);
    }
    assert.equal(await listening(h.parentPort), true);
    h.child.kill('SIGTERM');
    await h.ended;
    assert.equal(h.result.code, 0, h.output);
    absent(JSON.parse(readFileSync(h.marker)).pid);
  }
);

for (const mode of ['failure', 'signal', 'signal-success'])
  test(
    `chat A2UI ${mode} during preparation reaps worker without late readiness`,
    { timeout: 10000 },
    async (t) => {
      const h = await host(t, mode);
      assert.equal(
        await listening(h.port),
        false,
        'no readiness while preparation pending'
      );
      assert.equal(await listening(h.parentPort), false);
      if (mode.startsWith('signal')) h.child.kill('SIGTERM');
      await h.ended;
      assert.equal(h.result.code, mode === 'failure' ? 1 : 0, h.output);
      assert.equal(
        existsSync(h.closed),
        true,
        'preparation owns worker cleanup'
      );
      absent(JSON.parse(readFileSync(h.marker)).pid);
      assert.equal(await listening(h.port), false);
      assert.equal(await listening(h.parentPort), false);
    }
  );

test(
  'chat A2UI listener bind failure closes the prepared worker',
  { timeout: 10000 },
  async (t) => {
    const occupied = createServer();
    occupied.listen(0, '127.0.0.1');
    await once(occupied, 'listening');
    t.after(() => new Promise((resolve) => occupied.close(resolve)));
    const h = await host(t, 'success', occupied.address().port);
    writeFileSync(h.release, 'ready');
    await h.ended;
    assert.equal(h.result.code, 1, h.output);
    assert.equal(existsSync(h.closed), true);
    absent(JSON.parse(readFileSync(h.marker)).pid);
    assert.equal(await listening(h.parentPort), false);
  }
);
