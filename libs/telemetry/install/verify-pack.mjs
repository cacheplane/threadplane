// Run after building the four packages. All installs live in disposable directories.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const execute = promisify(execFile);
const packages = ['chat', 'langgraph', 'ag-ui', 'render'];
const temporary = await mkdtemp(join(tmpdir(), 'threadplane-install-pack-'));
const run = async (command, args, options = {}) =>
  execute(command, args, {
    timeout: 90000,
    maxBuffer: 1024 * 1024,
    ...options,
  });
try {
  const cache = (await run('npm', ['config', 'get', 'cache'])).stdout.trim();
  const preload = join(temporary, 'capture.cjs');
  await writeFile(
    preload,
    `const https=require('node:https'),fs=require('node:fs'),{EventEmitter}=require('node:events');
https.request=(url,options,callback)=>{if(url!=='https://threadplane.ai/api/growth/collect/v1/install')throw Error('Unexpected network in install smoke');
if(options.method!=='POST'||options.headers.authorization||options.headers.cookie)throw Error('Invalid collector request');
const request=new EventEmitter();request.destroy=()=>{};request.end=body=>{fs.appendFileSync(process.env.INSTALL_CAPTURE,body+'\\n');queueMicrotask(()=>callback({statusCode:200,destroy(){}}));};return request;};`
  );
  const tarballs = [],
    versions = new Map();
  for (const name of packages) {
    const dist = resolve('dist/libs', name);
    const pkg = JSON.parse(await readFile(join(dist, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.postinstall, 'node install/postinstall.cjs');
    versions.set(pkg.name, pkg.version);
    const packed = JSON.parse(
      (
        await run('npm', [
          'pack',
          dist,
          '--ignore-scripts',
          '--json',
          '--pack-destination',
          temporary,
        ])
      ).stdout
    )[0];
    const packagedHook = (await run('tar', ['-xOf', join(temporary, packed.filename), 'package/install/postinstall.cjs'])).stdout;
    assert.equal(packagedHook, await readFile(resolve('libs/telemetry/install/postinstall.cjs'), 'utf8'), `${name} must ship the shared real hook`);
    assert.notEqual(packagedHook, await readFile(resolve(`libs/${name}/install/postinstall.cjs`), 'utf8'), `${name} must not ship its contributor stub`);
    if (name === 'chat') {
      for (const subpath of [
        './chat.css',
        './themes/default-dark.css',
        './themes/default-light.css',
        './themes/material-dark.css',
        './themes/material-light.css',
      ]) {
        assert.equal(pkg.exports[subpath], subpath, `Missing CSS export: ${subpath}`);
        assert(packed.files.some((file) => file.path === subpath.slice(2)), `Missing CSS asset: ${subpath}`);
      }
    }
    for (const file of [
      'postinstall',
      'collector',
      'bridge',
      'files',
      'git-context',
      'identity',
      'policy',
    ])
      assert(
        packed.files.some((f) => f.path === `install/${file}.cjs`),
        `${name} missing ${file}`
      );
    assert(
      !packed.files.some(
        (f) => f.path.startsWith('install/') && !f.path.endsWith('.cjs')
      ),
      'Test tools must not ship in install assets'
    );
    tarballs.push(join(temporary, packed.filename));
    assert.deepEqual(pkg.exports['./development-install'], {
      types: './.install-collector/development-install.d.ts',
      default: './.install-collector/development-install.mjs',
    });
    const bridge = (
      await run('tar', [
        '-xOf',
        join(temporary, packed.filename),
        'package/.install-collector/development-install.mjs',
      ])
    ).stdout;
    assert.equal(
      bridge,
      'export const installationToken = null;\n',
      'Published tarballs must never contain an installer token'
    );
    assert(
      packed.files.some(
        (f) => f.path === '.install-collector/development-install.d.ts'
      )
    );
    const readme = (
      await run('tar', [
        '-xOf',
        join(temporary, packed.filename),
        'package/README.md',
      ])
    ).stdout;
    assert(
      readme.includes('Installation collection') &&
        readme.includes('DO_NOT_TRACK=1'),
      `${name} missing install disclosure`
    );
  }
  // npm ci caches lockfile tarballs, but a fresh runner may have no registry
  // metadata for their semver ranges. Resolve dependencies with scripts disabled
  // before the strictly offline, intercepted lifecycle scenarios below.
  const prime = join(temporary, 'dependency-cache');
  await mkdir(prime);
  await writeFile(join(prime, 'package.json'), JSON.stringify({ private: true }));
  await run('npm', [
    'install', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', ...tarballs,
  ], { cwd: prime });
  for (const scenario of ['ci', 'unknown', 'disabled', 'ignore-scripts']) {
    const cwd = join(temporary, scenario),
      home = join(cwd, 'home'),
      capture = join(cwd, 'captured.jsonl');
    await mkdir(join(cwd, '.git'), { recursive: true });
    await mkdir(home);
    await writeFile(
      join(cwd, 'package.json'),
      JSON.stringify({
        name: 'synthetic-consumer',
        version: '1.0.0',
        private: true,
      })
    );
    await writeFile(
      join(cwd, '.git/config'),
      '[user]\nname=Synthetic Developer\nemail=developer@example.invalid\n[remote "origin"]\nurl=https://secret@github.com/synthetic/private-repository.git'
    );
    await writeFile(capture, '');
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      USERPROFILE: home,
      npm_config_cache: cache,
      NODE_OPTIONS: `--require=${preload}`,
      INSTALL_CAPTURE: capture,
      ...(scenario === 'ci' ? { CI: 'true', GITHUB_ACTIONS: 'true' } : {}),
      ...(scenario === 'disabled' ? { DO_NOT_TRACK: '1' } : {}),
    };
    await run(
      'npm',
      [
        'install',
        '--offline',
        '--legacy-peer-deps',
        '--no-audit',
        '--no-fund',
        '--foreground-scripts',
        ...(scenario === 'ignore-scripts' ? ['--ignore-scripts'] : []),
        ...tarballs,
      ],
      { cwd, env }
    );
    const content = await readFile(capture, 'utf8');
    const events = content.trim()
      ? content
          .trim()
          .split('\n')
          .flatMap((line) => JSON.parse(line).events)
      : [];
    for (const name of packages) {
      const module = await readFile(
        join(
          cwd,
          'node_modules/@threadplane',
          name,
          '.install-collector/development-install.mjs'
        ),
        'utf8'
      );
      const token = events.find(
        (e) => e.properties.packageName === `@threadplane/${name}`
      )?.installationToken;
      if (scenario === 'unknown') {
        assert.match(
          token,
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        );
        assert.equal(
          module,
          `export const installationToken = ${JSON.stringify(token)};\n`
        );
      } else {
        assert.equal(token, undefined);
        assert.equal(module, 'export const installationToken = null;\n');
      }
    }
    if (scenario === 'unknown')
      assert.equal(new Set(events.map((e) => e.installationToken)).size, 4);
    if (['disabled', 'ignore-scripts'].includes(scenario)) {
      assert.equal(events.length, 0);
      await assert.rejects(
        readFile(join(home, '.threadplane/installation-id'))
      );
    } else {
      assert.equal(
        events.length,
        4,
        `Expected one event per package in ${scenario}`
      );
      assert.deepEqual(
        new Set(events.map((e) => e.properties.packageName)),
        new Set(versions.keys())
      );
      assert.equal(new Set(events.map((e) => e.subject.id)).size, 1);
      for (const event of events) {
        assert.equal(
          event.properties.packageVersion,
          versions.get(event.properties.packageName)
        );
        assert.equal(
          event.properties.environment,
          scenario === 'ci' ? 'ci' : 'unknown'
        );
        assert.equal(event.properties.consumerContext, 'checkout');
        assert.equal(event.identity.gitEmail, 'developer@example.invalid');
        assert.equal(event.identity.gitConfigOrigin, 'local');
        assert.equal(event.identity.repositoryOwner, 'synthetic');
        assert.equal(event.subject.scope, 'persistent');
        assert(!JSON.stringify(event).includes('secret'));
        assert(!JSON.stringify(event).includes('private-repository'));
      }
    }
    console.log(
      `${scenario}: ${events.length} synthetic install events; checks passed`
    );
    // A copied cache may already contain a token before npm invokes the script.
    const stale = '10000000-0000-4000-8000-000000000001';
    for (const name of packages)
      await writeFile(
        join(
          cwd,
          'node_modules/@threadplane',
          name,
          '.install-collector/development-install.mjs'
        ),
        `export const installationToken = "${stale}";\n`
      );
    await writeFile(capture, '');
    await run(
      'npm',
      [
        'rebuild',
        '--offline',
        '--foreground-scripts',
        ...(scenario === 'ignore-scripts' ? ['--ignore-scripts'] : []),
      ],
      { cwd, env }
    );
    const replayed = (await readFile(capture, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => JSON.parse(line).events);
    for (const name of packages) {
      const module = await readFile(
        join(
          cwd,
          'node_modules/@threadplane',
          name,
          '.install-collector/development-install.mjs'
        ),
        'utf8'
      );
      const token = replayed.find(
        (e) => e.properties.packageName === `@threadplane/${name}`
      )?.installationToken;
      if (scenario === 'ignore-scripts')
        assert.equal(module, `export const installationToken = "${stale}";\n`);
      else if (scenario === 'unknown') {
        assert(token && token !== stale);
        assert.equal(module, `export const installationToken = "${token}";\n`);
      } else {
        assert.equal(module, 'export const installationToken = null;\n');
        assert.equal(token, undefined);
      }
    }
  }
  console.log(
    'All four packed artifacts passed clean npm installation checks.'
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
