import { Client } from '@langchain/langgraph-sdk';
import { createSession } from '@threadplane/langgraph';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Neutral bridge copied by isolated build.
import type { RuntimeBridgeConfiguration } from '../../../../../libs/cockpit-runtime-bridge/src/index';
import {
  createMemoryApplication,
  type MemoryClient,
  type MemorySession,
} from './application';
import { copyData, record, text, LIMITS, type Checkpoint } from './authority';
import { validScope } from './browser-scope';
export interface MemoryConnection {
  readonly apiUrl: string;
  readonly headers: Record<string, string>;
}
export function memoryConnection(
  configuration: RuntimeBridgeConfiguration
): MemoryConnection {
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
  return Object.freeze({
    apiUrl: target?.apiUrl ?? new URL('/api', window.location.origin).href,
    headers: Object.freeze(
      target ? { 'x-api-key': target.apiKey } : ({} as Record<string, string>)
    ),
  });
}
type Transport = NonNullable<Parameters<typeof createSession>[0]['transport']>;
type Event = ReturnType<Transport['stream']> extends AsyncIterable<infer T>
  ? T
  : never;
/** Routing comes only from the SDK event name and cursor, never payload fields. */
function normalize(event: string, data: unknown, id: unknown): Event {
  const [base, ...namespace] = event.split('|');
  const route = {
    type: event as Event['type'],
    ...(namespace.length ? { namespace } : {}),
    sseId: typeof id === 'string' ? id : undefined,
  };
  if (
    base === 'messages' &&
    Array.isArray(data) &&
    data.length === 2 &&
    record(data[1])
  )
    return { ...route, messages: [data[0]], messageMetadata: data[1], data };
  if (
    (base === 'messages' || base.startsWith('messages/')) &&
    Array.isArray(data)
  )
    return { ...route, messages: data, data };
  if (record(data))
    return {
      ...data,
      ...route,
      ...(Object.hasOwn(data, 'namespace') && !namespace.length
        ? { namespace: undefined }
        : {}),
      data,
    };
  return { ...route, data };
}
export function createMemoryClient(input: MemoryConnection): MemoryClient {
  const connection = Object.freeze({
    apiUrl: input.apiUrl,
    headers: Object.freeze({ ...input.headers }),
  });
  const sdk = new Client({
    apiUrl: connection.apiUrl,
    apiKey: null,
    defaultHeaders: connection.headers,
    callerOptions: { maxRetries: 0 },
  });
  const known = new Set<string>(),
    observers = new Map<string, (event: unknown) => void>();
  function owned(id: string | null, signal: AbortSignal): asserts id is string {
    if (!id || !known.has(id) || signal.aborted)
      throw Error('Conversation unavailable.');
  }
  const readHistory: MemoryClient['readHistory'] = async (id, signal) => {
    owned(id, signal);
    const result = await sdk.threads.getHistory(id, { limit: 1, signal });
    owned(id, signal);
    return result;
  };
  const readCheckpoint: MemoryClient['readCheckpoint'] = async (
    requested,
    signal
  ) => {
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
    const cp = v as unknown as Checkpoint;
    owned(cp.thread_id, signal);
    const result = await sdk.threads.getState(
      cp.thread_id,
      cp as Parameters<typeof sdk.threads.getState>[1],
      { signal }
    );
    owned(cp.thread_id, signal);
    return result;
  };
  return {
    async createThread(signal) {
      if (signal.aborted) throw Error('Conversation unavailable.');
      const id = crypto.randomUUID();
      if (!validScope(id)) throw Error('Conversation unavailable.');
      const result = await sdk.threads.create({
        threadId: id,
        ifExists: 'raise',
        signal,
      });
      const captured = copyData(result, false);
      if (signal.aborted || !record(captured) || captured.thread_id !== id)
        throw Error('Conversation creation was not confirmed.');
      known.add(id);
      return id;
    },
    observeMemory(id, listener) {
      if (!known.has(id)) throw Error('Unknown conversation.');
      observers.set(id, listener);
      return () => {
        if (observers.get(id) === listener) observers.delete(id);
      };
    },
    sessionFactory(id) {
      if (!known.has(id)) throw Error('Unknown conversation.');
      const transport: Transport = {
        // Capture now, at physical invocation: a late event never adopts a later turn listener.
        stream(assistant, thread, payload, signal, options) {
          owned(thread, signal);
          const observe = observers.get(thread);
          const currentThread = thread;
          return (async function* () {
            try {
              for await (const packet of sdk.runs.stream(
                currentThread,
                assistant,
                {
                  input: payload as Record<string, unknown>,
                  context: options?.context,
                  config: options?.config,
                  metadata: options?.metadata,
                  streamMode: ['values', 'messages-tuple', 'updates', 'custom'],
                  streamSubgraphs: true,
                  signal,
                }
              )) {
                const event = normalize(packet.event, packet.data, packet.id);
                if (event.type === 'custom' && !event.namespace?.length)
                  observe?.(event.data);
                yield event;
              }
            } catch {
              throw Error('Conversation delivery unavailable.');
            }
          })();
        },
        async getHistory(thread, signal) {
          return (await readHistory(thread, signal)) as Awaited<
            ReturnType<NonNullable<Transport['getHistory']>>
          >;
        },
      };
      const session = createSession({
        assistantId: 'da-memory',
        threadId: id,
        transport,
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
        return session as MemorySession;
      } catch {
        void Promise.resolve(session.dispose()).catch(() => undefined);
        throw Error('Runtime session is unavailable.');
      }
    },
    async readCurrent(id, signal) {
      owned(id, signal);
      const result = await sdk.threads.getState(id, undefined, { signal });
      owned(id, signal);
      return result;
    },
    readHistory,
    readCheckpoint,
  };
}
export function createConnectedApplication(connection: MemoryConnection) {
  return createMemoryApplication(createMemoryClient(connection));
}
