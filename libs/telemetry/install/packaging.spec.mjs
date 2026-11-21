import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const json = async (path) => JSON.parse(await readFile(resolve(path), 'utf8'));
describe('install collector package assembly', () => {
  it.each(['chat', 'langgraph', 'ag-ui', 'render'])(
    'provides an inert %s source bridge before package preparation',
    async (name) => {
      expect(await readFile(resolve(`libs/${name}/.install-collector/development-install.mjs`), 'utf8'))
        .toBe('export const installationToken = null;\n');
      expect(await readFile(resolve(`libs/${name}/.install-collector/development-install.d.ts`), 'utf8'))
        .toBe('export declare const installationToken: string | null;\n');
    }
  );
  it.each(['chat', 'langgraph', 'ag-ui', 'render'])(
    'keeps the %s contributor workspace lifecycle inert',
    async (name) => {
      const directory = await mkdtemp(resolve(tmpdir(), 'threadplane-workspace-hook-'));
      try {
        const output = execFileSync(process.execPath, [resolve(`libs/${name}/install/postinstall.cjs`)], {
          cwd: directory,
          env: { PATH: process.env.PATH },
          encoding: 'utf8',
          timeout: 3000,
        });
        expect(output).toBe('');
        expect(await readdir(directory)).toEqual([]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );
  it.each(['chat', 'render'])(
    'explicitly ships the shared hook in %s and includes it in build inputs',
    async (name) => {
      const pkg = await json(`libs/${name}/package.json`),
        config = await json(`libs/${name}/ng-package.json`),
        project = await json(`libs/${name}/project.json`);
      expect(pkg.scripts?.postinstall).toBe('node install/postinstall.cjs');
      expect(pkg.exports?.['./development-install']).toEqual({
        types: './.install-collector/development-install.d.ts',
        default: './.install-collector/development-install.mjs',
      });
      expect(pkg.imports?.['#development-install']).toEqual({
        types: './.install-collector/development-install.d.ts',
        default: `@threadplane/${name}/development-install`,
      });
      expect(config.assets).toContainEqual({
        input: '.install-collector',
        glob: 'development-install.*',
        output: '.install-collector',
      });
      expect(config.keepLifecycleScripts).toBe(true);
      expect(project.targets.build.executor).toBe('@nx/angular:package');
      expect(project.targets['prepare-install'].options.command).toBe(
        `node libs/telemetry/install/assemble-package.mjs ${name}`
      );
      expect(project.targets.build.dependsOn).toEqual([
        '^build',
        'prepare-install',
      ]);
      expect(config.assets).toContainEqual({
        input: '.install-collector',
        glob: '*.cjs',
        output: 'install',
      });
      expect(project.targets.build.inputs).toContain(
        '{workspaceRoot}/libs/telemetry/install/*'
      );
      expect(project.implicitDependencies).toContain('telemetry');
      const prepared = await readFile(
        resolve(`libs/${name}/src/lib/package-version.ts`),
        'utf8'
      ).catch(() => '');
      expect(prepared).toContain(
        `export const THREADPLANE_PACKAGE_VERSION = ${JSON.stringify(
          pkg.version
        )};`
      );
      expect(project.targets['prepare-install'].outputs).toContain(
        '{projectRoot}/src/lib/package-version.ts'
      );
    }
  );
  // The backend packages are framework-neutral libraries compiled by tsc. They
  // ship the same hook and bridge through the build target's own assets, embed
  // their release version under `src/runtime` for the development collector's
  // host, and import the bridge by its package subpath only.
  it.each(['langgraph', 'ag-ui'])(
    'explicitly ships the shared hook in the neutral %s package and includes it in build inputs',
    async (name) => {
      const pkg = await json(`libs/${name}/package.json`),
        project = await json(`libs/${name}/project.json`);
      expect(pkg.scripts?.postinstall).toBe('node install/postinstall.cjs');
      expect(pkg.exports?.['./development-install']).toEqual({
        types: './.install-collector/development-install.d.ts',
        default: './.install-collector/development-install.mjs',
      });
      expect(pkg.imports).toBeUndefined();
      expect(pkg.files).toEqual(
        expect.arrayContaining([
          'install/*.cjs',
          '.install-collector/development-install.mjs',
          '.install-collector/development-install.d.ts',
        ])
      );
      expect(project.targets.build.executor).toBe('@nx/js:tsc');
      expect(project.targets.build.options.generatePackageJson).toBe(false);
      expect(project.targets.build.options.assets).toContainEqual({
        input: `libs/${name}/.install-collector`,
        glob: 'development-install.*',
        output: '.install-collector',
      });
      // The collector files are ignored by source control: the asset names that.
      expect(project.targets.build.options.assets).toContainEqual({
        input: `libs/${name}/.install-collector`,
        glob: '*.cjs',
        output: 'install',
        includeIgnoredFiles: true,
      });
      expect(project.targets['prepare-install'].options.command).toBe(
        `node libs/telemetry/install/assemble-package.mjs ${name}`
      );
      expect(project.targets.build.dependsOn).toEqual([
        '^build',
        'prepare-install',
      ]);
      expect(project.targets.build.inputs).toContain(
        '{workspaceRoot}/libs/telemetry/install/*'
      );
      expect(project.implicitDependencies).toContain('telemetry');
      const prepared = await readFile(
        resolve(`libs/${name}/src/runtime/package-version.ts`),
        'utf8'
      ).catch(() => '');
      expect(prepared).toContain(
        `export const THREADPLANE_PACKAGE_VERSION = ${JSON.stringify(
          pkg.version
        )};`
      );
      expect(project.targets['prepare-install'].outputs).toEqual([
        '{projectRoot}/.install-collector',
        '{projectRoot}/src/runtime/package-version.ts',
      ]);
    }
  );
  it('keeps root and the explicit telemetry helper package installation inert', async () => {
    expect((await json('package.json')).scripts.postinstall).toBeUndefined();
    expect((await json('libs/telemetry/package.json')).scripts).toBeUndefined();
  });
});
