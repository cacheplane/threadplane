import { Client } from '@langchain/langgraph-sdk';
import { createSession } from '@threadplane/langgraph';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Internal bridge is copied by the isolated build.
import type { RuntimeBridgeConfiguration } from '../../../../../libs/cockpit-runtime-bridge/src/index';
import {
  createSubagentsApplication,
  type SubagentsClient,
  type SubagentsSession,
} from './application';
import { copyData, record, text, LIMITS, type Checkpoint } from './authority';
export interface SubagentsConnection {
  readonly apiUrl: string;
  readonly headers: Record<string, string>;
}
export function subagentsConnection(
  configuration: RuntimeBridgeConfiguration
): SubagentsConnection {
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
export function createSubagentsClient(
  input: SubagentsConnection
): SubagentsClient {
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
  function owned(id: string, signal: AbortSignal) {
    if (!known.has(id) || signal.aborted)
      throw Error('Conversation unavailable.');
  }
  return {
    async createThread(signal) {
      if (signal.aborted) throw Error('Aborted');
      const id = crypto.randomUUID(),
        created = await client.threads.create({
          threadId: id,
          ifExists: 'raise',
          signal,
        });
      if (signal.aborted || created.thread_id !== id)
        throw Error('Conversation creation was not confirmed.');
      known.add(id);
      return id;
    },
    sessionFactory(id) {
      if (!known.has(id)) throw Error('Unknown conversation.');
      const session = createSession({
        assistantId: 'subagents',
        threadId: id,
        apiUrl: connection.apiUrl,
        clientOptions: { maxRetries: 0, defaultHeaders: connection.headers },
      });
      try {
        const state = session.getSnapshot();
        if (
          ![
            'getSnapshot',
            'subscribe',
            'submit',
            'load',
            'stop',
            'dispose',
          ].every(
            (k) => typeof session[k as keyof typeof session] === 'function'
          ) ||
          ![
            state.messages,
            state.toolCalls,
            state.interrupts,
            state.subgraphs,
          ].every((x) => Array.isArray(x) && x.length === 0)
        )
          throw Error('Rejected session');
        return session as SubagentsSession;
      } catch {
        void Promise.resolve(session.dispose()).catch(() => undefined);
        throw Error('Runtime session is unavailable.');
      }
    },
    async readCurrent(id, signal) {
      owned(id, signal);
      const value = await client.threads.getState(id, undefined, { signal });
      owned(id, signal);
      return value;
    },
    async readHistory(id, signal) {
      owned(id, signal);
      const value = await client.threads.getHistory(id, { limit: 1, signal });
      owned(id, signal);
      return value;
    },
    async readCheckpoint(requested, signal) {
      const v = copyData(requested, false);
      if (
        !record(v) ||
        !text(v.thread_id) ||
        v.checkpoint_ns !== '' ||
        !text(v.checkpoint_id) ||
        v.checkpoint_id.length > LIMITS.fieldText ||
        Object.keys(v).some(
          (k) =>
            ![
              'thread_id',
              'checkpoint_ns',
              'checkpoint_id',
              'checkpoint_map',
            ].includes(k)
        ) ||
        (v.checkpoint_map !== undefined &&
          (!record(v.checkpoint_map) ||
            Object.keys(v.checkpoint_map).length !== 1 ||
            v.checkpoint_map[''] !== v.checkpoint_id))
      )
        throw Error('Checkpoint unavailable.');
      const c = v as unknown as Checkpoint;
      owned(c.thread_id, signal);
      const value = await client.threads.getState(
        c.thread_id,
        c as Parameters<typeof client.threads.getState>[1],
        { signal }
      );
      owned(c.thread_id, signal);
      return value;
    },
  };
}
export function createConnectedApplication(connection: SubagentsConnection) {
  return createSubagentsApplication(createSubagentsClient(connection));
}
