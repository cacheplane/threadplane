/** Reproducible private packed-consumer proof; build core before running. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants,
  closeSync,
  copyFileSync,
  fstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  emitCandidate,
  packCandidate,
  installCandidateConsumer,
} from '../react-parity/langgraph-candidate-package.mjs';
import { packLocalArtifacts } from '../react-parity/verify-packages.mjs';

/** Only an exclusive, regular file at the harness-owned exact path is data.
 * TAP stdout remains bounded diagnostics and never carries authority. */
export function readNativeReceipt(consumer, path) {
  assert.equal(
    path,
    join(realpathSync(consumer), 'debug-native-receipt.json'),
    'Unexpected receipt path'
  );
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    assert.ok(
      stat.isFile() && stat.size > 0 && stat.size <= 262144,
      'Receipt regular-file bound'
    );
    const captured = Buffer.alloc(262145);
    let length = 0;
    while (length < captured.length) {
      const n = readSync(
        descriptor,
        captured,
        length,
        captured.length - length,
        null
      );
      if (!n) break;
      length += n;
    }
    assert.ok(length <= 262144, 'Receipt byte bound');
    assert.equal(length, stat.size, 'Receipt changed during read');
    assert.equal(
      fstatSync(descriptor).size,
      length,
      'Receipt changed during read'
    );
    const bytes = captured.subarray(0, length);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      value = JSON.parse(text);
    assert.equal(
      text,
      JSON.stringify(value) + '\n',
      'Canonical complete JSON required'
    );
    return {
      value,
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } finally {
    closeSync(descriptor);
  }
}

export function readAcquisitionJournal(consumer, path, sourceHash) {
  assert.equal(
    path,
    join(realpathSync(consumer), 'debug-native-acquisitions.jsonl')
  );
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    assert.ok(stat.isFile() && stat.size <= 4096, 'Acquisition journal bound');
    const buffer = Buffer.alloc(4097);
    let length = 0,
      n;
    while (
      length < buffer.length &&
      (n = readSync(fd, buffer, length, buffer.length - length, null))
    )
      length += n;
    assert.equal(length, stat.size);
    assert.ok(length <= 4096);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      buffer.subarray(0, length)
    );
    if (!text) return [];
    assert.ok(text.endsWith('\n'));
    const rows = text
      .slice(0, -1)
      .split('\n')
      .map((line) => {
        const row = JSON.parse(line);
        assert.equal(line, JSON.stringify(row));
        assert.equal(Object.keys(row).sort().join(), 'pgid,pid,sourceHash');
        assert.equal(row.sourceHash, sourceHash);
        assert.ok(
          Number.isSafeInteger(row.pid) &&
            row.pid > 1 &&
            row.pid < 2147483648 &&
            row.pgid === row.pid
        );
        return row;
      });
    assert.ok(
      rows.length <= 4 && new Set(rows.map((r) => r.pid)).size === rows.length
    );
    return rows;
  } finally {
    closeSync(fd);
  }
}

