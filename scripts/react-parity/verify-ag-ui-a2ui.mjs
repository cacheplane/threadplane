export {
  createProofCoordinator,
  createTurnAdmission,
  createBoundedCapture,
  validateSettledTurn,
} from './ag-ui-a2ui-proof-policy.mjs';

/** Packaging and real owners are reachable only through this explicit call. */
export async function verifyA2ui(options) {
  const {
    readFileSync,
    writeFileSync,
    mkdirSync,
    cpSync,
    realpathSync,
    readdirSync,
    statSync,
  } = await import('node:fs');
  const { join, dirname, resolve, relative } = await import('node:path');
  const { spawn, execFileSync } = await import('node:child_process');
  const { createRequire } = await import('node:module');
  const { setTimeout: delay } = await import('node:timers/promises');
  const { validateSettledTurn, createTurnAdmission, createBoundedCapture } =
    await import('./ag-ui-a2ui-proof-policy.mjs');
  const root = realpathSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  );
  const { retain: directory, python, environment, home, tmpdir } = options;
  assert.ok(
    python.startsWith(environment + '/bin/'),
    'Direct exclusive environment Python required'
  );
  assert.notEqual(realpathSync(home), realpathSync(root));
  mkdirSync(directory); // Exclusive: never overwrite/reuse an actual attempt.
  const write = (name, value) => {
    const bytes = JSON.stringify(value, null, 2) + '\n';
    assert.ok(
      Buffer.byteLength(bytes) <= 64 * 1024 * 1024,
      'Full retained artifact byte bound'
    );
    writeFileSync(join(directory, name), bytes, { flag: 'wx' });
  };
  const {
    emitCandidate,
    packCandidate,
    installCandidate,
    assertInstalledInputs,
    rootRangeOverrides,
    reviewedSources,
  } = await import('./ag-ui-candidate-package.mjs');
  const { localArtifactRecords, sha256 } = await import(
    './langgraph-candidate-package.mjs'
  );
  const { packLocalArtifacts } = await import('./verify-packages.mjs');
  const { buildSync } = await import('esbuild');
  const { default: ts } = await import('typescript');
  const fixture = 'fixtures/react-parity/native-ag-ui-a2ui';
  const policy = 'scripts/react-parity/ag-ui-a2ui-proof-policy.mjs';
  const selected = [
    ...new Set([
      ...reviewedSources,
      'package.json',
      'package-lock.json',
      'nx.json',
      'libs/core/project.json',
      'scripts/react-parity/ag-ui-candidate-package.mjs',
      'scripts/react-parity/langgraph-candidate-package.mjs',
      'scripts/react-parity/verify-packages.mjs',
      'scripts/react-parity/verify-ag-ui-a2ui.mjs',
      'scripts/react-parity/verify-ag-ui-a2ui.spec.mjs',
      policy,
      ...[
        'model.py',
        'compiled_worker.py',
        'server.mjs',
        'server.spec.mjs',
        'installed-probe.mjs',
        'installed-types.ts',
      ].map((name) => fixture + '/' + name),
      ...['src/graph.py', 'src/server.py', 'pyproject.toml', 'uv.lock'].map(
        (name) => 'cockpit/ag-ui/a2ui/python/' + name
      ),
    ]),
  ].sort();
  const sources = selected.map((path) => ({
    path,
    sha256: sha256(readFileSync(join(root, path))),
  }));
  mkdirSync(join(directory, 'selected-source'));
  for (const { path } of sources) {
    mkdirSync(dirname(join(directory, 'selected-source', path)), {
      recursive: true,
    });
    cpSync(join(root, path), join(directory, 'selected-source', path));
  }
  write('source-before.json', sources);
  const receipt = {
    directory,
    root,
    head: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 2000,
    }).trim(),
    sources,
    options,
    stages: [],
    turns: [],
  };
  let server,
    child,
    childIdentity,
    childClosed = false,
    stdoutClosed = false,
    stderrClosed = false,
    childFailure,
    previous = [];
  const admission = createTurnAdmission();
  const failures = [];
  let failureCount = 0;
  const failChild = (error) => {
    childFailure ??= String(error);
    admission.fail(error);
    failureCount++;
    if (failures.length < 16) failures.push(String(error).slice(0, 2048));
  };
  const identifyChild = () =>
    execFileSync(
      '/bin/ps',
      ['-o', 'pid=,lstart=,args=', '-p', String(child.pid)],
      { encoding: 'utf8', timeout: 1000, maxBuffer: 65536 }
    ).trim();
  const signalChild = (signal) => {
    if (
      !child ||
      childClosed ||
      child.exitCode !== null ||
      child.signalCode !== null
    )
      return;
    try {
      assert.ok(
        childIdentity && identifyChild() === childIdentity,
        'Exact owned native child identity required'
      );
      child.kill(signal);
    } catch (error) {
      failChild(error);
      receipt.cleanupFailure = String(error);
    }
  };
  try {
    receipt.emission = emitCandidate(root, join(directory, 'candidate'));
    write('emission.json', receipt.emission);
    receipt.stages.push('emitted');
    receipt.packed = packCandidate(join(directory, 'candidate'), directory);
    write('packed.json', receipt.packed);
    const tarballs = packLocalArtifacts(root, directory, ['core']);
    tarballs['@threadplane/ag-ui'] = 'file:' + receipt.packed.tarball;
    const records = localArtifactRecords(tarballs);
    write('tarball-payload-records.json', records);
    const artifacts = Object.fromEntries(
      Object.entries(records).map(([name, record]) => [name, record.files])
    );
    const consumer = join(directory, 'consumer');
    mkdirSync(consumer);
    receipt.installation = installCandidate(
      consumer,
      { private: true, type: 'module' },
      tarballs,
      JSON.parse(readFileSync(join(root, 'package-lock.json'))),
      false,
      rootRangeOverrides(root)
    );
    write('installation.json', receipt.installation);
    receipt.stages.push('installed');
    const inventory = (path, base = path) =>
      readdirSync(path).flatMap((name) => {
        const file = join(path, name);
        return statSync(file).isDirectory()
          ? inventory(file, base)
          : [
              {
                path: relative(base, file),
                sha256: sha256(readFileSync(file)),
                bytes: statSync(file).size,
              },
            ];
      });
    receipt.installedInventory = inventory(join(consumer, 'node_modules'));
    write('installed-inventory.json', receipt.installedInventory);
    const require = createRequire(join(consumer, 'package.json'));
    const installedEntry = require.resolve('@threadplane/ag-ui');
    const sdkEntry = createRequire(installedEntry).resolve('@ag-ui/client');
    assert.ok(
      realpathSync(installedEntry).startsWith(
        consumer + '/node_modules/@threadplane/ag-ui/'
      )
    );
    assert.ok(realpathSync(sdkEntry).startsWith(consumer + '/node_modules/'));
    receipt.resolutions = { installedEntry, sdkEntry };
    write('owner-resolution.json', receipt.resolutions);
    cpSync(
      join(root, fixture, 'installed-types.ts'),
      join(consumer, 'installed-types.ts')
    );
    receipt.types = {};
    for (const mode of ['NodeNext', 'Bundler']) {
      const config = {
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
      };
      const configPath = join(consumer, `tsconfig.${mode}.json`);
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      const parsed = ts.getParsedCommandLineOfConfigFile(
        configPath,
        {},
        {
          ...ts.sys,
          onUnRecoverableConfigFileDiagnostic: (d) => {
            throw new Error(
              ts.flattenDiagnosticMessageText(d.messageText, '\n')
            );
          },
        }
      );
      const program = ts.createProgram(parsed.fileNames, parsed.options);
      const diagnostics = ts.getPreEmitDiagnostics(program);
      write(
        `types-${mode}-diagnostics.json`,
        diagnostics.map((d) => ({
          code: d.code,
          message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
          file: d.file?.fileName,
          start: d.start,
        }))
      );
      assert.equal(
        diagnostics.length,
        0,
        'Actual strict installed declarations must compile'
      );
      const files = program.getSourceFiles().map((file) => ({
        path: file.fileName,
        sha256: sha256(readFileSync(file.fileName)),
      }));
      assert.ok(
        files.every(
          (file) =>
            file.path.startsWith(consumer + '/') ||
            file.path.startsWith(join(root, 'node_modules/typescript/lib/lib'))
        ),
        'Declaration closure is actual consumer plus compiler standard libraries'
      );
      assert.ok(
        files.some((file) =>
          file.path.includes(
            '/node_modules/@threadplane/core/src/tools/index.d.ts'
          )
        ),
        'Actual core/tools type closure'
      );
      assertInstalledInputs(
        consumer,
        files
          .filter((file) => file.path.startsWith(consumer + '/'))
          .map((file) => relative(consumer, file.path)),
        artifacts
      );
      receipt.types[mode] = files;
      write(`types-${mode}-inputs.json`, files);
    }
    cpSync(
      join(root, fixture, 'installed-probe.mjs'),
      join(consumer, 'installed-probe.mjs')
    );
    cpSync(join(root, policy), join(consumer, 'ag-ui-a2ui-proof-policy.mjs'));
    const graph = buildSync({
      absWorkingDir: consumer,
      entryPoints: ['installed-probe.mjs'],
      bundle: true,
      write: true,
      outfile: join(consumer, 'installed-probe.bundle.mjs'),
      metafile: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
    });
    const inputs = Object.keys(graph.metafile.inputs);
    assertInstalledInputs(consumer, inputs, artifacts);
    assert.ok(
      inputs.some((path) =>
        path.startsWith('node_modules/@threadplane/ag-ui/')
      ),
      'Real installed candidate implementation bundled'
    );
    assert.ok(
      !inputs.some(
        (path) =>
          path.includes('@angular/') ||
          path.startsWith('libs/') ||
          path.startsWith('dist/')
      ),
      'No Angular/workspace runtime input'
    );
    const harness = new Set([
      'installed-probe.mjs',
      'ag-ui-a2ui-proof-policy.mjs',
    ]);
    assert.ok(
      inputs.every(
        (path) => harness.has(path) || path.startsWith('node_modules/')
      ),
      'Harness and installed implementation remain separate'
    );
    write('bundle-metafile.json', graph.metafile);
    write(
      'bundle-inputs.json',
      inputs.map((path) => ({
        path,
        kind: harness.has(path) ? 'test-harness' : 'installed-package',
        sha256: sha256(readFileSync(join(consumer, path))),
      }))
    );
    const launcher = `import {writeFileSync} from 'node:fs';\nconst original=globalThis.fetch;let importFetches=0,phase='import',completion;\nglobalThis.fetch=()=>{importFetches++;throw new Error('Import fetch forbidden');};\ntry{const module=await import('./installed-probe.bundle.mjs');globalThis.fetch=original;phase='run';const result=await module.runInstalledProbe({...JSON.parse(process.argv[2]),importFetches});completion={ok:true,result,phase,importFetches};}catch(error){completion={ok:false,error:String(error),stack:error.stack,phase,importFetches};process.exitCode=1;}finally{globalThis.fetch=original;writeFileSync('probe-completion.json',JSON.stringify(completion)+'\\n',{flag:'wx'});if(process.connected)process.disconnect();}\n`;
    writeFileSync(join(consumer, 'probe-launcher.mjs'), launcher);
    const { createA2uiServer } = await import(
      '../../fixtures/react-parity/native-ag-ui-a2ui/server.mjs'
    );
    server = await createA2uiServer({ python, environment, home, tmpdir });
    write('worker-ready.json', server.stats().ready);
    const outputDirectory = join(directory, 'native');
    mkdirSync(outputDirectory);
    child = spawn(
      process.execPath,
      [
        'probe-launcher.mjs',
        JSON.stringify({ url: server.url, directory: outputDirectory }),
      ],
      {
        cwd: consumer,
        env: {
          PATH: '/usr/bin:/bin',
          HOME: home,
          TMPDIR: tmpdir,
          NODE_NO_WARNINGS: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      }
    );
    child.once('close', () => {
      childClosed = true;
    });
    child.once('error', (error) => {
      failChild(error);
    });
    childIdentity = identifyChild();
    assert.ok(
      childIdentity.includes('probe-launcher.mjs'),
      'Exact owned native child command'
    );
    write('probe-child-start.json', {
      pid: child.pid,
      identity: childIdentity,
    });
    const stdout = createBoundedCapture(1_000_000),
      stderr = createBoundedCapture(2_000_000);
    child.stdout.on('data', (chunk) => {
      if (!stdout.push(chunk)) {
        failChild('Probe stdout bound');
        signalChild('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk) => {
      if (!stderr.push(chunk)) {
        failChild('Probe stderr bound');
        signalChild('SIGTERM');
      }
    });
    child.stdout.once('end', () => {
      stdoutClosed = true;
    });
    child.stderr.once('end', () => {
      stderrClosed = true;
    });
    let lastTurn = 0,
      oracleFailureWritten = false;
    child.on('message', (message) => {
      void (async () => {
        const token = admission.begin(message);
        const until = Date.now() + 2000;
        while (
          !server.stats().requests.at(-1)?.responseClosed &&
          Date.now() < until
        )
          await delay(5);
        const stats = server.stats();
        write(`server-turn-${message.turn}.json`, stats);
        const native = JSON.parse(
          readFileSync(
            join(outputDirectory, `native-turn-${message.turn}.json`),
            'utf8'
          )
        );
        assert.equal(native.turn, message.turn);
        assert.equal(native.runId, message.runId);
        assert.equal(native.threadId, message.threadId);
        assert.equal(
          stats.requests.length,
          message.turn,
          'One real positive request per ordinary submit'
        );
        const record = stats.requests.at(-1);
        assert.ok(
          record.readerClosed && record.responseClosed,
          'HTTP reader/response fully closed'
        );
        assert.equal(record.status, 200);
        assert.equal(record.error, undefined);
        assert.deepEqual(stats.errors, []);
        assert.equal(record.method, 'POST');
        assert.equal(record.url, '/agent');
        assert.deepEqual(
          record.sentWire,
          record.worker.wire,
          'Every actual encoded adapter byte forwarded unchanged'
        );
        assert.deepEqual(
          Object.keys(record.body).sort(),
          [
            'threadId',
            'runId',
            'protocolVersion',
            'messages',
            'state',
            'tools',
            'context',
            'forwardedProps',
          ].sort()
        );
        assert.deepEqual(record.body.tools, []);
        assert.deepEqual(record.body.context, []);
        assert.deepEqual(record.body.forwardedProps, {});
        assert.equal(record.body.threadId, message.threadId);
        assert.equal(record.body.runId, message.runId);
        assert.deepEqual(
          record.body,
          native.requests[0].body,
          'Actual installed body equals actual received body'
        );
        assert.deepEqual(record.worker.observations.deniedNetwork, []);
        const accepted = validateSettledTurn({
          ...native,
          previous,
          oracle: record.worker.observations,
        });
        const surface = accepted.surface;
        if (message.turn === 1) {
          assert.equal(surface.surfaceId, 'booking');
          assert.deepEqual(surface.data.origin, ['LAX']);
          assert.deepEqual(surface.data.dest, ['JFK']);
          assert.equal(surface.data.passengers, 1);
        }
        if (message.turn === 2) {
          assert.equal(surface.surfaceId, 'results');
          assert.ok(
            surface.components.some(
              (c) =>
                c.action?.event?.name === 'flightSelect' &&
                c.action.event.context.flightId === 'UA204'
            )
          );
          assert.deepEqual(
            record.worker.observations.tools.map((tool) => tool.name),
            ['_find_routes_impl']
          );
          assert.deepEqual(record.worker.observations.tools[0].args, {
            from_code: 'SFO',
            to_code: 'SEA',
            date_offset_days: 0,
          });
        }
        if (message.turn === 3) {
          assert.equal(surface.surfaceId, 'confirmation');
          const text = surface.components
            .filter((c) => typeof c.text === 'string')
            .map((c) => c.text)
            .join('\n');
          assert.match(text, /UA204/);
          assert.match(text, /3/);
          assert.match(text, /Business/);
          assert.deepEqual(
            record.worker.observations.tools.map((tool) => tool.name),
            ['_lookup_flight_impl']
          );
          assert.deepEqual(record.worker.observations.tools[0].args, {
            flight_number: 'UA204',
          });
        }
        if (message.turn === 4) {
          assert.equal(surface.surfaceId, 'booking');
          assert.deepEqual(surface.data, {
            origin: ['SFO'],
            dest: ['SEA'],
            date: '2027-02-17',
            passengers: 3,
            fare_class: ['Business'],
          });
        }
        const models = record.worker.observations.models;
        assert.ok(models.length >= 1, 'Actual structured model parser path');
        if (message.turn === 1) {
          assert.ok(
            models.some((model) => model.retry),
            'Real schema validation retry'
          );
          assert.ok(record.worker.observations.title.length >= 1);
          assert.ok(
            record.worker.observations.metadata.some(
              (item) =>
                item.op === 'update' &&
                item.metadata.title === 'Local booking title'
            )
          );
        }
        assert.equal(
          childFailure,
          undefined,
          'Any pending failure fences acceptance'
        );
        write(`accepted-turn-${message.turn}.json`, accepted);
        previous = accepted.transcript;
        lastTurn = message.turn;
        receipt.turns.push({
          turn: message.turn,
          threadId: message.threadId,
          runId: message.runId,
          checkpoint: accepted.checkpoint,
        });
        admission.commit(token);
        child.send({ ...message, accepted: true }, (error) => {
          if (error) failChild(error);
        });
      })().catch((error) => {
        failChild(error);
        if (!oracleFailureWritten) {
          oracleFailureWritten = true;
          try {
            write('oracle-failure.json', {
              error: String(error),
              stack: error.stack,
              message,
            });
          } catch (retentionError) {
            failChild(retentionError);
          }
        }
        if (child.connected)
          try {
            child.send(
              { ...message, accepted: false, error: String(error) },
              (sendError) => {
                if (sendError) failChild(sendError);
              }
            );
          } catch (sendError) {
            failChild(sendError);
          }
      });
    });
    const until = Date.now() + 90000;
    while (!childClosed && Date.now() < until) await delay(10);
    if (!childClosed) {
      failChild('Probe total deadline');
      signalChild('SIGTERM');
    }
    const drainUntil = Date.now() + 3000;
    while (
      (!childClosed || !stdoutClosed || !stderrClosed) &&
      Date.now() < drainUntil
    )
      await delay(10);
    write('probe-process.json', {
      pid: child.pid,
      childClosed,
      stdoutClosed,
      stderrClosed,
      exitCode: child.exitCode,
      signalCode: child.signalCode,
      stdout: stdout.receipt(),
      stderr: stderr.receipt(),
      admission: admission.receipt(),
      failureCount,
      failures,
      failure: childFailure,
    });
    assert.ok(
      childClosed && stdoutClosed && stderrClosed,
      'Probe close/drain required'
    );
    assert.equal(child.exitCode, 0, childFailure);
    assert.equal(childFailure, undefined);
    const completion = JSON.parse(
      readFileSync(join(consumer, 'probe-completion.json'), 'utf8')
    );
    assert.equal(completion.ok, true, completion.error);
    assert.equal(lastTurn, 4);
    receipt.completion = completion;
    receipt.status = 'accepted';
  } catch (error) {
    receipt.status = 'failed';
    receipt.failure = String(error);
    receipt.stack = error.stack;
    receipt.fixtureClosure = error.fixtureClosure;
  } finally {
    if (child && !childClosed) {
      signalChild('SIGTERM');
      const until = Date.now() + 2000;
      while (!childClosed && Date.now() < until) await delay(10);
      if (!childClosed) {
        signalChild('SIGKILL');
        await delay(100);
      }
    }
    if (server) {
      try {
        await server.close();
      } catch (error) {
        receipt.cleanupFailure = String(error);
      }
      write('server-final.json', server.stats());
    }
    receipt.childClosed = child ? childClosed : true;
    const after = sources.map(({ path }) => ({
      path,
      sha256: sha256(readFileSync(join(root, path))),
    }));
    write('source-after.json', after);
    if (JSON.stringify(after) !== JSON.stringify(sources))
      receipt.sourceFailure = 'Selected source changed';
    write('provenance.json', receipt);
  }
  assert.equal(receipt.status, 'accepted', receipt.failure);
  assert.equal(receipt.cleanupFailure, undefined);
  assert.equal(receipt.sourceFailure, undefined);
  assert.equal(receipt.childClosed, true);
  process.stdout.write(
    JSON.stringify({
      directory,
      status: receipt.status,
      turns: receipt.turns.length,
    }) + '\n'
  );
  return receipt;
}
import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseCli(args) {
  if (!args.length) return null;
  const keys = ['retain', 'python', 'environment', 'home', 'tmpdir'];
  const options = {};
  assert.equal(
    args.length,
    keys.length * 2,
    'All explicit owned paths required'
  );
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index].slice(2),
      value = args[index + 1];
    assert.ok(
      args[index].startsWith('--') &&
        keys.includes(key) &&
        !Object.hasOwn(options, key),
      'Unknown/duplicate flag'
    );
    assert.ok(
      typeof value === 'string' && isAbsolute(value),
      'Concrete absolute path required'
    );
    options[key] = value;
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseCli(process.argv.slice(2));
  if (options) await verifyA2ui(options);
  else
    process.stdout.write(
      'Explicit --retain --python --environment --home --tmpdir paths required to execute.\n'
    );
}
