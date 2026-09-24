// Final package roles are independent of the packages temporarily retained
// during migration. Removing a scaffold must not weaken the final-role gate.
export const finalPackageDependencies = {
  core: [],
  langgraph: ['core'],
  'ag-ui': ['core'],
  render: ['core'],
  a2ui: [],
  content: ['core', 'render', 'a2ui'],
  angular: ['core', 'content', 'render', 'a2ui'],
  react: ['core', 'content', 'render', 'a2ui'],
  telemetry: ['core'],
};
export const privateScaffoldProjects = ['core', 'content', 'angular', 'react'];
export const angularTransitionProjects = ['chat', 'langgraph', 'ag-ui', 'render'];
export const scanProjects = [...new Set([...privateScaffoldProjects, ...angularTransitionProjects, 'a2ui', 'telemetry'])];
// Source-only staging boundary; this does not declare a published entry point.
export const neutralLangGraphRoots = ['src/lib/transport/fetch-stream.transport.ts', 'src/lib/client/create-langgraph-client.ts'];
// Exact source-sharing exceptions during the Angular transition. Their imports
// remain guarded; neither file may expose the private session through a bridge.
export const sharedLangGraphRuntimeSources = ['src/runtime/transport.types.ts', 'src/runtime/operation-errors.ts'];
// TypeScript resolution and filesystem enumeration can use different separators.
export function langGraphRuntimeSourceKind(root, path) {
  const directory = `${root.replaceAll('\\', '/').replace(/\/$/, '')}/libs/langgraph/`;
  const normalized = path.replaceAll('\\', '/');
  if (!normalized.startsWith(`${directory}src/runtime/`)) return undefined;
  return sharedLangGraphRuntimeSources.includes(normalized.slice(directory.length)) ? 'shared' : 'private';
}
const retiredProjects = ['chat', 'langgraph-core', 'ag-ui-core', 'react-render'];

export function packageOf(specifier) {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
}

export function sourceEntry(project, angularTransitions = angularTransitionProjects) {
  return project === 'angular' || angularTransitions.includes(project) ? 'src/public-api.ts' : 'src/index.ts';
}

export function forbiddenDependency(project, specifier, { angularTransitions = [], browserTransition = false, neutralRuntime = false } = {}) {
  const pkg = packageOf(specifier);
  const internal = pkg.startsWith('@threadplane/') ? pkg.slice('@threadplane/'.length) : undefined;
  if (neutralRuntime) {
    if (internal) return !['langgraph', 'core'].includes(internal);
    if (specifier.startsWith('.')) return false;
    return specifier !== '@langchain/langgraph-sdk';
  }
  const angular = pkg.startsWith('@angular/');
  const react = ['react', 'react-dom', '@types/react', '@types/react-dom'].includes(pkg) || ['react', 'react-render', 'ui-react', 'workspace-react'].includes(internal);
  // These are intentionally the only whole-project exceptions. Their current
  // Angular graphs are scanned transitively and still cannot reach React.
  if (angularTransitionProjects.includes(project) && angularTransitions.includes(project)) return react;
  const role = project;
  if (internal) {
    if (internal === project) return false;
    return !finalPackageDependencies[role]?.includes(internal);
  }
  if (react && role !== 'react') return true;
  if (angular && role !== 'angular' && !(role === 'telemetry' && browserTransition)) return true;
  const backend = pkg.startsWith('@langchain/') || pkg.startsWith('@ag-ui/');
  if (backend && !['langgraph', 'ag-ui'].includes(role)) return true;
  const parser = ['@cacheplane/partial-json', '@cacheplane/partial-markdown', 'marked', 'remark-gfm', 'katex', 'shiki'].includes(pkg);
  return (role === 'core' && (parser || pkg === 'zod')) ||
    (['core', 'content', 'render', 'a2ui', 'telemetry'].includes(role) && pkg === 'rxjs');
}

export function manifestViolations(project, manifest, { angularTransitions = [], telemetryBrowserTransition = false } = {}) {
  const errors = [];
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const dependency of Object.keys(manifest[field] ?? {})) {
      const optionalBrowserPeer = project === 'telemetry' && telemetryBrowserTransition &&
        field === 'peerDependencies' && dependency === '@angular/core' && manifest.peerDependenciesMeta?.[dependency]?.optional === true;
      // Core's install graph must stay empty even when source never imports a
      // declared dependency. This also covers optional and peer installation.
      if (project === 'core' || (!optionalBrowserPeer && forbiddenDependency(project, dependency, { angularTransitions }))) errors.push(`${project}: forbidden ${field} entry ${dependency}`);
    }
  }
  return errors;
}

// Deliberately opt-in until the topology migration has removed all exceptions.
export function assertFinalRelease({ projects = scanProjects, angularTransitions = angularTransitionProjects, telemetryBrowserTransition = true } = {}) {
  return [
    ...projects.filter((project) => retiredProjects.includes(project)).map((project) => `${project}: transition package remains in final release`),
    ...angularTransitions.map((project) => `${project}: Angular transition remains enabled`),
    ...(telemetryBrowserTransition ? ['telemetry/browser: Angular transition remains enabled'] : []),
  ];
}

// Both APF conditional exports and legacy @nx/js manifests are valid. Explicit
// exports maps take precedence: never invent a subpath they do not expose.
export function emittedEntries(manifest, subpath = '.') {
  const strings = (value) => typeof value === 'string' ? [value] : Object.values(value ?? {}).flatMap(strings);
  if (manifest?.exports) {
    const exports = manifest.exports;
    const entry = typeof exports === 'string' || !Object.keys(exports).some((key) => key.startsWith('.')) ? (subpath === '.' ? exports : undefined) : exports[subpath];
    return [...new Set(strings(entry))];
  }
  return subpath === '.' ? [...new Set([manifest?.types, manifest?.typings, manifest?.module, manifest?.main].filter(Boolean))] : [];
}
