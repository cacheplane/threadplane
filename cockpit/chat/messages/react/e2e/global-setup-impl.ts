import { resolve } from 'node:path';
import { createLanggraphGlobalSetup } from '@threadplane-internal/e2e-harness';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Closed React cockpit identity shared with the static server.
import { reactCockpitConfiguration } from '../../../../../scripts/react-cockpit/configuration.mjs';

const { project, backend } = reactCockpitConfiguration('chat-messages');

// aimock replays the Angular example's fixtures; `langgraph dev` runs the real
// graph against it. The static server (webServer) proxies /api here.
export default createLanggraphGlobalSetup({
  stateKey: project,
  langgraphCwd: backend.python,
  langgraphPort: backend.langgraphPort,
  fixturesDir: resolve(__dirname, '../../../../..', backend.fixtures),
});
