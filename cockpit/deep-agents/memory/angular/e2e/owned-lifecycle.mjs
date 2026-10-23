import { execFileSync } from 'node:child_process';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function processes(groupId) {
  return execFileSync('ps', ['-eo', 'pid=,ppid=,pgid=,stat=,lstart='], { encoding: 'utf8', timeout: 1000, maxBuffer: 1024 * 1024 }).split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    return match && Number(match[3]) === groupId && !match[4].startsWith('Z')
      ? [{ pid: Number(match[1]), parent: Number(match[2]), identity: match[1] + ':' + match[5] }]
      : [];
  });
}
/** A lease for this freshly spawned detached group, never an arbitrary PGID.
 * Observed process birth identities maintain ownership after leader exit.
 * Once empty, ownership is permanently revoked to prevent PGID reuse kills.
 * Unknown replacement membership fails closed instead of signalling it. */
export function createOwnedProcessGroup(child, { graceMs = 1000, killMs = 1500 } = {}) {
  const groupId = child.pid;
  if (!Number.isInteger(groupId) || groupId <= 0) throw Error('Missing owned process group');
  const initial = processes(groupId);
  if (!initial.some(member => member.pid === groupId && member.parent === process.pid)) throw Error('Fresh detached child ownership not established');
  const known = new Map(initial.map(member => [member.pid, member.identity]));
  let current = initial, active = true, closing, scanError;
  const ended = new Promise(resolve => child.once('close', resolve));
  const signals = [];
  function refresh() {
    if (!active) return [];
    const found = processes(groupId);
    if (!found.length) { current = []; active = false; return []; }
    if (!found.some(member => known.get(member.pid) === member.identity)) {
      active = false;
      throw Error('Owned process group identity changed; signalling refused');
    }
    for (const member of found) known.set(member.pid, member.identity);
    current = found;
    return found;
  }
  const monitor = setInterval(() => { try { refresh(); } catch (error) { scanError = error; } }, 25);
  monitor.unref();
  async function waitForGroup(timeout) {
    const deadline = Date.now() + timeout;
    while (refresh().length) {
      if (Date.now() >= deadline) return false;
      await pause(25);
    }
    return true;
  }
  function signal(value) {
    if (!refresh().length) return;
    try { process.kill(-groupId, value); signals.push(value); }
    catch (error) { if (error.code !== 'ESRCH') throw error; refresh(); }
  }
  return Object.freeze({
    members: () => refresh().map(member => member.pid),
    close() {
      return closing ??= (async () => {
        clearInterval(monitor);
        if (scanError) throw scanError;
        signal('SIGTERM');
        if (!await waitForGroup(graceMs)) {
          signal('SIGKILL');
          if (!await waitForGroup(killMs)) throw Error('Owned process group did not terminate within bounds');
        }
        await ended;
        return { groupId, ownedPids: [...known.keys()], signals, remainingPids: current.map(member => member.pid), leaderExitCode: child.exitCode, leaderSignalCode: child.signalCode };
      })();
    },
  });
}
/** Every owned resource gets a close attempt even if another close rejects. */
export async function settleOwnedCleanup(tasks) {
  const results = await Promise.allSettled(tasks.map(async close => close()));
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (failures.length) throw new AggregateError(failures, 'Owned Memory resources could not all close');
}
