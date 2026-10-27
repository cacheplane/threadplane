import { createSession } from '@threadplane/ag-ui';
import { createClientToolsApplication } from './application';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Isolated build copies the neutral internal bridge, not a published package.
import type { RuntimeBridgeConfiguration } from '../../../../../libs/cockpit-runtime-bridge/src/index';
export interface ClientToolsConnection {
  readonly url: string;
  readonly label: 'Shared runtime' | 'Developer runtime';
}
export function clientToolsConnection(
  configuration: RuntimeBridgeConfiguration
): ClientToolsConnection {
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
      : undefined;
  const url =
    target?.endpoint ??
    new URL('/ag-ui/client-tools/agent', window.location.origin).href;
  try {
    const parsed = new URL(url);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error();
  } catch {
    throw new Error('Runtime configuration failed.');
  }
  return Object.freeze({
    url,
    label: target ? 'Developer runtime' : 'Shared runtime',
  });
}
export function createConnectedApplication(connection: ClientToolsConnection) {
  return createClientToolsApplication({
    sessionFactory(threadId, tools) {
      const session = createSession({ threadId, url: connection.url }, tools);
      try {
        const native = session.getSnapshot();
        if (
          !native ||
          !Array.isArray(native.transcript) ||
          !Array.isArray(native.subagents) ||
          !['idle', 'running', 'error'].includes(native.status) ||
          !native.clientTools ||
          !Array.isArray(native.clientTools.calls) ||
          ![
            session.getSnapshot,
            session.subscribe,
            session.submit,
            session.resume,
            session.stop,
            session.dispose,
          ].every((method) => typeof method === 'function')
        )
          throw new Error();
      } catch {
        try {
          void Promise.resolve(session.dispose()).catch(() => undefined);
        } catch {
          /* Rejected candidate has no authority. */
        }
        throw new Error('Runtime session is unavailable.');
      }
      return session;
    },
  });
}
