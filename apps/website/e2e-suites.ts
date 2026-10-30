import {
  getCockpitFrontends,
  type CockpitFrontendDeployment,
} from '@threadplane/cockpit-registry';

export const websiteSuites = [
  'control-plane',
  'agents',
  'ag-ui',
  'chat',
  'render',
] as const;
export type WebsiteSuite = (typeof websiteSuites)[number];

// These public surfaces have the same assertions against a production preview.
// Only eligible PRs delegate them; new specs default to local coverage too.
// Keep docs-shell, docs-deep-link and Render Spec hydration local: MdxRenderer
// has a development-only Suspense/fragment recovery path they must exercise.
export const deployedSurfaceSpecs = [
  'blog.spec.ts',
  'docs-tables.spec.ts',
  'docs.spec.ts',
  'example-code.spec.ts',
  'home-airport.spec.ts',
  'home-architecture.spec.ts',
  'home-bundle.spec.ts',
  'home-hero.spec.ts',
  'home-no-runtime.spec.ts',
  'nav-drawer.spec.ts',
  'nav-height.spec.ts',
  'nav-panels.spec.ts',
  'nav-surface.spec.ts',
  'recent-articles.spec.ts',
  'solutions.spec.ts',
  'static-browser-runtime-label.spec.ts',
  'website.spec.ts',
] as const;

// These generic integration specs drive runtimes across product boundaries.
// Keep this list explicit: adding a cross-product journey requires choosing its
// runtime dependencies rather than starting every registered runtime again.
const controlPlaneProjects = new Set([
  'cockpit-langgraph-streaming-react',
  'cockpit-langgraph-persistence-react',
  'cockpit-langgraph-durable-execution-react',
  'cockpit-langgraph-client-tools-react',
  'cockpit-langgraph-deployment-runtime-react',
  'cockpit-ag-ui-streaming-react',
  'cockpit-deep-agents-filesystem-react',
  'cockpit-render-state-management-react',
]);

export function suiteFrontends(suite: WebsiteSuite) {
  return getCockpitFrontends().filter(
    (f) =>
      f.frontend === 'react' &&
      (suite === 'control-plane'
        ? controlPlaneProjects.has(f.project)
        : suite === 'agents'
        ? ['langgraph', 'deep-agents'].includes(f.product)
        : suite === 'render'
        ? ['render', 'runtimes'].includes(f.product)
        : f.product === suite)
  );
}

/** Existing filenames predate the uniform registry naming convention. */
export function previewSpec(frontend: CockpitFrontendDeployment) {
  const aliases: Record<string, string> = {
    'render/spec-rendering': 'render-spec',
    'chat/theming': 'theming',
    'chat/debug': 'debug',
    'runtimes/mastra': 'mastra',
    'runtimes/microsoft-agent-framework': 'maf',
    'runtimes/aws-strands': 'strands',
  };
  const name =
    aliases[`${frontend.product}/${frontend.topic}`] ??
    (['langgraph', 'render'].includes(frontend.product)
      ? frontend.topic
      : `${frontend.product}-${frontend.topic}`);
  return `react-${name}-preview.spec.ts`;
}
