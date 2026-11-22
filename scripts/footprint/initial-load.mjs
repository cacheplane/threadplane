#!/usr/bin/env node
// Initial-load size gate. Builds a minimal chat application per framework from
// the packed packages, the way an application installs them, and checks the
// JavaScript a browser loads before first paint against budgets.json.
//
// The applications hold nothing but a LangGraph session and the default chat
// component, so the measurement is what the libraries cost a chat app: changes
// to the example applications never move it.
//
//   node scripts/footprint/initial-load.mjs [--framework=angular|react] [--keep=DIR]
//
// Run after building core, content, angular, react, langgraph, a2ui and
// telemetry. Lower a budget when a change makes room; the report says by how much.
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { init, parse } from 'es-module-lexer';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const budgetsFile = join(root, 'scripts/footprint/budgets.json');

/** The local packages each application installs, before their own local dependencies. */
export const APPLICATIONS = {
  angular: { projects: ['angular', 'langgraph'] },
  react: { projects: ['react', 'langgraph'] },
};

/** Build tools and framework packages each application installs beside the packed packages. */
const TOOLS = {
  angular: [
    '@angular/build',
    '@angular/cli',
    '@angular/compiler-cli',
    '@angular/compiler',
    '@angular/platform-browser',
    'typescript',
  ],
  react: ['react', 'react-dom', 'vite', 'typescript'],
};

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, contents) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    typeof contents === 'string'
      ? contents
      : JSON.stringify(contents, null, 2) + '\n'
  );
};

/** Exact versions from the repository lockfile, so a measurement never floats. */
export function pinnedVersions(lock, names) {
  return Object.fromEntries(
    [...new Set(names)].sort().map((name) => {
      const version = lock.packages?.[`node_modules/${name}`]?.version;
      assert.ok(version, `The root lockfile has no version for ${name}`);
      return [name, version];
    })
  );
}

/** Every non-Threadplane package the packed manifests depend on or peer with. */
export function externalDependencies(manifests) {
  const names = [];
  for (const manifest of manifests)
    for (const field of ['dependencies', 'peerDependencies'])
      for (const name of Object.keys(manifest[field] ?? {}))
        if (
          !name.startsWith('@threadplane/') &&
          manifest.peerDependenciesMeta?.[name]?.optional !== true
        )
          names.push(name);
  return names;
}

/**
 * The JavaScript a browser loads before first paint: the entry scripts and
 * module preloads in index.html, and every module they import statically.
 * Dynamic imports load later and do not count.
 */