async function drainAcquiredWorkers(acquisitions) {
  const receipts = [];
  const absent = (id) => {
    try {
      process.kill(id, 0);
      return false;
    } catch (error) {
      if (error.code === 'ESRCH') return true;
      throw error;
    }
  };
  for (const row of acquisitions) {
    const receipt = { ...row, signals: [], absent: false };
    receipts.push(receipt);
    const gone = () => absent(row.pid) && absent(-row.pgid);
    if (!gone()) {
      for (const signal of ['SIGTERM', 'SIGKILL']) {
        try {
          process.kill(-row.pgid, signal);
          receipt.signals.push(signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
        const deadline = Date.now() + (signal === 'SIGTERM' ? 250 : 2000);
        while (!gone() && Date.now() < deadline) await delay(5);
        if (gone()) break;
      }
    }
    assert.ok(gone(), 'Owned detached worker PID/group must be absent');
    receipt.absent = true;
  }
  return receipts;
}

export async function runNativeProbe({ failureLifetimeProof = false } = {}) {
  const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
  const node = realpathSync(process.execPath);
  assert.equal(
    process.versions.node.split('.')[0],
    '22',
    'Run the locked Node22 toolchain'
  );
  const environment = {
    PATH: `${dirname(node)}:/usr/bin:/bin`,
    LANG: 'en_US.UTF-8',
    HOME: process.env.HOME,
    COREPACK_ENABLE_AUTO_PIN: '0',
    NX_DAEMON: 'false',
    NX_ISOLATE_PLUGINS: 'false',
    LANGSMITH_TRACING: 'false',
    LANGCHAIN_TRACING_V2: 'false',
    PYTHONDONTWRITEBYTECODE: '1',
  };
  // Existing installation helper inherits this process environment. Remove token,
  // key, NODE_OPTIONS and other ambient knobs before invoking npm or consumers.
  process.env = { ...environment };
  const temporary = realpathSync(
    mkdtempSync(join(tmpdir(), 'threadplane-debug-native-'))
  );
  const candidate = join(temporary, 'candidate'),
    consumer = join(temporary, 'consumer');
  mkdirSync(candidate);
  mkdirSync(consumer);
  const sha = (path) =>
    createHash('sha256').update(readFileSync(path)).digest('hex');
  const evidence = realpathSync(
    mkdtempSync(join(tmpdir(), 'threadplane-react-debug-native-evidence-'))
  );
  const privatePrefix = join(evidence, 'probe');
  let childReceipt,
    safelyClosed = true;
  const report = { temporary, candidate, consumer, node, root, evidence };

  async function run() {
    const fixture = realpathSync(
      join(root, 'scripts/react-cockpit/chat-debug-fixture.mjs')
    );
    const source = join(
      root,
      'fixtures/react-parity/langgraph-candidate/chat-debug-native-session.mjs'
    );
    copyFileSync(source, join(consumer, 'chat-debug-native-session.mjs'));
    const journal = join(consumer, 'debug-native-acquisitions.jsonl');
    writeFileSync(journal, '', { flag: 'wx', mode: 0o600 });
    const child = spawn(
      node,
      ['--test', '--test-concurrency=1', 'chat-debug-native-session.mjs'],
      {
        cwd: consumer,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...environment,
          DEBUG_FIXTURE_MODULE_URL: pathToFileURL(fixture).href,
          DEBUG_NATIVE_RECEIPT_PATH: join(
            consumer,
            'debug-native-receipt.json'
          ),
          DEBUG_NATIVE_ACQUISITIONS_PATH: journal,
          ...(failureLifetimeProof
            ? { DEBUG_NATIVE_PROBE_FAULT: 'exit-after-worker-acquired' }
            : {}),
        },
      }
    );
    childReceipt = {
      pid: child.pid ?? null,
      pgid: child.pid ?? null,
      reaped: false,
      exitCode: null,
      signal: null,
      stdoutBytes: 0,
      stderrBytes: 0,
      signals: [],
    };
    safelyClosed = false;
    let stdout = '',
      stderr = '',
      failure,
      killTimer;
    const terminate = (reason) => {
      failure ??= reason;
      if (childReceipt.pid && !childReceipt.reaped) {
        try {
          process.kill(-childReceipt.pgid, 'SIGTERM');
          childReceipt.signals.push('SIGTERM');
        } catch (error) {
          if (error.code !== 'ESRCH') failure = error;
        }
        killTimer ??= setTimeout(() => {
          try {
            process.kill(-childReceipt.pgid, 'SIGKILL');
            childReceipt.signals.push('SIGKILL');
          } catch (error) {
            if (error.code !== 'ESRCH') failure = error;
          }
        }, 250);
      }
    };
    await new Promise((resolve) => {
      // Synchronous ownership before any promise yield.
      child.once('error', () => {
        failure = Error('Native consumer spawn failed');
      });
      child.stdout.on('data', (bytes) => {
        childReceipt.stdoutBytes += bytes.length;
        if (childReceipt.stdoutBytes > 512 * 1024)
          terminate(Error('Native stdout bound'));
        else stdout += bytes;
      });
      child.stderr.on('data', (bytes) => {
        childReceipt.stderrBytes += bytes.length;
        if (childReceipt.stderrBytes > 256 * 1024)
          terminate(Error('Native stderr bound'));
        else stderr += bytes;
      });
      const timer = setTimeout(
        () => terminate(Error('Native consumer 60s deadline')),
        60000
      );
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        Object.assign(childReceipt, { reaped: true, exitCode: code, signal });
        resolve();
      });
    });
    writeFileSync(privatePrefix + '.stdout.log', stdout);
    writeFileSync(privatePrefix + '.stderr.log', stderr);
    report.acquisitions = readAcquisitionJournal(
      consumer,
      journal,
      sha(fixture)
    );
    writeFileSync(
      privatePrefix + '.acquisitions.jsonl',
      readFileSync(journal),
      { flag: 'wx', mode: 0o600 }
    );
    report.knownWorkerCleanup = await drainAcquiredWorkers(report.acquisitions);
    if (childReceipt.pid)
      for (const pid of [childReceipt.pid, -childReceipt.pgid])
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    if (failureLifetimeProof) {
      assert.equal(
        childReceipt.exitCode,
        1,
        'Node test runner reports the intentionally failed test worker'
      );
      assert.match(
        stdout,
        /exitCode: 7/,
        'Actual native test worker exits after owned Python acquisition'
      );
      assert.equal(report.acquisitions.length, 1);
      assert.ok(report.knownWorkerCleanup[0].signals.length > 0);
      report.failureLifetimeProven = true;
      safelyClosed = true;
      return;
    }
    try {
      const receipt = readNativeReceipt(
        consumer,
        join(consumer, 'debug-native-receipt.json')
      );
      writeFileSync(privatePrefix + '.native.json', receipt.bytes, {
        flag: 'wx',
        mode: 0o600,
      });
      report.native = receipt.value;
      report.nativeReceiptSha256 = receipt.sha256;
    } catch (error) {
      failure ??= error;
    }
    const cleanup = report.native?.cleanup;
    const cleanups = [
      cleanup,
      report.native?.unicodeCleanup,
      report.native?.projectionCleanup,
    ];
    const complete =
      childReceipt.reaped &&
      childReceipt.exitCode === 0 &&
      cleanups.every(
        (c) =>
          c &&
          Object.values(c.active).every((n) => n === 0) &&
          c.children.every((child) => child.reaped)
      );
    for (const cleanup of cleanups)
      for (const child of cleanup?.children ?? []) {
        if (child.pid)
          for (const pid of [child.pid, -child.pgid])
            assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      }
    if (childReceipt.pid)
      for (const pid of [childReceipt.pid, -childReceipt.pgid])
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    if (failure) throw failure;
    assert.equal(childReceipt.exitCode, 0, stdout + '\n' + stderr);
    assert.ok(
      complete,
      'Native consumer must provide complete teardown receipt'
    );
    assert.deepEqual(
      report.acquisitions.map((c) => c.pid).sort(),
      cleanups.flatMap((c) => c.children.map((child) => child.pid)).sort(),
      'Journal and cleanup must name exactly the same acquired worker owners'
    );
    assert.equal(report.native.turns.length, 2);
    safelyClosed = true;
  }
  try {
    report.emitted = emitCandidate(root, candidate);
    report.packed = packCandidate(candidate, temporary);
    const tarballs = packLocalArtifacts(root, temporary, ['core']);
    tarballs['@threadplane/langgraph'] = 'file:' + report.packed.tarball;
    report.tarballs = Object.fromEntries(
      Object.entries(tarballs).map(([name, url]) => [
        name,
        { url, sha256: sha(url.slice(5)) },
      ])
    );
    report.installed = installCandidateConsumer(
      consumer,
      { private: true, type: 'module' },
      tarballs,
      JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')),
      'node'
    );
    await run();
    console.log(
      (failureLifetimeProof
        ? 'Installed consumer failure lifetime proof'
        : 'Installed native Debug gate: two submits, two loads, exact checkpoints and cleanup verified') +
        '. Evidence: ' +
        evidence
    );
  } finally {
    report.child = childReceipt;
    report.safelyClosed = Boolean(safelyClosed);
    report.sourceManifest = Object.fromEntries(
      [
        'cockpit/chat/debug/python/src/graph.py',
        'cockpit/chat/debug/python/tests/providers.py',
        'cockpit/chat/debug/python/tests/test_streaming.py',
        'cockpit/chat/debug/python/uv.lock',
        'scripts/react-cockpit/chat-debug-wire.py',
        'scripts/react-cockpit/chat-debug-fixture.mjs',
        'scripts/react-cockpit/chat-debug-fixture.spec.mjs',
        'scripts/react-cockpit/chat-debug-native-session-probe.mjs',
        'fixtures/react-parity/langgraph-candidate/chat-debug-native-session.mjs',
      ].map((path) => [path, sha(join(root, path))])
    );
    writeFileSync(
      privatePrefix + '.json',
      JSON.stringify(report, null, 2) + '\n'
    );
    if (safelyClosed) rmSync(temporary, { recursive: true, force: true });
    else
      console.error(
        'Owned consumer retained pending verified cleanup: ' + temporary
      );
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert.ok(
    process.argv.slice(2).length === 0 ||
      process.argv.slice(2).join() === '--failure-lifetime-proof',
    'Unknown probe option'
  );
  await runNativeProbe({
    failureLifetimeProof: process.argv[2] === '--failure-lifetime-proof',
  });
}
