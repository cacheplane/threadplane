/** Serialized result for a browser-executed client tool. */
export type ClientToolResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string };

/** Durable identity for one client-tool execution on one thread. */
export interface ClientToolExecutionKey {
  readonly threadId: string;
  readonly toolCallId: string;
}

export type ClientToolExecutionStatus = 'executing' | 'done' | 'failed';

export type ClientToolExecutionRecord =
  | { status: 'executing' }
  | { status: 'done'; result: ClientToolResult }
  | { status: 'failed'; result?: ClientToolResult };

/** Backend-authoritative store for client-tool execution deduplication. */
export interface ClientToolExecutionStore {
  /** Atomically claim a tool-call execution. Returns prior state when present. */
  claim(key: ClientToolExecutionKey): Promise<'claimed' | ClientToolExecutionRecord>;
  /** Record the final client-tool result for a claimed or first-seen execution. */
  record(key: ClientToolExecutionKey, result: ClientToolResult): Promise<void>;
  /** Reload reconciliation: statuses/results for selected tool calls on a thread. */
  lookup(
    threadId: string,
    toolCallIds: readonly string[],
  ): Promise<Record<string, ClientToolExecutionRecord>>;
}

/** Non-persistent store useful for tests and Tier-0/Tier-1 local backends. */
export function createInMemoryClientToolExecutionStore(): ClientToolExecutionStore {
  const records = new Map<string, ClientToolExecutionRecord>();

  return {
    async claim(key: ClientToolExecutionKey): Promise<'claimed' | ClientToolExecutionRecord> {
      const existing = records.get(mapKey(key));
      if (existing) return cloneRecord(existing);
      records.set(mapKey(key), { status: 'executing' });
      return 'claimed';
    },

    async record(key: ClientToolExecutionKey, result: ClientToolResult): Promise<void> {
      records.set(mapKey(key), { status: 'done', result: cloneResult(result) });
    },

    async lookup(
      threadId: string,
      toolCallIds: readonly string[],
    ): Promise<Record<string, ClientToolExecutionRecord>> {
      const entries: [string, ClientToolExecutionRecord][] = [];
      for (const toolCallId of toolCallIds) {
        const existing = records.get(mapKey({ threadId, toolCallId }));
        if (existing) entries.push([toolCallId, cloneRecord(existing)]);
      }
      return Object.fromEntries(entries);
    },
  };
}

function mapKey(key: ClientToolExecutionKey): string {
  // Frame both strings without reserving a delimiter in either identity.
  return JSON.stringify([key.threadId, key.toolCallId]);
}

function cloneRecord(record: ClientToolExecutionRecord): ClientToolExecutionRecord {
  if (record.status === 'done') return { status: 'done', result: cloneResult(record.result) };
  if (record.status === 'failed') {
    return record.result
      ? { status: 'failed', result: cloneResult(record.result) }
      : { status: 'failed' };
  }
  return { status: 'executing' };
}

function cloneResult(result: ClientToolResult): ClientToolResult {
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, value: structuredCloneIfAvailable(result.value) };
}

function structuredCloneIfAvailable(value: unknown): unknown {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