export async function initialScripts(distDirectory) {
  await init;
  const html = readFileSync(join(distDirectory, 'index.html'), 'utf8');
  const start = new Set();
  // HTML tag and attribute names are case-insensitive, and values may use
  // either quote.
  const attribute = (attributes, name) =>
    new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attributes)?.[2];
  for (const [, attributes] of html.matchAll(/<script\b([^>]*)>/gi)) {
    const src = attribute(attributes, 'src');
    if (src && attribute(attributes, 'type')?.toLowerCase() === 'module')
      start.add(src);
  }
  for (const [, attributes] of html.matchAll(/<link\b([^>]*)>/gi))
    if (attribute(attributes, 'rel')?.toLowerCase() === 'modulepreload') {
      const href = attribute(attributes, 'href');
      if (href) start.add(href);
    }
  assert.ok(start.size, 'index.html loads no module script');
  const files = new Map();
  const visit = (url) => {
    const path = posix.normalize(url.replace(/^\//, '').split(/[?#]/)[0]);
    if (files.has(path)) return;
    const file = join(distDirectory, path);
    assert.ok(
      existsSync(file),
      `index.html or a module names a missing file: ${path}`
    );
    const source = readFileSync(file);
    files.set(path, source);
    const [imports] = parse(source.toString('utf8'));
    for (const entry of imports) {
      // d > -1 is a dynamic import; -2 is import.meta. Only static imports load up front.
      if (entry.d !== -1 || !entry.n) continue;
      if (!/^(?:\.{1,2}\/|\/)/.test(entry.n)) continue;
      visit(
        entry.n.startsWith('/')
          ? entry.n
          : posix.join(posix.dirname(path), entry.n)
      );
    }
  };
  for (const url of start) visit(url);
  const list = [...files].map(([path, source]) => ({
    path,
    bytes: source.length,
    gzipBytes: gzipSync(source).length,
  }));
  return {
    files: list.sort((a, b) => b.bytes - a.bytes),
    bytes: list.reduce((sum, file) => sum + file.bytes, 0),
    gzipBytes: list.reduce((sum, file) => sum + file.gzipBytes, 0),
  };
}

/** Over-budget results fail; results well under budget say the budget can come down. */
export function checkBudgets(results, budgets) {
  const errors = [];
  const notes = [];
  for (const [framework, result] of Object.entries(results)) {
    const budget = budgets[framework]?.initialBytes;
    assert.ok(
      Number.isInteger(budget),
      `budgets.json has no initialBytes for ${framework}`
    );
    if (result.bytes > budget)
      errors.push(
        `${framework}: initial JS is ${
          result.bytes
        } bytes, over its ${budget} byte budget by ${result.bytes - budget}`
      );
    else if (budget - result.bytes > budget * 0.05)
      notes.push(
        `${framework}: ${
          budget - result.bytes
        } bytes under budget; lower initialBytes to about ${Math.ceil(
          result.bytes * 1.02
        )}`
      );
  }
  return { errors, notes };
}

function angularApplication(directory) {
  write(join(directory, 'angular.json'), {
    version: 1,
    newProjectRoot: 'projects',
    cli: { analytics: false, packageManager: 'npm' },
    projects: {
      footprint: {
        projectType: 'application',
        root: '',
        sourceRoot: 'src',
        architect: {
          build: {
            builder: '@angular/build:application',
            options: {
              browser: 'src/main.ts',
              index: 'src/index.html',
              tsConfig: 'tsconfig.json',
              outputPath: 'dist',
              optimization: true,
              outputHashing: 'all',
              sourceMap: false,
              styles: [],
            },
          },
        },
      },
    },
  });
  write(join(directory, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'ES2022',
      moduleResolution: 'bundler',
      strict: true,
      skipLibCheck: true,
      lib: ['ES2022', 'DOM'],
      types: [],
    },
    files: ['src/main.ts'],
    angularCompilerOptions: { strictTemplates: true },
  });
  write(
    join(directory, 'src/index.html'),
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Footprint</title><base href="/"></head>\n<body><app-root></app-root></body>\n</html>\n'
  );
  write(
    join(directory, 'src/main.ts'),
    `import { Component, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { injectAgent, provideAgent } from '@threadplane/angular';
import { ChatComponent } from '@threadplane/angular/chat';
import { createSession } from '@threadplane/langgraph';

@Component({
  selector: 'app-root',
  imports: [ChatComponent],
  template: '<chat [agent]="agent" />',
})
class App {
  protected readonly agent = injectAgent();
}

bootstrapApplication(App, {
  providers: [
    provideZonelessChangeDetection(),
    provideAgent({
      createSession: (context) =>
        createSession({ apiUrl: '/api', assistantId: 'agent', ...context }),
    }),
  ],
}).catch((error: unknown) => console.error(error));
`
  );
  return {
    build: ['node_modules/@angular/cli/bin/ng.js', 'build', 'footprint'],
    dist: join(directory, 'dist/browser'),
  };
}

