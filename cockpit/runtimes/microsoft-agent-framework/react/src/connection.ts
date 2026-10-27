import { createSession } from '@threadplane/ag-ui';
import { createMafApplication } from './application';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The installed build copies this neutral internal bridge.
import type { RuntimeBridgeConfiguration } from '../../../../../libs/cockpit-runtime-bridge/src/index';

export function mafConnection(configuration: RuntimeBridgeConfiguration): {
  readonly url: string;
  readonly label: 'Shared runtime' | 'Developer runtime';
} {
  if (
    configuration.status === 'error' ||
    (configuration.status === 'configured' &&
      configuration.target.kind === 'langsmith')
  )
    throw new Error('Runtime configuration failed.');
  const target =
    configuration.status === 'configured' &&
    configuration.target.kind === 'ag-ui'
      ? configuration.target
      : null;
  return {
    url:
      target?.endpoint ??
      new URL(
        '/runtimes/microsoft-agent-framework/agent',
        window.location.origin
      ).href,
    label: target ? 'Developer runtime' : 'Shared runtime',
  };
}
export function createConnectedApplication(
  connection: ReturnType<typeof mafConnection>
) {
  return createMafApplication({
    sessionFactory: (threadId) =>
      createSession({ threadId, url: connection.url }),
  });
}
