import { Client } from '@langchain/langgraph-sdk';
import { createSession } from '@threadplane/langgraph';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated build copies this neutral internal bridge; it is not a published package.
import type { RuntimeBridgeConfiguration } from '../../../../../libs/cockpit-runtime-bridge/src/index';
import { createThemingApplication, type ThemingSession } from './application';

export function themingConnection(configuration: RuntimeBridgeConfiguration): {
  apiUrl: string;
  headers: Record<string, string>;
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
  };
}
export function createConnectedApplication(
  connection: ReturnType<typeof themingConnection>
) {
  const apiUrl = connection.apiUrl;
  const headers = Object.freeze({ ...connection.headers });
  const client = new Client({
    apiUrl,
    apiKey: null,
    defaultHeaders: headers,
    callerOptions: { maxRetries: 0 },
  });
  return createThemingApplication({
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
        assistantId: 'c-theming',
        threadId,
        apiUrl,
        clientOptions: { maxRetries: 0, defaultHeaders: headers },
      });
      return session as ThemingSession;
    },
  });
}
