import { createSession } from '@threadplane/ag-ui';
import { createStreamingApplication } from './application';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated build copies this neutral internal bridge; it is not a published package.
import type { RuntimeBridgeConfiguration } from '../../../../../libs/cockpit-runtime-bridge/src/index';
export function streamingConnection(
  configuration: RuntimeBridgeConfiguration
): {
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
      new URL('/ag-ui/streaming/agent', window.location.origin).href,
    label: target ? 'Developer runtime' : 'Shared runtime',
  };
}
export function createConnectedApplication(
  connection: ReturnType<typeof streamingConnection>
) {
  return createStreamingApplication({
    sessionFactory(threadId) {
      const session = createSession({ threadId, url: connection.url });
      try {
        const snapshot = session.getSnapshot();
        if (
          !snapshot ||
          !Array.isArray(snapshot.transcript) ||
          !Array.isArray(snapshot.subagents) ||
          ![
            'getSnapshot',
            'subscribe',
            'submit',
            'resume',
            'stop',
            'dispose',
          ].every(
            (method) =>
              typeof session[method as keyof typeof session] === 'function'
          )
        )
          throw new Error('Runtime session is unavailable.');
      } catch {
        if (typeof session?.dispose === 'function') {
          try {
            void Promise.resolve(session.dispose()).catch(() => undefined);
          } catch {
            /* Rejected candidates have no authority. */
          }
        }
        throw new Error('Runtime session is unavailable.');
      }
      return session;
    },
  });
}
