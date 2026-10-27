#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import {
  cpSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import {
  emitCandidate,
  packCandidate,
  installCandidate,
  assertInstalledInputs,
  rootRangeOverrides,
  reviewedSources,
} from './ag-ui-candidate-package.mjs';
import {
  localArtifactRecords,
  sha256,
} from './langgraph-candidate-package.mjs';
import { packLocalArtifacts } from './verify-packages.mjs';
import { checkTypes } from './verify-langgraph-candidate.mjs';
import { createClientToolsServer } from '../../fixtures/react-parity/native-ag-ui-client-tools/server.mjs';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = 'fixtures/react-parity/native-ag-ui-client-tools';
// Prerequisites (run at the actual repository root):
// UV_PYTHON=3.12 UV_PROJECT_ENVIRONMENT=/tmp/threadplane-agui-client-tools-native-fixture-env uv sync --frozen --no-install-project --project cockpit/ag-ui/client-tools/python
// NX_DAEMON=false NX_TUI=false npx nx run-many -t build -p core,content,angular,react --skip-nx-cache --outputStyle=stream
// node --test fixtures/react-parity/native-ag-ui-client-tools/server.spec.mjs
// node scripts/react-parity/verify-ag-ui-client-tools.mjs
// The existing full candidate verifier additionally requires:
// npm ci --prefix deployments/ag-ui-mastra --no-audit --no-fund
function childProbe(consumer, options) {
  return new Promise((yes, no) => {
    const child = spawn(
      process.execPath,
      ['installed-probe.mjs', JSON.stringify(options)],
      { cwd: consumer, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let output = '',
      errors = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 30000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 4_000_000) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk;
      if (errors.length > 2_000_000) child.kill('SIGKILL');
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      no(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0)
        no(new Error(`Installed probe failed ${code}: ${errors}`));
      else {
        try {
          yes(JSON.parse(output));
        } catch (error) {
          no(error);
        }
      }
    });
  });
}
/** Reusable installed proof; existing candidate verifier supplies its real consumer. */
export async function verifyInstalledClientTools({
  root = defaultRoot,
  consumer,
  artifacts,
  receiptDirectory,
}) {
  cpSync(
    join(root, fixture, 'installed-probe.mjs'),
    join(consumer, 'installed-probe.mjs')
  );
  const graph = buildSync({
    absWorkingDir: consumer,
    entryPoints: ['installed-probe.mjs'],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  assertInstalledInputs(
    consumer,
    Object.keys(graph.metafile.inputs),
    artifacts
  );
  const sourcePaths = [
    '.github/workflows/ci.yml',
    'fixtures/react-parity/ag-ui-candidate/README.md',
    fixture + '/compiled_worker.py',
    fixture + '/server.mjs',
    fixture + '/server.spec.mjs',
    fixture + '/installed-probe.mjs',
    'scripts/react-parity/verify-ag-ui-client-tools.mjs',
    'scripts/react-parity/verify-ag-ui-candidate.mjs',
    'scripts/react-parity/ag-ui-candidate-package.mjs',
    'scripts/react-parity/ag-ui-candidate-package.spec.mjs',
    'fixtures/react-parity/ag-ui-candidate/installed-types.ts',
    'fixtures/react-parity/ag-ui-candidate/entry.ts',
    'fixtures/react-parity/ag-ui-candidate/backend-binding.ts',
  ];
  const sources = sourcePaths.map((path) => ({
    path: join(root, path),
    sha256: sha256(readFileSync(join(root, path))),
  }));
  const results = [];
  for (const [mode, scenario, holdTerminal] of [
    ['nonstream', 'positive', false],
    ['stream', 'positive', false],
    ['unknown', 'unknown', false],
    ['nonstream', 'held-cancel', true],
    ['nonstream', 'handler-cancel', false],
  ]) {
    const server = await createClientToolsServer({ root, mode, holdTerminal });
    let result, failure;
    try {
      result = await childProbe(consumer, { url: server.url, scenario });
      assert.ok(
        result.installedEntry.startsWith(
          join(realpathSync(consumer), 'node_modules/@threadplane/ag-ui/')
        )
      );
      const stats = server.stats();
      assert.deepEqual(
        result.requests,
        stats.requests.map((record) => record.body)
      );
      assert.equal(stats.errors.length, 0);
      for (const record of stats.requests)
        assert.deepEqual(record.observations.socketAttempts, []);
      if (scenario === 'positive') {
        assert.equal(stats.requests.length, 2);
        const [first, second] = stats.requests;
        for (const record of stats.requests) {
          const terminal = record.events.at(-1);
          assert.equal(terminal.type, 'RUN_FINISHED');
          assert.equal(terminal.runId, record.body.runId);
          assert.equal(terminal.threadId, record.body.threadId);
          assert.equal(terminal.outcome, undefined);
        }
        const firstSnapshot = first.events
          .filter((event) => event.type === 'MESSAGES_SNAPSHOT')
          .at(-1);
        const call = firstSnapshot.messages.find(
          (row) => row.role === 'assistant'
        ).toolCalls[0];
        assert.equal(call.id, 'scripted-weather-call-id');
        assert.deepEqual(JSON.parse(call.function.arguments), {
          location: 'KASE',
        });
        assert.equal(
          first.events.some((event) => event.type === 'TOOL_CALL_END'),
          mode === 'stream'
        );
        const resultMessage = second.body.messages.find(
          (row) => row.role === 'tool'
        );
        assert.deepEqual(
          second.body.messages,
          [...firstSnapshot.messages, resultMessage],
          'Continuation carries the complete actual native history and exact authored result'
        );
        const finalSnapshot = second.events
          .filter((event) => event.type === 'MESSAGES_SNAPSHOT')
          .at(-1);
        const exactEcho = finalSnapshot.messages.some(
          (row) =>
            row.id === resultMessage.id &&
            row.role === 'tool' &&
            row.toolCallId === resultMessage.toolCallId &&
            row.content === resultMessage.content
        );
        assert.equal(
          result.snapshot.clientTools.calls[0].delivery,
          exactEcho ? 'observed' : 'sent-unconfirmed'
        );
        const observations = second.observations;
        for (const key of [
          'workerPid',
          'graphIdentity',
          'checkpointerIdentity',
          'modelIdentity',
        ])
          assert.equal(
            first.observations[key],
            observations[key],
            'Two requests share the one owned compiled graph/checkpointer/model worker'
          );
        assert.equal(observations.workerPid, stats.ready.pid);
        assert.equal(observations.modelCatalogs.length, 2);
        assert.equal(observations.modelMessages.length, 2);
        assert.deepEqual(
          observations.modelCatalogs,
          [first.body, second.body].map((body) =>
            body.tools.map((tool) => ({ type: 'function', function: tool }))
          ),
          'The actual repository middleware binds each request catalog to the real model'
        );
        assert.ok(
          observations.modelMessages[1].some(
            (row) =>
              row.type === 'tool' &&
              row.tool_call_id === resultMessage.toolCallId &&
              row.content === resultMessage.content
          )
        );
        result.exactNativeEcho = exactEcho;
      }
    } catch (error) {
      failure = String(error);
      throw error;
    } finally {
      let cleanupFailure;
      try {
        await server.close();
      } catch (error) {
        cleanupFailure = String(error);
      }
      const receipt = {
        mode,
        scenario,
        terminalHold: holdTerminal
          ? 'labelled-cancellation-boundary-only'
          : false,
        result,
        failure,
        cleanupFailure,
        server: server.stats(),
      };
      results.push(receipt);
      writeFileSync(
        join(receiptDirectory, `${mode}-${scenario}.json`),
        JSON.stringify(receipt, null, 2) + '\n'
      );
      if (cleanupFailure) throw new Error(cleanupFailure);
    }
  }
  for (const source of sources)
    assert.equal(
      sha256(readFileSync(source.path)),
      source.sha256,
      'Proof source bytes stayed frozen during execution'
    );
  return {
    results,
    inputs: Object.keys(graph.metafile.inputs),
    sources,
  };
}
export async function verifyClientTools({ root = defaultRoot } = {}) {
  root = realpathSync(root);
  const directory = mkdtempSync(
    '/tmp/threadplane-agui-client-tools-installed-'
  );
  let failure;
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const unchanged = [
      'package.json',
      'package-lock.json',
      'libs/ag-ui/package.json',
      'libs/ag-ui/src/index.ts',
      'libs/core/src',
      'libs/langgraph/src/runtime',
      'cockpit/ag-ui/client-tools/python',
      'packages/threadplane-middleware/src',
    ];
    assert.equal(
      execFileSync('git', ['diff', 'HEAD', '--name-only', '--', ...unchanged], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      '',
      'Public package roots, canonical inputs and unrelated owners remain unchanged'
    );
    const emission = emitCandidate(root, join(directory, 'candidate'));
    assert.deepEqual(
      emission.sources.map((source) => source.path).sort(),
      reviewedSources
    );
    const packed = packCandidate(join(directory, 'candidate'), directory);
    const tarballs = packLocalArtifacts(root, directory, ['core']);
    tarballs['@threadplane/ag-ui'] = 'file:' + packed.tarball;
    const artifacts = Object.fromEntries(
      Object.entries(localArtifactRecords(tarballs)).map(([name, record]) => [
        name,
        record.files,
      ])
    );
    const consumer = join(directory, 'consumer');
    mkdirSync(consumer);
    const installation = installCandidate(
      consumer,
      { private: true, type: 'module' },
      tarballs,
      JSON.parse(readFileSync(join(root, 'package-lock.json'))),
      false,
      rootRangeOverrides(root)
    );
    cpSync(
      join(root, 'fixtures/react-parity/ag-ui-candidate/installed-types.ts'),
      join(consumer, 'installed-types.ts')
    );
    const types = {};
    for (const mode of ['NodeNext', 'Bundler']) {
      const config = `tsconfig.${mode}.json`;
      writeFileSync(
        join(consumer, config),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: mode === 'NodeNext' ? 'NodeNext' : 'ESNext',
            moduleResolution: mode,
            strict: true,
            skipLibCheck: false,
            types: [],
            lib: ['ES2022', 'DOM'],
            noEmit: true,
          },
          files: ['installed-types.ts'],
        })
      );
      types[mode] = checkTypes(consumer, config);
      assert.ok(
        types[mode].some(
          (file) =>
            file.path === 'node_modules/@threadplane/core/src/tools/index.d.ts'
        ),
        'Actual packed core tools declarations'
      );
    }
    for (const files of Object.values(types))
      assertInstalledInputs(
        consumer,
        files.map((file) => file.path),
        artifacts
      );
    const proof = await verifyInstalledClientTools({
      root,
      consumer,
      artifacts,
      receiptDirectory: directory,
    });
    const receipt = {
      directory,
      head,
      unchanged,
      emission,
      packed,
      installation,
      types,
      proof,
    };
    writeFileSync(
      join(directory, 'provenance.json'),
      JSON.stringify(receipt, null, 2) + '\n'
    );
    console.log(
      JSON.stringify({
        directory,
        scenarios: proof.results.map(({ mode, scenario, result }) => ({
          mode,
          scenario,
          delivery: result.snapshot.clientTools.calls[0]?.delivery,
        })),
      })
    );
    return receipt;
  } catch (error) {
    failure = String(error);
    writeFileSync(
      join(directory, 'failure.json'),
      JSON.stringify(
        { directory, failure, fixtureClosure: error.fixtureClosure },
        null,
        2
      ) + '\n'
    );
    throw error;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  await verifyClientTools();
