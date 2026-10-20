import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const module = await import('./prepare-ag-ui-a2ui-fixture.mjs').catch(
  () => ({})
);
test('native A2UI preparation exports an import-inert closed entry point', () => {
  assert.equal(typeof module.prepareAgUiA2uiFixture, 'function');
  assert.equal(typeof module.parsePreparationArguments, 'function');
});
const preparation =
  typeof module.prepareAgUiA2uiFixture === 'function' ? test : test.skip;

preparation('prepared browser service has its own finite lease and exact owned inputs', async () => {
  const prepared = { env: { HOME: '/owned/home' }, python: '/owned/python', environment: '/owned/environment', home: '/owned/home', tmpdir: '/owned/tmp', attempt: '/owned/attempt' };
  let specification;
  await module.servePreparedAgUiA2uiFixture(prepared, { run: async (value) => { specification = value; } });
  assert.equal(specification.timeoutMs, 35 * 60 * 1000);
  assert.equal(specification.allowInterrupt, true);
  assert.equal(specification.name, 'browser-server');
  assert.equal(specification.retain, prepared.attempt);
  assert.equal(specification.executable, process.execPath);
  assert.deepEqual(specification.args, [join(module.root, 'scripts/react-cockpit/serve.mjs'), 'ag-ui-a2ui', '--no-parent']);
  assert.deepEqual(specification.env, { ...prepared.env, THREADPLANE_AGUI_A2UI_BROWSER_RUNTIME: JSON.stringify({ python: prepared.python, environment: prepared.environment, home: prepared.home, tmpdir: prepared.tmpdir }), THREADPLANE_AGUI_A2UI_BROWSER_RETAIN: join(prepared.attempt, 'browser') });
});

for (const mode of ['parent-completion', 'fallback-expiry']) preparation(`actual browser stage preserves ${mode} lifetime with a fake clock`, async (context) => {
  const retain = await mkdtemp(join(tmpdir(), 'a2ui-service-clock-'));
  const child = new EventEmitter();
  child.pid = 12345;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let exited = false;
  const signals = [];
  const finish = () => {
    if (exited) return;
    exited = true;
    child.stdout.end();
    child.stderr.end();
    setImmediate(() => child.emit('close', 0, null));
  };
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const stage = module.servePreparedAgUiA2uiFixture({ env: {}, attempt: retain }, { run: (specification) => module.runPreparationStage({ ...specification, spawnChild: () => child, observeIdentity: () => exited ? null : '12345 1 12345 captured', observeGroup: () => exited ? [] : ['12345 1 12345 captured'], signalGroup: (_pid, signal) => { signals.push(signal); finish(); } }) }).then(value => ({ value }), error => ({ error }));
  try {
    // The old fixed lease expires here while the modeled 30-minute owner is still active.
    context.mock.timers.tick(20 * 60 * 1000);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(signals, [], 'service must remain alive at the old 20-minute deadline');
    context.mock.timers.tick(10 * 60 * 1000);
    assert.deepEqual(signals, [], 'service must outlive the full parent setup/test deadline');
    if (mode === 'parent-completion') process.emit('SIGTERM');
    else context.mock.timers.tick(5 * 60 * 1000);
    const outcome = await stage;
    if (mode === 'parent-completion') {
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.value.code, 0);
    } else assert.match(String(outcome.error), /Preparation stage deadline: browser-server/);
    const receipt = JSON.parse(await readFile(join(retain, 'browser-server-result.json'), 'utf8'));
    assert.equal(receipt.closure, true);
    assert.equal(receipt.reaped, true);
    assert.equal(receipt.stdoutEOF, true);
    assert.equal(receipt.stderrEOF, true);
    assert.equal(receipt.knownChildAbsent, true);
    assert.deepEqual(receipt.groupMembers, []);
    assert.deepEqual(signals, ['SIGTERM']);
  } finally {
    // Always release the injected child, even when the causal assertion fails.
    finish();
    await stage;
    context.mock.timers.reset();
  }
});

