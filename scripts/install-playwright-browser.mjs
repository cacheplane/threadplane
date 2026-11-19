import { appendFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// Installs one Playwright browser and the Ubuntu packages it needs, without
// depending on mirror speed in the common case.
//
// `npx playwright install --with-deps` runs `apt-get update` and then
// `apt-get install` for every listed package. On a hosted runner most of them
// are already present, but apt still upgrades any listed library that has a
// newer patch release (mesa pulled ~20 MB this way) and downloads the fonts the
// image lacks. A slow mirror turned that into a ten-minute timeout.
//
// This helper instead:
//   1. asks Playwright for its package list (`install-deps --dry-run`),
//   2. installs nothing when every package is already present,
//   3. otherwise installs the missing packages from cached .deb files,
//   4. and only falls back to apt (missing packages only, `--no-upgrade`) when
//      the cache cannot satisfy them, keeping the downloaded .deb files for the
//      workflow cache to save.
// The browser binaries come from the restored ~/.cache/ms-playwright, so
// `playwright install` is a no-op on a warm cache.

const BROWSERS = new Set(['chromium', 'firefox', 'webkit']);
const PACKAGE_NAME = /^[a-z0-9][a-z0-9+.-]+$/;

export function parseDryRunPackages(output) {
  const match = output.match(/apt-get install -y --no-install-recommends ([^"\n]+)/);
  if (!match) throw new Error('Could not find the apt-get install command in Playwright install-deps --dry-run output');
  const packages = [...new Set(match[1].trim().split(/\s+/))];
  const invalid = packages.filter((name) => !PACKAGE_NAME.test(name));
  if (packages.length === 0 || invalid.length > 0) {
    throw new Error(`Unexpected package names in Playwright install-deps output: ${invalid.join(' ') || '(none)'}`);
  }
  return packages;
}

// `dpkg-query -W` prints one line per known package and reports unknown ones on
// stderr, so a package that never appears is missing too.
export function parseInstalledPackages(output) {
  const installed = new Set();
  for (const line of output.split('\n')) {
    const [name, status] = line.split('\t');
    if (name && status === 'installed') installed.add(name.replace(/:[a-z0-9]+$/, ''));
  }
  return installed;
}

export function missingPackages(required, installed) {
  return required.filter((name) => !installed.has(name));
}

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  if (result.error) throw result.error;
  return result;
}

function mustRun(command, args) {
  const result = run(command, args);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
}

function installedSet(packages) {
  const result = run('dpkg-query', ['-W', '-f=${Package}\t${db:Status-Status}\n', ...packages], { capture: true });
  return parseInstalledPackages(result.stdout);
}

function debPackageName(path) {
  const result = run('dpkg-deb', ['-f', path, 'Package'], { capture: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function cachedDebs(debCache) {
  try {
    return (await readdir(debCache)).filter((name) => name.endsWith('.deb')).map((name) => join(debCache, name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function installFromCache(debCache) {
  const debs = await cachedDebs(debCache);
  if (debs.length === 0) return false;
  const names = new Map(debs.map((path) => [path, debPackageName(path)]));
  const installed = installedSet([...names.values()].filter(Boolean));
  const pending = debs.filter((path) => names.get(path) && !installed.has(names.get(path)));
  if (pending.length === 0) return true;
  console.log(`Installing ${pending.length} cached package(s) without network access`);
  const result = run('sudo', ['dpkg', '-i', ...pending]);
  if (result.status !== 0) {
    console.warn('Cached packages did not install cleanly; repairing with apt');
    return false;
  }
  return true;
}

async function installWithApt(debCache, packages) {
  // Only packages that are missing, and never upgrades of installed ones.
  await rm(debCache, { recursive: true, force: true });
  await mkdir(join(debCache, 'partial'), { recursive: true });
  mustRun('sudo', ['apt-get', 'update']);
  mustRun('sudo', [
    'apt-get', 'install', '-y', '--no-install-recommends', '--no-upgrade', '--fix-broken',
    '-o', `Dir::Cache::archives=${debCache}`,
    '-o', 'APT::Keep-Downloaded-Packages=true',
    ...packages,
  ]);
  // apt runs as root; let the cache step read and later restore the files.
  mustRun('sudo', ['chown', '-R', `${process.getuid()}:${process.getgid()}`, debCache]);
  await rm(join(debCache, 'partial'), { recursive: true, force: true });
  await rm(join(debCache, 'lock'), { force: true });
}

export async function installPlaywrightBrowser({ browser, debCache }) {
  if (!BROWSERS.has(browser)) throw new Error(`Unsupported browser: ${browser}`);
  await mkdir(debCache, { recursive: true });

  const dryRun = run('npx', ['--no-install', 'playwright', 'install-deps', '--dry-run', browser], { capture: true });
  if (dryRun.status !== 0) throw new Error(`playwright install-deps --dry-run failed:\n${dryRun.stderr}`);
  const required = parseDryRunPackages(dryRun.stdout);

  let downloaded = false;
  let missing = missingPackages(required, installedSet(required));
  if (missing.length === 0) {
    console.log(`All ${required.length} ${browser} host packages are already installed`);
  } else {
    console.log(`Missing ${browser} host packages: ${missing.join(' ')}`);
    if (await installFromCache(debCache)) missing = missingPackages(required, installedSet(required));
    if (missing.length > 0) {
      await installWithApt(debCache, missing);
      downloaded = (await cachedDebs(debCache)).length > 0;
      missing = missingPackages(required, installedSet(required));
    }
    if (missing.length > 0) throw new Error(`Host packages still missing after install: ${missing.join(' ')}`);
  }

  mustRun('npx', ['--no-install', 'playwright', 'install', browser]);
  // The composite action saves the .deb cache only after a fresh download, so an
  // image that needed nothing never stores an empty cache under the shared key.
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `downloaded=${downloaded}\n`);
  return { downloaded };
}

async function main() {
  const [browser, debCache] = process.argv.slice(2);
  if (!browser || !debCache || process.argv.length !== 4) {
    throw new Error('Usage: node scripts/install-playwright-browser.mjs <browser> <deb-cache-dir>');
  }
  if (process.platform !== 'linux') throw new Error('Playwright host package installation requires Linux');
  await installPlaywrightBrowser({ browser, debCache: resolve(debCache) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
