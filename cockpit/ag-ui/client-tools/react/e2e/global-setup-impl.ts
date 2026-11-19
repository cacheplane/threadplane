// eslint-disable-next-line @nx/enforce-module-boundaries -- Shared aimock setup for the React cockpit examples.
import { reactAimockAgUiGlobalSetup } from '../../../../shared/react-aimock-setup';

// aimock replays the Angular example's fixtures into the example's real AG-UI
// server; the static server (webServer) proxies the agent endpoint to it.
export default reactAimockAgUiGlobalSetup({ example: 'ag-ui/client-tools', port: 4640 });
