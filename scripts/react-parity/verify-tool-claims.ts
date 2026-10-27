import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { ThreadState } from '@langchain/langgraph-sdk';
import type { ToolExecutionStore } from '@threadplane/core/tools';
// This integration gate deliberately exercises the source implementations before
// package builds, including stores that are not in the runtime's public surface.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { createSession } from '../../libs/langgraph/src/runtime/create-session';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { canonicalInvocation } from '../../libs/langgraph/src/runtime/tool-provenance';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { deferred } from '../../libs/langgraph/src/runtime/testing/deferred';
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  createInMemoryClientToolExecutionStore,
  type ClientToolExecutionStore,
} from '../../libs/middleware/src/langgraph/client-tool-execution-store';
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  createPostgresClientToolExecutionStore,
  THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA,
  THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION,
  type PostgresTaggedSql,
} from '../../libs/middleware/src/langgraph/postgres-client-tool-execution-store';

// Two real sessions and production stores; only graph delivery is deterministic.
// PostgreSQL runs without host ports, network access, or existing DB credentials.
const container = `threadplane-tool-claims-${process.pid}-${Date.now()}`;
const ownerValue = { city: 'Paris', source: 'owner' };

async function bounded<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 15_000
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function command(
  args: string[],
  input = '',
  timeout = 30_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
      killSignal: 'SIGKILL',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve(stdout.trim());
      else
        reject(
          new Error(
            `docker ${args[0]} failed (${signal ?? code}): ${stderr.trim()}`
          )
        );
    });
    child.stdin.on('error', reject);
    child.stdin.end(input);
  });
}

function psql(query: string, timeout = 10_000): Promise<string> {
  return command(
    [
      'exec',
      '-i',
      container,
      'psql',
      '-h',
      '127.0.0.1',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    query,
    timeout
  );
}

// Encode the production SQL tag's parameters without interpolating SQL text.
// The tag's INSERT/ON CONFLICT/SELECT statements execute in real PostgreSQL.
function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (Array.isArray(value))
    return `ARRAY[${value.map(literal).join(',')}]::text[]`;
  if (typeof value === 'string')
    return `convert_from(decode('${Buffer.from(value).toString(
      'hex'
    )}', 'hex'), 'UTF8')`;
  throw new Error('Unsupported SQL parameter in tool-claim regression');
}

const sql: PostgresTaggedSql = async (strings, ...values) => {
  const query = strings
    .reduce(
      (text, part, index) =>
        text + part + (index < values.length ? literal(values[index]) : ''),
      ''
    )
    .trim()
    .replace(/;$/, '');
  if (/^SELECT/i.test(query))
    return JSON.parse(
      await psql(`SELECT coalesce(json_agg(row), '[]') FROM (${query}) row;`)
    );
  if (/RETURNING/i.test(query))
    return JSON.parse(
      await psql(
        `WITH rows AS (${query}) SELECT coalesce(json_agg(rows), '[]') FROM rows;`
      )
    );
  await psql(query + ';');
  return [];
};

