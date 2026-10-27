import { createA2uiApplication } from './application';
import { createSession } from '@threadplane/ag-ui';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Same-layout private bridge.
import type { RuntimeBridgeConfiguration } from '../../../../../libs/cockpit-runtime-bridge/src/index';
export interface A2uiConnection {
  readonly url: string;
  readonly label: 'Shared runtime' | 'Developer runtime';
}
function endpoint(value: string): string {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw Error('Unavailable');
    return url.href;
  } catch {
    throw Error('Runtime configuration failed.');
  }
}
/** Select only the shared route or an authored credential-free native endpoint. */
export function a2uiConnection(
  configuration: RuntimeBridgeConfiguration
): A2uiConnection {
  if (
    configuration.status === 'error' ||
    (configuration.status === 'configured' &&
      configuration.target.kind === 'langsmith')
  )
    throw Error('Runtime configuration failed.');
  const target =
    configuration.status === 'configured' &&
    configuration.target.kind === 'ag-ui'
      ? configuration.target
      : null;
  return Object.freeze({
    url: endpoint(
      target?.endpoint ??
        new URL('/ag-ui/a2ui/agent', window.location.origin).href
    ),
    label: target ? 'Developer runtime' : 'Shared runtime',
  });
}
export function createConnectedApplication(connection: A2uiConnection) {
  const url = endpoint(connection.url);
  return createA2uiApplication({
    sessionFactory(threadId) {
      return createSession({ threadId, url });
    },
  });
}
