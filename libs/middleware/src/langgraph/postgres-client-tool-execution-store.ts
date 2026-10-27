import type {
  ClientToolExecutionAcquisition,
  ClientToolExecutionStore,
} from './client-tool-execution-store.js';
export {
  THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA,
  THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION,
} from './postgres-tool-execution-schema.js';

export type PostgresRow = Record<string, unknown>;
export type PostgresTaggedSql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<readonly PostgresRow[]>;
export interface PostgresClientToolExecutionStoreOptions {
  /** Tenant scope for every read and write. Defaults to the empty scope. */
  readonly tenantId?: string | null;
}
const ownerPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Constructor performs no DDL. Apply the fresh schema or explicit migration. */
export function createPostgresClientToolExecutionStore(
  sql: PostgresTaggedSql,
  opts: PostgresClientToolExecutionStoreOptions = {}
): ClientToolExecutionStore {
  const tenantId = opts.tenantId ?? '';
  return {
    async acquire(key, invocation) {
      const threadId = key.threadId;
      const toolCallId = key.toolCallId;
      const token = crypto.randomUUID();
      const inserted = await sql`
        INSERT INTO threadplane_client_tool_executions
          (tenant_id, thread_id, tool_call_id, status, invocation, owner_token)
        VALUES (${tenantId}, ${threadId}, ${toolCallId}, 'executing', ${invocation}, ${token})
        ON CONFLICT (tenant_id, thread_id, tool_call_id) DO NOTHING
        RETURNING owner_token
      `;
      if (inserted.length > 0)
        return inserted.length === 1 && inserted[0]?.['owner_token'] === token
          ? { status: 'acquired', token }
          : { status: 'unavailable' };
      const existing = await sql`
        SELECT status, invocation, owner_token, encoded_result
        FROM threadplane_client_tool_executions
        WHERE tenant_id COLLATE "C" = ${tenantId} COLLATE "C"
          AND thread_id COLLATE "C" = ${threadId} COLLATE "C"
          AND tool_call_id COLLATE "C" = ${toolCallId} COLLATE "C"
        LIMIT 1
      `;
      return observe(existing[0], invocation);
    },
    async settle(key, settlement) {
      const threadId = key.threadId;
      const toolCallId = key.toolCallId;
      const invocation = settlement.invocation;
      const token = settlement.token;
      const result = settlement.result;
      if (
        typeof invocation !== 'string' ||
        typeof token !== 'string' ||
        !ownerPattern.test(token) ||
        (result !== null && typeof result !== 'string')
      )
        return 'rejected';
      // A reusable retry acknowledges unchanged logical data (SQL triggers may
      // still run). A null completion has no retry acknowledgment or takeover.
      const updated = await sql`
        UPDATE threadplane_client_tool_executions
        SET status = 'done', encoded_result = ${result},
          updated_at = CASE WHEN status = 'executing' THEN now() ELSE updated_at END
        WHERE tenant_id COLLATE "C" = ${tenantId} COLLATE "C"
          AND thread_id COLLATE "C" = ${threadId} COLLATE "C"
          AND tool_call_id COLLATE "C" = ${toolCallId} COLLATE "C"
          AND owner_token COLLATE "C" = ${token} COLLATE "C"
          AND invocation COLLATE "C" = ${invocation} COLLATE "C"
          AND ((status = 'executing' AND encoded_result IS NULL)
            OR (status = 'done' AND encoded_result IS NOT NULL
              AND encoded_result COLLATE "C" = ${result} COLLATE "C"))
        RETURNING owner_token
      `;
      return updated.length === 1 && updated[0]?.['owner_token'] === token
        ? 'accepted'
        : 'rejected';
    },
  };
}

function observe(
  row: PostgresRow | undefined,
  invocation: string
): ClientToolExecutionAcquisition {
  const priorInvocation = row?.['invocation'];
  const token = row?.['owner_token'];
  const status = row?.['status'];
  const result = row?.['encoded_result'];
  if (
    typeof priorInvocation !== 'string' ||
    typeof token !== 'string' ||
    !ownerPattern.test(token)
  )
    return { status: 'unavailable' };
  // A malformed row cannot establish even an invocation mismatch. Validate
  // the stored state before interpreting a well-formed owner's identity.
  const validState =
    (status === 'executing' && result === null) ||
    (status === 'done' && (result === null || typeof result === 'string'));
  if (!validState) return { status: 'unavailable' };
  if (priorInvocation !== invocation) return { status: 'conflict' };
  if (status === 'done' && typeof result === 'string')
    return { status: 'complete', result };
  return { status: 'unavailable' };
}
