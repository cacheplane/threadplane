import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated consumer copies this private bridge.
import {
  GENERATED_RUNTIME_PARENT_ORIGINS,
  installRuntimeBridge,
  type InstalledRuntimeBridge,
} from '../../../../../libs/cockpit-runtime-bridge/src/index';
import { A2uiDemo } from './app';
import {
  a2uiConnection,
  createConnectedApplication,
  type A2uiConnection,
} from './connection';
import type { A2uiApplication } from './application';
import '@threadplane/react/chat/styles.css';
import './styles.css';

/** Own bootstrap and teardown outside React's replayable presentation lifetime. */
export function startA2uiDemo(
  element: HTMLElement,
  dependencies: {
    readonly bridge?: InstalledRuntimeBridge;
    readonly root?: Pick<Root, 'render' | 'unmount'>;
    readonly createApplication?: (
      connection: A2uiConnection
    ) => A2uiApplication;
  } = {}
) {
  const bridge =
    dependencies.bridge ??
    installRuntimeBridge(undefined, {
      allowedParentOrigins: GENERATED_RUNTIME_PARENT_ORIGINS,
    });
  let root: Pick<Root, 'render' | 'unmount'>;
  try {
    root = dependencies.root ?? createRoot(element);
  } catch (error) {
    try {
      bridge.dispose();
    } catch {
      /* Preserve the acquisition error. */
    }
    throw error;
  }
  const createApplication =
    dependencies.createApplication ?? createConnectedApplication;
  let active = true,
    markedReady = false,
    application: A2uiApplication | undefined,
    cleanup: Promise<void> | undefined;
  function dispose(): Promise<void> {
    if (!active) return cleanup ?? Promise.resolve();
    active = false;
    window.removeEventListener('pagehide', pagehide);
    // Revoke work/stop first, then remove borrowed views, then dispose owned data.
    try {
      application?.revoke();
    } catch {
      /* Every acquired owner still needs cleanup. */
    }
    try {
      root.unmount();
    } catch {
      /* Unmount failure cannot retain application authority. */
    }
    cleanup = Promise.resolve()
      .then(() => application?.dispose())
      .catch(() => undefined)
      .then(() => {
        try {
          bridge.dispose();
        } catch {
          /* Page teardown cannot trigger unhandled rejection. */
        }
      });
    return cleanup;
  }
  function pagehide() {
    void dispose();
  }
  window.addEventListener('pagehide', pagehide);
  const ready = bridge
    .awaitConfiguration()
    .then(async (configuration) => {
      if (!active) return;
      const connection = a2uiConnection(configuration);
      application = createApplication(connection);
      if (!active) {
        application.revoke();
        await application.dispose();
        return;
      }
      root.render(
        <StrictMode>
          <A2uiDemo
            application={application}
            onReady={() => {
              if (active && !markedReady) {
                markedReady = true;
                bridge.markReady();
              }
            }}
          />
        </StrictMode>
      );
    })
    .catch(async () => {
      if (!active) return;
      try {
        bridge.markError('bootstrap_failed');
      } catch {
        /* Continue local cleanup. */
      }
      let renderFailed = false;
      try {
        root.render(<p role="alert">The flight preview could not start.</p>);
      } catch {
        renderFailed = true;
      }
      if (application || renderFailed) await dispose();
    });
  return Object.freeze({ ready, dispose });
}
const element = document.getElementById('root');
if (element) startA2uiDemo(element);
