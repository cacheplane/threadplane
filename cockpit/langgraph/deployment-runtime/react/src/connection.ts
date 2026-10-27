import { Client } from '@langchain/langgraph-sdk';
import { createSession } from '@threadplane/langgraph';
import {
  createDeploymentApplication,
  type DeploymentSession,
} from './application';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated build copies this neutral internal bridge; it is not a published package.
import type { RuntimeBridgeConfiguration } from '../../../../../libs/cockpit-runtime-bridge/src/index';
export function deploymentConnection(
  configuration: RuntimeBridgeConfiguration
): {
  apiUrl: string;
  headers: Record<string, string>;
  label: 'Shared runtime' | 'Developer runtime';
} {
  if (
    configuration.status === 'error' ||
    (configuration.status === 'configured' &&
      configuration.target.kind === 'ag-ui')
  )
    throw new Error('Runtime configuration failed.');
  const target =
    configuration.status === 'configured' &&
    configuration.target.kind === 'langsmith'
      ? configuration.target
      : null;
  return {
    apiUrl: target?.apiUrl ?? new URL('/api', window.location.origin).href,
    headers: target ? { 'x-api-key': target.apiKey } : {},
    label: target ? 'Developer runtime' : 'Shared runtime',
  };
}
export function createConnectedApplication(
  connection: ReturnType<typeof deploymentConnection>
) {
  const client = new Client({
    apiUrl: connection.apiUrl,
    apiKey: null,
    defaultHeaders: connection.headers,
    callerOptions: { maxRetries: 0 },
  });
  return createDeploymentApplication({
    async createThread(signal) {
      const threadId = crypto.randomUUID();
      const created = await client.threads.create({
        threadId,
        ifExists: 'raise',
        signal,
      });
      if (created.thread_id !== threadId)
        throw new Error('Conversation creation was not confirmed.');
      return threadId;
    },
    sessionFactory(threadId) {
      const session = createSession({
        assistantId: 'deployment-runtime',
        threadId,
        apiUrl: connection.apiUrl,
        clientOptions: { maxRetries: 0, defaultHeaders: connection.headers },
      });
      try {
        const state = session.getSnapshot();
        if (
          !state ||
          !Array.isArray(state.messages) ||
          !Array.isArray(state.toolCalls) ||
          !Array.isArray(state.interrupts) ||
          !['getSnapshot', 'subscribe', 'submit', 'stop', 'dispose'].every(
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
            /* A rejected candidate cannot become the active session. */
          }
        }
        throw new Error('Runtime session is unavailable.');
      }
      return session as DeploymentSession;
    },
  });
}
