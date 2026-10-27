import { createRoot } from 'react-dom/client';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Neutral internal bridge copied into isolated cockpit builds.
import {
  GENERATED_RUNTIME_PARENT_ORIGINS,
  installRuntimeBridge,
} from '../../../../../libs/cockpit-runtime-bridge/src/index';
import { createDebugApplication, type DebugApplication } from './application';
import { createDebugClient, debugConnection } from './connection';
import { DebugDemo } from './app';
import '@threadplane/react/chat/styles.css';
import '@threadplane/react/debug/styles.css';
import './styles.css';
const element = document.getElementById('root');
if (!element) throw Error('Application root is missing.');
const bridge = installRuntimeBridge(undefined, {
    allowedParentOrigins: GENERATED_RUNTIME_PARENT_ORIGINS,
  }),
  root = createRoot(element);
let active = true,
  application: DebugApplication | undefined;
window.addEventListener(
  'pagehide',
  () => {
    active = false;
    root.unmount();
    void application?.dispose();
    bridge.dispose();
  },
  { once: true }
);
void bridge
  .awaitConfiguration()
  .then((configuration) => {
    if (!active) return;
    // Construction is lazy and stays outside React rendering. This mount owns the application.
    application = createDebugApplication(
      createDebugClient(debugConnection(configuration))
    );
    root.render(
      <DebugDemo application={application} onReady={() => bridge.markReady()} />
    );
  })
  .catch(() => {
    if (!active) return;
    bridge.markError('bootstrap_failed');
    root.render(<p role="alert">The chat debug example could not start.</p>);
  });
