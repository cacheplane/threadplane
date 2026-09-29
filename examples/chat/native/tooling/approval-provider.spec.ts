import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createServer } from 'node:http';
import {
  mkdtempSync,
  existsSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runApprovalProvider } from './approval-provider';

const root = resolve(process.cwd());
const node = (source: string) => ({
  command: process.execPath,
  args: ['-e', source],
  cwd: root,
  env: process.env,
});
const server = (port: number, rejectDeletion = false) =>
  node(`
 const http=require('node:http');
 const s=http.createServer((q,r)=>{if(${rejectDeletion}&&q.method==='DELETE')r.statusCode=500;r.setHeader('content-type','application/json');r.end(q.url==='/ok'?'{}':JSON.stringify([{graph_id:'chat',assistant_id:'chat'}]));});
 s.listen(${port},'127.0.0.1',()=>console.log('API: http://127.0.0.1:${port}\\nApplication started up in 0.001s'));
 s.on('error',()=>process.exit(9));
`);
function owned(t: TestContext) {
  const temporaryParent = mkdtempSync(
    join(tmpdir(), 'approval-lifetime-test-')
  );
  t.after(() => rmSync(temporaryParent, { recursive: true, force: true }));
  return temporaryParent;
}
const operations = {
  prepare: async () => {},
  providerCommand: async ({ port }: { port: number }) => server(port),
  exercise: async () => ({ proof: 'lifecycle control only' }),
};

test('provider startup failure rejects and removes only its owned files', async (t) => {
  const temporaryParent = owned(t);
  const marker = join(temporaryParent, 'unrelated');
  writeFileSync(marker, 'keep');
  let temporary = '';
  await assert.rejects(
    runApprovalProvider({
      root,
      temporaryParent,
      operations: {
        ...operations,
        providerCommand: async (context) => {
          temporary = context.temporary;
          return node('process.exit(7)');
        },
      },
    }),
    /provider.*exited/i
  );
  assert.ok(temporary);
  assert.equal(existsSync(temporary), false);
  assert.equal(existsSync(marker), true);
});

test('external abort during preparation closes its group before deleting inputs', async (t) => {
  const temporaryParent = owned(t),
    controller = new AbortController();
  let pid = 0,
    temporary = '';
  await assert.rejects(
    runApprovalProvider({
      root,
      temporaryParent,
      signal: controller.signal,
      operations: {
        ...operations,
        prepare: async (context) => {
          temporary = context.temporary;
          const running = context.run(
            'preparation',
            node('setInterval(()=>{},1000)')
          );
          pid = running.pid;
          controller.abort();
          await running.done;
        },
      },
    }),
    /abort/i
  );
  assert.ok(pid > 0);
  assert.throws(() => process.kill(-pid, 0), { code: 'ESRCH' });
  assert.equal(existsSync(temporary), false);
});

test('an occupied requested port fails and preserves its unrelated listener', async (t) => {
  const temporaryParent = owned(t);
  const unrelated = createServer((_q, r) => r.end('still here'));
  await new Promise<void>((yes) => unrelated.listen(0, '127.0.0.1', yes));
  t.after(() => new Promise<void>((yes) => unrelated.close(() => yes())));
  const address = unrelated.address();
  assert.ok(address && typeof address !== 'string');
  await assert.rejects(
    runApprovalProvider({
      root,
      temporaryParent,
      port: address.port,
      operations,
    }),
    /EADDRINUSE|occupied/i
  );
  assert.equal(
    await (await fetch(`http://127.0.0.1:${address.port}`)).text(),
    'still here'
  );
});

test('leader exit with a remaining descendant closes the whole owned group', async (t) => {
  const temporaryParent = owned(t);
  let temporary = '',
    pid = 0;
  await assert.rejects(
    runApprovalProvider({
      root,
      temporaryParent,
      operations: {
        ...operations,
        providerCommand: async (context) => {
          temporary = context.temporary;
          return node(
            `const {spawn}=require('node:child_process'); spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); process.exit(4);`
          );
        },
      },
      onChild: (name, childPid) => {
        if (name === 'provider') pid = childPid;
      },
    }),
    /provider.*exited/i
  );
  assert.ok(pid > 0);
  assert.throws(() => process.kill(-pid, 0), { code: 'ESRCH' });
  assert.equal(existsSync(temporary), false);
});

test('successful provider lifetime closes model and provider without launching a UI', async (t) => {
  const temporaryParent = owned(t),
    children: string[] = [],
    pids: number[] = [];
  const result = await runApprovalProvider({
    root,
    temporaryParent,
    operations,
    onChild: (name, pid) => {
      children.push(name);
      pids.push(pid);
    },
  });
  assert.deepEqual(children, ['provider']);
  assert.equal(result.proof.proof, 'lifecycle control only');
  assert.equal(existsSync(result.temporary), false);
  for (const pid of pids)
    assert.throws(() => process.kill(-pid, 0), { code: 'ESRCH' });
  await assert.rejects(fetch(result.modelUrl));
});

