import { describe, expect, it } from 'vitest';
import {
  THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA,
  THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION,
  createPostgresClientToolExecutionStore,
  type PostgresTaggedSql,
} from './langgraph/postgres-client-tool-execution-store';

function makeSql(rows: unknown[][]) {
  const queries: string[] = [],
    values: unknown[][] = [];
  const sql = (async (strings: TemplateStringsArray, ...params: unknown[]) => {
    queries.push(strings.join('?'));
    values.push(params);
    // Reflect the token actually sent to INSERT rather than granting invented authority.
    return (
      rows
        .shift()
        ?.map((row) =>
          row === 'inserted' ? { owner_token: params[4] } : row
        ) ?? []
    );
  }) as PostgresTaggedSql;
  return { sql, queries, values };
}
const key = { threadId: 'thread', toolCallId: 'call' };
const invocation = 'opaque';
const token = '12345678-1234-4123-8123-123456789abc';
const known = {
  invocation,
  owner_token: token,
  status: 'executing',
  encoded_result: null,
};

describe('Postgres durable ownership', () => {
  it('keeps historical columns and primary key, with explicit transactional migration and no token default', () => {
    expect(THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA).toContain(
      'PRIMARY KEY (tenant_id, thread_id, tool_call_id)'
    );
    expect(THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA).toMatch(
      /owner_token\s+text\s+NOT NULL[,\n]/
    );
    expect(THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION).toContain('BEGIN;');
    expect(THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION).toContain(
      'ACCESS EXCLUSIVE'
    );
    expect(THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION).toContain(
      'WHERE owner_token IS NULL'
    );
    expect(THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION).toContain(
      'DROP DEFAULT'
    );
    expect(THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION).toContain('COMMIT;');
  });
  it('constructs without DDL and authorizes only the returned inserted owner', async () => {
    const { sql, queries, values } = makeSql([['inserted']]);
    const store = createPostgresClientToolExecutionStore(sql, {
      tenantId: 'tenant',
    });
    expect(queries).toEqual([]);
    const owner = await store.acquire(key, invocation);
    expect(owner).toEqual({ status: 'acquired', token: values[0][4] });
    expect(values[0]).toEqual([
      'tenant',
      'thread',
      'call',
      invocation,
      expect.any(String),
    ]);
    expect(queries[0]).toContain(
      'ON CONFLICT (tenant_id, thread_id, tool_call_id) DO NOTHING'
    );
  });
  it.each([
    undefined,
    {},
    { ...known, owner_token: null },
    { ...known, owner_token: 'legacy-unknown' },
    { ...known, owner_token: '' },
    { ...known, owner_token: 'malformed' },
    { ...known, invocation: null },
    { ...known, status: 'unknown' },
    { ...known, encoded_result: 'bad' },
  ])('fails closed for unknown/malformed authority %j', async (row) => {
    const { sql } = makeSql([[], row ? [row] : []]);
    await expect(
      createPostgresClientToolExecutionStore(sql).acquire(key, invocation)
    ).resolves.toEqual({ status: 'unavailable' });
  });
  it.each([
    { ...known, status: 'bogus' },
    { ...known, encoded_result: 'inconsistent' },
    { ...known, encoded_result: undefined },
    { ...known, status: 'done', encoded_result: undefined },
    { ...known, status: 'done', encoded_result: 42 },
  ])(
    'does not infer invocation conflict from malformed state %j',
    async (row) => {
      const { sql } = makeSql([[], [row]]);
      await expect(
        createPostgresClientToolExecutionStore(sql).acquire(key, 'other')
      ).resolves.toEqual({ status: 'unavailable' });
    }
  );
  it.each([
    { ...known },
    { ...known, status: 'done', encoded_result: null },
    { ...known, status: 'done', encoded_result: 'saved' },
  ])('compares invocation before interpreting a known row %j', async (row) => {
    const { sql } = makeSql([[], [row]]);
    await expect(
      createPostgresClientToolExecutionStore(sql).acquire(key, 'other')
    ).resolves.toEqual({ status: 'conflict' });
  });
  it('returns only encoded completion and no observer token', async () => {
    const { sql } = makeSql([
      [],
      [
        {
          ...known,
          status: 'done',
          encoded_result: 'saved',
          result: { ok: false, error: 'historical' },
        },
      ],
    ]);
    await expect(
      createPostgresClientToolExecutionStore(sql).acquire(key, invocation)
    ).resolves.toEqual({ status: 'complete', result: 'saved' });
  });
  it('captures original key once before a deferred insert and subsequent observation', async () => {
    let release!: (rows: []) => void;
    const pending = new Promise<[]>((resolve) => {
      release = resolve;
    });
    const captured: unknown[][] = [];
    const mutable = { threadId: 'original', toolCallId: '__proto__' };
    let threadReads = 0,
      callReads = 0;
    const identity = {
      get threadId() {
        threadReads++;
        return mutable.threadId;
      },
      get toolCallId() {
        callReads++;
        return mutable.toolCallId;
      },
    };
    const sql: PostgresTaggedSql = async (_strings, ...params) => {
      captured.push(params);
      return captured.length === 1 ? pending : [known];
    };
    const acquired = createPostgresClientToolExecutionStore(sql, {
      tenantId: 'tenant',
    }).acquire(identity, invocation);
    mutable.threadId = 'mutated';
    mutable.toolCallId = 'other';
    release([]);
    await expect(acquired).resolves.toEqual({ status: 'unavailable' });
    expect(captured[1]).toEqual(['tenant', 'original', '__proto__']);
    expect([threadReads, callReads]).toEqual([1, 1]);
  });
  it('uses one conditioned UPDATE, exact string collations and once-captured settlement fields', async () => {
    const { sql, queries, values } = makeSql([[{ owner_token: token }]]);
    const reads = { invocation: 0, token: 0, result: 0 };
    const store = createPostgresClientToolExecutionStore(sql, {
      tenantId: 'tenant',
    });
    await expect(
      store.settle(key, {
        get invocation() {
          reads.invocation++;
          return invocation;
        },
        get token() {
          reads.token++;
          return token;
        },
        get result() {
          reads.result++;
          return 'saved';
        },
      })
    ).resolves.toBe('accepted');
    expect(reads).toEqual({ invocation: 1, token: 1, result: 1 });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/^\s*UPDATE/);
    expect(queries[0]).not.toContain('INSERT');
    expect(queries[0]).toContain('COLLATE "C"');
    expect(values[0]).toContain('tenant');
  });
  it('rejects legacy markers before querying and rejects missing settlement acknowledgments', async () => {
    const { sql, queries } = makeSql([[]]);
    const store = createPostgresClientToolExecutionStore(sql);
    await expect(
      store.settle(key, { invocation, token: 'legacy-unknown', result: null })
    ).resolves.toBe('rejected');
    expect(queries).toEqual([]);
    await expect(
      store.settle(key, { invocation, token, result: null })
    ).resolves.toBe('rejected');
  });
});
