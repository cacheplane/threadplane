import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { configureCiApt, validateEffectiveAptConfig } from './configure-ci-apt.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ci-apt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'sources.list.d'));
  await mkdir(join(root, 'apt.conf.d'));
  return root;
}

test('leaves every package source as the runner image ships it and writes only the download limits', async (t) => {
  const root = await fixture(t);
  const files = {
    'apt-mirrors.txt': 'http://azure.archive.ubuntu.com/ubuntu/ priority:1\nhttps://archive.ubuntu.com/ubuntu/ priority:2\nhttps://security.ubuntu.com/ubuntu/ priority:3\n',
    'apt-mirrors-security.txt': 'http://security.ubuntu.com/ubuntu/ priority:2\n',
    'sources.list': 'deb [arch=amd64 signed-by=/key.gpg] http://azure.archive.ubuntu.com/ubuntu noble main\n',
    'sources.list.d/ubuntu.sources': 'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n',
    'sources.list.d/custom.list': 'deb http://custom.example/ubuntu noble main\n',
    'apt.conf.d/99custom': 'Acquire::Retries "5";\n',
    'apt.conf': 'APT::Get::Assume-Yes "false";\n',
  };
  for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content);
  await chmod(join(root, 'sources.list'), 0o640);
  await configureCiApt(root);
  // The Azure mirror stays first with the public archive behind it, so neither host is a single point of failure.
  for (const [path, content] of Object.entries(files)) assert.equal(await readFile(join(root, path), 'utf8'), content);
  assert.equal((await stat(join(root, 'sources.list'))).mode & 0o777, 0o640);
  const config = await readFile(join(root, 'apt.conf.d/zz-threadplane-ci-downloads'), 'utf8');
  assert.equal(config, 'Acquire::Retries "2";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n');
  assert.equal((await stat(join(root, 'apt.conf.d/zz-threadplane-ci-downloads'))).mode & 0o777, 0o644);
  await configureCiApt(root);
  assert.equal(await readFile(join(root, 'apt.conf.d/zz-threadplane-ci-downloads'), 'utf8'), config);
});

test('creates the configuration directory when missing and surfaces filesystem errors', async (t) => {
  const root = await fixture(t);
  await rm(join(root, 'apt.conf.d'), { recursive: true });
  await configureCiApt(root);
  assert.match(await readFile(join(root, 'apt.conf.d/zz-threadplane-ci-downloads'), 'utf8'), /Timeout "30"/);
  await rm(join(root, 'apt.conf.d'), { recursive: true });
  await writeFile(join(root, 'apt.conf.d'), 'not a directory');
  await assert.rejects(configureCiApt(root));
});

test('effective settings validation accepts only the bounded values without printing configuration', () => {
  validateEffectiveAptConfig("CI_RETRIES='2'\nCI_HTTP_TIMEOUT='30'\nCI_HTTPS_TIMEOUT='30'\n");
  for (const output of ['', "CI_RETRIES='5'\nCI_HTTP_TIMEOUT='30'\nCI_HTTPS_TIMEOUT='30'\n", "CI_RETRIES='2'\nCI_HTTP_TIMEOUT='30'\n"]) assert.throws(() => validateEffectiveAptConfig(output), /effective APT download limits/);
});

test('CLI rejects arbitrary filesystem overrides before accessing APT', () => {
  const result = spawnSync(process.execPath, ['scripts/configure-ci-apt.mjs', '/tmp/not-the-system-apt'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /accepts no arguments/);
  assert.equal(result.stdout, '');
});

test('failed validation reports only selected bounded integers or safe markers', () => {
  assert.throws(() => validateEffectiveAptConfig("CI_RETRIES='5'\nCI_HTTP_TIMEOUT='30'\n"), /retries=5, http=30, https=missing/);
  const credential = 'https://user:never-print-this@proxy.example';
  assert.throws(() => validateEffectiveAptConfig(`CI_RETRIES='2'\nCI_HTTP_TIMEOUT='${credential}'\nCI_HTTPS_TIMEOUT='30'\n`), (error) => {
    assert.match(error.message, /retries=2, http=nonnumeric, https=30/);
    assert.ok(!error.message.includes(credential));
    return true;
  });
});

test('actual Linux APT parser applies limits after the hosted Ubuntu runner zz-retries file', { skip: process.platform !== 'linux' }, async (t) => {
  const root = await fixture(t);
  // Pinned ubuntu24/20261012.334 configure-apt.sh writes this late override.
  await writeFile(join(root, 'apt.conf.d/zz-retries'), 'Acquire::Retries "1";\nAcquire::http::Timeout "15";\nAcquire::https::Timeout "15";\n');
  const bootstrap = join(root, 'bootstrap.conf');
  await writeFile(bootstrap, `Dir::Etc::parts "${root}/apt.conf.d";\nDir::Etc::main "${root}/apt.conf";\n`);
  await configureCiApt(root);
  const result = spawnSync('apt-config', ['shell', 'CI_RETRIES', 'Acquire::Retries', 'CI_HTTP_TIMEOUT', 'Acquire::http::Timeout', 'CI_HTTPS_TIMEOUT', 'Acquire::https::Timeout'], { encoding: 'utf8', env: { PATH: process.env.PATH, APT_CONFIG: bootstrap } });
  assert.equal(result.status, 0, 'actual APT parser must be available on Linux CI');
  validateEffectiveAptConfig(result.stdout);
  assert.equal(await readFile(join(root, 'apt.conf.d/zz-retries'), 'utf8'), 'Acquire::Retries "1";\nAcquire::http::Timeout "15";\nAcquire::https::Timeout "15";\n');
});
