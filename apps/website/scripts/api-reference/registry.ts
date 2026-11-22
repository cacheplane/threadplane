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
  ['ag-ui', 'shared', 'src/public-api.ts'],
  ['angular', 'angular', 'src/public-api.ts'],
  ['angular/chat', 'angular', 'chat/src/public-api.ts'],
  ['angular/a2ui', 'angular', 'a2ui/public-api.ts'],
  ['angular/chat/debug', 'angular', 'chat/debug/public-api.ts'],
  ['angular/chat/math', 'angular', 'chat/math/public-api.ts'],
  ['angular/chat/testing', 'angular', 'chat/testing/public-api.ts'],
  ['angular/markdown', 'angular', 'markdown/src/public-api.ts'],
  ['angular/render', 'angular', 'render/src/public-api.ts'],
  ['angular/testing', 'angular', 'testing/src/public-api.ts'],
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
  ['langgraph', 'shared', 'src/public-api.ts'],
  ['middleware/langgraph', 'backend', 'src/langgraph/index.ts'],
  ['react', 'react', 'src/index.ts'],
  ...['chat', 'markdown', 'render', 'debug', 'a2ui'].map(
    (name) =>
      [`react/${name}`, 'react', `src/${name}/index.ts`] as [
        string,
        ApiFramework,
        string
      ]
  ),
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
      'angular/chat/debug',
      'angular/chat/math',
      'angular/chat/testing',
      'angular/markdown',
      'react/chat',
      'react/markdown',
      'react/debug',
    ].includes(id)
      ? 'chat'
      : id === 'react/render' || id === 'angular/render'
      ? 'render'
      : id === 'react/a2ui' || id === 'angular/a2ui'
      ? 'a2ui'
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

// Entry points another documented entry re-exports in full, by import path
// and source. Their symbols are documented once, under the re-exporting entry.
const REEXPORTED_ENTRIES: Readonly<Record<string, string>> = {
  '@threadplane/telemetry/browser/development':
    'libs/telemetry/src/browser/development/public-api.ts',
};
const EXCLUDED_ENTRY_SOURCES = new Set(Object.values(REEXPORTED_ENTRIES));
/** The re-exported entry points, which the API generator resolves to source. */
export function reexportedEntries(): Readonly<Record<string, string>> {
  return REEXPORTED_ENTRIES;
}
/** Assets and install implementation exports are intentionally outside TypeScript reference. */
export const EXCLUDED_EXPORTS = new Set([
  // The development runtime alone; `telemetry/browser` re-exports and
  // documents every symbol it has.
  'telemetry/browser/development',
  'ag-ui/development-install',
  'angular/development-install',
  'langgraph/development-install',
  'angular/chat/styles.css',
  'angular/chat/themes/default-dark.css',
  'angular/chat/themes/default-light.css',
  'angular/chat/themes/material-dark.css',
  'angular/chat/themes/material-light.css',
  'react/chat/styles.css',
  'react/debug/styles.css',
  'react/a2ui/styles.css',
  'react/a2ui/themes/default-light.css',
  'react/a2ui/themes/default-dark.css',
  'react/a2ui/themes/material-light.css',
  'react/a2ui/themes/material-dark.css',
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
        if (
          !EXCLUDED_ENTRY_SOURCES.has(source) &&
          !entries.some((entry) => entry.source === source)
        )
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
        !imports.has(alias) &&
        !EXCLUDED_EXPORTS.has(alias.slice('@threadplane/'.length))
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