test('unconfirmed cleanup retains owned inputs even after a successful proof', async (t) => {
  const temporaryParent = owned(t);
  let temporary = '';
  await assert.rejects(
    runApprovalProvider({
      root,
      temporaryParent,
      operations: {
        ...operations,
        exercise: async (context) => {
          temporary = context.temporary;
          return {};
        },
      },
      killProcessGroup(pid, signal) {
        // Actually close our child, but refuse to attest that the group disappeared.
        if (signal !== 0) {
          try {
            process.kill(pid, signal);
          } catch {}
        }
        throw Object.assign(new Error('Cannot confirm owned group'), {
          code: 'EPERM',
        });
      },
    }),
    /cleanup failed; temporary files retained/
  );
  assert.equal(existsSync(join(temporary, 'provider/uv.lock')), true);
});

test('abort leaves provider and observer alive until the installed owner finishes cleanup', async (t) => {
  const temporaryParent = owned(t),
    controller = new AbortController();
  const ready = join(temporaryParent, 'ready'),
    cleaned = join(temporaryParent, 'cleaned');
  await assert.rejects(
    runApprovalProvider({
      root,
      temporaryParent,
      signal: controller.signal,
      operations: {
        ...operations,
        exercise: async (context) => {
          const running = context.run(
            'installed session',
            node(`
        const fs=require('node:fs');
        process.once('SIGTERM',async()=>{
          try {const r=await fetch(${JSON.stringify(
            context.url + '/cleanup'
          )});if(!r.ok)throw Error();fs.writeFileSync(${JSON.stringify(
              cleaned
            )},'ok');fs.writeFileSync(${JSON.stringify(
              context.ownerCleanupPath
            )},JSON.stringify({ownersDisposed:true,threadsDeleted:true}));}
          catch {fs.writeFileSync(${JSON.stringify(cleaned)},'failed');}
          process.exit(0);
        });
        fs.writeFileSync(${JSON.stringify(
          ready
        )},'ready');setInterval(()=>{},1000);
      `)
          );
          while (!existsSync(ready))
            await new Promise((yes) => setTimeout(yes, 10));
          controller.abort();
          await running.done;
          return {};
        },
      },
    }),
    /abort/i
  );
  assert.equal(readFileSync(cleaned, 'utf8'), 'ok');
});

for (const behavior of ['failed deletion', 'ignored SIGTERM'] as const) {
  test(`installed owner ${behavior} retains inputs without a cleanup acknowledgement`, async (t) => {
    const temporaryParent = owned(t),
      controller = new AbortController();
    const ready = join(temporaryParent, 'ready'),
      deletion = join(temporaryParent, 'deletion');
    let temporary = '',
      pid = 0;
    await assert.rejects(
      runApprovalProvider({
        root,
        temporaryParent,
        signal: controller.signal,
        operations: {
          ...operations,
          providerCommand: async ({ port }) => server(port, true),
          exercise: async (context) => {
            temporary = context.temporary;
            const running = context.run(
              'installed session',
              node(`
          const fs=require('node:fs');
          process.on('SIGTERM', ${
            behavior === 'ignored SIGTERM'
              ? '()=>{}'
              : `async()=>{
            const r=await fetch(${JSON.stringify(
              context.url + '/threads/owned'
            )},{method:'DELETE'});
            fs.writeFileSync(${JSON.stringify(
              deletion
            )},String(r.status));process.exit(9);
          }`
          });
          fs.writeFileSync(${JSON.stringify(
            ready
          )},'ready');setInterval(()=>{},1000);
        `)
            );
            pid = running.pid;
            while (!existsSync(ready))
              await new Promise((yes) => setTimeout(yes, 10));
            controller.abort();
            await running.done;
            return {};
          },
        },
      }),
      /cleanup failed; temporary files retained/
    );
    assert.equal(existsSync(join(temporary, 'provider/uv.lock')), true);
    assert.throws(() => process.kill(-pid, 0), { code: 'ESRCH' });
    if (behavior === 'failed deletion')
      assert.equal(readFileSync(deletion, 'utf8'), '500');
  });
}

test('the provider target compiles and tests its host before the actual installed proof', () => {
  const project = JSON.parse(
    require('node:fs').readFileSync(
      join(root, 'examples/chat/native/react/project.json'),
      'utf8'
    )
  );
  const target = project.targets['provider-test'];
  assert.equal(target?.cache, false);
  assert.deepEqual(target?.dependsOn, []);
  assert.equal(target?.options.parallel, false);
  assert.deepEqual(target?.options.commands, [
    'node node_modules/typescript/bin/tsc -p examples/chat/native/tooling/tsconfig.approval-provider-host.json',
    'node --import tsx --test examples/chat/native/tooling/approval-provider.spec.ts',
    'node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.base.json examples/chat/native/tooling/approval-provider.ts',
  ]);
});
