import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the actual CLI without accessing a registry or installing packages.
async function fixture(t, version) {
  const root = await mkdtemp(join(tmpdir(), 'threadplane-toolchain-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const target = join(root, 'consumer');
  const log = join(root, 'npm-calls');
  await mkdir(bin);
  await mkdir(target);
  await writeFile(join(target, 'keep.txt'), 'existing consumer');
  await writeFile(join(bin, 'npm'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$SMOKE_NPM_LOG"\ncase "$1" in\n  --version) printf '%s\\n' "$SMOKE_NPM_VERSION" ;;\n  view) printf '1.0.0\\n' ;;\n  install) exit 42 ;;\n  *) exit 43 ;;\nesac\n`, { mode: 0o755 });
  return {
    target, log,
    async chooseInstall(answer, timeout = 5000) {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
          fileURLToPath(new URL('./cli.mjs', import.meta.url)),
          '--fresh', '--target', target, '--version', '1.0.0', '--no-start',
        ], {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SMOKE_NPM_VERSION: version, SMOKE_NPM_LOG: log },
        });
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, timeout);
        let stdout = '';
        let stderr = '';
        let targetAnswered = false;
        let installAnswered = false;
        child.stdout.on('data', (chunk) => {
          stdout += chunk;
          if (!targetAnswered && stdout.includes('Target directory:')) {
            targetAnswered = true;
            child.stdin.write('\n');
          }
          if (answer !== undefined && !installAnswered && stdout.includes('Run `npm install` now?')) {
            installAnswered = true;
            child.stdin.write(`${answer}\n`);
          }
        });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on('close', (status) => {
          clearTimeout(timer);
          if (timedOut) reject(new Error('Interactive smoke CLI timed out and closed'));
          else resolve({ status, stderr });
        });
      });
    },
    run: (install) => spawnSync(process.execPath, [
      fileURLToPath(new URL('./cli.mjs', import.meta.url)),
      '--non-interactive', '--fresh', '--target', target,
      '--version', '1.0.0', '--no-start', install,
    ], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SMOKE_NPM_VERSION: version, SMOKE_NPM_LOG: log },
    }),
  };
}

for (const version of ['10.9.8', '11.6.1']) {
  test(`refuses npm ${version} before deleting a fresh target`, async (t) => {
    const f = await fixture(t, version);
    const result = f.run('--install');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires npm 11\.6\.0/);
    assert.match(result.stderr, /npm exec --yes --package=npm@11\.6\.0 -- node examples\/chat\/smoke\/cli\.mjs/);
    assert.equal(await readFile(join(f.target, 'keep.txt'), 'utf8'), 'existing consumer');
    assert.equal(await readFile(f.log, 'utf8'), '--version\n');
  });
}

test('accepts exactly npm 11.6.0 and reaches the normal install', async (t) => {
  const f = await fixture(t, '11.6.0');
  const result = f.run('--install');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm exited 42/);
  assert.match(await readFile(f.log, 'utf8'), /\ninstall\n$/);
  assert.equal(JSON.parse(await readFile(join(f.target, 'package.json'), 'utf8')).packageManager, 'npm@11.6.0');
});

test('allows generation without installation using older npm', async (t) => {
  const f = await fixture(t, '10.9.8');
  const result = f.run('--no-install');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(await readFile(f.log, 'utf8'), /(^|\n)install\n/);
  assert.equal(JSON.parse(await readFile(join(f.target, 'package.json'), 'utf8')).packageManager, 'npm@11.6.0');
});

test('template, CI, local verification and instructions agree on scoped npm version', async () => {
  const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
  assert.equal(JSON.parse(await read('./template/package.json')).packageManager, 'npm@11.6.0');
  const workflow = await read('../../../.github/workflows/ci.yml');
  const job = workflow.match(/^  angular-compatibility:\n[\s\S]*?(?=^  [\w-]+:|$(?![\s\S]))/m)[0];
  assert.match(job, /- run: npm ci/);
  assert.match(job, /npm exec --yes --package=npm@11\.6\.0 -- node examples\/chat\/smoke\/cli\.mjs/);
  const project = JSON.parse(await read('./project.json'));
  assert.match(project.targets['verify-local'].options.command, /^npm exec --yes --package=npm@11\.6\.0 -- node cli\.mjs /);
  for (const path of ['./README.md', './CHECKLIST.md']) {
    assert.match(await read(path), /npm 11\.6\.0/);
  }
});

for (const answer of ['Y', 'n']) {
  test(`interactive installation choice ${answer} applies the npm guard before target changes`, { timeout: 10000 }, async (t) => {
    const f = await fixture(t, '10.9.8');
    const result = await f.chooseInstall(answer);
    if (answer === 'Y') {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /requires npm 11\.6\.0/);
      assert.equal(await readFile(join(f.target, 'keep.txt'), 'utf8'), 'existing consumer');
      assert.equal(await readFile(f.log, 'utf8'), '--version\n');
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(await readFile(f.log, 'utf8'), /(^|\n)install\n/);
    }
  });
}

test('reaps an interactive child that stops answering prompts', { timeout: 10000 }, async (t) => {
  const f = await fixture(t, '10.9.8');
  await assert.rejects(f.chooseInstall(undefined, 500), /timed out and closed/);
  assert.equal(await readFile(join(f.target, 'keep.txt'), 'utf8'), 'existing consumer');
});
