import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import type {
  ApiEntrypoint,
  ApiFramework,
} from '../../src/lib/api-reference-model';

export interface SdkEntrypoint extends ApiEntrypoint {
  source: string;
  allowEmpty?: boolean;
}
const definitions: [string, ApiFramework, string, string?][] = [
  ['a2ui', 'shared', 'src/index.ts'],
  ['ag-ui', 'angular', 'src/public-api.ts'],
  ['angular', 'angular', 'src/public-api.ts'],
  ['angular/chat', 'angular', 'chat/src/public-api.ts'],
  ['angular/markdown', 'angular', 'markdown/src/public-api.ts'],
  ['chat', 'angular', 'src/public-api.ts'],
  ['chat/debug', 'angular', 'debug/public-api.ts'],
  ['chat/testing', 'angular', 'testing/public-api.ts'],
  ['content', 'shared', 'src/index.ts'],
  ...['markdown', 'messages', 'json', 'a2ui', 'render-state', 'testing'].map(
    (name) =>
      [`content/${name}`, 'shared', `src/${name}/index.ts`] as [
        string,
        ApiFramework,
        string
      ]
  ),
  ['core', 'shared', 'src/index.ts'],
  ['core/tools', 'shared', 'src/tools/index.ts'],
  ['core/testing', 'shared', 'src/testing/index.ts'],
  ['langgraph', 'angular', 'src/public-api.ts'],
  ['middleware/langgraph', 'backend', 'src/langgraph/index.ts'],
  ['react', 'react', 'src/index.ts'],
  ...['chat', 'markdown', 'render', 'debug'].map(
    (name) =>
      [`react/${name}`, 'react', `src/${name}/index.ts`] as [
        string,
        ApiFramework,
        string
      ]
  ),
  ['render', 'angular', 'src/public-api.ts'],
  ['telemetry', 'shared', 'src/index.ts'],
  ['telemetry/browser', 'angular', 'src/browser/public-api.ts'],
  ['telemetry/node', 'backend', 'src/node/index.ts'],
  ['telemetry/shared', 'shared', 'src/shared/public-api.ts'],
];
const workspace = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..'
);
export const SDK_ENTRYPOINTS: SdkEntrypoint[] = definitions.map(
  ([id, framework, source]) => {
    const project = id.split('/')[0];
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(workspace, 'libs', project, 'package.json'),
        'utf8'
      )
    );
    const docLibrary = [
      'angular/chat',
      'angular/markdown',
      'react/chat',
      'react/markdown',
      'react/debug',
    ].includes(id)
      ? 'chat'
      : id === 'react/render'
      ? 'render'
      : project;
    return {
      id,
      project,
      framework,
      source: `libs/${project}/${source}`,
      importPath: `@threadplane/${id}`,
      packageName: manifest.name,
      version: manifest.version,
      status: manifest.private ? 'development' : 'published',
      docLibrary,
      ...(['content', 'content/testing', 'core/testing'].includes(id)
        ? { allowEmpty: true }
        : {}),
    };
  }
);

/** Assets and install implementation exports are intentionally outside TypeScript reference. */
export const EXCLUDED_EXPORTS = new Set([
  'ag-ui/development-install',
  'chat/development-install',
  'langgraph/development-install',
  'render/development-install',
  'chat/chat.css',
  'chat/themes/default-dark.css',
  'chat/themes/default-light.css',
  'chat/themes/material-dark.css',
  'chat/themes/material-light.css',
  'react/chat/styles.css',
  'react/debug/styles.css',
  'middleware/README.md',
  'telemetry/README.md',
]);
function json(file: string) {
  const result = ts.readConfigFile(file, ts.sys.readFile);
  if (result.error) throw new Error(`Invalid registry configuration: ${file}`);
  return result.config;
}
export function validateRegistry(
  root: string,
  entries: readonly SdkEntrypoint[]
): void {
  const imports = new Set(entries.map((entry) => entry.importPath));
  const projects = new Set(entries.map((entry) => entry.project));
  if (
    imports.size !== entries.length ||
    new Set(entries.map((entry) => entry.id)).size !== entries.length
  )
    throw new Error('Duplicate API registry entry');
  for (const dir of fs.readdirSync(path.join(root, 'libs'))) {
    const projectFile = path.join(root, 'libs', dir, 'project.json');
    if (!fs.existsSync(projectFile)) continue;
    const project = json(projectFile);
    if (project.tags?.includes('scope:library') && !projects.has(project.name))
      throw new Error(`Unregistered scope:library project: ${project.name}`);
  }
  const aliases = json(path.join(root, 'tsconfig.base.json')).compilerOptions
    .paths;
  for (const project of projects) {
    const base = path.join(root, 'libs', project);
    const manifest = json(path.join(base, 'package.json'));
    for (const [key, value] of Object.entries(manifest.exports ?? {})) {
      const id = `${project}${key === '.' ? '' : key.slice(1)}`;
      if (EXCLUDED_EXPORTS.has(id)) continue;
      const hasTypes = (entry: unknown): boolean =>
        !!entry &&
        typeof entry === 'object' &&
        Object.entries(entry).some(
          ([name, child]) => name === 'types' || hasTypes(child)
        );
      if (hasTypes(value) && !imports.has(`@threadplane/${id}`))
        throw new Error(`Unregistered typed export: ${id}`);
      if (!hasTypes(value)) throw new Error(`Unclassified asset export: ${id}`);
    }
    const walk = (dir: string): void => {
      for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
        if (
          child.isDirectory() &&
          !['node_modules', '.install-collector', 'dist'].includes(child.name)
        )
          walk(path.join(dir, child.name));
        if (child.name !== 'ng-package.json') continue;
        const configFile = path.join(dir, child.name);
        const config = json(configFile);
        const source = path.relative(
          root,
          path.resolve(dir, config.lib.entryFile)
        );
        if (!entries.some((entry) => entry.source === source))
          throw new Error(`Unregistered Angular entrypoint: ${source}`);
      }
    };
    walk(base);
    for (const [alias, paths] of Object.entries(aliases) as [
      string,
      string[]
    ][]) {
      if (
        (alias === manifest.name || alias.startsWith(`${manifest.name}/`)) &&
        !imports.has(alias)
      )
        throw new Error(
          `Unregistered SDK path alias: ${alias} (${paths.join(', ')})`
        );
    }
  }
  for (const entry of entries) {
    if (!fs.existsSync(path.join(root, entry.source)))
      throw new Error(
        `Missing API entrypoint ${entry.importPath}: ${entry.source}`
      );
    if (
      aliases[entry.importPath] &&
      !aliases[entry.importPath].includes(entry.source)
    )
      throw new Error(
        `API entrypoint source disagrees with alias: ${entry.importPath}`
      );
  }
}