async function scenario(
  kind: string,
  store: ClientToolExecutionStore
): Promise<void> {
  const key = { threadId: `claim-${kind}`, toolCallId: 'shared-call' };
  const invocation = canonicalInvocation('weather', { city: 'Paris' });
  const started = deferred<void>();
  const release = deferred<typeof ownerValue>();
  const sessions: ReturnType<typeof createSession>[] = [];
  const handlers: string[] = [];
  const records: string[] = [];
  const writes: { session: string; values: Record<string, unknown> }[] = [];
  const streams: { session: string; continuation: boolean }[] = [];
  const assistant = {
    type: 'ai',
    id: 'assistant-call',
    content: '',
    tool_calls: [
      { id: key.toolCallId, name: 'weather', args: { city: 'Paris' } },
    ],
  };
  const graphMessages: unknown[] = [assistant];

  function session(name: string, waitForRelease = false) {
    const executionStore: ToolExecutionStore = {
      acquire: store.acquire.bind(store),
      async settle(settlementKey, settlement) {
        records.push(name);
        return store.settle(settlementKey, settlement);
      },
    };
    let streamCount = 0;
    const value = createSession({
      threadId: key.threadId,
      assistantId: 'claim-regression',
      executionStore,
      transport: {
        async *stream(_assistantId, _threadId, payload) {
          assert.ok(
            payload && typeof payload === 'object' && 'messages' in payload
          );
          assert.ok(Array.isArray(payload.messages));
          const results = payload.messages.filter(
            (message: unknown) =>
              message !== null &&
              typeof message === 'object' &&
              'type' in message &&
              message.type === 'tool'
          );
          streams.push({ session: name, continuation: results.length > 0 });
          if (results.length) {
            writes.push({ session: name, values: { messages: results } });
            graphMessages.push(...results);
          }
          streamCount++;
          yield {
            type: 'values',
            data: {
              messages:
                streamCount === 1
                  ? [assistant]
                  : [
                      ...graphMessages,
                      {
                        type: 'ai',
                        id: `${name}-answer`,
                        content: 'Weather complete',
                      },
                    ],
            },
          };
        },
        async updateState(threadId, values) {
          assert.equal(threadId, key.threadId);
          writes.push({ session: name, values });
          assert.ok(Array.isArray(values['messages']));
          graphMessages.push(...values['messages']);
        },
        async getHistory(threadId): Promise<ThreadState[]> {
          assert.equal(threadId, key.threadId);
          return [
            {
              values: { messages: [...graphMessages] },
              next: [],
              tasks: [],
              checkpoint: {
                thread_id: threadId,
                checkpoint_id: 'saved-owner-result',
                checkpoint_ns: '',
                checkpoint_map: {},
              },
              metadata: null,
              created_at: null,
              parent_checkpoint: null,
            },
          ];
        },
      },
      tools: {
        weather: {
          description: 'Deferred weather tool',
          followUp: true,
          async handler(args: { city: string }) {
            assert.deepEqual(args, { city: 'Paris' });
            handlers.push(name);
            if (waitForRelease) {
              started.resolve();
              return release.promise;
            }
            return { city: 'Paris', source: name };
          },
        },
      },
    });
    sessions.push(value);
    return value;
  }

  let ownerRun: Promise<unknown> | undefined;
  try {
    const owner = session('owner', true);
    ownerRun = owner.submit('Go');
    await bounded(started.promise, `${kind}: owner handler start`);
    const outstanding = { status: 'unavailable' };
    assert.deepEqual(await store.acquire(key, invocation), outstanding);
    assert.deepEqual(handlers, ['owner']);
    assert.equal(records.length, 0);
    assert.equal(writes.length, 0);
    const contender = session('contender');
    const outcome = await bounded(
      contender.submit('Go'),
      `${kind}: contender settlement`
    );

    assert.deepEqual(
      await store.acquire(key, invocation),
      outstanding,
      `${kind}: contender must not overwrite the executing owner`
    );
    assert.equal(outcome, 'interrupted');
    assert.deepEqual(contender.getSnapshot().toolCalls, [
      {
        id: key.toolCallId,
        name: 'weather',
        args: { city: 'Paris' },
        status: 'pending',
      },
    ]);
    assert.deepEqual(handlers, ['owner']);
    assert.equal(records.length, 0);
    assert.equal(writes.length, 0);
    assert.deepEqual(
      streams.filter((item) => item.session === 'contender'),
      [{ session: 'contender', continuation: false }]
    );
    await bounded(
      assert.rejects(() => contender.submit('Blocked while owned elsewhere')),
      `${kind}: blocked submit`
    );
    assert.deepEqual(
      streams.filter((item) => item.session === 'contender'),
      [{ session: 'contender', continuation: false }]
    );

    release.resolve(ownerValue);
    assert.equal(
      await bounded(ownerRun, `${kind}: owner completion`),
      'success'
    );
    const ownerCall = owner.getSnapshot().toolCalls[0];
    assert.ok(ownerCall?.status === 'complete');
    assert.deepEqual(ownerCall.result, ownerValue);
    const done = {
      status: 'complete',
      result: JSON.stringify({ ok: true, value: ownerValue }),
    };
    assert.deepEqual(await store.acquire(key, invocation), done);
    assert.deepEqual(records, ['owner']);
    assert.deepEqual(
      writes.map((write) => write.session),
      ['owner']
    );
    assert.equal(
      streams.filter((item) => item.session === 'owner' && item.continuation)
        .length,
      1
    );

    const fresh = session('fresh');
    assert.equal(
      await bounded(
        fresh.submit('Replay saved call'),
        `${kind}: saved result reuse`
      ),
      'success'
    );
    const freshCall = fresh.getSnapshot().toolCalls[0];
    assert.ok(freshCall?.status === 'complete');
    assert.deepEqual(freshCall.result, ownerValue);
    assert.deepEqual(handlers, ['owner']);
    assert.deepEqual(records, ['owner']);
    assert.deepEqual(await store.acquire(key, invocation), done);

    assert.ok(contender.load);
    await bounded(contender.load(), `${kind}: contender history load`);
    assert.ok(
      contender
        .getSnapshot()
        .messages.some(
          (message) =>
            message.role === 'tool' &&
            message.toolCallId === key.toolCallId &&
            message.content === JSON.stringify(ownerValue)
        )
    );
    assert.ok(
      !contender
        .getSnapshot()
        .toolCalls.some(
          (call) => call.id === key.toolCallId && call.status === 'pending'
        )
    );
    assert.equal(
      await bounded(
        contender.submit('Next turn after owner result'),
        `${kind}: reconciled submit`
      ),
      'success'
    );
    assert.deepEqual(handlers, ['owner']);
    assert.deepEqual(records, ['owner']);
    assert.ok(writes.every((write) => write.session !== 'contender'));
    assert.deepEqual(
      streams.filter((item) => item.session === 'contender'),
      [
        { session: 'contender', continuation: false },
        { session: 'contender', continuation: false },
      ]
    );
    for (const write of writes) {
      assert.deepEqual(write.values['messages'], [
        {
          id: `client-tool-result-${key.toolCallId}`,
          role: 'tool',
          type: 'tool',
          tool_call_id: key.toolCallId,
          content: JSON.stringify(ownerValue),
        },
      ]);
    }
    console.log(
      `${kind}: execution ownership, saved result reuse, and history recovery passed`
    );
  } finally {
    release.resolve(ownerValue);
    sessions.forEach((value) => value.dispose());
    if (ownerRun)
      await bounded(Promise.allSettled([ownerRun]), `${kind}: session cleanup`);
  }
}

