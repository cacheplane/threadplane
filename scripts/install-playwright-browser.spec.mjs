import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parse as parseYaml } from 'yaml';
import { missingPackages, parseDryRunPackages, parseInstalledPackages } from './install-playwright-browser.mjs';

const dryRun = 'sudo -- sh -c "apt-get update&& apt-get install -y --no-install-recommends libasound2t64 libgbm1 xvfb fonts-unifont fonts-wqy-zenhei libgbm1"\n';

test('reads the package list from Playwright install-deps --dry-run output', () => {
  assert.deepEqual(parseDryRunPackages(dryRun), ['libasound2t64', 'libgbm1', 'xvfb', 'fonts-unifont', 'fonts-wqy-zenhei']);
  // As root, Playwright prints the commands without the sudo wrapper.
  assert.deepEqual(parseDryRunPackages('sh -c "apt-get update&& apt-get install -y --no-install-recommends libnss3"'), ['libnss3']);
});

test('refuses output it cannot read rather than installing nothing', () => {
  assert.throws(() => parseDryRunPackages('Installing dependencies...\n'), /Could not find the apt-get install command/);
  assert.throws(() => parseDryRunPackages('apt-get install -y --no-install-recommends libnss3 $(rm -rf /)'), /Unexpected package names/);
});

test('treats only fully installed packages as present', () => {
  const installed = parseInstalledPackages([
    'libgbm1\tinstalled',
    'libasound2t64:amd64\tinstalled',
    'fonts-unifont\tconfig-files',
    'xvfb\thalf-installed',
    '',
  ].join('\n'));
  assert.deepEqual([...installed].sort(), ['libasound2t64', 'libgbm1']);
  // A package dpkg has never heard of prints no line at all and stays missing.
  assert.deepEqual(
    missingPackages(['libasound2t64', 'libgbm1', 'xvfb', 'fonts-unifont', 'fonts-wqy-zenhei'], installed),
    ['xvfb', 'fonts-unifont', 'fonts-wqy-zenhei'],
  );
});

test('the composite action caches browsers and host packages around the installer', async () => {
  const action = parseYaml(await readFile('.github/actions/install-playwright-browser/action.yml', 'utf8'));
  const steps = action.runs.steps;
  const browsers = steps.find((step) => step.uses?.startsWith('actions/cache@'));
  const restore = steps.find((step) => step.uses?.startsWith('actions/cache/restore@'));
  const install = steps.find((step) => step.id === 'install');
  const save = steps.find((step) => step.uses?.startsWith('actions/cache/save@'));
  assert.equal(browsers.with.path, '~/.cache/ms-playwright');
  assert.match(browsers.with.key, /steps\.version\.outputs\.playwright/);
  assert.match(browsers.with.key, /inputs\.browser/);
  assert.equal(restore.with.path, save.with.path);
  assert.equal(save.with.key, '${{ steps.debs.outputs.cache-primary-key }}');
  // Saving only after a download keeps an empty directory from claiming the key.
  assert.match(save.if, /steps\.install\.outputs\.downloaded == 'true'/);
  assert.match(install.run, /node scripts\/install-playwright-browser\.mjs/);
  assert.ok(steps.indexOf(browsers) < steps.indexOf(install));
  assert.ok(steps.indexOf(restore) < steps.indexOf(install) && steps.indexOf(install) < steps.indexOf(save));
});
