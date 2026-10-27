import { Client } from '@langchain/langgraph-sdk';
import { createSession } from '@threadplane/langgraph';
import {
  createGenerativeUiApplication,
  type GenerativeUiClient,
  type GenerativeUiSession,
} from './application';
import { copyData } from './dashboard-data';
import { checkpointSource, type Checkpoint } from './terminal';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Internal bridge is copied by the isolated build.
import type { RuntimeBridgeConfiguration } from '../../../../../libs/cockpit-runtime-bridge/src/index';
export interface GenerativeUiConnection {
  readonly apiUrl: string;
  readonly headers: Record<string, string>;
}
/** Resolve the shared proxy or the explicitly authored developer target. */
export function generativeUiConnection(
  configuration: RuntimeBridgeConfiguration
): {
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
/** Connect only this page's confirmed IDs, with retries disabled for owned requests. */
export function createGenerativeUiClient(
  connection: GenerativeUiConnection
): GenerativeUiClient {
  connection = Object.freeze({
    apiUrl: connection.apiUrl,
    headers: Object.freeze({ ...connection.headers }),
  });
  const known = new Set<string>();
  const client = new Client({
    apiUrl: connection.apiUrl,
    apiKey: null,
    defaultHeaders: connection.headers,
    callerOptions: { maxRetries: 0 },
  });
  return {
    async createThread(signal) {
      try {
        if (signal.aborted) throw new Error('Aborted');
        const threadId = crypto.randomUUID();
        const created = await client.threads.create({
          threadId,
          ifExists: 'raise',
          signal,
        });
        if (signal.aborted || created.thread_id !== threadId)
          throw new Error('Unconfirmed');
        known.add(threadId);
        return threadId;
      } catch {
        throw new Error('Conversation creation was not confirmed.');
      }
    },
    sessionFactory(threadId) {
      if (!known.has(threadId)) throw new Error('Unknown conversation.');
      let session: ReturnType<typeof createSession> | undefined;
      try {
        session = createSession({
          assistantId: 'c-generative-ui',
          threadId,
          apiUrl: connection.apiUrl,
          clientOptions: { maxRetries: 0, defaultHeaders: connection.headers },
        });
        const selected = session;
        const state = selected.getSnapshot();
        if (
          !state ||
          !Array.isArray(state.messages) ||
          !Array.isArray(state.toolCalls) ||
          !Array.isArray(state.interrupts) ||
          !Array.isArray(state.subgraphs) ||
          ![
            'getSnapshot',
            'subscribe',
            'submit',
            'load',
            'stop',
            'dispose',
          ].every(
            (method) =>
              typeof selected[method as keyof typeof selected] === 'function'
          )
        )
          throw new Error('Rejected session');
        return session as GenerativeUiSession;
      } catch {
        try {
          void Promise.resolve(session?.dispose()).catch(() => undefined);
        } catch {
          /* Rejected sessions cannot be installed. */
        }
        throw new Error('Runtime session is unavailable.');
      }
    },
    async readCheckpoint(requested, signal) {
      try {
        const captured = copyData(requested) as Checkpoint;
        const source = checkpointSource(captured, captured.thread_id);
        if (!source || !known.has(source.thread_id) || signal.aborted)
          throw new Error('Unavailable');
        // SDK declares checkpoint_map required-but-possibly-undefined. Preserve its absence on the wire.
        const state = await client.threads.getState(
          source.thread_id,
          source as Parameters<typeof client.threads.getState>[1],
          { signal }
        );
        if (signal.aborted) throw new Error('Aborted');
        return state;
      } catch {
        throw new Error('Checkpoint preview is unavailable.');
      }
    },
  };
}

export function createConnectedApplication(connection: GenerativeUiConnection) {
  return createGenerativeUiApplication(createGenerativeUiClient(connection));
}
