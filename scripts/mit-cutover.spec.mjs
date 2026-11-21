import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createCanonicalPackageJson } from '../libs/telemetry/scripts/assemble-dist.mjs';

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function exists(relativePath) {
  try {
    await access(join(workspaceRoot, relativePath), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function read(relativePath) {
  return readFile(join(workspaceRoot, relativePath), 'utf8');
}

async function readJson(relativePath) {
  return JSON.parse(await read(relativePath));
}

describe('MIT package cutover', () => {
  it('publishes every active package under MIT and retires the licensing package', async () => {
    const nx = await readJson('nx.json');
    const projects = nx.release.groups.publishable.projects;

    expect(projects).not.toContain('licensing');
    expect(await exists('libs/licensing')).toBe(false);

    const libraryDirs = await readdir(join(workspaceRoot, 'libs'), { withFileTypes: true });
    for (const entry of libraryDirs) {
      if (!entry.isDirectory() || !(await exists(`libs/${entry.name}/package.json`))) continue;
      const manifest = await readJson(`libs/${entry.name}/package.json`);
      if (manifest.private === true) continue;
      expect(manifest.license, `${manifest.name} license`).toBe('MIT');
    }

    const angular = await readJson('libs/angular/package.json');
    expect(angular.peerDependencies).not.toHaveProperty('@threadplane/licensing');
  });

  it('ships the MIT notice with every published package', async () => {
    const nx = await readJson('nx.json');
    const projects = nx.release.groups.publishable.projects;
    const rootLicense = await read('LICENSE');

    for (const project of projects) {
      const packageLicense = `libs/${project}/LICENSE.md`;
      expect(await exists(packageLicense), packageLicense).toBe(true);
      expect(await read(packageLicense), packageLicense).toBe(rootLicense);

      let packagesLicense = false;
      if (await exists(`libs/${project}/ng-package.json`)) {
        const ngPackage = await readJson(`libs/${project}/ng-package.json`);
        packagesLicense = ngPackage.assets?.some((asset) =>
          typeof asset === 'string'
            ? asset.endsWith('LICENSE.md')
            : asset.glob === 'LICENSE.md',
        ) ?? false;
      }
      if (await exists(`libs/${project}/project.json`)) {
        const projectConfig = await readJson(`libs/${project}/project.json`);
        packagesLicense ||= Object.values(projectConfig.targets ?? {}).some((target) =>
          target.options?.assets?.some((asset) =>
            typeof asset === 'string'
              ? asset.endsWith('LICENSE.md')
              : asset.glob === 'LICENSE.md',
          ),
        );
      }
      expect(packagesLicense, `${project} build assets`).toBe(true);
    }
  });

  it('removes the complete license-minting and checkout stack', async () => {
    const retiredPaths = [
      'apps/minting-service',
      'apps/website/src/app/api/checkout/session',
      'apps/website/src/app/api/portal/session',
      'libs/db/src/lib/queries/licenses.ts',
      'libs/db/src/lib/queries/licenses.spec.ts',
      'libs/db/src/lib/schema/licenses.ts',
      'COMMERCIAL.md',
      'libs/chat/COMMERCIAL-USE.md',
      'libs/chat/LICENSE-COMMERCIAL.md',
    ];

    for (const path of retiredPaths) {
      expect(await exists(path), path).toBe(false);
    }

    const root = await readJson('package.json');
    expect(root.scripts).not.toHaveProperty('postinstall');
    expect(root.dependencies).not.toHaveProperty('@noble/ed25519');
    expect(root.dependencies).not.toHaveProperty('stripe');
    // The LangGraph package is framework-neutral and has no Angular test setup
    // left to carry the retired key library.
    expect(await exists('libs/langgraph/src/test-setup.ts')).toBe(false);
  });

  it('keeps telemetry explicit instead of mutating package artifacts or installs', async () => {
    const nx = await readJson('nx.json');
    const preVersionCommand = nx.release.version.preVersionCommand;
    const telemetry = await readJson('libs/telemetry/package.json');
    const assembled = createCanonicalPackageJson(telemetry);

    expect(preVersionCommand).not.toContain('apply-install-telemetry');
    expect(telemetry.bin).toBeUndefined();
    expect(telemetry.exports).not.toHaveProperty('./node/postinstall');
    expect(assembled.scripts).toBeUndefined();
  });

  it('contains no current-facing references to the retired licensing model', async () => {
    const currentFiles = [
      'README.md',
      'libs/angular/chat/README.md',
      'libs/angular/NOTICE.md',
      'apps/website/src',
      'apps/website/content',
      'apps/website/public/AGENTS.md',
      'apps/website/public/CLAUDE.md',
      'pricing',
      'examples/chat',
    ];
    const retiredTerms = [
      ['Poly', 'Form'].join(''),
      ['commercial', ' license'].join(''),
      ['dual', '-licensed'].join(''),
      ['license', ' token'].join(''),
      ['@threadplane/', 'licensing'].join(''),
      ['most packages', ' are mit'].join(''),
    ];
    const tracked = execFileSync('git', ['ls-files', '-z', '--', ...currentFiles], {
      cwd: workspaceRoot,
      encoding: 'utf8',
    }).split('\0').filter(Boolean).filter((path) => !path.endsWith('CHANGELOG.md'));

    const violations = [];
    for (const path of tracked) {
      if (!(await exists(path))) continue;
      const content = await read(path);
      for (const term of retiredTerms) {
        if (content.toLowerCase().includes(term.toLowerCase())) {
          violations.push(`${path}: ${term}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