async function identityScenario(
  kind: string,
  store: ClientToolExecutionStore,
  otherTenant?: ClientToolExecutionStore
): Promise<void> {
  const invocation = 'opaque';
  const tuples = [
    ['identity-thread', '__proto__'],
    ['identity-thread', 'constructor'],
    ['identity-thread', 'toString'],
    ['', ''],
    ['a:b', 'c'],
    ['a', 'b:c'],
    ['雪', '😀'],
    ['other-thread', '__proto__'],
  ];
  if (kind === 'memory') tuples.push(['a\0b', 'c'], ['a', 'b\0c']);
  for (const [threadId, toolCallId] of tuples) {
    const key = { threadId, toolCallId };
    assert.equal(
      await store.settle(key, { invocation, token: 'forged', result: 'first' }),
      'rejected'
    );
    const acquisitions = await Promise.all(
      Array.from({ length: 8 }, () => store.acquire(key, invocation))
    );
    const owners = acquisitions.filter((a) => a.status === 'acquired');
    assert.equal(owners.length, 1);
    assert.equal(
      acquisitions.filter((a) => a.status === 'unavailable').length,
      7
    );
    const token = owners[0].token;
    assert.deepEqual(await store.acquire(key, 'other'), { status: 'conflict' });
    assert.equal(
      await store.settle(key, { invocation, token: 'forged', result: 'first' }),
      'rejected'
    );
    assert.equal(
      await store.settle(key, { invocation: 'other', token, result: 'first' }),
      'rejected'
    );
    const settlement = {
      invocation,
      token,
      result: JSON.stringify({ ok: true, value: `saved-${toolCallId}` }),
    };
    assert.equal(await store.settle(key, settlement), 'accepted');
    assert.equal(await store.settle(key, settlement), 'accepted');
    assert.equal(
      await store.settle(key, { ...settlement, result: 'different' }),
      'rejected'
    );
    assert.equal(
      await store.settle(key, { ...settlement, result: null }),
      'rejected'
    );
    assert.deepEqual(await store.acquire(key, invocation), {
      status: 'complete',
      result: settlement.result,
    });
    assert.deepEqual(await store.acquire(key, 'other'), { status: 'conflict' });
    if (otherTenant)
      assert.equal(
        (await otherTenant.acquire(key, invocation)).status,
        'acquired'
      );
  }
  const key = { threadId: 'nonreusable', toolCallId: 'call' };
  const owner = await store.acquire(key, invocation);
  assert.equal(owner.status, 'acquired');
  if (owner.status !== 'acquired') throw new Error('No owner');
  const settlement = { invocation, token: owner.token, result: null };
  assert.equal(await store.settle(key, settlement), 'accepted');
  assert.equal(await store.settle(key, settlement), 'rejected');
  assert.equal(
    await store.settle(key, { ...settlement, result: 'new' }),
    'rejected'
  );
  assert.deepEqual(await store.acquire(key, invocation), {
    status: 'unavailable',
  });
  assert.deepEqual(await store.acquire(key, 'other'), { status: 'conflict' });
  console.log(
    `${kind}: actual provider contention, opaque identity, ownership, retries, nonreuse, and scope isolation passed`
  );
}

