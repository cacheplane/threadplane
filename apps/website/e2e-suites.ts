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
