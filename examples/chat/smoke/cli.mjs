#!/usr/bin/env node
/**
 * Smoke generator for a fresh consumer of the canonical examples/chat demo.
 *
 * Default mode is interactive and resolves published @threadplane/* packages
 * from npm. CI/local verification can pass --non-interactive with
 * --local-dist-root to pack the local dist/libs package closure before publish.
 */

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output, exit } from 'node:process';
import { cp, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { spawn, execFile, execSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { getAngularLane } from './angular-versions.mjs';
import { applyAngularLane, strictNpmEnv } from './consumer-package.mjs';
import { requireSmokeNpm } from './toolchain-policy.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(SCRIPT_DIR, 'template');
const DEMO_APP_DIR = resolve(SCRIPT_DIR, '..', 'angular', 'src', 'app');
const DEMO_ENVIRONMENTS_DIR = resolve(
  SCRIPT_DIR,
  '..',
  'angular',
  'src',
  'environments'
);
const CHECKLIST = join(SCRIPT_DIR, 'CHECKLIST.md');
const DEFAULT_TARGET = join(homedir(), 'tmp', 'threadplane');

const THREADPLANE_PACKAGES = [
  { name: '@threadplane/a2ui', dist: 'a2ui' },
  { name: '@threadplane/ag-ui', dist: 'ag-ui' },
  { name: '@threadplane/chat', dist: 'chat' },
  { name: '@threadplane/langgraph', dist: 'langgraph' },
  { name: '@threadplane/render', dist: 'render' },
  { name: '@threadplane/telemetry', dist: 'telemetry' },
];

function parseArgs(argv) {
  const options = {
    action: undefined,
    angularMajor: '21',
    build: false,
    install: undefined,
    nonInteractive: false,
    packageSpecs: new Map(),
    runtime: false,
    start: undefined,
    target: undefined,
    version: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };

    if (arg === '--non-interactive' || arg === '--yes')
      options.nonInteractive = true;
    else if (arg === '--target') options.target = readValue();
    else if (arg === '--version')
      options.version = readValue().replace(/^[v^~]+/, '');
    else if (arg === '--angular-major') options.angularMajor = readValue();
    else if (arg === '--fresh') options.action = 'fresh';
    else if (arg === '--update') options.action = 'update';
    else if (arg === '--install') options.install = true;
    else if (arg === '--no-install') options.install = false;
    else if (arg === '--start') options.start = true;
    else if (arg === '--no-start') options.start = false;
    else if (arg === '--build') options.build = true;
    else if (arg === '--runtime') options.runtime = true;
    else if (arg === '--local-dist-root') options.localDistRoot = readValue();
    else if (arg === '--pack-destination')
      options.packDestination = readValue();
    else if (arg === '--package') {
      const spec = readValue();
      const [name, value] = spec.split('=');
      if (!name || !value)
        throw new Error('--package expects @scope/name=specifier');
      options.packageSpecs.set(name, value);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const angularLane = getAngularLane(options.angularMajor);
  const rl = options.nonInteractive ? null : createInterface({ input, output });
  const ask = (q, def) => {
    if (!rl) return Promise.resolve(def);
    return rl
      .question(def !== undefined ? `${q} (${def}) ` : `${q} `)
      .then((v) => v.trim() || def);
  };

  console.log('\n📦 Threadplane chat smoke generator\n');

  const target = resolve(
    await ask('Target directory:', options.target ?? DEFAULT_TARGET)
  );
  let action = options.action ?? 'fresh';
  if (existsSync(target) && !options.nonInteractive && !options.action) {
    const choice = await ask(
      'Directory exists. [r]efresh / [u]pdate in place / [c]ancel:',
      'c'
    );
    const c = choice.toLowerCase();
    if (c.startsWith('c')) {
      console.log('Cancelled.');
      rl.close();
      exit(0);
    }
    if (c.startsWith('u')) action = 'update';
    else if (c.startsWith('r')) action = 'fresh';
    else {
      console.log('Unrecognised choice; cancelling.');
      rl.close();
      exit(1);
    }
  }

  let version = options.version;
  if (!version && options.localDistRoot) {
    version = await readLocalVersion(options.localDistRoot);
  }
  if (!version) {
    const resolvedVersion = await resolvePublishedVersion();
    const versionAnswer = await ask('@threadplane version:', resolvedVersion);
    version = versionAnswer.replace(/^[v^~]+/, '');
  }

  const installAnswer =
    options.install === undefined
      ? await ask('Run `npm install` now? [Y/n]:', 'Y')
      : undefined;
  const doInstall =
    options.install ?? !installAnswer.toLowerCase().startsWith('n');
  if (options.runtime && !doInstall) {
    throw new Error(
      '--runtime requires installation; omit --no-install or pass --install'
    );
  }
  if (options.runtime) options.build = true;
  const doStart =
    options.start ??
    (doInstall && !options.nonInteractive
      ? !(await ask('Run `npm start` after install? [Y/n]:', 'Y'))
          .toLowerCase()
          .startsWith('n')
      : false);

  rl?.close();

  if (doInstall) requireSmokeNpm();

  const packageSpecs = new Map(options.packageSpecs);
  if (options.localDistRoot) {
    for (const [name, spec] of await packLocalPackages(
      options.localDistRoot,
      options.packDestination
    )) {
      packageSpecs.set(name, spec);
    }
  }

  if (action === 'fresh') {
    console.log(`\n→ Removing ${target} ...`);
    await rm(target, { recursive: true, force: true });
    console.log(`→ Copying scaffold from ${TEMPLATE_DIR} ...`);
    await cp(TEMPLATE_DIR, target, { recursive: true });
    console.log(`→ Copying app code from ${DEMO_APP_DIR} ...`);
    await cp(DEMO_APP_DIR, join(target, 'src', 'app'), { recursive: true });
    console.log(`→ Copying environments from ${DEMO_ENVIRONMENTS_DIR} ...`);
    await cp(DEMO_ENVIRONMENTS_DIR, join(target, 'src', 'environments'), {
      recursive: true,
    });
  } else {
    console.log(
      `\n→ Updating in place at ${target} (skipping scaffold copy) ...`
    );
  }

  await writeConsumerPackage({ target, version, packageSpecs, angularLane });
  await cp(CHECKLIST, join(target, 'CHECKLIST.md'));
  await writeFile(
    join(target, 'SMOKE_RUN.md'),
    await buildSmokeRun({ target, version, packageSpecs, angularLane })
  );
  console.log('→ Wrote SMOKE_RUN.md');

  if (doInstall) {
    console.log('\n→ Running npm install ...');
    console.log(
      `Angular lane ${angularLane.major}: framework ${angularLane.dependencies['@angular/core']}, TypeScript ${angularLane.devDependencies.typescript}, Node >=${angularLane.node}`
    );
    await runChild('npm', ['install'], { cwd: target, env: strictNpmEnv() });
  }

  if (options.build) {
    console.log('\n→ Running npm run build ...');
    await runChild('npm', ['run', 'build'], { cwd: target });
  }

  if (options.runtime) {
    console.log('\n→ Running backend-free runtime compatibility smoke ...');
    await runChild(
      process.execPath,
      [join(SCRIPT_DIR, 'runtime-smoke.mjs'), '--target', target],
      { cwd: SCRIPT_DIR }
    );
  }

  console.log(`\n✓ Smoke consumer ready at ${target}`);
  console.log(
    '  Backend:  cd examples/chat/python && uv run langgraph dev --port 2024'
  );
  console.log(`  App:      cd ${target} && npm start`);
  console.log('  URL:      http://localhost:4200');
  console.log(`  Checklist: cat ${join(target, 'CHECKLIST.md')}\n`);

  if (doStart) {
    console.log('→ Starting `npm start` (Ctrl+C to stop) ...\n');
    await runChild('npm', ['start'], { cwd: target });
  }
}

async function readLocalVersion(localDistRoot) {
  const packageJson = JSON.parse(
    await readFile(resolve(localDistRoot, 'chat', 'package.json'), 'utf8')
  );
  return packageJson.version;
}

async function resolvePublishedVersion() {
  try {
    return execSync('npm view @threadplane/chat version', {
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    console.error(
      'Could not resolve @threadplane/chat version from npm:',
      error.message
    );
    exit(1);
  }
}

async function packLocalPackages(localDistRoot, packDestination) {
  const distRoot = resolve(localDistRoot);
  const destination = resolve(
    packDestination ?? (await mkdtemp(join(tmpdir(), 'threadplane-packs-')))
  );
  const specs = new Map();

  for (const pkg of THREADPLANE_PACKAGES) {
    const packageRoot = join(distRoot, pkg.dist);
    if (!existsSync(join(packageRoot, 'package.json'))) {
      throw new Error(
        `Missing built package at ${packageRoot}. Run public package builds before smoke verification.`
      );
    }
    const output = await execFileText('npm', [
      'pack',
      packageRoot,
      '--pack-destination',
      destination,
    ]);
    const tarball = output.trim().split(/\r?\n/).filter(Boolean).at(-1);
    if (!tarball)
      throw new Error(`npm pack did not report a tarball for ${pkg.name}`);
    const tarballPath = join(destination, tarball);
    specs.set(pkg.name, `file:${tarballPath}`);
  }

  return specs;
}

async function writeConsumerPackage({
  target,
  version,
  packageSpecs,
  angularLane,
}) {
  const pkgPath = join(target, 'package.json');
  const packageJson = JSON.parse(await readFile(pkgPath, 'utf8'));
  const pkg = applyAngularLane(packageJson, angularLane);

  for (const { name } of THREADPLANE_PACKAGES) {
    if (!pkg.dependencies?.[name]) continue;
    pkg.dependencies[name] = packageSpecs.get(name) ?? `^${version}`;
  }

  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(
    `→ Pinned ${THREADPLANE_PACKAGES.map(({ name }) => name).join(', ')}`
  );
}

async function buildSmokeRun({ target, version, packageSpecs, angularLane }) {
  const lines = [
    '# Smoke run capture',
    '',
    `- Timestamp: ${new Date().toISOString()}`,
    `- Target: ${target}`,
    `- Threadplane version (pinned): ^${version}`,
    `- Angular major: ${angularLane.major}`,
    `- Angular framework version: ${angularLane.dependencies['@angular/core']}`,
    `- TypeScript version: ${angularLane.devDependencies.typescript}`,
    `- Required Node version: >=${angularLane.node}`,
    `- Node: ${process.version}`,
    `- Platform: ${process.platform} ${process.arch}`,
  ];
  try {
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    lines.push(`- Workspace git SHA: ${sha}`);
  } catch {
    /* outside a repo, ignore */
  }
  try {
    const npmV = execSync('npm --version', { encoding: 'utf8' }).trim();
    lines.push(`- npm: ${npmV}`);
  } catch {
    /* ignore */
  }
  lines.push('', '## Resolved package specs', '');
  for (const { name } of THREADPLANE_PACKAGES) {
    const spec = packageSpecs.get(name) ?? `^${version}`;
    if (spec.startsWith('file:')) {
      lines.push(`- ${name}: ${relative(target, spec.slice('file:'.length))}`);
      continue;
    }
    try {
      const resolved = execSync(`npm view ${name}@${spec} version`, {
        encoding: 'utf8',
      }).trim();
      lines.push(`- ${name}@${resolved}`);
    } catch {
      lines.push(`- ${name}: ${spec} (resolution failed)`);
    }
  }
  return lines.join('\n') + '\n';
}

function execFileText(cmd, args) {
  return new Promise((resolveP, rejectP) => {
    execFile(cmd, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${error.message}\n${stderr}`;
        rejectP(error);
      } else {
        resolveP(stdout);
      }
    });
  });
}

function runChild(cmd, args, opts = {}) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('exit', (code) =>
      code === 0 ? resolveP() : rejectP(new Error(`${cmd} exited ${code}`))
    );
    child.on('error', rejectP);
  });
}

export { parseArgs };

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main().catch((err) => {
    console.error('\n✖ Smoke generator failed:', err.message);
    exit(1);
  });
}
