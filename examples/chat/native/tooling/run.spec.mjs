import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseOptions,
  preparationEnvironment,
  foundationCommands,
} from './run.mjs';

test('build defaults to production and accepts Nx-consumed configuration', () => {
  assert.deepEqual(parseOptions(['build'], {}), {
    configuration: 'production',
    assistantId: '',
  });
  assert.equal(
    parseOptions(['build'], { NX_TASK_TARGET_CONFIGURATION: 'development' })
      .configuration,
    'development'
  );
  assert.equal(
    parseOptions(['build', '--configuration=development'], {}).configuration,
    'development'
  );
});

test('closed framework selection propagates through launcher and foundation commands', () => {
  for (const mode of ['build', 'test']) {
    assert.equal(
      parseOptions([mode, '--framework=angular'], {}).framework,
      'angular'
    );
    assert.equal(
      parseOptions([mode, '--framework=react'], {}).framework,
      'react'
    );
    for (const value of ['vue', '', 'Angular'])
      assert.throws(
        () => parseOptions([mode, '--framework=' + value], {}),
        /framework/i
      );
    assert.throws(
      () =>
        parseOptions([mode, '--framework=angular', '--framework=react'], {}),
      /framework/i
    );
  }
  assert.deepEqual(
    foundationCommands('/owned/root', 'angular').map(({ args }) => args[2]),
    ['core', 'content', 'angular']
  );
  assert.throws(() => foundationCommands('/owned/root', 'vue'), /framework/i);
  assert.equal(
    parseOptions(['serve', '--framework=angular'], {
      NATIVE_LANGGRAPH_URL: 'http://127.0.0.1:1',
      NATIVE_ASSISTANT_ID: 'owned',
    }).framework,
    'angular'
  );
});

test('Angular project exposes only implemented selected build and test targets', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const path = fileURLToPath(
    new URL('../angular/project.json', import.meta.url)
  );
  assert.ok(existsSync(path), 'Authored Angular project required');
  const project = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(project.name, 'native-conversation-angular');
  assert.deepEqual(Object.keys(project.targets).sort(), [
    'build',
    'conversation-e2e',
    'development-e2e',
    'e2e',
    'serve',
    'test',
    'tooling-test',
  ]);
  for (const target of ['build', 'test']) {
    assert.equal(project.targets[target].cache, false);
    assert.deepEqual(project.targets[target].dependsOn, []);
    assert.equal(
      project.targets[target].options.command,
      `node examples/chat/native/tooling/run.mjs ${target} --framework=angular`
    );
  }
  assert.equal(
    project.targets.serve.options.command,
    'node examples/chat/native/tooling/run.mjs serve --framework=angular'
  );
  assert.equal(project.targets.serve.continuous, true);
  assert.equal(
    project.targets['development-e2e'].options.config,
    'examples/chat/native/angular/development.playwright.config.ts'
  );
  assert.equal(
    project.targets.e2e.options.config,
    'examples/chat/native/angular/playwright.config.ts'
  );
  assert.equal(project.targets.e2e.executor, '@nx/playwright:playwright');
});

test('rejects unsupported configuration, modes and application arguments', () => {
  for (const args of [
    ['serve'],
    ['build', '--port=4200'],
    ['build', '--endpoint=x'],
    ['build', '--configuration=test'],
    ['build', '--configuration'],
    ['build', '--configuration=production', '--configuration=development'],
  ])
    assert.throws(() => parseOptions(args, {}));
  assert.throws(() =>
    parseOptions(['build'], { NX_TASK_TARGET_CONFIGURATION: 'test' })
  );
  assert.throws(() =>
    parseOptions(['build', '--configuration=production'], {
      NX_TASK_TARGET_CONFIGURATION: 'development',
    })
  );
});

