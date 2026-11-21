// Verify shipped browser code with the actual Angular production development-mode constant.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { verifyAngularInstallBridge } from './verify-angular-install-bridge.mjs';
const { parseCollectionBatch } = await import(
  pathToFileURL(resolve('dist/libs/growth/src/lib/observability/contracts.js'))
    .href
);

const entry = `
  import { createDevelopmentRuntime } from './dist/libs/telemetry/browser/fesm2022/threadplane-telemetry.mjs';
  const runtime = createDevelopmentRuntime({ integration: 'langgraph', packageName: '@threadplane/langgraph', packageVersion: '0.0.65' });
  if (globalThis.exercise) { runtime.touch(); runtime.milestone('transport.connected'); }
`;
async function check(development, browser, exercise) {
  const result = await build({
    stdin: { contents: entry, resolveDir: process.cwd() },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    minify: true,
    define: { ngDevMode: String(development) },
    logLevel: 'silent',
  });
  const counts = { storage: 0, identity: 0, fetch: 0 };
  let validatedBatches = 0;
  const stored = new Map();
  const timers = new Map();
  let sequence = 0;
  const context = {
    exercise,
    AbortController,
    TextDecoder,
    TextEncoder,
    Response,
    URL,
    console: {
      info() {
        /* no announcement output in verification */
      },
    },
    setTimeout: (fn, ms) => {
      const id = ++sequence;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    fetch: async (_url, options) => {
      counts.fetch++;
      const batch = parseCollectionBatch(
        'runtime',
        JSON.parse(options.body),
        new Date()
      );
      validatedBatches++;
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          events: batch.events.map((e) => ({
            eventId: e.eventId,
            disposition: 'accepted',
          })),
          announcements: [],
        })
      );
    },
    ...(browser
      ? {
          document: {},
          window: {
            location: { hostname: 'remote-development.example.invalid' },
            crypto: {
              randomUUID: () => {
                counts.identity++;
                return `00000000-0000-4000-8000-${String(
                  counts.identity
                ).padStart(12, '0')}`;
              },
            },
            get localStorage() {
              counts.storage++;
              return {
                getItem: (key) => stored.get(key) ?? null,
                setItem: (key, value) => stored.set(key, value),
              };
            },
          },
        }
      : {}),
  };
  runInNewContext(result.outputFiles[0].text, context, { timeout: 3000 });
  if (development && browser && exercise) {
    assert(
      counts.identity > 0 && counts.storage > 0,
      'Development browser positive control did not initialize'
    );
    for (const [id, timer] of timers)
      if (timer.ms === 0) {
        timers.delete(id);
        timer.fn();
      }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      counts.fetch,
      1,
      'Development browser positive control did not exchange'
    );
    assert.equal(
      validatedBatches,
      1,
      'The built Growth contract rejected the emitted batch'
    );
  } else {
    assert.deepEqual(counts, { storage: 0, identity: 0, fetch: 0 });
    assert.equal(timers.size, 0);
  }
}
for (const configuration of [
  [false, true, true],
  [true, false, true],
  [true, true, false],
  [true, true, true],
]) {
  await check(...configuration);
}
const manifest = async (name) =>
  JSON.parse(
    await readFile(resolve('dist/libs', name, 'package.json'), 'utf8')
  );
const embedsVersion = (source, version) =>
  source.includes(`THREADPLANE_PACKAGE_VERSION = ${JSON.stringify(version)}`) ||
  source.includes(`THREADPLANE_PACKAGE_VERSION = '${version}'`);
// The Angular renderer builds its own collector handle.
{
  const pkg = await manifest('render');
  const bundle = await readFile(
    resolve('dist/libs/render/fesm2022/threadplane-render.mjs'),
    'utf8'
  );
  assert(
    embedsVersion(bundle, pkg.version),
    'render runtime version differs from published manifest; rebuild after versioning'
  );
  assert(
    bundle.includes('createDevelopmentRuntime'),
    'render missing runtime instrumentation'
  );
  assert(
    pkg.peerDependencies['@threadplane/telemetry'] !== '*',
    'render must require the telemetry API version'
  );
}
// The backend packages are framework-neutral: they may not import the
// collector. Each describes its own installation (version and bridge token)
// to the collector a host hands its sessions, and reports to that handle.
for (const name of ['langgraph', 'ag-ui']) {
  const pkg = await manifest(name);
  const runtime = (file) =>
    readFile(resolve('dist/libs', name, 'src/runtime', file), 'utf8');
  assert(
    embedsVersion(await runtime('package-version.js'), pkg.version),
    `${name} runtime version differs from published manifest; rebuild after versioning`
  );
  const install = await runtime('development-install.js');
  assert(
    install.includes(
      "from '../../.install-collector/development-install.mjs'"
    ) &&
      install.includes('THREADPLANE_PACKAGE_VERSION') &&
      install.includes(`'@threadplane/${name}'`),
    `${name} does not describe its installation to the collector`
  );
  const instrumented = await runtime(
    name === 'langgraph' ? 'create-session.js' : 'session-instruments.js'
  );
  assert(
    instrumented.includes('buildDevelopmentRuntime') &&
      instrumented.includes("'runtime.first_stream_completed'") &&
      instrumented.includes("'transport.connected'"),
    `${name} missing runtime instrumentation`
  );
  assert(
    !('@threadplane/telemetry' in (pkg.peerDependencies ?? {})) &&
      !('@threadplane/telemetry' in (pkg.dependencies ?? {})),
    `${name} must stay free of the telemetry package`
  );
}
// The chat package is the host: it hands the collector to the agent layer and
// is the package that requires the telemetry API version.
{
  const pkg = await manifest('chat');
  const bundle = await readFile(
    resolve('dist/libs/chat/fesm2022/threadplane-chat.mjs'),
    'utf8'
  );
  assert(
    bundle.includes('createDevelopmentRuntime') &&
      bundle.includes('registerDevelopmentRuntimePolicy') &&
      bundle.includes('ɵsetAgentDevelopmentHost'),
    'chat does not connect agents to the development collector'
  );
  assert(
    typeof pkg.peerDependencies['@threadplane/telemetry'] === 'string' &&
      pkg.peerDependencies['@threadplane/telemetry'] !== '*',
    'chat must require the telemetry API version'
  );
  assert(
    (pkg.sideEffects ?? []).includes('./fesm2022/threadplane-chat.mjs'),
    'chat must keep its entry module, which registers the collector'
  );
}
console.log(
  'Built browser verification passed: production, SSR and import-only silence; remote development exchange; three package runtime versions; chat connects the collector.'
);
await verifyAngularInstallBridge(parseCollectionBatch);
