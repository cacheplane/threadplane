/** Durable identity for one client-tool execution on one thread. */
export interface ClientToolExecutionKey {
  readonly threadId: string;
  readonly toolCallId: string;
}

export type ClientToolExecutionAcquisition =
  | { readonly status: 'acquired'; readonly token: string }
  | { readonly status: 'complete'; readonly result: string }
  | { readonly status: 'unavailable' }
  | { readonly status: 'conflict' };

export interface ClientToolExecutionSettlement {
  readonly invocation: string;
  readonly token: string;
  readonly result: string | null;
}

/** Opaque invocation ownership protocol, structurally shared with the runtime. */
export interface ClientToolExecutionStore {
  acquire(
    key: ClientToolExecutionKey,
    invocation: string
  ): Promise<ClientToolExecutionAcquisition>;
  settle(
    key: ClientToolExecutionKey,
    settlement: ClientToolExecutionSettlement
  ): Promise<'accepted' | 'rejected'>;
}

type RecordState = {
  readonly invocation: string;
  readonly token: string;
  readonly status: 'executing' | 'done';
  readonly result: string | null;
};

/** Non-persistent, single-process ownership. No takeover or expiration. */
export function createInMemoryClientToolExecutionStore(): ClientToolExecutionStore {
  const records = new Map<string, RecordState>();
  return {
    async acquire(key, invocation) {
      const threadId = key.threadId;
      const toolCallId = key.toolCallId;
      const identity = JSON.stringify([threadId, toolCallId]);
      const existing = records.get(identity);
      if (existing) {
        if (existing.invocation !== invocation) return { status: 'conflict' };
        return existing.status === 'done' && existing.result !== null
          ? { status: 'complete', result: existing.result }
          : { status: 'unavailable' };
      }
      const token = crypto.randomUUID();
      records.set(identity, {
        invocation,
        token,
        status: 'executing',
        result: null,
      });
      return { status: 'acquired', token };
    },
    async settle(key, settlement) {
      const threadId = key.threadId;
      const toolCallId = key.toolCallId;
      const invocation = settlement.invocation;
      const token = settlement.token;
      const result = settlement.result;
      const identity = JSON.stringify([threadId, toolCallId]);
      const existing = records.get(identity);
      if (
        !existing ||
        existing.invocation !== invocation ||
        existing.token !== token
      )
        return 'rejected';
      if (existing.status === 'done')
        return existing.result !== null && existing.result === result
          ? 'accepted'
          : 'rejected';
      records.set(identity, { invocation, token, status: 'done', result });
      return 'accepted';
    },
  };
}
