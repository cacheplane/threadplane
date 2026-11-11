import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { installCiBrowser, requestedBrowser, unresolvedPackageHosts, PACKAGE_HOSTS } from './install-ci-browser.mjs';

const WITH_DEPS = ['npx', 'playwright', 'install', '--with-deps', 'chromium'];

function harness({ failing = () => false, statuses = {}, launch = true } = {}) {
  const calls = { lookups: [], sleeps: [], runs: [], launches: [], logs: [] };
  const lookupAttempts = new Map();
  return {
    calls,
    options: {
      lookup: async (host) => {
        calls.lookups.push(host);
        const attempt = (lookupAttempts.get(host) ?? 0) + 1;
        lookupAttempts.set(host, attempt);
        if (failing(host, attempt)) throw Object.assign(new Error('EAI_AGAIN'), { code: 'EAI_AGAIN' });
        return { address: '192.0.2.1', family: 4 };
      },
      sleep: async (ms) => { calls.sleeps.push(ms); },
      run: (command) => { calls.runs.push(command.join(' ')); return statuses[command.join(' ')] ?? 0; },
      launches: (browser) => { calls.launches.push(browser); return launch; },
      log: (line) => { calls.logs.push(line); },
    },
  };
}

test('runs the requested install unchanged when both package hosts resolve', async () => {
  const { calls, options } = harness();
  assert.equal(await installCiBrowser(WITH_DEPS, options), 0);
  assert.deepEqual(calls.runs, ['npx playwright install --with-deps chromium']);
  assert.deepEqual(calls.lookups.sort(), [...PACKAGE_HOSTS].sort());
  assert.deepEqual([calls.sleeps, calls.launches, calls.logs], [[], [], []]);
});

test('returns the requested install status without a fallback when the hosts resolve', async () => {
  const { calls, options } = harness({ statuses: { 'npx playwright install --with-deps chromium': 7 } });
  assert.equal(await installCiBrowser(WITH_DEPS, options), 7);
  assert.equal(calls.runs.length, 1);
  assert.deepEqual(calls.launches, []);
});

test('retries only the host that failed and proceeds normally once it resolves', async () => {
  const { calls, options } = harness({ failing: (host, attempt) => host === 'archive.ubuntu.com' && attempt < 3 });
  assert.equal(await installCiBrowser(WITH_DEPS, options), 0);
  assert.deepEqual(calls.lookups, ['archive.ubuntu.com', 'security.ubuntu.com', 'archive.ubuntu.com', 'archive.ubuntu.com']);
  assert.deepEqual(calls.sleeps, [5000, 5000]);
  assert.deepEqual(calls.runs, ['npx playwright install --with-deps chromium']);
  assert.deepEqual(calls.logs, []);
});

test('installs only the browser and proves it launches when a package host never resolves', async () => {
  const { calls, options } = harness({ failing: (host) => host === 'archive.ubuntu.com' });
  assert.equal(await installCiBrowser(WITH_DEPS, options), 0);
  assert.deepEqual(calls.runs, ['npx playwright install chromium']);
  assert.deepEqual(calls.launches, ['chromium']);
  assert.deepEqual(calls.sleeps, [5000, 5000], 'bounded to three attempts');
  assert.equal(calls.logs.length, 1);
  assert.match(calls.logs[0], /^::warning::archive\.ubuntu\.com did not resolve after 3 attempts/);
});

test('fails when the browser cannot launch without its packages', async () => {
  const { calls, options } = harness({ failing: () => true, launch: false });
  assert.equal(await installCiBrowser(['npx', 'playwright', 'install', '--with-deps', 'firefox'], options), 1);
  assert.deepEqual(calls.runs, ['npx playwright install firefox']);
  assert.deepEqual(calls.launches, ['firefox']);
  assert.match(calls.logs[0], /^::warning::archive\.ubuntu\.com and security\.ubuntu\.com did not resolve/);
  assert.match(calls.logs[1], /^::error::firefox did not launch/);
});

test('fails with the download status and never launches when the browser download fails', async () => {
  const { calls, options } = harness({ failing: () => true, statuses: { 'npx playwright install chromium': 3 } });
  assert.equal(await installCiBrowser(WITH_DEPS, options), 3);
  assert.deepEqual(calls.launches, []);
});

test('treats a lookup that never settles as unresolved', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = unresolvedPackageHosts({ lookup: () => new Promise(() => {}), sleep: async () => {} });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise((done) => setImmediate(done));
    t.mock.timers.tick(10000);
    await new Promise((done) => setImmediate(done));
  }
  assert.deepEqual(await pending, PACKAGE_HOSTS);
});

test('accepts only the exact dependency install command', () => {
  assert.equal(requestedBrowser(WITH_DEPS), 'chromium');
  for (const command of [
    [],
    ['npx', 'playwright', 'install', 'chromium'],
    ['npx', 'playwright', 'install', '--with-deps'],
    ['npx', 'playwright', 'install', '--with-deps', 'chrome'],
    ['npx', 'playwright', 'install', '--with-deps', 'chromium', 'firefox'],
    ['npx', 'playwright', 'install', '--with-deps', 'chromium; rm -rf /'],
    ['sh', '-c', 'npx playwright install --with-deps chromium'],
  ]) assert.throws(() => requestedBrowser(command), /Usage:/);
});

test('the CLI rejects another command before any lookup or install', () => {
  const result = spawnSync(process.execPath, ['scripts/install-ci-browser.mjs', 'npx', 'playwright', 'install', 'chromium'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^Usage:/);
  assert.equal(result.stdout, '');
});