async function fidelityScenario(
  kind: string,
  store: ClientToolExecutionStore
): Promise<void> {
  for (const [label, value] of [
    ['json', { nested: [1, 'literal'] }],
    ['string', 'Error: {"ok":false}'],
    ['undefined', undefined],
    ['special', { x: -0, n: NaN, missing: undefined, sparse: Array(2) }],
  ] as const) {
    const threadId = `fidelity-${kind}-${label}`;
    let handlers = 0,
      settlements = 0;
    const guarded: ToolExecutionStore = {
      acquire: store.acquire.bind(store),
      settle: (key, settlement) => {
        settlements++;
        return store.settle(key, settlement);
      },
    };
    const sessions: ReturnType<typeof createSession>[] = [];
    const build = (name: string, args: { a: number; b: number }) => {
      const writes: unknown[] = [];
      const session = createSession({
        assistantId: 'agent',
        threadId,
        executionStore: guarded,
        transport: {
          async *stream() {
            yield {
              type: 'values',
              data: {
                messages: [
                  {
                    type: 'ai',
                    id: 'ai',
                    content: '',
                    tool_calls: [{ id: 'call', name, args }],
                  },
                ],
              },
            };
          },
          async updateState(_thread, values) {
            writes.push(values);
          },
        },
        tools: {
          work: {
            description: 'Work',
            followUp: false,
            handler: () => {
              handlers++;
              return value;
            },
          },
          changed: {
            description: 'Changed',
            followUp: false,
            handler: () => {
              handlers++;
              return value;
            },
          },
        },
      });
      sessions.push(session);
      return { session, writes };
    };
    try {
      const owner = build('work', { a: 1, b: 2 });
      assert.equal(await owner.session.submit('Owner'), 'success');
      const completed = owner.session.getSnapshot().toolCalls[0];
      assert.equal(completed.status, 'complete');
      if (completed.status === 'complete')
        assert.deepEqual(completed.result, value);
      const observer = build('work', { b: 2, a: 1 });
      assert.equal(
        await observer.session.submit('Observer'),
        label === 'json' || label === 'string' ? 'success' : 'interrupted'
      );
      if (label === 'undefined' || label === 'special')
        assert.deepEqual(observer.writes, []);
      else {
        const reused = observer.session.getSnapshot().toolCalls[0];
        assert.equal(reused.status, 'complete');
        if (reused.status === 'complete')
          assert.deepEqual(reused.result, value);
      }
      for (const [name, args] of [
        ['changed', { a: 1, b: 2 }],
        ['work', { a: 2, b: 2 }],
      ] as const) {
        const mismatch = build(name, args);
        assert.equal(await mismatch.session.submit('Mismatch'), 'interrupted');
        assert.match(
          mismatch.session.getSnapshot().error?.message ?? '',
          /identity conflict/
        );
        assert.deepEqual(mismatch.writes, []);
      }
      assert.equal(handlers, 1);
      assert.equal(settlements, 1);
    } finally {
      for (const session of sessions) await session.dispose();
    }
  }
  console.log(
    `${kind}: real-provider two-session exact reuse, name/argument conflict and non-reusable original fidelity passed`
  );
}

