import { createRoot } from 'react-dom/client';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The installed build copies this neutral internal bridge.
import {
  GENERATED_RUNTIME_PARENT_ORIGINS,
  installRuntimeBridge,
} from '../../../../../libs/cockpit-runtime-bridge/src/index';
import { StrandsDemo } from './app';
import { strandsConnection } from './connection';
import '@threadplane/react/chat/styles.css';
import './styles.css';

const element = document.getElementById('root');
if (!element) throw new Error('Application root is missing');
const bridge = installRuntimeBridge(undefined, {
  allowedParentOrigins: GENERATED_RUNTIME_PARENT_ORIGINS,
});
const root = createRoot(element);
let active = true;
window.addEventListener(
  'pagehide',
  () => {
    active = false;
    root.unmount();
    bridge.dispose();
  },
  { once: true }
);
void bridge
  .awaitConfiguration()
  .then((configuration) => {
    if (!active) return;
    root.render(
      <StrandsDemo
        connection={strandsConnection(configuration)}
        onReady={() => {
          if (active) bridge.markReady();
        }}
      />
    );
  })
  .catch(() => {
    if (!active) return;
    bridge.markError('bootstrap_failed');
    root.render(<p role="alert">The meeting preview could not start.</p>);
  });
