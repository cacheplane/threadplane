import { createSession } from '@threadplane/ag-ui';
import { createMastraApplication } from './application';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated build copies this neutral internal bridge; it is not a published package.
import type { RuntimeBridgeConfiguration } from '../../../../../libs/cockpit-runtime-bridge/src/index';
export function mastraConnection(configuration: RuntimeBridgeConfiguration): {
  url: string;
  label: 'Shared runtime' | 'Developer runtime';
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
      new URL('/runtimes/mastra/agent', window.location.origin).href,
    label: target ? 'Developer runtime' : 'Shared runtime',
  };
}
export function createConnectedApplication(
  connection: ReturnType<typeof mastraConnection>
) {
  return createMastraApplication({
    sessionFactory(threadId) {
      // The application validates and owns candidate cleanup before granting authority.
      return createSession({ threadId, url: connection.url });
    },
  });
}
