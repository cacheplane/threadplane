// eslint-disable-next-line @nx/enforce-module-boundaries -- Shared aimock setup for the React cockpit examples.
import { reactAimockGlobalSetup } from '../../../../shared/react-aimock-setup';

// aimock replays the Angular example's fixtures into a real `langgraph dev`;
// the static server (webServer) proxies /api to it.
export default reactAimockGlobalSetup({ example: 'chat/messages', port: 4620 });
