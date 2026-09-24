import type {
  ClientToolExecutionKey,
  ClientToolExecutionRecord,
  ClientToolExecutionStore,
  ClientToolResult,
} from './client-tool-execution-store.js';

export type PostgresRow = Record<string, unknown>;
export type PostgresTaggedSql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<readonly PostgresRow[]>;

export const THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS threadplane_client_tool_executions (
  tenant_id     text        NOT NULL DEFAULT '',
  thread_id     text        NOT NULL,
  tool_call_id  text        NOT NULL,
  status        text        NOT NULL,
  result        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, thread_id, tool_call_id)
);
`;

export interface PostgresClientToolExecutionStoreOptions {
  /** Tenant scope for every read and write. Defaults to `''` (the single-tenant scope). */
  readonly tenantId?: string | null;
}

/** Create a Postgres-backed client-tool execution store from a supplied SQL tag. */
export function createPostgresClientToolExecutionStore(
  sql: PostgresTaggedSql,
  opts: PostgresClientToolExecutionStoreOptions = {},
): ClientToolExecutionStore {
  // `tenant_id` participates in the primary key, so a missing tenant collapses to the
  // empty scope rather than NULL (a nullable column cannot be part of a Postgres key).
  const tenantId = opts.tenantId ?? '';

  return {
    async claim(key: ClientToolExecutionKey): Promise<'claimed' | ClientToolExecutionRecord> {
      const inserted = await sql`
        INSERT INTO threadplane_client_tool_executions
          (tenant_id, thread_id, tool_call_id, status)
        VALUES (${tenantId}, ${key.threadId}, ${key.toolCallId}, 'executing')
        ON CONFLICT (tenant_id, thread_id, tool_call_id) DO NOTHING
        RETURNING status, result
      `;
      if (inserted.length > 0) return 'claimed';

      const existing = await sql`
        SELECT status, result
        FROM threadplane_client_tool_executions
        WHERE tenant_id = ${tenantId}
          AND thread_id = ${key.threadId}
          AND tool_call_id = ${key.toolCallId}
        LIMIT 1
      `;
      return rowToRecord(existing[0]);
    },

    async record(key: ClientToolExecutionKey, result: ClientToolResult): Promise<void> {
      await sql`
        INSERT INTO threadplane_client_tool_executions
          (tenant_id, thread_id, tool_call_id, status, result)
        VALUES (${tenantId}, ${key.threadId}, ${key.toolCallId}, 'done', ${JSON.stringify(result)}::jsonb)
        ON CONFLICT (tenant_id, thread_id, tool_call_id) DO UPDATE
        SET status = 'done',
            result = CASE
              WHEN threadplane_client_tool_executions.status = 'done'
                THEN threadplane_client_tool_executions.result
              ELSE EXCLUDED.result
            END,
            updated_at = now()
      `;
    },

    async lookup(
      threadId: string,
      toolCallIds: readonly string[],
    ): Promise<Record<string, ClientToolExecutionRecord>> {
      if (toolCallIds.length === 0) return {};
      const rows = await sql`
        SELECT tool_call_id, status, result
        FROM threadplane_client_tool_executions
        WHERE tenant_id = ${tenantId}
          AND thread_id = ${threadId}
          AND tool_call_id = ANY(${[...toolCallIds]})
      `;
      const entries: [string, ClientToolExecutionRecord][] = [];
      for (const row of rows) {
        if (typeof row['tool_call_id'] !== 'string') continue;
        entries.push([row['tool_call_id'], rowToRecord(row)]);
      }
      return Object.fromEntries(entries);
    },
  };
}

function rowToRecord(row: PostgresRow | undefined): ClientToolExecutionRecord {
  const status = row?.['status'];
  if (status === 'done') {
    return { status: 'done', result: row?.['result'] as ClientToolResult };
  }
  if (status === 'failed') {
    return row?.['result']
      ? { status: 'failed', result: row['result'] as ClientToolResult }
      : { status: 'failed' };
  }
  return { status: 'executing' };
}
