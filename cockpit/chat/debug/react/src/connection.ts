import { Client } from '@langchain/langgraph-sdk';
import { createSession } from '@threadplane/langgraph';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Neutral internal bridge used by cockpit applications.
import type { RuntimeBridgeConfiguration } from '../../../../../libs/cockpit-runtime-bridge/src/index';
import { captureCheckpoint, type Checkpoint } from './checkpoint-page';
import { captureData, ownField, plainRecord } from './inspection-values';
function callable(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function';
}
export interface DebugConnection {
  readonly apiUrl: string;
  readonly headers: Readonly<Record<string, string>>;
}
function captureConnection(input: DebugConnection): DebugConnection {
  const apiUrl = ownField(input, 'apiUrl'),
    headers = captureData(ownField(input, 'headers'));
  if (
    typeof apiUrl !== 'string' ||
    !apiUrl ||
    !plainRecord(headers) ||
    Object.values(headers).some((v) => typeof v !== 'string')
  )
    throw Error('Runtime configuration failed.');
  return Object.freeze({
    apiUrl,
    headers: headers as Readonly<Record<string, string>>,
  });
}
export function debugConnection(
  configuration: RuntimeBridgeConfiguration
): DebugConnection {
  const status = ownField(configuration, 'status');
  if (status === 'default')
    return captureConnection({
      apiUrl: new URL('/api', window.location.origin).href,
      headers: {},
    });
  if (status !== 'configured') throw Error('Runtime configuration failed.');
  const target = ownField(configuration, 'target');
  if (!plainRecord(target)) throw Error('Runtime configuration failed.');
  const kind = ownField(target, 'kind');
  if (kind === 'shared')
    return captureConnection({
      apiUrl: new URL('/api', window.location.origin).href,
      headers: {},
    });
  if (kind !== 'langsmith') throw Error('Runtime configuration failed.');
  const apiUrl = ownField(target, 'apiUrl'),
    apiKey = ownField(target, 'apiKey');
  if (typeof apiUrl !== 'string' || typeof apiKey !== 'string')
    throw Error('Runtime configuration failed.');
  return captureConnection({ apiUrl, headers: { 'x-api-key': apiKey } });
}
export type DebugSession = Pick<
  ReturnType<typeof createSession>,
  | 'dispose'
  | 'getSnapshot'
  | 'subscribe'
  | 'submit'
  | 'resume'
  | 'load'
  | 'stop'
>;
/** Captures one target; construction performs no SDK or session work. Credentials stay in this closure. */
export function createDebugClient(input: DebugConnection) {
  const connection = captureConnection(input),
    known = new Set<string>();
  let client: Client | undefined;
  const sdk = () =>
    (client ??= new Client({
      apiUrl: connection.apiUrl,
      apiKey: null,
      defaultHeaders: connection.headers,
      callerOptions: { maxRetries: 0 },
    }));
  const owned = (threadId: string, signal?: AbortSignal) => {
    if (!known.has(threadId) || signal?.aborted)
      throw Error('Conversation is unavailable.');
  };
  return Object.freeze({
    async createThread(signal: AbortSignal): Promise<string> {
      try {
        if (signal.aborted) throw Error('Aborted');
        const id = crypto.randomUUID(),
          created = await sdk().threads.create({
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
    async sessionFactory(threadId: string): Promise<DebugSession> {
      owned(threadId);
      let session: DebugSession | undefined, dispose: unknown;
      try {
        session = createSession({
          assistantId: 'c-debug',
          threadId,
          apiUrl: connection.apiUrl,
          clientOptions: { maxRetries: 0, defaultHeaders: connection.headers },
        });
        dispose = ownField(session, 'dispose');
        if (!callable(dispose)) throw Error('Rejected session.');
        const methods: Record<string, (...args: never[]) => unknown> = {
          dispose,
        };
        // Dispose is captured first so every rejected acquisition can await cleanup.
        for (const key of [
          'getSnapshot',
          'subscribe',
          'submit',
          'resume',
          'load',
          'stop',
        ]) {
          const method = ownField(session, key);
          if (!callable(method)) throw Error('Rejected session.');
          methods[key] = method;
        }
        const snapshot = methods['getSnapshot'].call(session),
          status = ownField(snapshot, 'status');
        const arrays = ['messages', 'toolCalls', 'interrupts', 'subgraphs'].map(
            (k) => ownField(snapshot, k)
          ),
          history = ownField(snapshot, 'history');
        const error = ownField(snapshot, 'error');
        if (
          status !== 'idle' ||
          (error !== undefined && error !== null) ||
          arrays.some((v) => !Array.isArray(v) || v.length) ||
          (history !== undefined && (!Array.isArray(history) || history.length))
        )
          throw Error('Rejected session.');
        const facade = Object.fromEntries(
          Object.entries(methods).map(([key, method]) => [
            key,
            method.bind(session),
          ])
        );
        return Object.freeze(facade) as unknown as DebugSession;
      } catch {
        try {
          if (session) {
            if (!callable(dispose)) throw Error('No cleanup capability.');
            await dispose.call(session);
          }
        } catch {
          throw Error('Runtime session cleanup failed.');
        }
        throw Error('Runtime session is unavailable.');
      }
    },
    async readCurrent(threadId: string, signal: AbortSignal) {
      try {
        owned(threadId, signal);
        const result = await sdk().threads.getState(threadId, undefined, {
          signal,
        });
        owned(threadId, signal);
        return result;
      } catch {
        throw Error('Checkpoint read failed.');
      }
    },
    async readHistory(threadId: string, signal: AbortSignal) {
      try {
        owned(threadId, signal);
        const result = await sdk().threads.getHistory(threadId, {
          limit: 10,
          signal,
        });
        owned(threadId, signal);
        return result;
      } catch {
        throw Error('History read failed.');
      }
    },
    async readCheckpoint(input: Checkpoint, signal: AbortSignal) {
      try {
        const threadId = ownField(input, 'thread_id');
        if (typeof threadId !== 'string')
          throw Error('Checkpoint is unavailable.');
        const cp = captureCheckpoint(input, threadId);
        if (!cp) throw Error('Checkpoint is unavailable.');
        owned(threadId, signal);
        const result = await sdk().threads.getState(
          threadId,
          { ...cp, checkpoint_map: cp.checkpoint_map },
          { signal }
        );
        owned(threadId, signal);
        return result;
      } catch {
        throw Error('Checkpoint read failed.');
      }
    },
  });
}
export type DebugClient = ReturnType<typeof createDebugClient>;
