import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { assertHeadlessInputs, assertParserFreeInputs, consumerSpecifiers, installConsumer, packLocalArtifacts, runConsumer } from './verify-packages.mjs';
import { buildSync } from 'esbuild';
import { prepareInstalledTypes, prepareRuntimeConsumer, runRuntimeScenarios } from './runtime-consumer.mjs';

export function lockedAngularManifest(template, lock) {
  const dependencies = ['@angular/core', '@angular/common', '@angular/compiler', '@angular/platform-browser', 'rxjs', 'tslib'];
  const devDependencies = ['@angular/build', '@angular/cli', '@angular/compiler-cli', 'typescript'];
  const version = (name) => {
    const value = lock.packages?.[`node_modules/${name}`]?.version;
    if (!value) throw new Error(`Missing root lock version for ${name}`);
    return value;
  };
  const angularVersions = [...dependencies, ...devDependencies].filter((name) => name.startsWith('@angular/')).map(version);
  if (new Set(angularVersions.map((value) => value.split('.')[0])).size !== 1) throw new Error('Angular compiler/build/runtime major versions differ in root lock');
  return {
    ...template,
    dependencies: Object.fromEntries(dependencies.map((name) => [name, version(name)])),
    devDependencies: Object.fromEntries(devDependencies.map((name) => [name, version(name)])),
  };
}

export function angularBuildCommand(consumer) {
  return [join(consumer, 'node_modules/@angular/cli/bin/ng.js'), 'build', '--configuration=production', '--stats-json'];
}

export function assertAngularChatExports(names) {
  const expected = ['TextTranscriptComponent', 'ToolObservationComponent'];
  for (const name of expected)
    assert.ok(names.includes(name), `Angular chat missing ${name}`);
  assert.deepEqual(
    [...names].sort(),
    expected,
    'Angular chat has unexpected exports'
  );
}