function reactApplication(directory) {
  write(
    join(directory, 'vite.config.mjs'),
    `export default { esbuild: { jsx: 'automatic' }, build: { outDir: 'dist', sourcemap: false } };\n`
  );
  write(
    join(directory, 'index.html'),
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Footprint</title></head>\n<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>\n</html>\n'
  );
  write(
    join(directory, 'src/main.tsx'),
    `import { createRoot } from 'react-dom/client';
import { Chat } from '@threadplane/react/chat';
import '@threadplane/react/chat/styles.css';
import { createSession } from '@threadplane/langgraph';

const session = createSession({ apiUrl: '/api', assistantId: 'agent' });
createRoot(document.getElementById('root')!).render(<Chat session={session} />);
`
  );
  return {
    build: ['node_modules/vite/bin/vite.js', 'build', '--logLevel', 'warn'],
    dist: join(directory, 'dist'),
  };
}

export async function measureApplication(framework, temporary, helpers) {
  const { packLocalArtifacts, runConsumer } = helpers;
  const directory = join(temporary, framework);
  const packed = join(temporary, `${framework}-packed`);
  mkdirSync(directory, { recursive: true });
  mkdirSync(packed, { recursive: true });
  const tarballs = packLocalArtifacts(
    root,
    packed,
    APPLICATIONS[framework].projects
  );
  const manifests = Object.keys(tarballs).map((name) =>
    json(
      join(
        root,
        'dist/libs',
        name.slice('@threadplane/'.length),
        'package.json'
      )
    )
  );
  const lock = json(join(root, 'package-lock.json'));
  write(join(directory, 'package.json'), {
    name: `footprint-${framework}`,
    private: true,
    type: 'module',
    dependencies: {
      ...tarballs,
      ...pinnedVersions(lock, [
        ...externalDependencies(manifests),
        ...TOOLS[framework],
      ]),
    },
  });
  const application =
    framework === 'angular'
      ? angularApplication(directory)
      : reactApplication(directory);
  // The install collector is not what this measures.
  const env = { ...process.env, DO_NOT_TRACK: '1' };
  runConsumer(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
      '--prefer-offline',
    ],
    directory,
    env
  );
  runConsumer(process.execPath, application.build, directory, env);
  return initialScripts(application.dist);
}

function format(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

async function main() {
  const options = Object.fromEntries(
    process.argv.slice(2).map((argument) => {
      const match = /^--([a-z]+)=(.+)$/.exec(argument);
      assert.ok(match, `Unknown argument: ${argument}`);
      return [match[1], match[2]];
    })
  );
  const frameworks = options.framework
    ? [options.framework]
    : Object.keys(APPLICATIONS);
  for (const framework of frameworks)
    assert.ok(APPLICATIONS[framework], `Unknown framework: ${framework}`);
  for (const project of new Set(
    frameworks.flatMap((framework) => APPLICATIONS[framework].projects)
  ))
    assert.ok(
      existsSync(join(root, 'dist/libs', project, 'package.json')),
      `Build ${project} first: npx nx run-many -t build -p core,content,angular,react,langgraph,a2ui,telemetry`
    );
  const helpers = await import('../react-parity/verify-packages.mjs');
  let temporary;
  if (options.keep) {
    assert.ok(!existsSync(options.keep), '--keep needs a new directory');
    mkdirSync(options.keep, { recursive: true });
    temporary = realpathSync(options.keep);
  } else
    temporary = realpathSync(
      mkdtempSync(join(tmpdir(), 'threadplane-footprint-'))
    );
  try {
    const results = {};
    for (const framework of frameworks) {
      results[framework] = await measureApplication(
        framework,
        temporary,
        helpers
      );
      const result = results[framework];
      console.log(
        `${framework}: ${format(result.bytes)} initial JS (${format(
          result.gzipBytes
        )} gzip) in ${result.files.length} files`
      );
      for (const file of result.files.slice(0, 5))
        console.log(`  ${file.path}  ${format(file.bytes)}`);
    }
    const { errors, notes } = checkBudgets(results, json(budgetsFile));
    for (const note of notes) console.log(note);
    if (errors.length) {
      for (const error of errors) console.error(error);
      process.exitCode = 1;
    } else console.log('Initial-load budgets hold.');
  } finally {
    if (!options.keep) rmSync(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
