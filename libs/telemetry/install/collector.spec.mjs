import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  symlink,
  chmod,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
const execute = promisify(execFile),
  require = createRequire(import.meta.url);
const { installationIdentity } = require('./identity.cjs');
const { collectInstall, sendBatch } = require('./collector.cjs');

describe('install collector', () => {
  it('makes one credential-free request and destroys a stalled transport at its deadline', async () => {
    const request = new EventEmitter();
    request.destroy = vi.fn();
    request.end = vi.fn();
    const transport = vi
      .spyOn(require('node:https'), 'request')
      .mockReturnValue(request);
    try {
      await sendBatch({ schemaVersion: 1, events: [] }, { timeoutMs: 20 });
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport.mock.calls[0][0]).toBe(
        'https://threadplane.ai/api/growth/collect/v1/install'
      );
      expect(transport.mock.calls[0][1].headers).toEqual({
        'content-type': 'application/json',
        'content-length': 31,
      });
      expect(request.destroy).toHaveBeenCalledOnce();
    } finally {
      transport.mockRestore();
    }
  });
  let root, home, packageRoot;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'install-collector-'));
    home = join(root, 'home');
    packageRoot = join(root, 'package');
    await mkdir(home);
    await mkdir(packageRoot);
    await writeFile(
      join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@threadplane/angular', version: '0.0.65' })
    );
  });
  afterEach(async () => rm(root, { recursive: true, force: true }));
  it('publishes one complete identifier across concurrent writers and leaves no temporary files', async () => {
    const values = await Promise.all(
      Array.from({ length: 12 }, () => installationIdentity(home))
    );
    expect(new Set(values.map((v) => v.id)).size).toBe(1);
    expect(values.every((v) => v.scope === 'persistent')).toBe(true);
    expect(await readdir(join(home, '.threadplane'))).toEqual([
      'installation-id',
    ]);
    expect((await installationIdentity(home)).id).toBe(values[0].id);
  });
  it('falls back without replacing corrupt, unwritable or symlink identity state', async () => {
    await mkdir(join(home, '.threadplane'));
    await writeFile(join(home, '.threadplane/installation-id'), 'invalid');
    expect((await installationIdentity(home)).scope).toBe('memory');
    expect(
      await readFile(join(home, '.threadplane/installation-id'), 'utf8')
    ).toBe('invalid');
    const file = join(root, 'not-directory');
    await writeFile(file, 'keep');
    expect((await installationIdentity(file)).scope).toBe('memory');
    await rm(join(home, '.threadplane/installation-id'));
    await symlink(file, join(home, '.threadplane/installation-id'));
    expect((await installationIdentity(home)).scope).toBe('memory');
    expect(await readFile(file, 'utf8')).toBe('keep');
  });
  it('does not read identity, home or metadata and does not send when disabled', async () => {
    const fail = vi.fn(() => {
      throw new Error('must not run');
    });
    await collectInstall({
      packageRoot,
      env: { DO_NOT_TRACK: '1' },
      getHome: fail,
      readPackage: fail,
      identify: fail,
      discover: fail,
      send: fail,
    });
    expect(fail).not.toHaveBeenCalled();
  });
  it('registers a fresh package-local bridge before sending, without identity in its module', async () => {
    const sources = [];
    const send = vi.fn(async () => {
      sources.push(
        await readFile(
          join(packageRoot, '.install-collector/development-install.mjs'),
          'utf8'
        )
      );
    });
    await collectInstall({ packageRoot, env: {}, getHome: () => home, send });
    await collectInstall({ packageRoot, env: {}, getHome: () => home, send });
    expect(send).toHaveBeenCalledTimes(2);
    for (const [index, [batch]] of send.mock.calls.entries()) {
      const event = batch.events[0];
      expect(event.installationToken).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      const source = sources[index];
      expect(source).toBe(
        `export const installationToken = ${JSON.stringify(
          event.installationToken
        )};\n`
      );
      expect(source).not.toContain(event.subject.id);
      expect(source).not.toMatch(/email|Developer|repository|identity/i);
      expect(event.properties).not.toHaveProperty('installationToken');
    }
    expect(send.mock.calls[0][0].events[0].installationToken).not.toBe(
      send.mock.calls[1][0].events[0].installationToken
    );
  });
  it.each([{}, { DO_NOT_TRACK: '1' }, { CI: 'true' }])(
    'fails open when a read-only copied package retains a stale bridge: %j',
    async (env) => {
      const directory = join(packageRoot, '.install-collector');
      await mkdir(directory);
      const stale =
        'export const installationToken = "10000000-0000-4000-8000-000000000001";\n';
      await writeFile(join(directory, 'development-install.mjs'), stale);
      await chmod(directory, 0o555);
      const send = vi.fn(async () => undefined);
      try {
        await collectInstall({ packageRoot, env, getHome: () => home, send });
        expect(
          await readFile(join(directory, 'development-install.mjs'), 'utf8')
        ).toBe(stale);
        expect(await readdir(directory)).toEqual(['development-install.mjs']);
        expect(send).toHaveBeenCalledTimes(env.DO_NOT_TRACK ? 0 : 1);
        for (const [batch] of send.mock.calls)
          expect(batch.events[0]).not.toHaveProperty('installationToken');
      } finally {
        await chmod(directory, 0o755);
      }
    }
  );
  it('publishes only complete modules by rename and cleans up a failed replacement after reset', async () => {
    const fs = require('node:fs/promises');
    const rename = fs.rename;
    const observed = [];
    const replacement = vi
      .spyOn(fs, 'rename')
      .mockImplementation(async (source, target) => {
        observed.push(await readFile(source, 'utf8'));
        if (observed.length === 2)
          throw Object.assign(new Error('read-only'), { code: 'EROFS' });
        await rename(source, target);
      });
    const send = vi.fn(async () => undefined);
    try {
      await collectInstall({ packageRoot, env: {}, getHome: () => home, send });
      expect(observed).toHaveLength(2);
      expect(observed[0]).toBe('export const installationToken = null;\n');
      expect(observed[1]).toMatch(
        /^export const installationToken = "[0-9a-f-]{36}";\n$/
      );
      expect(
        await readFile(
          join(packageRoot, '.install-collector/development-install.mjs'),
          'utf8'
        )
      ).toBe(observed[0]);
      expect(await readdir(join(packageRoot, '.install-collector'))).toEqual([
        'development-install.mjs',
      ]);
      expect(send.mock.calls[0][0].events[0]).not.toHaveProperty(
        'installationToken'
      );
    } finally {
      replacement.mockRestore();
    }
  });
  it.each([{ DO_NOT_TRACK: '1' }, { CI: 'true' }, { GITHUB_ACTIONS: 'true' }])(
    'resets a stale module before an excluded invocation: %j',
    async (env) => {
      await mkdir(join(packageRoot, '.install-collector'));
      await writeFile(
        join(packageRoot, '.install-collector/development-install.mjs'),
        'export const installationToken = "stale";\n'
      );
      const send = vi.fn(async () => undefined);
      await collectInstall({ packageRoot, env, getHome: () => home, send });
      expect(
        await readFile(
          join(packageRoot, '.install-collector/development-install.mjs'),
          'utf8'
        )
      ).toBe('export const installationToken = null;\n');
      for (const [batch] of send.mock.calls)
        expect(batch.events[0]).not.toHaveProperty('installationToken');
    }
  );
  it('uses publisher metadata and sends one CI event with restricted global Git hints', async () => {
    await writeFile(
      join(home, '.gitconfig'),
      '[user]\nname=Build Person\nemail=Builder@EXAMPLE.INVALID'
    );
    const send = vi.fn(async () => undefined);
    await collectInstall({
      packageRoot,
      env: {
        CI: 'true',
        npm_package_name: 'consumer-secret',
        npm_package_version: 'private',
        npm_config_user_agent: 'npm/11.0.0',
      },
      getHome: () => home,
      send,
    });
    expect(send).toHaveBeenCalledTimes(1);
    const event = send.mock.calls[0][0].events[0];
    expect(event).toMatchObject({
      kind: 'package.installed',
      subject: { namespace: 'installation', scope: 'persistent' },
      properties: {
        packageName: '@threadplane/angular',
        packageVersion: '0.0.65',
        environment: 'ci',
        ciProvider: 'generic_ci',
        consumerContext: 'unavailable',
      },
      identity: {
        gitEmail: 'builder@example.invalid',
        gitDisplayName: 'Build Person',
        gitConfigOrigin: 'global',
      },
    });
    expect(JSON.stringify(event.properties)).not.toMatch(
      /secret|private|email|Builder/
    );
  });
  it('always completes on collector failure without trying a second request', async () => {
    const send = vi.fn(async () => {
      throw new Error('network failed');
    });
    await expect(
      collectInstall({ packageRoot, env: {}, getHome: () => home, send })
    ).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('omits sends for unrecognized publisher packages or expired discovery budget', async () => {
    const send = vi.fn();
    await collectInstall({
      packageRoot,
      env: {},
      getHome: () => home,
      send,
      deadline: Date.now() - 1,
    });
    await writeFile(
      join(packageRoot, 'package.json'),
      JSON.stringify({ name: 'consumer', version: '1' })
    );
    await collectInstall({ packageRoot, env: {}, getHome: () => home, send });
    expect(send).not.toHaveBeenCalled();
  });
  it('keeps the lifecycle silent and exits zero before five seconds even if collection never settles', async () => {
    const script = join(root, 'stall.cjs');
    await writeFile(
      script,
      `const Module=require('node:module');const load=Module._load;Module._load=function(name,...args){if(name==='./collector.cjs')return {collectInstall:()=>new Promise(()=>{})};return load.call(this,name,...args)};`
    );
    const start = performance.now();
    const result = await execute(
      process.execPath,
      ['--require', script, resolve('libs/telemetry/install/postinstall.cjs')],
      {
        env: { PATH: process.env.PATH, npm_lifecycle_event: 'postinstall' },
        timeout: 5500,
      }
    );
    expect(performance.now() - start).toBeLessThan(5000);
    expect(result.stdout + result.stderr).toBe('');
  }, 7000);
  it('does nothing when loaded as a module or run outside the lifecycle', async () => {
    const result = await execute(
      process.execPath,
      [resolve('libs/telemetry/install/postinstall.cjs')],
      { env: { PATH: process.env.PATH }, timeout: 1000 }
    );
    expect(result.stdout + result.stderr).toBe('');
  });
});
