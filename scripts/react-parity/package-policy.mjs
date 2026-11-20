// The package roles of the release. Each package may import only the internal
// packages listed for it. The backend packages (langgraph, ag-ui) are
// framework-neutral: core and their own SDK, nothing else. `angular` is the one
// Angular binding; `chat` is the Angular chat UI built on it.
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
  chat: ['core', 'angular', 'content', 'render', 'a2ui', 'telemetry'],
};
// The shared foundations every binding is built from.
export const foundationProjects = ['core', 'content', 'angular', 'react'];
// Published to npm at one version. `react` is the only foundation not yet released.
export const publishableProjects = ['core', 'content', 'angular', 'chat', 'langgraph', 'ag-ui', 'render', 'a2ui', 'telemetry'];
export const privateProjects = ['react'];
export const backendProjects = ['langgraph', 'ag-ui'];
// Packages that are Angular by role: Angular imports are theirs to make, and
// their source entry is an APF `public-api.ts`.
export const angularProjects = ['angular', 'chat'];
// The one remaining whole-project exception: the Angular render engine, whose
// final role is neutral. Its graph is scanned transitively and cannot reach React.
export const angularTransitionProjects = ['render'];
export const scanProjects = [...new Set([...foundationProjects, 'chat', ...backendProjects, ...angularTransitionProjects, 'a2ui', 'telemetry'])];
// The only external packages a backend package may import. RxJS is the AG-UI
// client's own stream type; the in-process fake agent returns one.
export const neutralRuntimeSdkEntries = { langgraph: ['@langchain/langgraph-sdk'], 'ag-ui': ['@ag-ui/client', 'rxjs'] };
// A backend package's source. No Angular source may reach it: a binding takes a
// session through `provideAgent({ createSession })`, never by importing a backend.
// TypeScript resolution and filesystem enumeration can use different separators.
export function backendRuntimeSourceKind(root, path) {
  const directory = `${root.replaceAll('\\', '/').replace(/\/$/, '')}/libs/`;
  const normalized = path.replaceAll('\\', '/');
  return backendProjects.some((project) => normalized.startsWith(`${directory}${project}/src/`)) ? 'private' : undefined;
}
const retiredProjects = ['langgraph-core', 'ag-ui-core', 'react-render'];

export function packageOf(specifier) {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
}

export function sourceEntry(project, angularTransitions = angularTransitionProjects) {
  // The backend packages keep the entry name their roots always had.
  return angularProjects.includes(project) || backendProjects.includes(project) || angularTransitions.includes(project) ? 'src/public-api.ts' : 'src/index.ts';
}

export function forbiddenDependency(project, specifier, { angularTransitions = [], browserTransition = false, neutralRuntime = false } = {}) {
  const pkg = packageOf(specifier);
  const internal = pkg.startsWith('@threadplane/') ? pkg.slice('@threadplane/'.length) : undefined;
  if (neutralRuntime) {
    if (internal) return ![project, 'core'].includes(internal);
    if (specifier.startsWith('.')) return false;
    return !neutralRuntimeSdkEntries[project]?.includes(specifier);
  }
  const angular = pkg.startsWith('@angular/');
  const react = ['react', 'react-dom', '@types/react', '@types/react-dom'].includes(pkg) || ['react', 'react-render', 'ui-react', 'workspace-react'].includes(internal);
  // This is intentionally the only whole-project exception. Its current
  // Angular graph is scanned transitively and still cannot reach React.
  if (angularTransitionProjects.includes(project) && angularTransitions.includes(project)) return react;
  const role = project;
  if (internal) {
    if (internal === project) return false;
    return !finalPackageDependencies[role]?.includes(internal);
  }
  if (react && role !== 'react') return true;
  if (angular && !angularProjects.includes(role) && !(role === 'telemetry' && browserTransition)) return true;
  const backend = pkg.startsWith('@langchain/') || pkg.startsWith('@ag-ui/');
  if (backend && !['langgraph', 'ag-ui'].includes(role)) return true;
  const parser = ['@cacheplane/json-stream', '@cacheplane/partial-json', '@cacheplane/partial-markdown', 'marked', 'remark-gfm', 'katex', 'shiki'].includes(pkg);
  return (role === 'core' && (parser || pkg === 'zod' || pkg === '@json-render/core')) ||
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