preparation('CLI accepts only explicit serve or installed proof modes', () => {
  assert.deepEqual(module.parsePreparationArguments([]), {
    serve: false,
    verifyApplication: false,
  });
  assert.deepEqual(module.parsePreparationArguments(['--serve']), {
    serve: true,
    verifyApplication: false,
  });
  assert.deepEqual(module.parsePreparationArguments(['--verify-application']), {
    serve: false,
    verifyApplication: true,
  });
  for (const flags of [
    ['--serve', '--verify-application'],
    ['--root', '/tmp'],
    ['--serve', '--serve'],
    ['--unknown'],
  ])
    assert.throws(() => module.parsePreparationArguments(flags));
});
preparation(
  'prepares only frozen own canonical A2UI Python 3.12 with closed child environment',
  async () => {
    const calls = [],
      parent = await mkdtemp(join(tmpdir(), 'a2ui-preparation-test-'));
    const tools = { uv: '/owned/uv', python: '/owned/python3.12' };
    const result = await module.prepareAgUiA2uiFixture({
      parent,
      tools,
      run: async (specification) => {
        calls.push(specification);
        return { code: 0, stdout: 'Python 3.12.10\n', stderr: '' };
      },
    });
    const sync = calls.find((call) => call.args[0] === 'sync');
    assert.ok(sync);
    assert.deepEqual(sync.args, [
      'sync',
      '--frozen',
      '--no-install-project',
      '--no-dev',
      '--no-config',
      '--no-python-downloads',
      '--python',
      tools.python,
      '--project',
      resolve(module.root, 'cockpit/ag-ui/a2ui/python'),
    ]);
    assert.equal(sync.timeoutMs, 300000);
    assert.equal(sync.env.UV_PROJECT_ENVIRONMENT, result.environment);
    assert.equal(sync.env.HOME, result.home);
    assert.equal(sync.env.UV_PYTHON, tools.python);
    assert.equal(sync.env.UV_PYTHON_DOWNLOADS, 'never');
    assert.equal(sync.env.UV_NO_CONFIG, '1');
    assert.equal(sync.env.NX_LOAD_DOT_ENV_FILES, 'false');
    for (const key of [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'LANGSMITH_API_KEY',
      'NODE_OPTIONS',
      'PYTHONPATH',
      'THREADPLANE_AG_UI_FIXTURE_ENVIRONMENT',
    ])
      assert.equal(sync.env[key], undefined);
    assert.ok(!result.environment.startsWith(result.retain + '/'));
    assert.ok(!result.home.startsWith(result.retain + '/'));
    assert.ok(result.python.startsWith(result.environment + '/bin/'));
  }
);
preparation(
  'installed proof runs once with exact measured options and retains failed attempts',
  async () => {
    const calls = [],
      parent = await mkdtemp(join(tmpdir(), 'a2ui-proof-preparation-test-'));
    let proof;
    const tools = { uv: '/owned/uv', python: '/owned/python3.12' };
    const result = await module.prepareAgUiA2uiFixture({
      parent,
      tools,
      verifyApplication: true,
      run: async (spec) => {
        calls.push(spec);
        return { code: 0, stdout: 'Python 3.12.10\n', stderr: '' };
      },
      prove: async (options) => {
        proof = options;
      },
    });
    assert.deepEqual(proof, {
      root: module.root,
      retain: result.retain,
      python: result.python,
      environment: result.environment,
      home: result.home,
      tmpdir: result.tmpdir,
    });
    const cache = calls.find((call) => call.name === 'public-package-cache');
    assert.ok(cache);
    assert.equal(cache.timeoutMs, 300000);
    assert.deepEqual(cache.args.slice(1, 3), ['cache', 'add']);
    const urls = cache.args.filter((arg) => arg.startsWith('https://'));
    assert.ok(
      urls.length > 0 &&
        urls.every((url) =>
          /^https:\/\/registry\.npmjs\.org\/.+\.tgz$/.test(url)
        )
    );
    assert.ok(cache.args.includes('--fetch-retries=0'));
    assert.equal(cache.env.npm_config_cache, result.env.npm_config_cache);
    assert.ok(!cache.env.npm_config_cache.startsWith(result.attempt + '/'));
    const manager = calls.filter(
      (call) => call.name === 'actual-canonical-manager'
    );
    assert.equal(manager.length, 1);
    assert.deepEqual(
      JSON.parse(manager[0].env.THREADPLANE_AGUI_A2UI_MANAGER_OPTIONS),
      {
        retain: join(result.attempt, 'canonical-manager'),
        python: result.python,
        environment: result.environment,
        home: result.home,
        tmpdir: result.tmpdir,
      }
    );
    const failed = new Error('frozen failure');
    await assert.rejects(
      module.prepareAgUiA2uiFixture({
        parent,
        tools,
        run: async () => {
          throw failed;
        },
      }),
      failed
    );
    const next = await module.prepareAgUiA2uiFixture({
      parent,
      tools,
      run: async () => ({ code: 0, stdout: 'Python 3.12.10\n', stderr: '' }),
    });
    assert.notEqual(next.attempt, result.attempt);
  }
);