async function corruptedStateScenario(): Promise<void> {
  const store = createPostgresClientToolExecutionStore(sql);
  for (const [status, result] of [
    ['bogus', null],
    ['executing', 'inconsistent'],
  ] as const) {
    const key = { threadId: 'corrupted-state', toolCallId: status };
    const owner = await store.acquire(key, 'original');
    assert.equal(owner.status, 'acquired');
    if (owner.status !== 'acquired')
      throw new Error('No corruption fixture owner');
    // Deliberately corrupt only rows created in our disposable database.
    await psql(`UPDATE threadplane_client_tool_executions
      SET status=${literal(status)}, encoded_result=${literal(result)}
      WHERE thread_id=${literal(key.threadId)} AND tool_call_id=${literal(
      key.toolCallId
    )};`);
    for (const invocation of ['original', 'different']) {
      assert.deepEqual(await store.acquire(key, invocation), {
        status: 'unavailable',
      });
      assert.equal(
        await store.settle(key, {
          invocation,
          token: owner.token,
          result: 'replacement',
        }),
        'rejected'
      );
    }
  }
  console.log(
    'postgres: corrupted status/result states stay unavailable for matching and changed invocations, with no settlement authority'
  );
}

async function migrationScenario(): Promise<void> {
  await psql('DROP TABLE threadplane_client_tool_executions;');
  const legacySchema = THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA.replace(
    /  invocation.*\n|  owner_token.*\n|  encoded_result.*\n/g,
    ''
  );
  await psql(legacySchema);
  const legacyRows = ['executing', 'done', 'failed', 'receipt']
    .map(
      (status, index) =>
        `('', 'legacy', 'call-${index}', '${
          status === 'receipt' ? 'done' : status
        }', '{"ok":true,"value":"historical-${status}"}'::jsonb)`
    )
    .join(',');
  await psql(
    `INSERT INTO threadplane_client_tool_executions (tenant_id,thread_id,tool_call_id,status,result) VALUES ${legacyRows};`
  );
  const before = await psql(
    'SELECT json_agg(t) FROM (SELECT tableoid::oid,tenant_id,thread_id,tool_call_id,status,result,created_at,updated_at FROM threadplane_client_tool_executions ORDER BY tool_call_id) t;'
  );
  await assert.rejects(
    psql(
      THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION.replace(
        'COMMIT;',
        'SELECT 1 / 0; COMMIT;'
      )
    ),
    /division by zero/
  );
  assert.equal(
    await psql(
      "SELECT count(*) FROM information_schema.columns WHERE table_name='threadplane_client_tool_executions' AND column_name='owner_token';"
    ),
    '0'
  );
  // A partial prior upgrade must preserve invocation yet never certify authority.
  await psql(
    "ALTER TABLE threadplane_client_tool_executions ADD COLUMN invocation text, ADD COLUMN owner_token text DEFAULT 'unsafe-default'; UPDATE threadplane_client_tool_executions SET invocation='partial',owner_token=NULL WHERE tool_call_id='call-0'; UPDATE threadplane_client_tool_executions SET owner_token=NULL;"
  );
  await psql(THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION);
  const after = await psql(
    'SELECT json_agg(t) FROM (SELECT tableoid::oid,tenant_id,thread_id,tool_call_id,status,result,created_at,updated_at FROM threadplane_client_tool_executions ORDER BY tool_call_id) t;'
  );
  assert.equal(
    after,
    before,
    'migration preserves historical values and table OID'
  );
  const store = createPostgresClientToolExecutionStore(sql);
  for (let index = 0; index < 4; index++) {
    const key = { threadId: 'legacy', toolCallId: `call-${index}` };
    assert.deepEqual(await store.acquire(key, 'partial'), {
      status: 'unavailable',
    });
    assert.equal(
      await store.settle(key, {
        invocation: 'partial',
        token: 'legacy-unknown',
        result: 'forged',
      }),
      'rejected'
    );
  }
  assert.equal(
    await psql(
      "SELECT invocation FROM threadplane_client_tool_executions WHERE tool_call_id='call-0';"
    ),
    'partial'
  );
  for (const result of ['saved', null]) {
    const key = { threadId: 'new', toolCallId: String(result) };
    const owner = await store.acquire(key, 'new-invocation');
    assert.equal(owner.status, 'acquired');
    if (owner.status === 'acquired')
      assert.equal(
        await store.settle(key, {
          invocation: 'new-invocation',
          token: owner.token,
          result,
        }),
        'accepted'
      );
  }
  const mixed = await psql(
    'SELECT json_agg(t) FROM (SELECT * FROM threadplane_client_tool_executions ORDER BY thread_id,tool_call_id) t;'
  );
  await psql(THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION);
  assert.equal(
    await psql(
      'SELECT json_agg(t) FROM (SELECT * FROM threadplane_client_tool_executions ORDER BY thread_id,tool_call_id) t;'
    ),
    mixed
  );
  assert.equal(
    await psql(
      "SELECT column_default IS NULL AND is_nullable='NO' FROM information_schema.columns WHERE table_name='threadplane_client_tool_executions' AND column_name='owner_token';"
    ),
    't'
  );
  // Execute the former factory's actual INSERT and UPSERT shapes, for both old
  // and new identities. NOT NULL is checked before ON CONFLICT can update.
  for (const toolCallId of ['call-0', 'new-legacy-writer']) {
    const values = `('', 'legacy', ${literal(toolCallId)}, 'executing')`;
    await assert.rejects(
      psql(
        `INSERT INTO threadplane_client_tool_executions (tenant_id,thread_id,tool_call_id,status) VALUES ${values} ON CONFLICT (tenant_id,thread_id,tool_call_id) DO NOTHING RETURNING status,result;`
      ),
      /owner_token/
    );
    await assert.rejects(
      psql(
        `INSERT INTO threadplane_client_tool_executions (tenant_id,thread_id,tool_call_id,status,result) VALUES ('','legacy',${literal(
          toolCallId
        )},'done','{"ok":true,"value":"old"}'::jsonb) ON CONFLICT (tenant_id,thread_id,tool_call_id) DO UPDATE SET status='done',result=CASE WHEN threadplane_client_tool_executions.status='done' THEN threadplane_client_tool_executions.result ELSE EXCLUDED.result END,updated_at=now();`
      ),
      /owner_token/
    );
  }
  // Deliberately demonstrate why drain/audit remains mandatory: custom direct
  // UPDATE writers are not universally fenced by the column requirement.
  await psql(
    "UPDATE threadplane_client_tool_executions SET result='{\"custom\":true}'::jsonb WHERE thread_id='legacy' AND tool_call_id='call-0';"
  );
  assert.equal(
    await psql(
      "SELECT result->>'custom' FROM threadplane_client_tool_executions WHERE thread_id='legacy' AND tool_call_id='call-0';"
    ),
    'true'
  );
  console.log(
    'postgres: actual PG16 transactional rollback, preserved legacy/partial upgrade, repeat migration, old INSERT/UPSERT fencing, and direct UPDATE limitation passed'
  );
}

