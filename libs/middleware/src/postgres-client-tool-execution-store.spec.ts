import { describe, expect, it } from 'vitest';
import {
  THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA,
  createPostgresClientToolExecutionStore,
  type PostgresTaggedSql,
} from './langgraph/postgres-client-tool-execution-store';

function makeSql(rows: unknown[][]): { sql: PostgresTaggedSql; queries: string[]; values: unknown[][] } {
  const queries: string[] = [];
  const values: unknown[][] = [];
  const sql = (async (strings: TemplateStringsArray, ...params: unknown[]) => {
    queries.push(strings.join('?'));
    values.push(params);
    return rows.shift() ?? [];
  }) as PostgresTaggedSql;
  return { sql, queries, values };
}

describe('THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA', () => {
  it('creates the client-tool execution table with a tenant-scoped primary key', () => {
    expect(THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA).toContain('CREATE TABLE');
    expect(THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA).toContain('threadplane_client_tool_executions');
    expect(THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA).toContain("tenant_id     text        NOT NULL DEFAULT ''");
    expect(THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA).toContain(
      'PRIMARY KEY (tenant_id, thread_id, tool_call_id)',
    );
  });
});

describe('createPostgresClientToolExecutionStore', () => {
  it('returns special call IDs as enumerable own lookup entries', async () => {
    const ids = ['__proto__', 'constructor', 'toString', 'ordinary'];
    const result = { ok: true, value: 'saved' };
    const { sql } = makeSql([[
      ...ids.map(tool_call_id => ({ tool_call_id, status: 'done', result })),
      { tool_call_id: 42, status: 'done', result },
    ]]);
    const store = createPostgresClientToolExecutionStore(sql);
    const found = await store.lookup('thread-1', [...ids, 'missing']);

    expect(Object.getPrototypeOf(found)).toBe(Object.prototype);
    expect(Object.keys(found)).toEqual(ids);
    for (const id of ids) expect(Object.hasOwn(found, id)).toBe(true);
    expect(Object.hasOwn(found, 'missing')).toBe(false);
    expect(JSON.parse(JSON.stringify(found))).toEqual(
      Object.fromEntries(ids.map(id => [id, { status: 'done', result }])),
    );
  });

  it('returns an ordinary empty lookup without querying for no IDs', async () => {
    const { sql, queries } = makeSql([]);
    const found = await createPostgresClientToolExecutionStore(sql).lookup('thread-1', []);
    expect(found).toEqual({});
    expect(Object.getPrototypeOf(found)).toBe(Object.prototype);
    expect(queries).toEqual([]);
  });

  it('claims a new execution with ON CONFLICT DO NOTHING', async () => {
    const { sql, queries, values } = makeSql([[{ status: 'executing', result: null }]]);
    const store = createPostgresClientToolExecutionStore(sql, { tenantId: 'tenant-1' });

    await expect(store.claim({ threadId: 'thread-1', toolCallId: 'call-1' })).resolves.toBe('claimed');

    expect(queries[0]).toContain('ON CONFLICT (tenant_id, thread_id, tool_call_id) DO NOTHING');
    expect(values[0]).toEqual(['tenant-1', 'thread-1', 'call-1']);
  });

  it('reads the existing row when claim conflicts', async () => {
    const { sql } = makeSql([
      [],
      [{ status: 'done', result: { ok: true, value: { temp: 72 } } }],
    ]);
    const store = createPostgresClientToolExecutionStore(sql);

    await expect(store.claim({ threadId: 'thread-1', toolCallId: 'call-1' })).resolves.toEqual({
      status: 'done',
      result: { ok: true, value: { temp: 72 } },
    });
  });

  it('records a done result without overwriting an already-done result', async () => {
    const { sql, queries, values } = makeSql([[]]);
    const store = createPostgresClientToolExecutionStore(sql);
    const result = { ok: false as const, error: 'boom' };

    await store.record({ threadId: 'thread-1', toolCallId: 'call-1' }, result);

    expect(queries[0]).toContain('ON CONFLICT (tenant_id, thread_id, tool_call_id) DO UPDATE');
    expect(queries[0]).toContain('WHEN threadplane_client_tool_executions.status =');
    expect(values[0]).toEqual(['', 'thread-1', 'call-1', JSON.stringify(result)]);
  });

  it('looks up records by requested tool_call_id', async () => {
    const { sql, queries, values } = makeSql([
      [
        { tool_call_id: 'call-1', status: 'done', result: { ok: true, value: 'done' } },
        { tool_call_id: 'call-2', status: 'executing', result: null },
      ],
    ]);
    const store = createPostgresClientToolExecutionStore(sql);

    await expect(store.lookup('thread-1', ['call-1', 'call-2'])).resolves.toEqual({
      'call-1': { status: 'done', result: { ok: true, value: 'done' } },
      'call-2': { status: 'executing' },
    });

    expect(queries[0]).toContain('tool_call_id = ANY');
    expect(values[0]).toEqual(['', 'thread-1', ['call-1', 'call-2']]);
  });

  it('scopes lookup by tenant', async () => {
    const { sql, queries, values } = makeSql([[]]);
    const store = createPostgresClientToolExecutionStore(sql, { tenantId: 'tenant-a' });

    await store.lookup('thread-1', ['call-1']);

    expect(queries[0]).toContain('tenant_id');
    expect(values[0]).toContain('tenant-a');
  });

  it('scopes claim by tenant', async () => {
    const { sql, queries, values } = makeSql([[], []]);
    const store = createPostgresClientToolExecutionStore(sql, { tenantId: 'tenant-a' });

    await store.claim({ threadId: 'thread-1', toolCallId: 'call-1' });

    // The follow-up SELECT after a no-op INSERT must be tenant-scoped too.
    expect(queries[1]).toContain('tenant_id');
    expect(values[1]).toContain('tenant-a');
  });

  it('scopes record by tenant', async () => {
    const { sql, queries } = makeSql([[]]);
    const store = createPostgresClientToolExecutionStore(sql, { tenantId: 'tenant-a' });

    await store.record({ threadId: 'thread-1', toolCallId: 'call-1' }, { ok: true, value: 1 });

    expect(queries[0]).toContain('ON CONFLICT (tenant_id, thread_id, tool_call_id) DO UPDATE');
  });

  it('claims independently for a different tenant on the same thread and tool call', async () => {
    // Tenant A claims, then records; tenant B's INSERT does not conflict because the
    // primary key is widened with tenant_id, so its own claim returns 'claimed'.
    const { sql, queries, values } = makeSql([
      [{ status: 'executing', result: null }],
      [],
      [{ status: 'executing', result: null }],
    ]);
    const storeA = createPostgresClientToolExecutionStore(sql, { tenantId: 'tenant-a' });
    const storeB = createPostgresClientToolExecutionStore(sql, { tenantId: 'tenant-b' });
    const key = { threadId: 'thread-1', toolCallId: 'call-1' };

    await expect(storeA.claim(key)).resolves.toBe('claimed');
    await storeA.record(key, { ok: true, value: 'a' });
    await expect(storeB.claim(key)).resolves.toBe('claimed');

    expect(queries[0]).toContain('ON CONFLICT (tenant_id, thread_id, tool_call_id) DO NOTHING');
    expect(values[0]).toEqual(['tenant-a', 'thread-1', 'call-1']);
    expect(values[1]).toEqual(['tenant-a', 'thread-1', 'call-1', JSON.stringify({ ok: true, value: 'a' })]);
    expect(values[2]).toEqual(['tenant-b', 'thread-1', 'call-1']);
  });

  it('dedupes a same-tenant claim after a record round trip', async () => {
    const done = { ok: true as const, value: 'first' };
    const { sql, values } = makeSql([
      [{ status: 'executing', result: null }],
      [],
      [],
      [{ status: 'done', result: done }],
    ]);
    const store = createPostgresClientToolExecutionStore(sql, { tenantId: 'tenant-a' });
    const key = { threadId: 'thread-1', toolCallId: 'call-1' };

    await expect(store.claim(key)).resolves.toBe('claimed');
    await store.record(key, done);
    // Second claim conflicts, so the tenant-scoped SELECT returns the recorded result.
    await expect(store.claim(key)).resolves.toEqual({ status: 'done', result: done });

    expect(values[3]).toEqual(['tenant-a', 'thread-1', 'call-1']);
  });
});
