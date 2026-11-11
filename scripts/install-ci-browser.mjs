import { lookup as dnsLookup } from 'node:dns/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// configure-ci-apt.mjs points every Ubuntu source at these two hosts.
export const PACKAGE_HOSTS = ['archive.ubuntu.com', 'security.ubuntu.com'];
const BROWSERS = ['chromium', 'firefox', 'webkit'];
const ATTEMPTS = 3;
const PAUSE_MS = 5000;
const LOOKUP_MS = 10000;

/** The browser named by exactly `npx playwright install --with-deps <browser>`. */
export function requestedBrowser(command) {
  const [npx, playwright, install, deps, browser, ...rest] = command;
  if (npx !== 'npx' || playwright !== 'playwright' || install !== 'install' || deps !== '--with-deps' || !BROWSERS.includes(browser) || rest.length > 0) {
    throw new Error('Usage: install-ci-browser.mjs npx playwright install --with-deps <chromium|firefox|webkit>');
  }
  return browser;
}

async function resolves(host, lookup) {
  let timer;
  try {
    await Promise.race([
      lookup(host),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('lookup timed out')), LOOKUP_MS); }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Hosts that still do not resolve after the bounded attempts; empty when the package hosts are reachable by name. */
export async function unresolvedPackageHosts({ lookup, sleep }) {
  let missing = PACKAGE_HOSTS;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const results = await Promise.all(missing.map(async (host) => ((await resolves(host, lookup)) ? null : host)));
    missing = results.filter((host) => host !== null);
    if (missing.length === 0 || attempt === ATTEMPTS) break;
    await sleep(PAUSE_MS);
  }
  return missing;
}

/**
 * Runs the requested install unchanged when the Ubuntu package hosts resolve.
 * When they do not, APT would spend the whole step timeout on name lookups, so
 * install only the browser and prove it launches with the libraries the image
 * already has. A browser that cannot launch still fails the step.
 */
export async function installCiBrowser(command, { lookup, sleep, run, launches, log }) {
  const browser = requestedBrowser(command);
  const missing = await unresolvedPackageHosts({ lookup, sleep });
  if (missing.length === 0) return run(command);
  log(`::warning::${missing.join(' and ')} did not resolve after ${ATTEMPTS} attempts; installing ${browser} without Ubuntu packages and checking that it launches.`);
  const status = run(['npx', 'playwright', 'install', browser]);
  if (status !== 0) return status;
  if (launches(browser)) return 0;
  log(`::error::${browser} did not launch without its Ubuntu packages, and the package hosts are unreachable by name.`);
  return 1;
}

function run(command) {
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' });
  return result.status ?? 1;
}

function launches(browser) {
  const script = `const { ${browser} } = await import('@playwright/test'); const instance = await ${browser}.launch(); await instance.close();`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { stdio: 'inherit', timeout: 120000 });
  return result.status === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  installCiBrowser(process.argv.slice(2), { lookup: (host) => dnsLookup(host), sleep: delay, run, launches, log: console.log })
    .then((status) => { process.exitCode = status; })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
