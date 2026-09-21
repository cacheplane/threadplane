import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { foundationProjects } from './verify-boundaries.mjs';

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? filesIn(join(directory, entry.name)) : [join(directory, entry.name)]);
}
function clientDirective(path) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const first = source.statements[0];
  return first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'use client';
}

export function validatePackage(directory) {
  const errors = [];
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  if (manifest.private !== true) errors.push('Foundation package must remain private.');
  if (manifest.type !== 'module') errors.push('Foundation package must emit ESM.');
  if (manifest.license !== 'MIT') errors.push('Expected MIT package license.');
  for (const file of ['LICENSE.md', 'README.md']) if (!existsSync(join(directory, file))) errors.push(`Missing ${file}`);
  if (!manifest.exports?.['.']) errors.push('Missing root export.');
  for (const [subpath, conditions] of Object.entries(manifest.exports ?? {})) {
    if (!conditions.types || !conditions.import || !conditions.default) errors.push(`${subpath}: requires types, import and default export conditions.`);
    for (const [condition, target] of Object.entries(conditions)) {
      if (typeof target !== 'string' || !target.startsWith('./') || !resolve(directory, target).startsWith(resolve(directory) + sep)) { errors.push(`${subpath}: invalid export target ${target}`); continue; }
      const path = join(directory, target);
      if (!existsSync(path)) { errors.push(`${subpath}: missing export target ${target}`); continue; }
      if (condition === 'types' && !target.endsWith('.d.ts')) errors.push(`${subpath}: types must resolve to declarations.`);
      if (condition !== 'types' && !target.endsWith('.js')) errors.push(`${subpath}: runtime must resolve to JavaScript.`);
      if (condition === 'import' && ['@threadplane/react', '@threadplane/react-render'].includes(manifest.name)) {
        const expected = subpath !== './types';
        if (Boolean(clientDirective(path)) !== expected) errors.push(`${subpath}: ${expected ? 'missing' : 'unexpected'} use client directive.`);
      }
    }
  }
  for (const file of filesIn(directory)) if (/\.(?:spec|test|type-test)\.[cm]?[jt]sx?$|\/test-setup\./.test(file) || (/\.tsx?$/.test(file) && !file.endsWith('.d.ts'))) errors.push(`Unexpected production artifact ${relative(directory, file)}`);
  return errors;
}

export function verifyPackedConsumers(root = process.cwd()) {
  root = resolve(root);
  const temporary = mkdtempSync(join(tmpdir(), 'threadplane-consumer-'));
  const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const tarballs = [];
    for (const project of foundationProjects) {
      const built = join(root, 'dist/libs', project);
      const packed = JSON.parse(run('npm', ['pack', built, '--ignore-scripts', '--json', '--pack-destination', temporary], temporary));
      const tarball = join(temporary, packed[0].filename);
      tarballs.push(tarball);
      const unpacked = join(temporary, project);
      mkdirSync(unpacked);
      run('tar', ['-xzf', tarball, '-C', unpacked], temporary);
      const errors = validatePackage(join(unpacked, 'package'));
      if (errors.length) throw new Error(`${project}:\n${errors.join('\n')}`);
    }
    const consumer = join(temporary, 'consumer');
    mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    // Only core is installed for the framework-free proof. The compiler runs
    // from the repository, but module/type resolution starts in this temp tree.
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarballs[0]], consumer);
    const modules = readdirSync(join(consumer, 'node_modules')).filter((name) => name !== '.package-lock.json');
    if (JSON.stringify(modules) !== JSON.stringify(['@threadplane']) || JSON.stringify(readdirSync(join(consumer, 'node_modules/@threadplane'))) !== JSON.stringify(['core'])) throw new Error('Core consumer unexpectedly installed dependencies.');
    writeFileSync(join(consumer, 'index.mjs'), "import * as core from '@threadplane/core';\nif (Object.keys(core).length !== 0) throw new Error('Foundation core must remain empty');\n");
    writeFileSync(join(consumer, 'index.ts'), "import * as core from '@threadplane/core';\nexport type CoreExports = typeof core;\n");
    writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2022'], types: [], strict: true, skipLibCheck: false, noEmit: true }, files: ['index.ts'] }));
    run(process.execPath, ['index.mjs'], consumer);
    run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], consumer);
    // Install all local tarballs and exercise every declared export with Node
    // and TypeScript so aliases and missing emitted files cannot mask failures.
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', ...tarballs], consumer);
    const specifiers = foundationProjects.flatMap((project) => {
      const manifest = JSON.parse(readFileSync(join(consumer, 'node_modules/@threadplane', project, 'package.json'), 'utf8'));
      return Object.keys(manifest.exports).map((subpath) => manifest.name + (subpath === '.' ? '' : subpath.slice(1)));
    });
    writeFileSync(join(consumer, 'index.mjs'), specifiers.map((specifier) => `await import(${JSON.stringify(specifier)});`).join('\n'));
    writeFileSync(join(consumer, 'index.ts'), specifiers.map((specifier, index) => `import * as entry${index} from ${JSON.stringify(specifier)};\nexport type Entry${index} = typeof entry${index};`).join('\n'));
    run(process.execPath, ['index.mjs'], consumer);
    run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], consumer);
    console.log(`Verified ${tarballs.length} private tarballs, ${specifiers.length} exports, preserved client directives and isolated framework-free core consumer.`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verifyPackedConsumers();