/** Real Angular template checking against the installed secondary declarations. */
function verifyRejectedTranscriptTemplates(consumer) {
  writeFileSync(join(consumer, 'transcript-negative.ts'), `
import { Component } from '@angular/core';
import { TextTranscriptComponent, ToolObservationComponent } from '@threadplane/angular/chat';
@Component({ selector: 'negative-transcript', standalone: true, imports: [TextTranscriptComponent, ToolObservationComponent], template: \`
  <threadplane-text-transcript [messages]="missingId" />
  <threadplane-text-transcript [messages]="missingContent" />
  <threadplane-text-transcript [messages]="objectContent" />
  <threadplane-tool-observation argumentsText="{}" />
  <threadplane-tool-observation name="weather" />
  <threadplane-tool-observation name="weather" [argumentsText]="objectArgs" />
  <threadplane-tool-observation name="weather" argumentsText="{}" [resultText]="123" />
  <threadplane-tool-observation name="weather" argumentsText="{}" [execute]="execute" [status]="'running'" [session]="objectArgs" />
\` })
export class NegativeTranscript {
  readonly objectArgs = { city: 'Paris' };
  readonly execute = () => undefined;
  readonly missingId = [{ role: 'user', content: 'Hello' }] as const;
  readonly missingContent = [{ id: 'a', role: 'user' }] as const;
  readonly objectContent = [{ id: 'a', role: 'user', content: { text: 'Hello' } }] as const;
}
`);
  writeFileSync(join(consumer, 'tsconfig.negative.json'), JSON.stringify({ extends: './tsconfig.json', compilerOptions: { noEmit: true, skipLibCheck: false }, angularCompilerOptions: { strictTemplates: true }, files: ['transcript-negative.ts'], include: [] }));
  try {
    let diagnostics = '';
    try {
      execFileSync(process.execPath, [join(consumer, 'node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js'), '-p', 'tsconfig.negative.json'], { cwd: consumer, encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      diagnostics = String(error.stdout ?? '') + String(error.stderr ?? '');
    }
    assert.match(diagnostics, /Property 'id' is missing/);
    assert.match(diagnostics, /Property 'content' is missing/);
    assert.match(diagnostics, /not assignable to type 'string'/);
    assert.match(diagnostics, /Required input 'name'/);
    assert.match(diagnostics, /Required input 'argumentsText'/);
    assert.match(diagnostics, /Type '\{ city: string; \}' is not assignable to type 'string'/);
    assert.match(diagnostics, /Type 'number' is not assignable to type 'string'/);
    for (const input of ['execute', 'status', 'session'])
      assert.match(diagnostics, new RegExp(`Can't bind to '${input}'`));
    assert.doesNotMatch(diagnostics, /Cannot find module|Could not resolve/);
    console.log('Installed Angular strict templates rejected malformed transcript rows and missing, structured, numeric or command tool inputs.');
  } finally {
    rmSync(join(consumer, 'transcript-negative.ts'));
    rmSync(join(consumer, 'tsconfig.negative.json'));
  }
}

export async function verifyAngularPackage(root = process.cwd()) {
  root = resolve(root);
  const temporary = mkdtempSync(join(tmpdir(), 'threadplane-angular-consumer-'));
  try {
    const tarballs = packLocalArtifacts(root, temporary, ['angular']);
    const consumer = join(temporary, 'consumer');
    cpSync(join(root, 'fixtures/react-parity/consumers/angular'), consumer, { recursive: true });
    const template = JSON.parse(readFileSync(join(consumer, 'package.json'), 'utf8'));
    const manifest = lockedAngularManifest(template, JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')));
    console.log(`Angular consumer toolchain: ${JSON.stringify({ ...manifest.dependencies, ...manifest.devDependencies })}`);
    installConsumer(consumer, manifest, tarballs, 'angular');
    const rootProbe = buildSync({ absWorkingDir: consumer, stdin: { contents: "import * as angular from '@threadplane/angular'; console.log(angular);", resolveDir: consumer }, bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
    assertHeadlessInputs(rootProbe.metafile.inputs);
    const installed = JSON.parse(readFileSync(join(consumer, 'node_modules/@threadplane/angular/package.json'), 'utf8'));
    const specifiers = consumerSpecifiers(installed);
    const chatProbe = buildSync({
      absWorkingDir: consumer,
      stdin: {
        contents: "export * from '@threadplane/angular/chat';",
        resolveDir: consumer,
      },
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
      metafile: true,
      external: ['@angular/core'],
    });
    assertAngularChatExports(
      Object.values(chatProbe.metafile.outputs)[0].exports
    );
    prepareInstalledTypes(root, consumer, 'angular');
    verifyRejectedTranscriptTemplates(consumer);
    const contracts = join(consumer, 'installed-types.ts');
    writeFileSync(contracts, readFileSync(contracts, 'utf8') + '\n' + specifiers.map((specifier, index) => `import type * as entry${index} from ${JSON.stringify(specifier)};\nexport type Entry${index} = typeof entry${index};`).join('\n'));
    await prepareRuntimeConsumer(root, consumer, 'angular');
    runConsumer(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.contracts.json'], consumer);
    console.log(runConsumer(process.execPath, angularBuildCommand(consumer), consumer));
    const stats = JSON.parse(readFileSync(join(consumer, 'dist/consumer/stats.json'), 'utf8'));
    assertParserFreeInputs(stats.inputs);
    if (!Object.keys(stats.inputs).some((path) => path.includes('node_modules/@threadplane/angular/'))) throw new Error('Angular stats did not include the installed APF artifact');
    if (!Object.keys(stats.inputs).some((path) => path.includes('node_modules/@threadplane/angular/fesm2022/threadplane-angular-chat.mjs'))) throw new Error('Angular app did not include the installed chat component');
    console.log(`Angular runtime consumer bundle (app, binding and staged SDK): ${Object.keys(stats.inputs).length} inputs, no content parsers. Threadplane inputs: ${Object.keys(stats.inputs).filter((path) => path.includes('node_modules/@threadplane/')).join(', ')}.`);
    await runRuntimeScenarios(join(consumer, 'dist/consumer/browser'), 'Angular');
    console.log(`Verified ${specifiers.length} Angular APF exports through CLI compilation/linking with skipLibCheck:false, precise heterogeneous tool contracts, and a production-built installed Angular consumer.`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyAngularPackage();