for (const failure of ['identity-after-spawn', 'error-before-close'])
  preparation(`owned stage drains and reaps after ${failure}`, async () => {
    const retain = await mkdtemp(join(tmpdir(), 'a2ui-stage-control-'));
    const child = new EventEmitter();
    child.pid = 12345;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let exited = false,
      observations = 0;
    const finish = () => {
      if (exited) return;
      exited = true;
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', 1, null));
    };
    child.kill = () => {
      finish();
      return true;
    };
    const spawnChild = () => {
      if (failure === 'error-before-close')
        setImmediate(() =>
          child.emit('error', Error('deliberate early child error'))
        );
      setTimeout(finish, 25);
      return child;
    };
    const observeIdentity = () => {
      if (failure === 'identity-after-spawn' && observations++ === 0)
        throw Error('deliberate identity observation failure');
      return exited ? null : '12345 1 12345 captured';
    };
    await assert.rejects(
      module.runPreparationStage({
        executable: '/owned/child',
        args: [],
        env: {},
        timeoutMs: 100,
        retain,
        name: 'control',
        spawnChild,
        observeIdentity,
        observeGroup: () => (exited ? [] : ['12345 1 12345 captured']),
        signalGroup: () => finish(),
      })
    );
    const receipt = JSON.parse(
      await readFile(join(retain, 'control-result.json'), 'utf8')
    );
    assert.equal(receipt.reaped, true);
    assert.equal(receipt.stdoutEOF, true);
    assert.equal(receipt.stderrEOF, true);
    assert.equal(receipt.knownChildAbsent, true);
    assert.deepEqual(receipt.groupMembers, []);
  });

for (const mode of ['normal', 'timeout', 'overflow'])
  preparation(
    `owned stage verifies ${mode} exit with EOF and exact group closure`,
    async () => {
      const retain = await mkdtemp(join(tmpdir(), 'a2ui-stage-mode-'));
      const child = new EventEmitter();
      child.pid = 12345;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      let exited = false;
      const finish = (code = 0) => {
        if (exited) return;
        exited = true;
        child.stdout.end();
        child.stderr.end();
        setImmediate(() => child.emit('close', code, null));
      };
      const run = module.runPreparationStage({
        executable: '/owned/child',
        args: [],
        env: {},
        timeoutMs: 10,
        retain,
        name: 'control',
        spawnChild: () => {
          if (mode === 'normal') setImmediate(() => finish());
          if (mode === 'overflow')
            setImmediate(() =>
              child.stdout.write(Buffer.alloc(4 * 1024 * 1024 + 1))
            );
          return child;
        },
        observeIdentity: () => (exited ? null : '12345 1 12345 captured'),
        observeGroup: () => (exited ? [] : ['12345 1 12345 captured']),
        signalGroup: () => finish(1),
      });
      if (mode === 'normal') assert.equal((await run).code, 0);
      else
        await assert.rejects(
          run,
          mode === 'timeout' ? /deadline/ : /output bound/
        );
      const receipt = JSON.parse(
        await readFile(join(retain, 'control-result.json'), 'utf8')
      );
      assert.equal(receipt.closure, true);
      assert.equal(receipt.reaped, true);
      assert.equal(receipt.stdoutEOF, true);
      assert.equal(receipt.stderrEOF, true);
    }
  );

preparation(
  'early error wakes a long stage and reports unknown closure after bounded drain',
  async () => {
    const retain = await mkdtemp(join(tmpdir(), 'a2ui-stage-delayed-close-'));
    const child = new EventEmitter();
    child.pid = 12345;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let exited = false;
    const run = module
      .runPreparationStage({
        executable: '/owned/child',
        args: [],
        env: {},
        timeoutMs: 1000,
        drainTimeoutMs: 20,
        retain,
        name: 'control',
        spawnChild: () => {
          setImmediate(() =>
            child.emit('error', Error('deliberate early failure without close'))
          );
          return child;
        },
        observeIdentity: () => (exited ? null : '12345 1 12345 captured'),
        observeGroup: () => (exited ? [] : ['12345 1 12345 captured']),
        signalGroup: () => {
          // Deliberately leave the injected child open to prove bounded unknown-closure reporting.
        },
      })
      .then(
        () => 'unexpected success',
        (error) => String(error)
      );
    const result = await Promise.race([
      run,
      new Promise((resolve) => setTimeout(() => resolve('unbounded'), 100)),
    ]);
    exited = true;
    child.stdout.end();
    child.stderr.end();
    child.emit('close', 1, null);
    await run;
    assert.match(result, /deliberate early failure/);
    const receipt = JSON.parse(
      await readFile(join(retain, 'control-result.json'), 'utf8')
    );
    assert.equal(receipt.closure, false);
    assert.match(receipt.failure, /deliberate early failure/);
  }
);
