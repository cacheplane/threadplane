import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { assertTemplateDiagnostic } from '../../../../scripts/react-parity/markdown-presentation-build.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

// The installed application builder synthesizes this CSS import entry. It is
// metadata, not a file; retain it separately instead of inventing a file hash.
export function angularStatsInputs(stats) {
  const virtual = {};
  const files = Object.keys(stats.inputs).filter((path) => {
    if (path !== 'angular:styles/global:styles') return true;
    virtual[path] = stats.inputs[path];
    return false;
  });
  return { files, virtual };
}

// Stats paths belong to the emitting Angular workspace, not the consumer root.
export function angularInputHashes(consumer, cwd, inputs) {
  const root = realpathSync(consumer);
  return Object.fromEntries(
    inputs.map((input) => {
      const path = resolve(realpathSync(cwd), input);
      assert.ok(
        path.startsWith(root + sep),
        `Input outside consumer: ${input}`
      );
      const local = relative(root, path).replaceAll('\\', '/');
      assert.doesNotMatch(
        local,
        /(?:^|\/)(?:libs|fixtures|react)\/|node_modules\/(?:react(?:-dom)?\/|@types\/react(?:-dom)?\/|@threadplane\/(?:react|chat|telemetry|render|a2ui|ag-ui)\/|@threadplane\/langgraph\/(?:fesm\d*|esm\d*|types)\/)|runtime-entry\//,
        `Forbidden Angular input: ${local}`
      );
      assert.ok(
        realpathSync(path).startsWith(root + sep),
        `Input outside consumer: ${input}`
      );
      return [local, digest(readFileSync(path))];
    })
  );
}

export function assertAngularComposition(types, runtime) {
  for (const path of [
    'angular/src/main.ts',
    'angular/src/app.component.ts',
    'shared/application.ts',
    'shared/message-content.ts',
  ]) {
    assert.ok(
      types[path],
      'Authored application compiler input required: ' + path
    );
    assert.ok(
      runtime[path],
      'Authored application runtime input required: ' + path
    );
  }
  for (const path of [
    '@threadplane/langgraph/runtime/create-session',
    '@threadplane/content/src/markdown/create-markdown',
    '@threadplane/content/src/messages/create-message-content',
  ]) {
    assert.ok(
      types['node_modules/' + path + '.d.ts'],
      'Installed declarations required: ' + path
    );
    assert.ok(
      runtime['node_modules/' + path + '.js'],
      'Installed runtime required: ' + path
    );
  }
  for (const entry of [
    'threadplane-angular',
    'threadplane-angular-markdown',
    'threadplane-angular-chat',
  ]) {
    assert.ok(
      types['node_modules/@threadplane/angular/types/' + entry + '.d.ts'],
      'Installed Angular declarations required: ' + entry
    );
    assert.ok(
      runtime['node_modules/@threadplane/angular/fesm2022/' + entry + '.mjs'],
      'Installed Angular runtime required: ' + entry
    );
  }
}

