import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareFreshConsumer } from '../../scripts/react-cockpit/consumer-preparation.mjs';
import { localDependencyProjects } from '../../scripts/react-parity/verify-packages.mjs';
import { getScenario } from './scenarios.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const destination = resolve(
  process.argv[2] ?? '/private/tmp/threadplane-tool-benchmark-consumers'
);
const config = JSON.parse(
  readFileSync(join(root, 'tools/tool-rendering-benchmark/participants.json'))
);
mkdirSync(destination, { recursive: true });
assert.ok(!existsSync(join(destination, 'react/consumer')) && !existsSync(join(destination, 'angular/node_modules')), 'Installed SDK consumers are frozen evidence. Choose a fresh destination.');
const json = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const install = (path) =>
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: path, stdio: 'inherit' }
  );
const provenance = [];
async function source(
  repository,
  commit,
  path,
  directory,
  output,
  replacements = []
) {
  const url = `https://raw.githubusercontent.com/${repository}/${commit}/${path}`;
  const response = await fetch(url);
  assert.ok(response.ok, `Download failed: ${url}`);
  const original = await response.text();
  let code = original;
  for (const [from, to] of replacements) code = code.replaceAll(from, to);
  writeFileSync(join(directory, output), code);
  provenance.push({
    url,
    output,
    license: 'MIT',
    sha256: createHash('sha256').update(original).digest('hex'),
    adaptations: replacements,
  });
}
const vendor = join(destination, 'vendor');
mkdirSync(vendor, { recursive: true });
json(join(vendor, 'package.json'), {
  name: 'tool-ui-vendor-consumer',
  private: true,
  type: 'module',
  dependencies: {
    ...config.vendorDependencies,
    '@base-ui/react': '1.6.0',
    'lucide-react': '0.577.0',
    clsx: '2.1.1',
    'tailwind-merge': '3.5.0',
    tailwindcss: '4.3.0',
    '@tailwindcss/vite': '4.3.0',
  },
});
// A preinstalled probe can be copied explicitly; the resulting lock still records every version.
if (!existsSync(join(vendor, 'node_modules'))) install(vendor);
cpSync(join(root, 'tools/tool-rendering-benchmark/consumers/vendor'), vendor, {
  recursive: true,
});
await source(
  'assistant-ui/assistant-ui',
  config.assistantUiCommit,
  'packages/ui/src/components/react/assistant-ui/elements/tool-fallback.aui.tsx',
  vendor,
  'tool-fallback.tsx',
  [
    ['@/lib/utils', './utils'],
    ['@/components/ui/button', './controls'],
    ['@/components/ui/textarea', './controls'],
    ['./collapsible-root', './assistant-collapsible'],
  ]
);
await source(
  'assistant-ui/assistant-ui',
  config.assistantUiCommit,
  'packages/ui/src/components/react/assistant-ui/elements/collapsible-root.tsx',
  vendor,
  'assistant-collapsible.tsx'
);
await source(
  'shadcn-ui/ui',
  config.shadcnCommit,
  'apps/v4/registry/bases/base/ui/trace.tsx',
  vendor,
  'trace.tsx',
  [
    ['from "cn"', 'from "./utils"'],
    ['@/registry/bases/base/ui/collapsible', './shadcn-collapsible'],
    ['@/app/(create)/components/icon-placeholder', './icons'],
  ]
);
await source(
  'shadcn-ui/ui',
  config.shadcnCommit,
  'apps/v4/registry/bases/base/ui/collapsible.tsx',
  vendor,
  'shadcn-collapsible.tsx'
);

const reactRoot = join(destination, 'react');
if (!existsSync(join(reactRoot, 'consumer'))) {
  mkdirSync(reactRoot, { recursive: true });
  prepareFreshConsumer(root, reactRoot, {
    adapter: 'ag-ui',
    topic: 'streaming',
  });
}
cpSync(
  join(root, 'tools/tool-rendering-benchmark/consumers/react'),
  join(reactRoot, 'consumer'),
  { recursive: true }
);
const angular = join(destination, 'angular');
mkdirSync(angular, { recursive: true });
if (!existsSync(join(angular, 'node_modules'))) {
  // Angular APF packages have their own package contract (no ESM `type` field).
  const projects = localDependencyProjects(['chat', 'ag-ui'], (project) =>
    JSON.parse(readFileSync(join(root, 'dist/libs', project, 'package.json')))
  );
  const tarballs = {};
  for (const project of projects) {
    const [packed] = JSON.parse(
      execFileSync(
        'npm',
        [
          'pack',
          join(root, 'dist/libs', project),
          '--ignore-scripts',
          '--json',
          '--pack-destination',
          angular,
        ],
        { cwd: angular, encoding: 'utf8' }
      )
    );
    tarballs['@threadplane/' + project] =
      'file:' + join(angular, packed.filename);
  }
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
  const names = [
    '@angular/core',
    '@angular/common',
    '@angular/compiler',
    '@angular/platform-browser',
    '@angular/router',
    'rxjs',
    'vite',
    'typescript',
  ];
  const dependencies = Object.fromEntries(
    names.map((name) => [name, lock.packages['node_modules/' + name].version])
  );
  json(join(angular, 'package.json'), {
    name: 'tool-ui-angular-consumer',
    private: true,
    type: 'module',
    dependencies: { ...dependencies, ...tarballs },
    overrides: Object.fromEntries(
      Object.keys(tarballs).map((name) => [name, '$' + name])
    ),
  });
  install(angular);
}
cpSync(
  join(root, 'tools/tool-rendering-benchmark/consumers/angular'),
  angular,
  { recursive: true }
);
for (const consumer of [vendor, angular, join(reactRoot, 'consumer')]) {
  cpSync(
    join(root, 'tools/tool-rendering-benchmark/consumers/shell.css'),
    join(consumer, 'shell.css')
  );
  const scenarios = Object.fromEntries(
    ['references', 'repeated', 'falsy', 'tool-error', 'slow', 'approval'].map(
      (id) => [id, getScenario(id)]
    )
  );
  writeFileSync(
    join(consumer, 'scenarios.mjs'),
    'const scenarios = ' +
      JSON.stringify(scenarios) +
      ';\nexport const getScenario = id => scenarios[id];\n'
  );
  json(join(consumer, 'tsconfig.benchmark.json'), { compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'], jsx: 'react-jsx', strict: true, skipLibCheck: true, noEmit: true, allowSyntheticDefaultImports: true, allowJs: true, checkJs: false }, files: [consumer === angular ? 'main.ts' : 'main.tsx'] });
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.benchmark.json'], { cwd: consumer, stdio: 'inherit' });
}
json(join(destination, 'sources.json'), provenance);
console.log(
  JSON.stringify({
    destination,
    consumers: [vendor, angular, join(reactRoot, 'consumer')],
    sources: provenance.length,
  })
);
