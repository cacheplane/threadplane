import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync, openSync, closeSync, fstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOwnedProcessGroup, settleOwnedCleanup } from './owned-lifecycle.mjs';
const captures = mkdtempSync(join(tmpdir(), 'threadplane-memory-task4b-v2-lifecycle-'));
console.log('Memory lifecycle captures: ' + captures);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 3000) {
  const end = Date.now() + timeout;
  while (!check()) { if (Date.now() > end) throw Error('Owned process condition timed out'); await sleep(20); }
}
function group(pid) {
  try { return Number(execFileSync('ps', ['-p', String(pid), '-o', 'pgid='], { encoding: 'utf8' }).trim()); } catch { return undefined; }
}
async function bindable(port) {
  const listener = createServer();
  try { listener.listen(port, '127.0.0.1'); await once(listener, 'listening'); await new Promise(resolve => listener.close(resolve)); return true; } catch { listener.close(); return false; }
}
async function owned(t, stubborn = false) {
  const descendant = `const net=require('node:net');${stubborn ? "process.on('SIGTERM',()=>{});" : ''}const server=net.createServer();server.listen(0,'127.0.0.1',()=>process.send({pid:process.pid,port:server.address().port}));`;
  const leader = spawn(process.execPath, ['-e', `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','ignore','ignore','ipc']});child.once('message',value=>process.send(value));process.on('message',()=>{child.disconnect();child.unref();process.disconnect();process.exit(1);});`], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exited = once(leader, 'exit');
  const [member] = await once(leader, 'message');
  assert.equal(group(member.pid), leader.pid);
  t.after(async () => {
    // Only this freshly spawned, observed group's descendant can authorize
    // fallback cleanup when a regression deliberately leaves it alive.
    if (group(member.pid) === leader.pid) { try { process.kill(-leader.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    if (leader.exitCode === null && leader.signalCode === null) leader.kill('SIGKILL');
    await exited;
    await until(() => group(member.pid) === undefined);
    assert.equal(await bindable(member.port), true);
  });
  return { leader, exited, member };
}
test('cleanup terminates an owned surviving descendant after its detached leader exits', async t => {
  const f = await owned(t);
  const lease = createOwnedProcessGroup(f.leader, { graceMs: 100, killMs: 1000 });
  await until(() => lease.members().includes(f.member.pid));
  f.leader.send('exit'); await f.exited;
  assert.equal(f.leader.exitCode, 1);
  assert.equal(group(f.member.pid), f.leader.pid);
  const closure = await lease.close();
  const receipt = { leaderPid: f.leader.pid, descendantPid: f.member.pid, port: f.member.port, leaderExitCode: f.leader.exitCode, descendantGroupAfterCleanup: group(f.member.pid) ?? null, listenerBindable: await bindable(f.member.port), closure };
  writeFileSync(join(captures, 'exited-leader.json'), JSON.stringify(receipt, null, 2));
  assert.equal(receipt.descendantGroupAfterCleanup, null);
  assert.equal(receipt.listenerBindable, true);
});
test('running leader cleanup escalates only its SIGTERM-ignoring descendant and is idempotent', async t => {
  const f = await owned(t, true);
  const lease = createOwnedProcessGroup(f.leader, { graceMs: 100, killMs: 1000 });
  const first = lease.close(); assert.equal(lease.close(), first);
  const closure = await first;
  assert.deepEqual(closure.signals, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(closure.remainingPids, []);
  assert.equal(group(f.member.pid), undefined);
  assert.equal(await bindable(f.member.port), true);
  writeFileSync(join(captures, 'running-leader-stubborn-descendant.json'), JSON.stringify({ leaderPid: f.leader.pid, descendantPid: f.member.pid, port: f.member.port, closure, listenerBindable: true }, null, 2));
});
test('resource close failure still closes the real owned group, backend listener and descriptor', async t => {
  const f = await owned(t);
  const lease = createOwnedProcessGroup(f.leader, { graceMs: 100, killMs: 1000 });
  const backend = createServer(); backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  const port = backend.address().port;
  const descriptor = openSync(join(captures, 'owned-log.txt'), 'w');
  t.after(() => { backend.close(); try { closeSync(descriptor); } catch { /* verified closed */ } });
  await assert.rejects(settleOwnedCleanup([
    async () => { throw Error('Controlled first resource close failure'); },
    () => new Promise(resolve => backend.close(resolve)),
    () => lease.close(),
    () => closeSync(descriptor),
  ]), AggregateError);
  assert.equal(group(f.member.pid), undefined);
  assert.equal(await bindable(port), true);
  assert.equal(await bindable(f.member.port), true);
  assert.throws(() => fstatSync(descriptor), { code: 'EBADF' });
  writeFileSync(join(captures, 'all-owned-resources-attempted.json'), JSON.stringify({ leaderPid: f.leader.pid, descendantPid: f.member.pid, descendantPort: f.member.port, backendPort: port, descendantAbsent: true, bothPortsBindable: true, descriptorClosed: true }, null, 2));
});
