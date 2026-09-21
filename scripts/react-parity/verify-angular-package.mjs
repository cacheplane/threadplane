import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertParserFreeInputs, consumerSpecifiers, installConsumer, packLocalArtifacts, runConsumer } from './verify-packages.mjs';

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

export function angularConsumerSource(template, specifiers) {
  const extra = specifiers.filter((specifier) => specifier !== '@threadplane/angular');
  return template.replace('/* PACKAGE_IMPORTS */', extra.map((specifier, index) => `import * as entry${index} from ${JSON.stringify(specifier)};`).join('\n'))
    .replace('/* PACKAGE_EXPORT_COUNT */', extra.map((_, index) => `+ Object.keys(entry${index}).length`).join(' '));
}

export function verifyAngularPackage(root = process.cwd()) {
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
    const main = join(consumer, 'src/main.ts');
    writeFileSync(main, angularConsumerSource(readFileSync(main, 'utf8'), specifiers));
    console.log(runConsumer(process.execPath, angularBuildCommand(consumer), consumer));
    const stats = JSON.parse(readFileSync(join(consumer, 'dist/consumer/stats.json'), 'utf8'));
    assertParserFreeInputs(stats.inputs);
    if (!Object.keys(stats.inputs).some((path) => path.includes('node_modules/@threadplane/angular/'))) throw new Error('Angular stats did not include the installed APF artifact');
    console.log(`Angular root bundle: ${Object.keys(stats.inputs).length} inputs, no content parsers. Threadplane inputs: ${Object.keys(stats.inputs).filter((path) => path.includes('node_modules/@threadplane/')).join(', ')}.`);
    console.log(`Verified ${specifiers.length} Angular APF exports through CLI compilation/linking with skipLibCheck:false. Empty scaffold only; no runtime behavior is claimed.`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verifyAngularPackage();
