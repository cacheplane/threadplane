/** Where the live AG-UI session suite finds its real backends. */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));
export const root = resolve(here, '../../..');

/**
 * The uv project environment the Python backends run in. It is the same
 * environment the client-tools candidate proof uses, prepared from that
 * project's frozen lock (see `prepare.mjs`).
 */
export const environment =
  process.env.THREADPLANE_AG_UI_FIXTURE_ENVIRONMENT ??
  '/tmp/threadplane-agui-client-tools-native-fixture-env';
/** The project whose lock the environment is synced from. */
export const pythonProject = resolve(root, 'cockpit/ag-ui/client-tools/python');

/** The unchanged cockpit backends, each served from its own project directory. */
export const backends = {
  interrupts: {
    cwd: resolve(root, 'cockpit/ag-ui/interrupts/python'),
    fixtures: resolve(
      root,
      'cockpit/ag-ui/interrupts/angular/e2e/fixtures/interrupts.json'
    ),
  },
  clientTools: {
    cwd: resolve(root, 'cockpit/ag-ui/client-tools/python'),
    fixtures: resolve(
      root,
      'cockpit/ag-ui/client-tools/angular/e2e/fixtures/client-tools.json'
    ),
  },
  subagents: {
    cwd: resolve(root, 'cockpit/ag-ui/subagents/python'),
    fixtures: resolve(
      root,
      'cockpit/ag-ui/subagents/angular/e2e/fixtures/subagents.json'
    ),
  },
};

/** The Node service that hosts the Mastra agents, and its scripted model. */
export const mastra = resolve(root, 'deployments/ag-ui-mastra');
