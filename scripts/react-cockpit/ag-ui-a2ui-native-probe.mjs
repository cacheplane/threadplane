import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
/** Closed invocation: source root is derived from this module, never a CLI path. */
export function parseProofArguments(arguments_) {
  const names = ['retain', 'python', 'environment', 'home', 'tmpdir'];
  if (!Array.isArray(arguments_) || arguments_.length !== 10)
    throw Error('Five absolute proof flags required');
  const options = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index],
      value = arguments_[index + 1];
    if (
      !names.some((name) => flag === '--' + name) ||
      Object.hasOwn(options, flag.slice(2)) ||
      typeof value !== 'string' ||
      !isAbsolute(value) ||
      value.includes('\0')
    )
      throw Error('Five absolute proof flags required');
    options[flag.slice(2)] = value;
  }
  if (!names.every((name) => Object.hasOwn(options, name)))
    throw Error('Five absolute proof flags required');
  return Object.freeze(options);
}
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
function files(directory) {
  const result = [];
  function visit(path) {
    for (const name of readdirSync(path).sort()) {
      const selected = join(path, name),
        stat = lstatSync(selected);
      assert.ok(
        !stat.isSymbolicLink(),
        'Source/payload symlinks are not accepted: ' + selected
      );
      if (stat.isDirectory()) visit(selected);
      else if (stat.isFile()) result.push(selected);
    }
  }
  visit(directory);
  return result;
}
function processIdentity(pid) {
  const result = spawnSync(
    '/bin/ps',
    ['-p', String(pid), '-o', 'pid=,ppid=,pgid=,lstart='],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 65536 }
  );
  if (
    !result.error &&
    result.status === 0 &&
    result.stdout.trim() &&
    !result.stderr.trim()
  )
    return { state: 'present', value: result.stdout.trim() };
  if (
    !result.error &&
    result.status === 1 &&
    !result.stdout.trim() &&
    !result.stderr.trim()
  )
    return { state: 'absent' };
  return {
    state: 'unknown',
    status: result.status,
    error: String(result.error ?? result.stderr).slice(0, 2048),
  };
}
function processGroup(pgid) {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,lstart='], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || result.stderr.trim())
    return {
      state: 'unknown',
      status: result.status,
      error: String(result.error ?? result.stderr).slice(0, 2048),
    };
  const members = result.stdout
    .split('\n')
    .filter((row) => row.trim().split(/\s+/)[2] === String(pgid))
    .map((row) => row.trim());
  return {
    state: 'observed',
    members: members.slice(0, 64),
    overflow: members.length > 64,
  };
}
async function runOwnedChild({
  consumer,
  harness,
  arguments_,
  environment,
  retain,
}) {
  const receipt = {
    argv: [process.execPath, harness, ...arguments_],
    cwd: consumer,
    environment,
    stdoutEOF: false,
    stderrEOF: false,
    reaped: false,
    errors: [],
  };
  let child, closed, failure, deadline, killTimer, shutdownTimer;
  let stdout = Buffer.alloc(0),
    stderr = Buffer.alloc(0);
  function record(error) {
    receipt.errorCount = Math.min(
      Number.MAX_SAFE_INTEGER,
      (receipt.errorCount ?? 0) + 1
    );
    if (receipt.errors.length < 16)
      receipt.errors.push(String(error).slice(0, 2048));
    else receipt.errorOverflow = true;
  }
  function terminate(signal) {
    if (!child?.pid) return;
    const current = processIdentity(child.pid);
    if (
      current.state === 'present' &&
      JSON.stringify(current) === JSON.stringify(receipt.identity) &&
      current.value.split(/\s+/)[2] === String(child.pid)
    ) {
      try {
        process.kill(-child.pid, signal);
        receipt.signals ??= [];
        receipt.signals.push(signal);
      } catch (error) {
        if (error.code !== 'ESRCH') record(error);
      }
    } else if (
      current.state !== 'absent' ||
      processGroup(child.pid).members?.length
    )
      record('Unknown selected process authority; signal withheld');
  }
  function interrupted(signal) {
    failure ??= Error('Proof parent received ' + signal);
    record(failure);
    terminate('SIGTERM');
    killTimer ??= setTimeout(() => terminate('SIGKILL'), 2000);
  }
  const term = () => interrupted('SIGTERM'),
    interrupt = () => interrupted('SIGINT');
  process.on('SIGTERM', term);
  process.on('SIGINT', interrupt);
  try {
    if (failure) throw failure;
    child = spawn(process.execPath, [harness, ...arguments_], {
      cwd: consumer,
      env: environment,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    closed = new Promise((resolveClose) => {
      child.once('error', (error) => {
        failure ??= error;
        record(error);
      });
      child.stdout.on('end', () => {
        receipt.stdoutEOF = true;
      });
      child.stderr.on('end', () => {
        receipt.stderrEOF = true;
      });
      for (const [stream, name, limit] of [
        [child.stdout, 'stdout', 4 * 1024 * 1024],
        [child.stderr, 'stderr', 8 * 1024 * 1024],
      ]) {
        stream.on('error', (error) => {
          failure ??= error;
          record(error);
          terminate('SIGTERM');
          killTimer ??= setTimeout(() => terminate('SIGKILL'), 2000);
        });
        stream.on('data', (chunk) => {
          const old = name === 'stdout' ? stdout : stderr;
          if (old.length + chunk.length > limit) {
            failure ??= Error(name + ' bound exceeded');
            record(failure);
            terminate('SIGTERM');
            killTimer ??= setTimeout(() => terminate('SIGKILL'), 2000);
          }
          const combined = Buffer.concat([
            old,
            chunk.subarray(0, Math.max(0, limit - old.length)),
          ]);
          if (name === 'stdout') stdout = combined;
          else stderr = combined;
        });
      }
      child.once('close', (code, signal) => {
        receipt.exit = code;
        receipt.signal = signal;
        receipt.reaped = true;
        resolveClose();
      });
    });
    receipt.pid = child.pid;
    receipt.identity = child.pid
      ? processIdentity(child.pid)
      : { state: 'unknown' };
    writeFileSync(
      join(retain, 'child-process-initial.json'),
      JSON.stringify(receipt, null, 2) + '\n'
    );
    assert.equal(
      receipt.identity.state,
      'present',
      'Owned child identity required'
    );
    assert.equal(
      receipt.identity.value.split(/\s+/)[2],
      String(child.pid),
      'Exclusive child process group required'
    );
    deadline = setTimeout(() => {
      failure ??= Error('Installed application child deadline');
      record(failure);
      terminate('SIGTERM');
      killTimer ??= setTimeout(() => terminate('SIGKILL'), 2000);
    }, 120000);
    await Promise.race([
      closed,
      new Promise((_, reject) => {
        shutdownTimer = setTimeout(
          () => reject(Error('Installed child shutdown deadline')),
          132000
        );
      }),
    ]);
    if (receipt.exit !== 0)
      failure ??= Error('Installed application child exited unsuccessfully');
  } catch (error) {
    failure ??= error;
    record(error);
    terminate('SIGTERM');
    if (closed) {
      let drainTimer;
      killTimer ??= setTimeout(() => terminate('SIGKILL'), 2000);
      try {
        await Promise.race([
          closed,
          new Promise((resolveDrain) => {
            drainTimer = setTimeout(resolveDrain, 12000);
          }),
        ]);
      } finally {
        clearTimeout(drainTimer);
      }
    }
  } finally {
    clearTimeout(deadline);
    clearTimeout(killTimer);
    clearTimeout(shutdownTimer);
    process.off('SIGTERM', term);
    process.off('SIGINT', interrupt);
    if (child?.pid) {
      receipt.after = processIdentity(child.pid);
      receipt.group = processGroup(child.pid);
      receipt.closure =
        receipt.after.state === 'absent' &&
        receipt.group.state === 'observed' &&
        !receipt.group.overflow &&
        receipt.group.members.length === 0 &&
        receipt.stdoutEOF &&
        receipt.stderrEOF &&
        receipt.reaped;
    } else {
      receipt.noChildPid = true;
      receipt.closure = true;
    }
    writeFileSync(join(retain, 'child-stdout.log'), stdout);
    writeFileSync(join(retain, 'child-stderr.log'), stderr);
    writeFileSync(
      join(retain, 'child-process.json'),
      JSON.stringify(receipt, null, 2) + '\n'
    );
    if (!receipt.closure)
      failure ??= Error(
        'Selected child closure unknown; no further launch authorized'
      );
    if (receipt.errors.length || receipt.errorOverflow)
      failure ??= Error('Child lifecycle evidence contains failures');
  }
  if (failure) throw failure;
  return receipt;
}

export async function runInstalledApplicationProof(options) {
  assert.ok(options && typeof options === 'object');
  assert.ok(
    Object.keys(options).every((key) =>
      ['root', 'retain', 'python', 'environment', 'home', 'tmpdir'].includes(
        key
      )
    ),
    'Unknown installed application proof options'
  );
  const { root = sourceRoot, ...paths } = options;
  assert.equal(
    realpathSync(root),
    realpathSync(sourceRoot),
    'The source root is fixed'
  );
  const arguments_ = [
    'retain',
    'python',
    'environment',
    'home',
    'tmpdir',
  ].flatMap((name) => ['--' + name, paths[name]]);
  parseProofArguments(arguments_);
  assert.ok(
    paths.python.startsWith(paths.environment + '/bin/'),
    'Direct exclusive environment Python required'
  );
  assert.notEqual(realpathSync(paths.home), realpathSync(root));
  const retain = paths.retain;
  mkdirSync(retain); // Preserve every attempted consumer; never replace previous evidence.
  const save = (name, value) => {
    const bytes = JSON.stringify(value, null, 2) + '\n';
    assert.ok(
      Buffer.byteLength(bytes) <= 64 * 1024 * 1024,
      'Retained artifact byte bound'
    );
    writeFileSync(join(retain, name), bytes);
  };
  const report = {
    profile: 'react-native-a2ui-ag-ui',
    claim:
      'Actual compiled production application, native Session and borrowed shared actions against the canonical offline graph',
    compiler: {},
    bufferedOrderedTerminalProof: true,
  };
  let failure;
  try {
    const { packLocalArtifacts } = await import(
      '../react-parity/verify-packages.mjs'
    );
    const { emitCandidate, packCandidate } = await import(
      '../react-parity/ag-ui-candidate-package.mjs'
    );
    const {
      derivePresentationConsumer,
      installPresentationConsumer,
      assertPresentationInstallation,
      reactAgUiPresentationSeeds,
    } = await import('../react-parity/markdown-presentation-build.mjs');
    const graph = join(root, 'cockpit/ag-ui/a2ui/python/src/graph.py'),
      lock = join(root, 'package-lock.json');
    const graphHash =
        '9464b3361282252102ffead838724f24e20cc69607859029f98203aaeb5a8390',
      lockHash =
        '53377110c750ed07b1bd9e54a1a121599af085ce4cad0bf1ae4951b0e00a6092';
    assert.equal(hash(readFileSync(graph)), graphHash);
    assert.equal(hash(readFileSync(lock)), lockHash);
    const inputs = {},
      appPath = 'cockpit/ag-ui/a2ui/react';
    function retainSource(path) {
      const relativePath = relative(root, path);
      assert.ok(!relativePath.startsWith('..'));
      const target = join(retain, 'source-inputs', relativePath);
      mkdirSync(dirname(target), { recursive: true });
      const bytes = readFileSync(path);
      writeFileSync(target, bytes);
      inputs[relativePath] = hash(bytes);
    }
    const selected = [
      ...files(join(root, appPath, 'src')),
      ...files(join(root, 'libs/cockpit-a2ui-react/src')),
      ...files(join(root, 'libs/cockpit-runtime-bridge/src')),
    ].filter(
      (path) =>
        !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path) &&
        !path
          .split(/[\\/]/)
          .some((part) =>
            ['node_modules', 'testing', 'fixtures'].includes(part)
          )
    );
    const prerequisites = [
      'package-lock.json',
      'scripts/react-cockpit/ag-ui-a2ui-native-probe.mjs',
      appPath + '/fixtures/installed-application.mjs',
      appPath + '/index.html',
      'scripts/react-parity/verify-packages.mjs',
      'scripts/react-parity/ag-ui-candidate-package.mjs',
      'scripts/react-parity/langgraph-candidate-package.mjs',
      'scripts/react-parity/markdown-presentation-build.mjs',
      'scripts/react-parity/verify-langgraph-candidate.mjs',
      'fixtures/react-parity/native-ag-ui-a2ui/server.mjs',
      'fixtures/react-parity/native-ag-ui-a2ui/compiled_worker.py',
      'fixtures/react-parity/native-ag-ui-a2ui/model.py',
      'cockpit/ag-ui/a2ui/python/src/graph.py',
      'cockpit/ag-ui/a2ui/python/src/server.py',
      'cockpit/ag-ui/a2ui/python/pyproject.toml',
      'cockpit/ag-ui/a2ui/python/uv.lock',
    ];
    for (const path of [
      ...selected,
      ...prerequisites.map((path) => join(root, path)),
    ])
      retainSource(path);
    for (const project of ['core', 'content', 'react', 'a2ui'])
      for (const path of files(join(root, 'dist/libs', project)))
        retainSource(path);
    const tarballs = packLocalArtifacts(root, retain, ['react'], {
      optionalPeers: ['a2ui'],
    });
    const candidate = join(retain, 'candidate');
    mkdirSync(candidate);
    const emitted = emitCandidate(root, candidate);
    save('candidate-emission.json', emitted);
    for (const row of emitted.sources) {
      const path = typeof row === 'string' ? row : row.path;
      if (path && existsSync(join(root, path))) retainSource(join(root, path));
    }
    const packed = packCandidate(candidate, retain);
    save('candidate-pack.json', packed);
    tarballs['@threadplane/ag-ui'] = 'file:' + packed.tarball;
    assert.deepEqual(
      Object.keys(tarballs).sort(),
      ['a2ui', 'ag-ui', 'content', 'core', 'react'].map(
        (name) => '@threadplane/' + name
      )
    );
    save('tarballs.json', tarballs);
    const consumer = join(retain, 'consumer');
    mkdirSync(consumer);
    const rootLock = json(lock),
      derived = derivePresentationConsumer(
        rootLock,
        tarballs,
        reactAgUiPresentationSeeds,
        report.profile
      );
    save('derived.json', derived);
    const environment = {
      ...process.env,
      HOME: paths.home,
      TMPDIR: paths.tmpdir,
      npm_config_offline: 'true',
    };
    const installation = installPresentationConsumer(
      consumer,
      rootLock,
      tarballs,
      {
        seeds: reactAgUiPresentationSeeds,
        profile: report.profile,
        env: environment,
      }
    );
    save('installation.json', installation);
    for (const path of selected) {
      const target = join(consumer, relative(root, path));
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(path, target);
    }
    const index = join(consumer, appPath, 'index.html');
    copyFileSync(join(root, appPath, 'index.html'), index);
    const harness = join(
      consumer,
      appPath,
      'fixtures/installed-application.mjs'
    );
    mkdirSync(dirname(harness), { recursive: true });
    copyFileSync(
      join(root, appPath, 'fixtures/installed-application.mjs'),
      harness
    );
    const proof = `import { RenderSpec } from '@threadplane/react/render';\nimport { createA2uiMessageParser } from '@threadplane/a2ui';\nimport { createA2uiSurfaces } from '@threadplane/content/a2ui';\nimport { createRenderState } from '@threadplane/content/render-state';\nimport { createSession, type Session } from '@threadplane/ag-ui';\nexport const session: Session = createSession({url:'https://invalid.example/ag-ui',threadId:'declaration-only'});\nexport const contract = {RenderSpec,createA2uiMessageParser,createA2uiSurfaces,createRenderState,session};\n`;
    writeFileSync(join(consumer, 'declarations.ts'), proof);
    const ts = (
      await import(
        pathToFileURL(
          join(consumer, 'node_modules/typescript/lib/typescript.js')
        ).href
      )
    ).default;
    function compile(name, mode, roots) {
      const config = {
        compilerOptions: {
          target: 'ES2022',
          module: mode === 'NodeNext' ? 'NodeNext' : 'ESNext',
          moduleResolution: mode,
          lib: ['ES2022', 'ESNext.Disposable', 'DOM'],
          jsx: 'react-jsx',
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          types: ['react', 'react-dom'],
          typeRoots: [join(consumer, 'node_modules/@types')],
        },
        files: roots,
      };
      const configFile = join(consumer, 'tsconfig.' + name + '.json');
      writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
      const parsed = ts.parseJsonConfigFileContent(
        config,
        ts.sys,
        consumer,
        undefined,
        configFile
      );
      assert.equal(parsed.errors.length, 0);
      const host = ts.createCompilerHost(parsed.options);
      host.getCurrentDirectory = () => consumer;
      const program = ts.createProgram(parsed.fileNames, parsed.options, host),
        diagnostics = ts.getPreEmitDiagnostics(program);
      const sourceInputs = program.getSourceFiles().map((source) => {
        assert.ok(
          source.fileName.startsWith(consumer + '/'),
          'No workspace compiler inputs'
        );
        return {
          path: source.fileName,
          sha256: hash(readFileSync(source.fileName)),
        };
      });
      report.compiler[name] = {
        config,
        typescript: ts.version,
        inputs: sourceInputs,
        diagnostics: diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          path: diagnostic.file?.fileName,
          message: ts.flattenDiagnosticMessageText(
            diagnostic.messageText,
            '\n'
          ),
        })),
      };
      save('compiler-' + name + '.json', report.compiler[name]);
      assert.equal(
        diagnostics.length,
        0,
        ts.formatDiagnosticsWithColorAndContext(diagnostics, {
          getCurrentDirectory: () => consumer,
          getCanonicalFileName: (path) => path,
          getNewLine: () => '\n',
        })
      );
    }
    compile('installed-NodeNext', 'NodeNext', ['declarations.ts']);
    compile('installed-Bundler', 'Bundler', ['declarations.ts']);
    compile('production-application-Bundler', 'Bundler', [
      appPath + '/src/main.tsx',
    ]);
    const { build } = await import(
      pathToFileURL(join(consumer, 'node_modules/vite/dist/node/index.js')).href
    );
    const built = await build({
      configFile: false,
      envFile: false,
      root: join(consumer, appPath),
      base: '/ag-ui/a2ui/react/',
      esbuild: { jsx: 'automatic' },
      build: {
        outDir: join(retain, 'page-bundle'),
        emptyOutDir: false,
        sourcemap: true,
      },
    });
    const modules = (Array.isArray(built) ? built : [built])
      .flatMap((entry) => entry.output)
      .flatMap((chunk) => Object.entries(chunk.modules ?? {}));
    save('page-bundle-modules.json', modules);
    for (const suffix of [
      '/src/application.ts',
      '/src/terminal.ts',
      '/libs/cockpit-a2ui-react/src/surface.ts',
      '/node_modules/@threadplane/react/src/render/render-spec.js',
      '/node_modules/@threadplane/a2ui/src/lib/parser.js',
      '/node_modules/@threadplane/content/src/a2ui/create-surfaces.js',
      '/node_modules/@threadplane/content/src/render-state/create-render-state.js',
      '/node_modules/@threadplane/ag-ui/libs/ag-ui/src/runtime/session-publication.js',
    ])
      assert.ok(
        modules.some(
          ([path, module]) => path.endsWith(suffix) && module.renderedLength > 0
        ),
        'Required nonzero installed/private production implementation: ' +
          suffix
      );
    const candidateEntry = join(
      consumer,
      'node_modules/@threadplane/ag-ui/fixtures/react-parity/ag-ui-candidate/entry.js'
    );
    assert.ok(
      modules.some(
        ([path, module]) =>
          path.includes('/node_modules/@ag-ui/client/') &&
          module.renderedLength > 0
      )
    );
    assert.ok(
      !modules.some(
        ([path]) =>
          /\/(?:testing|fixtures|e2e)\//.test(path) && path !== candidateEntry
      )
    );
    assert.ok(
      !modules.some(([path]) =>
        /\/node_modules\/(?:@angular\/|@angular-devkit\/|@threadplane\/langgraph\/|@langchain\/|@mastra\/|openai\/|@anthropic-ai\/)/.test(
          path
        )
      )
    );
    assert.ok(!modules.some(([path]) => path.startsWith(root + '/libs/')));
    const esbuild = await import(
      pathToFileURL(join(consumer, 'node_modules/esbuild/lib/main.js')).href
    );
    const bundled = await esbuild.build({
      absWorkingDir: consumer,
      entryPoints: [join(consumer, appPath, 'src/application.ts')],
      outfile: join(consumer, 'compiled/application.mjs'),
      bundle: true,
      packages: 'external',
      platform: 'node',
      format: 'esm',
      target: 'node22',
      jsx: 'automatic',
      sourcemap: true,
      metafile: true,
    });
    save('application-bundle-metafile.json', bundled.metafile);
    for (const path of Object.keys(bundled.metafile.inputs))
      assert.ok(
        !isAbsolute(path) || path.startsWith(consumer + '/'),
        'No workspace Node bundle inputs'
      );
    assert.ok(
      Object.keys(bundled.metafile.inputs).some((path) =>
        path.endsWith('/src/application.ts')
      )
    );
    assert.ok(
      Object.keys(bundled.metafile.inputs).some((path) =>
        path.endsWith('/src/terminal.ts')
      )
    );
    const payloads = [];
    for (const [name, tarball] of Object.entries(tarballs)) {
      const unpacked = join(retain, 'payload-' + name.split('/')[1]);
      mkdirSync(unpacked);
      execFileSync('/usr/bin/tar', ['-xzf', tarball.slice(5), '-C', unpacked], {
        cwd: retain,
        env: environment,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
      for (const path of files(join(unpacked, 'package'))) {
        const packagePath = relative(join(unpacked, 'package'), path),
          installed = join(consumer, 'node_modules', name, packagePath);
        const expected = hash(readFileSync(path)),
          actual = hash(readFileSync(installed));
        assert.equal(actual, expected);
        payloads.push({
          name,
          path: packagePath,
          tarSha256: expected,
          installedSha256: actual,
        });
      }
    }
    save('payload-matches.json', payloads);
    assertPresentationInstallation(consumer, derived, tarballs);
    save('source-inputs.json', inputs);
    const childEnvironment = {
      PATH: dirname(process.execPath) + ':/usr/bin:/bin',
      HOME: paths.home,
      TMPDIR: paths.tmpdir,
      THREADPLANE_CANONICAL_FIXTURE: pathToFileURL(
        join(root, 'fixtures/react-parity/native-ag-ui-a2ui/server.mjs')
      ).href,
    };
    report.child = await runOwnedChild({
      consumer,
      harness,
      arguments_,
      environment: childEnvironment,
      retain,
    });
    report.receipt = json(join(retain, 'application-receipt.json'));
    assert.equal(report.receipt.turns.length, 4);
    assert.deepEqual(
      report.receipt.turns.map((turn) => turn.messages.length),
      [2, 4, 6, 8]
    );
    assert.ok(report.receipt.cleanup.every((row) => row.closed));
    assert.ok(Object.values(report.receipt.fixture.closure).every(Boolean));
    assert.equal(hash(readFileSync(graph)), graphHash);
    assert.equal(hash(readFileSync(lock)), lockHash);
    report.moduleCount = modules.length;
    report.payloadMatches = payloads.length;
  } catch (error) {
    failure = error;
    report.failure = { message: error.message, stack: error.stack };
  } finally {
    const inventory = [];
    let bytes = 0;
    function visit(directory) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name),
          stat = lstatSync(path);
        if (stat.isSymbolicLink()) {
          const target = realpathSync(path);
          assert.ok(
            target.startsWith(join(retain, 'consumer') + '/'),
            'Installed link cannot escape consumer'
          );
          inventory.push({
            path: relative(retain, path),
            link: readlinkSync(path),
          });
        } else if (stat.isDirectory()) visit(path);
        else if (stat.isFile()) {
          bytes += stat.size;
          assert.ok(
            inventory.length < 100000 && bytes < 1024 * 1024 * 1024,
            'Retained inventory bound'
          );
          inventory.push({
            path: relative(retain, path),
            bytes: stat.size,
            sha256: hash(readFileSync(path)),
          });
        }
      }
    }
    try {
      save('report.json', report);
      visit(retain);
      save('inventory.json', inventory);
    } catch (error) {
      failure ??= error;
      report.inventoryFailure = String(error);
      save('report.json', report);
    }
  }
  if (failure) throw failure;
  return report;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await runInstalledApplicationProof(
      parseProofArguments(process.argv.slice(2))
    );
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
