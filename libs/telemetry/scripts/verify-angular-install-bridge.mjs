// Actual Angular application compiler/linker/optimizer against installed tarballs.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  symlink,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const execute = promisify(execFile);
const workspace = resolve('.');
const packages = ['chat', 'langgraph', 'ag-ui', 'render'];
export async function verifyAngularInstallBridge(parseCollectionBatch) {
  const temporary = await mkdtemp(
    join(tmpdir(), 'threadplane-angular-install-')
  );
  const run = (cmd, args, options = {}) =>
    execute(cmd, args, {
      cwd: temporary,
      timeout: 90000,
      maxBuffer: 4 * 1024 * 1024,
      ...options,
    });
  try {
    await mkdir(join(temporary, 'home'));
    await writeFile(
      join(temporary, 'package.json'),
      JSON.stringify({
        name: 'synthetic-angular-install-proof',
        private: true,
        version: '1.0.0',
      })
    );
    const tarballs = [];
    for (const name of [...packages, 'telemetry', 'a2ui']) {
      const packed = JSON.parse(
        (
          await run('npm', [
            'pack',
            resolve('dist/libs', name),
            '--ignore-scripts',
            '--json',
            '--pack-destination',
            temporary,
          ])
        ).stdout
      )[0];
      tarballs.push(join(temporary, packed.filename));
    }
    await run('npm', [
      'install',
      '--prefer-offline',
      '--ignore-scripts',
      '--legacy-peer-deps',
      '--no-audit',
      '--no-fund',
      ...tarballs,
    ]);
    // Reuse the workspace's installed build toolchain and peer dependencies;
    // Threadplane package resolution remains the actual installed tarballs.
    for (const name of await readdir(resolve('node_modules'))) {
      if (name.startsWith('.') || name === '@threadplane') continue;
      await symlink(
        resolve('node_modules', name),
        join(temporary, 'node_modules', name)
      ).catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
    }
    const capture = join(temporary, 'events.jsonl');
    const preload = join(temporary, 'capture.cjs');
    await writeFile(capture, '');
    await writeFile(
      preload,
      `const https=require('node:https'),fs=require('node:fs'),{EventEmitter}=require('node:events');https.request=(url,options,callback)=>{if(url!=='https://threadplane.ai/api/growth/collect/v1/install')throw Error('Unexpected request');const r=new EventEmitter();r.destroy=()=>{};r.end=body=>{fs.appendFileSync(process.env.INSTALL_CAPTURE,body+'\\n');queueMicrotask(()=>callback({destroy(){}}));};return r;};`
    );
    const lifecycleEnv = {
      PATH: process.env.PATH,
      HOME: join(temporary, 'home'),
      USERPROFILE: join(temporary, 'home'),
      NODE_OPTIONS: `--require=${preload}`,
      INSTALL_CAPTURE: capture,
      npm_config_cache: (
        await run('npm', ['config', 'get', 'cache'])
      ).stdout.trim(),
    };
    const tokens = new Map();
    await writeFile(
      join(temporary, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ES2022',
          moduleResolution: 'bundler',
          skipLibCheck: true,
          experimentalDecorators: true,
          lib: ['ES2022', 'DOM'],
          types: [],
        },
        files: ['main.ts'],
        angularCompilerOptions: { strictTemplates: true },
      })
    );
    await writeFile(
      join(temporary, 'angular.json'),
      JSON.stringify({
        version: 1,
        cli: { analytics: false },
        projects: {
          proof: {
            projectType: 'application',
            root: '',
            sourceRoot: '',
            architect: {
              build: {
                builder: '@angular/build:application',
                options: {
                  browser: 'main.ts',
                  tsConfig: 'tsconfig.json',
                  index: false,
                  outputPath: 'output',
                  assets: [],
                  styles: [],
                  progress: false,
                  sourceMap: false,
                  extractLicenses: false,
                  preserveSymlinks: true,
                },
                configurations: {
                  development: { optimization: false },
                  production: { optimization: true },
                },
              },
            },
          },
        },
      })
    );
    await writeFile(
      join(temporary, 'main.ts'),
      `
import { toAgent, FakeAgent } from '@threadplane/ag-ui';
import { provideAgent as provideLanggraphAgent } from '@threadplane/langgraph';
import { RenderElementComponent } from '@threadplane/render';
const target = globalThis as any;
target.fixtureExports = { toAgent, provideLanggraphAgent, RenderElementComponent };
if (target.exercise) {
  const agent = toAgent(new FakeAgent({ tokens: ['synthetic'], delayMs: 0 }));
  target.fixtureDone = agent.submit({ message: 'synthetic package proof' });
}
`
    );
    for (const scenario of ['skipped-scripts', 'development', 'production']) {
      if (scenario === 'development') {
        await run('npm', ['rebuild', ...packages.map(name => `@threadplane/${name}`), '--offline', '--foreground-scripts'], { env: lifecycleEnv });
        const events = (await readFile(capture, 'utf8')).trim().split('\n').flatMap(line => JSON.parse(line).events);
        assert.equal(events.length, 4);
        for (const event of events) {
          assert.match(event.installationToken, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
          tokens.set(event.properties.packageName, event.installationToken);
        }
      }
      const configuration = scenario === 'production' ? 'production' : 'development';
      const result = await run(process.execPath, [
        join(workspace, 'node_modules/@angular/cli/bin/ng.js'),
        'build',
        'proof',
        '--configuration',
        configuration,
      ]);
      assert(
        result.stdout.includes('Application bundle generation complete'),
        result.stdout + result.stderr
      );
      const files = await readdir(join(temporary, 'output/browser'));
      const code = (
        await Promise.all(
          files
            .filter((file) => file.endsWith('.js'))
            .map((file) =>
              readFile(join(temporary, 'output/browser', file), 'utf8')
            )
        )
      ).join('\n');
      for (const name of scenario === 'skipped-scripts' ? [] : ['langgraph', 'ag-ui', 'render'])
        assert.equal(
          code.includes(tokens.get(`@threadplane/${name}`)),
          configuration === 'development',
          `${configuration}: ${name} token retention`
        );
      const main = files.find((file) => /^main.*\.js$/.test(file));
      const executable = await build({
        entryPoints: [join(temporary, 'output/browser', main)],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        logLevel: 'silent',
      });
      for (const mode of ['browser', 'disabled', 'ssr', 'import-only'])
        await exerciseBundle(executable.outputFiles[0].text, {
          development: configuration === 'development',
          mode,
          token: tokens.get('@threadplane/ag-ui'),
          parseCollectionBatch,
        });
    }
    console.log(
      'Actual packed Angular application passed skipped-script null forwarding, development token forwarding, production token removal, SSR, browser opt-out and import-only checks.'
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function exerciseBundle(
  code,
  { development, mode, token, parseCollectionBatch }
) {
  const events = [];
  let fetchCalls = 0;
  const dom =
    mode === 'ssr'
      ? undefined
      : new JSDOM('<!doctype html><html><head></head><body></body></html>', {
          url: 'https://remote-development.example.invalid',
        });
  if (dom) dom.window.__THREADPLANE_TELEMETRY_DISABLED__ = mode === 'disabled';
  const timers = new Map();
  let sequence = 0;
  const context = {
    exercise: mode !== 'import-only',
    AbortController,
    TextDecoder,
    TextEncoder,
    Response,
    Request,
    Headers,
    URL,
    performance,
    ReadableStream,
    WritableStream,
    TransformStream,
    DOMException,
    queueMicrotask,
    structuredClone,
    crypto: globalThis.crypto,
    console: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      log: () => undefined,
    },
    setTimeout: (fn, ms) => {
      const id = ++sequence;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    fetch: async (url, options) => {
      fetchCalls++;
      assert.equal(url, 'https://threadplane.ai/api/growth/collect/v1/runtime');
      const batch = parseCollectionBatch(
        'runtime',
        JSON.parse(options.body),
        new Date()
      );
      events.push(...batch.events);
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          events: batch.events.map((event) => ({
            eventId: event.eventId,
            disposition: 'accepted',
          })),
          announcements: [],
        })
      );
    },
    ...(dom ? { document: dom.window.document, window: dom.window } : {}),
  };
  runInNewContext(code, context, { timeout: 5000 });
  // Only collector's initial exchange runs. The fake stream's 30ms timer is
  // intentionally left pending; no network/provider operation exists.
  for (const [id, timer] of timers)
    if (timer.ms === 0) {
      timers.delete(id);
      timer.fn();
    }
  await new Promise((resolve) => setImmediate(resolve));
  if (development && mode === 'browser') {
    assert.equal(fetchCalls, 1);
    assert.equal(
      events.length,
      1,
      'Actual adapter initialization must exchange once'
    );
    assert.equal(events[0].installationToken, token);
    assert.equal(events[0].properties.packageName, '@threadplane/ag-ui');
    assert(!('installationToken' in events[0].properties));
  } else {
    assert.equal(fetchCalls, 0, `${mode}: no network requests`);
    assert.equal(events.length, 0, `${mode}: collection must remain silent`);
  }
  dom?.window.close();
}