test('positive environment allowlist reaches real child without changing parent keys', () => {
  const supplied = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NATIVE_LANGGRAPH_API_KEY: 'owned-secret',
    VITE_SECRET: 'owned-secret',
    NODE_OPTIONS: '--trace-warnings',
    HTTPS_PROXY: 'owned-secret',
    NATIVE_ASSISTANT_ID: 'assistant',
    NATIVE_PROXY_ORIGIN: 'http://127.0.0.1:4312',
    NATIVE_LANGGRAPH_URL: 'https://private-upstream.invalid',
  };
  const before = { ...supplied };
  const env = preparationEnvironment(supplied);
  const child = spawnSync(
    process.execPath,
    ['-e', 'console.log(JSON.stringify(process.env))'],
    { env, encoding: 'utf8' }
  );
  assert.equal(child.status, 0);
  const actual = JSON.parse(child.stdout);
  assert.equal(actual.NATIVE_LANGGRAPH_API_KEY, '');
  assert.equal(actual.NX_LOAD_DOT_ENV_FILES, 'false');
  assert.equal(actual.NX_TUI, 'false');
  assert.equal(actual.PATH, supplied.PATH);
  for (const key of [
    'VITE_SECRET',
    'NODE_OPTIONS',
    'HTTPS_PROXY',
    'NATIVE_ASSISTANT_ID',
    'NATIVE_PROXY_ORIGIN',
    'NATIVE_LANGGRAPH_URL',
  ])
    assert.equal(actual[key], undefined);
  assert.deepEqual(supplied, before);
  assert.equal(parseOptions(['build'], supplied).assistantId, 'assistant');
});

test('argument rejection does not print a supplied credential value', () => {
  assert.throws(
    () => parseOptions(['build', '--api-key=owned-cli-secret'], {}),
    (error) => !error.message.includes('owned-cli-secret')
  );
});

test('foundation invocations build only the ordered selected libraries', () => {
  assert.deepEqual(
    foundationCommands('/owned/root'),
    ['core', 'content', 'react'].map((project) => ({
      command: process.execPath,
      args: [
        '/owned/root/node_modules/nx/bin/nx.js',
        'build',
        project,
        '--excludeTaskDependencies',
        '--skip-nx-cache',
        '--outputStyle=stream',
      ],
      cwd: '/owned/root',
    }))
  );
});

test('installed Nx root dotenv loader cannot reinstate the proxy credential', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'native-dotenv-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, '.env'),
    'NATIVE_LANGGRAPH_API_KEY=owned-dotenv-secret\n'
  );
  const loader = createRequire(import.meta.url).resolve(
    'nx/src/utils/dotenv.js'
  );
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      `require(${JSON.stringify(loader)}).loadRootEnvFiles(${JSON.stringify(
        root
      )}); console.log(JSON.stringify({ key: process.env.NATIVE_LANGGRAPH_API_KEY }))`,
    ],
    { env: preparationEnvironment(process.env), encoding: 'utf8' }
  );
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { key: '' });
  assert.doesNotMatch(child.stdout + child.stderr, /owned-dotenv-secret/);
});

