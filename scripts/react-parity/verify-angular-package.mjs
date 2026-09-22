import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertParserFreeInputs, consumerSpecifiers, installConsumer, packLocalArtifacts, runConsumer } from './verify-packages.mjs';
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
    const installed = JSON.parse(readFileSync(join(consumer, 'node_modules/@threadplane/angular/package.json'), 'utf8'));
    const specifiers = consumerSpecifiers(installed);
    prepareInstalledTypes(root, consumer, 'angular');
    const contracts = join(consumer, 'installed-types.ts');
    writeFileSync(contracts, readFileSync(contracts, 'utf8') + '\n' + specifiers.map((specifier, index) => `import type * as entry${index} from ${JSON.stringify(specifier)};\nexport type Entry${index} = typeof entry${index};`).join('\n'));
    await prepareRuntimeConsumer(root, consumer, 'angular');
    runConsumer(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.contracts.json'], consumer);
    console.log(runConsumer(process.execPath, angularBuildCommand(consumer), consumer));
    const stats = JSON.parse(readFileSync(join(consumer, 'dist/consumer/stats.json'), 'utf8'));
    assertParserFreeInputs(stats.inputs);
    if (!Object.keys(stats.inputs).some((path) => path.includes('node_modules/@threadplane/angular/'))) throw new Error('Angular stats did not include the installed APF artifact');
    console.log(`Angular runtime consumer bundle (app, binding and staged SDK): ${Object.keys(stats.inputs).length} inputs, no content parsers. Threadplane inputs: ${Object.keys(stats.inputs).filter((path) => path.includes('node_modules/@threadplane/')).join(', ')}.`);
    await runRuntimeScenarios(join(consumer, 'dist/consumer/browser'), 'Angular');
    console.log(`Verified ${specifiers.length} Angular APF exports through CLI compilation/linking with skipLibCheck:false, precise heterogeneous tool contracts, and a production-built installed Angular consumer.`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyAngularPackage();