async function main(): Promise<void> {
  const failures: unknown[] = [];
  try {
    // Docker is mandatory. Missing Docker, image pull, or readiness failures fail
    // the verification rather than silently reducing coverage to an in-memory test.
    await command(
      [
        'run',
        '--detach',
        '--name',
        container,
        '--network',
        'none',
        '--env',
        'POSTGRES_HOST_AUTH_METHOD=trust',
        'postgres:16',
      ],
      '',
      120_000
    );
    const readyDeadline = Date.now() + 30_000;
    for (;;) {
      try {
        // TCP excludes the temporary Unix-socket-only initialization server.
        await psql('SELECT 1;', 5_000);
        break;
      } catch (error) {
        if (Date.now() >= readyDeadline) throw error;
        await delay(250);
      }
    }
    await psql(THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA);
    for (const [kind, store] of [
      ['memory', createInMemoryClientToolExecutionStore()],
      ['postgres', createPostgresClientToolExecutionStore(sql)],
    ] as const) {
      try {
        await scenario(kind, store);
        await fidelityScenario(kind, store);
        await identityScenario(
          kind,
          store,
          kind === 'postgres'
            ? createPostgresClientToolExecutionStore(sql, {
                tenantId: 'identity-other-tenant',
              })
            : undefined
        );
      } catch (error) {
        failures.push(error);
      }
    }
    await corruptedStateScenario();
    await migrationScenario();
    if (failures.length)
      throw new AggregateError(
        failures,
        'Tool claim ownership regressions failed'
      );
  } finally {
    // Also attempt cleanup after an ambiguous/timed-out docker run response.
    await command(['rm', '--force', container]).catch((error: unknown) => {
      if (
        !(error instanceof Error && error.message.includes('No such container'))
      )
        throw error;
    });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