export function compileAngularApplication({ consumer, run }) {
  const cwd = join(consumer, 'angular');
  const tsc = 'node_modules/typescript/bin/tsc';
  const ngc = 'node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js';
  const typecheck = (config) => {
    const result = run(
      process.execPath,
      [
        join(consumer, tsc),
        '-p',
        config,
        '--noEmit',
        '--listFiles',
        '--pretty',
        'false',
      ],
      cwd
    );
    return angularInputHashes(
      consumer,
      cwd,
      result.stdout.split(/\r?\n/).filter(isAbsolute)
    );
  };
  const templatecheck = (config, allowFailure = false) =>
    run(
      process.execPath,
      [join(consumer, ngc), '-p', config, '--noEmit'],
      cwd,
      { allowFailure }
    );
  const inputs = typecheck('tsconfig.app.json');
  templatecheck('tsconfig.app.json');
  const negatives = {};
  for (const kind of ['wrong', 'missing']) {
    const file = `__snapshot-negative-${kind}.ts`;
    const config = `tsconfig.negative-${kind}.json`;
    const source = `import { Component } from '@angular/core';
import { MarkdownComponent } from '@threadplane/angular/markdown';
@Component({selector:'negative-host',standalone:true,imports:[MarkdownComponent],template: \`<threadplane-markdown ${
      kind === 'wrong' ? '[snapshot]="value"' : ''
    } />\`})
export class NegativeHost { readonly value = 'not a snapshot'; }\n`;
    const configuration =
      JSON.stringify(
        {
          extends: './tsconfig.json',
          compilerOptions: { noEmit: true },
          files: [file],
        },
        null,
        2
      ) + '\n';
    assert.equal(existsSync(join(cwd, file)), false);
    assert.equal(existsSync(join(cwd, config)), false);
    try {
      writeFileSync(join(cwd, file), source, { flag: 'wx' });
      writeFileSync(join(cwd, config), configuration, { flag: 'wx' });
      const negativeInputs = typecheck(config);
      assert.ok(
        negativeInputs[
          'node_modules/@threadplane/angular/types/threadplane-angular-markdown.d.ts'
        ],
        'Installed Markdown APF declaration required'
      );
      assert.ok(
        negativeInputs[
          'node_modules/@threadplane/content/src/markdown/index.d.ts'
        ],
        'Installed Markdown content declarations required'
      );
      const result = templatecheck(config, true);
      assert.equal(
        result.status,
        1,
        'Invalid Angular snapshot must fail installed ngc'
      );
      const diagnostic = result.stdout + result.stderr;
      assertTemplateDiagnostic(kind, diagnostic);
      negatives[kind] = {
        code: kind === 'wrong' ? 'TS2322' : 'NG8008',
        expectedType: 'MarkdownSnapshot',
        source,
        sourceSha256: digest(source),
        configuration,
        configurationSha256: digest(configuration),
        inputs: negativeInputs,
        diagnostic,
        restored: true,
      };
    } finally {
      rmSync(join(cwd, file), { force: true });
      rmSync(join(cwd, config), { force: true });
    }
  }
  typecheck('tsconfig.app.json');
  templatecheck('tsconfig.app.json');
  return {
    version: json(join(consumer, 'node_modules/typescript/package.json'))
      .version,
    executable: tsc,
    executableSha256: digest(readFileSync(join(consumer, tsc))),
    inputs,
    configurations: angularInputHashes(consumer, cwd, [
      'tsconfig.json',
      'tsconfig.app.json',
    ]),
    angular: {
      version: json(
        join(consumer, 'node_modules/@angular/compiler-cli/package.json')
      ).version,
      executable: ngc,
      executableSha256: digest(readFileSync(join(consumer, ngc))),
      strictTemplates: true,
      negatives,
    },
  };
}

export function bundleAngularApplication({
  consumer,
  configuration,
  compilation,
  run,
}) {
  const cwd = join(consumer, 'angular');
  const executable = 'node_modules/@angular/cli/bin/ng.js';
  const result = run(
    process.execPath,
    [
      join(consumer, executable),
      'build',
      'native-conversation-angular',
      '--configuration=' + configuration,
    ],
    cwd
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  const statsPath = join(cwd, 'dist/stats.json');
  const stats = angularStatsInputs(json(statsPath));
  const inputs = angularInputHashes(consumer, cwd, stats.files);
  assertAngularComposition(compilation.inputs, inputs);
  assert.ok(
    Object.keys(inputs).some((path) =>
      path.startsWith('node_modules/@angular/core/')
    ),
    'Installed Angular shell runtime required'
  );
  const output = join(cwd, 'dist/browser');
  assert.ok(
    existsSync(join(output, 'index.html')),
    'Emitted browser entry required'
  );
  // Keep genuine stats with the published shell, including its consumer-relative inventory.
  writeFileSync(join(output, 'stats.json'), readFileSync(statsPath));
  writeFileSync(
    join(output, 'build-inputs.json'),
    JSON.stringify(Object.keys(inputs), null, 2) + '\n'
  );
  return {
    output,
    inputs,
    virtualInputs: stats.virtual,
    executable,
    executableSha256: digest(readFileSync(join(consumer, executable))),
    configuration: angularInputHashes(consumer, cwd, ['angular.json']),
    version: json(join(consumer, 'node_modules/@angular/cli/package.json'))
      .version,
  };
}