test('launcher import has no preparation side effects', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(
        new URL('./run.mjs', import.meta.url).href
      )})`,
    ],
    { cwd: '/', encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('Nx target owns preparation without outer dependency builds or unsupported targets', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const path = fileURLToPath(new URL('../react/project.json', import.meta.url));
  assert.ok(existsSync(path), 'Authored Nx project exists');
  const project = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(project.name, 'native-conversation-react');
  assert.deepEqual(Object.keys(project.targets).sort(), [
    'build',
    'copy-test',
    'e2e',
    'provider-test',
    'serve',
    'summary-provider-test',
    'test',
    'tooling-test',
  ]);
  assert.equal(project.targets.build.cache, false);
  assert.deepEqual(project.targets.build.dependsOn, []);
  assert.equal(project.targets.build.options.cwd, '{workspaceRoot}');
  assert.deepEqual(Object.keys(project.targets.build.configurations).sort(), [
    'development',
    'production',
  ]);
  assert.equal(project.targets.serve.continuous, true);
  assert.equal(project.targets.serve.cache, false);
  assert.deepEqual(project.targets.serve.dependsOn, []);
  assert.equal(project.targets.serve.options.readyWhen, undefined);
  assert.equal(
    project.targets.serve.options.command,
    'node examples/chat/native/tooling/run.mjs serve'
  );
  assert.equal(project.targets.e2e.executor, '@nx/playwright:playwright');
  assert.equal(project.targets.e2e.cache, false);
  assert.deepEqual(project.targets.e2e.dependsOn, []);
  assert.deepEqual(project.targets.e2e.options, {
    config: 'examples/chat/native/e2e/playwright.config.ts',
    skipInstall: true,
  });
  assert.equal(project.targets.test.executor, 'nx:run-commands');
  assert.deepEqual(project.targets['provider-test'], {
    executor: 'nx:run-commands',
    cache: false,
    dependsOn: [],
    options: {
      cwd: '{workspaceRoot}',
      parallel: false,
      commands: [
        'node node_modules/typescript/bin/tsc -p examples/chat/native/tooling/tsconfig.approval-provider-host.json',
        'node --import tsx --test examples/chat/native/tooling/approval-provider.spec.ts',
        'node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.base.json examples/chat/native/tooling/approval-provider.ts',
        'node node_modules/typescript/bin/tsc -p examples/chat/native/tooling/tsconfig.backup-provider-host.json',
        'node --import tsx --test examples/chat/native/tooling/backup-provider.spec.ts',
        'node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.base.json examples/chat/native/tooling/backup-provider.ts',
      ],
    },
  });
  assert.deepEqual(project.targets['summary-provider-test'], {
    executor: 'nx:run-commands',
    cache: false,
    dependsOn: [],
    options: {
      cwd: '{workspaceRoot}',
      parallel: false,
      commands: [
        'node node_modules/typescript/bin/tsc -p examples/chat/native/tooling/tsconfig.trip-summary-provider-host.json',
        'node --import tsx --test examples/chat/native/tooling/trip-summary-provider.spec.ts',
        'node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.base.json examples/chat/native/tooling/trip-summary-provider.ts',
      ],
    },
  });
  assert.equal(project.targets.test.cache, false);
  assert.deepEqual(project.targets.test.dependsOn, []);
  assert.equal(
    project.targets.test.options.command,
    'node examples/chat/native/tooling/run.mjs test'
  );
});

test('test accepts only Node test-name-pattern and keeps preparation arguments separate', () => {
  assert.deepEqual(
    parseOptions(['test', '--test-name-pattern=directory|projection'], {}),
    {
      configuration: 'production',
      assistantId: '',
      testNamePattern: 'directory|projection',
    }
  );
  assert.deepEqual(
    parseOptions(['test', '--test-name-pattern', 'directory'], {}),
    {
      configuration: 'production',
      assistantId: '',
      testNamePattern: 'directory',
    }
  );
  for (const args of [
    ['test', '--test-name-pattern'],
    ['test', '--test-name-pattern=a', '--test-name-pattern=b'],
    ['build', '--test-name-pattern=a'],
    ['test', '--test-only'],
  ])
    assert.throws(() => parseOptions(args, {}));
});

test('serve validates explicit upstream and assistant, development configuration and strict port arguments', () => {
  const env = {
    NATIVE_LANGGRAPH_URL: 'http://127.0.0.1:12345',
    NATIVE_ASSISTANT_ID: ' assistant ',
  };
  assert.deepEqual(parseOptions(['serve'], env), {
    configuration: 'development',
    assistantId: 'assistant',
    port: 4301,
  });
  assert.equal(
    parseOptions(['serve', '--configuration=development', '--port=4301'], env)
      .port,
    4301
  );
  assert.throws(() => parseOptions(['serve', '--port=0'], env), /port/i);
  for (const args of [
    ['--configuration=production'],
    ['--port'],
    ['--port=1.5'],
    ['--port=-1'],
    ['--port=65536'],
    ['--port='],
    ['--port=01'],
    ['--port=1', '--port=2'],
    ['--configuration=development', '--configuration=development'],
    ['--endpoint=secret'],
  ])
    assert.throws(() => parseOptions(['serve', ...args], env));
  for (const supplied of [
    {},
    { ...env, NATIVE_ASSISTANT_ID: ' ' },
    { ...env, NATIVE_LANGGRAPH_URL: '' },
    { ...env, NX_TASK_TARGET_CONFIGURATION: 'production' },
  ])
    assert.throws(() => parseOptions(['serve'], supplied));
  assert.throws(
    () => parseOptions(['serve', 'owned-positional-secret'], env),
    (error) => !error.message.includes('owned-positional-secret')
  );
});
