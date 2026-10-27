import { Client } from '@langchain/langgraph-sdk';
import { createSession } from '@threadplane/langgraph';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Internal bridge is copied by the isolated build.
import type { RuntimeBridgeConfiguration } from '../../../../../libs/cockpit-runtime-bridge/src/index';
import {
  createFilesystemApplication,
  type FilesystemClient,
  type FilesystemSession,
} from './application';
import { copyJson } from './workspace-state';
import { checkpointSource, type Checkpoint } from './authority';
export interface FilesystemConnection {
  readonly apiUrl: string;
  readonly headers: Record<string, string>;
}
export function filesystemConnection(
  configuration: RuntimeBridgeConfiguration
): FilesystemConnection {
  if (
    configuration.status === 'error' ||
    (configuration.status === 'configured' &&
      configuration.target.kind === 'ag-ui')
  )
    throw Error('Runtime configuration failed.');
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
export function createFilesystemClient(
  input: FilesystemConnection
): FilesystemClient {
  const connection = Object.freeze({
      apiUrl: input.apiUrl,
      headers: Object.freeze({ ...input.headers }),
    }),
    known = new Set<string>();
  const client = new Client({
    apiUrl: connection.apiUrl,
    apiKey: null,
    defaultHeaders: connection.headers,
    callerOptions: { maxRetries: 0 },
  });
  function owned(threadId: string, signal: AbortSignal) {
    if (!known.has(threadId) || signal.aborted)
      throw Error('Conversation is unavailable.');
  }
  return {
    async createThread(signal) {
      try {
        if (signal.aborted) throw Error('Aborted');
        const id = crypto.randomUUID(),
          created = await client.threads.create({
            threadId: id,
            ifExists: 'raise',
            signal,
          });
        if (signal.aborted || created.thread_id !== id)
          throw Error('Unconfirmed');
        known.add(id);
        return id;
      } catch {
        throw Error('Conversation creation was not confirmed.');
      }
    },
    sessionFactory(threadId) {
      if (!known.has(threadId)) throw Error('Unknown conversation.');
      let session: ReturnType<typeof createSession> | undefined;
      try {
        session = createSession({
          assistantId: 'da-filesystem',
          threadId,
          apiUrl: connection.apiUrl,
          clientOptions: { maxRetries: 0, defaultHeaders: connection.headers },
        });
        const state = session.getSnapshot();
        if (
          !state ||
          !Array.isArray(state.messages) ||
          !Array.isArray(state.toolCalls) ||
          !Array.isArray(state.interrupts) ||
          !Array.isArray(state.subgraphs) ||
          state.messages.length !== 0 ||
          state.toolCalls.length !== 0 ||
          state.interrupts.length !== 0 ||
          state.subgraphs.length !== 0 ||
          (state.history !== undefined &&
            (!Array.isArray(state.history) || state.history.length !== 0)) ||
          ![
            'getSnapshot',
            'subscribe',
            'submit',
            'resume',
            'load',
            'stop',
            'dispose',
          ].every(
            (method) =>
              typeof session?.[method as keyof typeof session] === 'function'
          )
        )
          throw Error('Rejected session');
        return session as FilesystemSession;
      } catch {
        try {
          void Promise.resolve(session?.dispose()).catch(() => undefined);
        } catch {
          /* Rejected session is never installed. */
        }
        throw Error('Runtime session is unavailable.');
      }
    },
    async readCurrent(threadId, signal) {
      owned(threadId, signal);
      const result = await client.threads.getState(threadId, undefined, {
        signal,
      });
      owned(threadId, signal);
      return result;
    },
    async readCheckpoint(requested, signal) {
      const captured = copyJson(requested) as Checkpoint,
        source = checkpointSource(captured, captured.thread_id);
      if (!source) throw Error('Checkpoint is unavailable.');
      owned(source.thread_id, signal);
      const result = await client.threads.getState(
        source.thread_id,
        source as Parameters<typeof client.threads.getState>[1],
        { signal }
      );
      owned(source.thread_id, signal);
      return result;
    },
  };
}
export function createConnectedApplication(connection: FilesystemConnection) {
  return createFilesystemApplication(createFilesystemClient(connection));
}
