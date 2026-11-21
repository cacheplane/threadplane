// eslint-disable-next-line @nx/enforce-module-boundaries -- Shared aimock setup for the React cockpit examples.
import { reactAimockMastraGlobalSetup } from '../../../../shared/react-aimock-setup';

// aimock replays the Angular example's fixtures into the deployments/ag-ui-mastra
// service; the static server (webServer) proxies the agent endpoint to it.
export default reactAimockMastraGlobalSetup({ example: 'runtimes/mastra', port: 4641 });
