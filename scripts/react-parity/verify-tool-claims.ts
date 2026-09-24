import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { ThreadState } from '@langchain/langgraph-sdk';
import type { PlainValue } from '@threadplane/core';
import type {
  ToolExecutionResult,
  ToolExecutionStore,
} from '@threadplane/core/tools';
// This integration gate deliberately exercises the source implementations before
// package builds, including stores that are not in the runtime's public surface.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { createSession } from '../../libs/langgraph/src/runtime/create-session';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { deferred } from '../../libs/langgraph/src/runtime/testing/deferred';
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  createInMemoryClientToolExecutionStore,
  type ClientToolExecutionStore,
  type ClientToolResult,
} from '../../libs/middleware/src/langgraph/client-tool-execution-store';
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  createPostgresClientToolExecutionStore,
  THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA,
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

// Middleware accepts unknown results while runtime snapshots require plain
// data. This scenario only writes ownerValue; check that fact before narrowing.
function runtimeResult(result: ClientToolResult): ToolExecutionResult {
  if (!result.ok) return result;
  assert.deepEqual(result.value, ownerValue);
  return { ok: true, value: result.value as PlainValue };
}

async function scenario(
  kind: string,
  store: ClientToolExecutionStore
): Promise<void> {
  const key = { threadId: `claim-${kind}`, toolCallId: 'shared-call' };
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
      async claim(claimKey) {
        const prior = await store.claim(claimKey);
        if (prior === 'claimed' || prior.status === 'executing') return prior;
        if (prior.status === 'done')
          return { status: 'done', result: runtimeResult(prior.result) };
        return {
          status: 'failed',
          ...(prior.result ? { result: runtimeResult(prior.result) } : {}),
        };
      },
      async record(claimKey, result) {
        records.push(name);
        await store.record(claimKey, result);
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
    const outstanding = { [key.toolCallId]: { status: 'executing' } };
    assert.deepEqual(
      await store.lookup(key.threadId, [key.toolCallId]),
      outstanding
    );
    assert.deepEqual(handlers, ['owner']);
    assert.equal(records.length, 0);
    assert.equal(writes.length, 0);
    const contender = session('contender');
    const outcome = await bounded(
      contender.submit('Go'),
      `${kind}: contender settlement`
    );

    assert.deepEqual(
      await store.lookup(key.threadId, [key.toolCallId]),
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
      [key.toolCallId]: {
        status: 'done',
        result: { ok: true, value: ownerValue },
      },
    };
    assert.deepEqual(await store.lookup(key.threadId, [key.toolCallId]), done);
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
    assert.deepEqual(await store.lookup(key.threadId, [key.toolCallId]), done);

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
  const threadId = 'identity-thread';
  const ids = ['__proto__', 'constructor', 'toString', 'ordinary'];
  const expected = Object.fromEntries(
    ids.map((id) => [id, {
      status: 'done', result: { ok: true, value: `saved-${id}` },
    }])
  );
  for (const toolCallId of ids) {
    const key = { threadId, toolCallId };
    assert.equal(await bounded(store.claim(key), `${kind}: special-ID claim`), 'claimed');
    await bounded(store.record(key, { ok: true, value: `saved-${toolCallId}` }), `${kind}: special-ID owner record`);
  }
  const found = await bounded(
    store.lookup(threadId, [...ids, 'missing']), `${kind}: special-ID lookup`
  );
  assert.equal(Object.getPrototypeOf(found), Object.prototype);
  assert.deepEqual(Object.keys(found).sort(), [...ids].sort());
  for (const id of ids) assert.equal(Object.hasOwn(found, id), true);
  assert.equal(Object.hasOwn(found, 'missing'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(found)), expected);

  const alternate = { ok: true as const, value: 'other scope' };
  const otherThread = 'identity-other-thread';
  assert.deepEqual(await bounded(store.lookup(otherThread, ids), `${kind}: other thread`), {});
  assert.equal(await bounded(store.claim({ threadId: otherThread, toolCallId: '__proto__' }), `${kind}: other thread claim`), 'claimed');
  await bounded(store.record({ threadId: otherThread, toolCallId: '__proto__' }, alternate), `${kind}: other thread record`);
  assert.deepEqual(await bounded(store.lookup(otherThread, ['__proto__']), `${kind}: other thread lookup`), {
    ['__proto__']: { status: 'done', result: alternate },
  });
  if (otherTenant) {
    assert.deepEqual(await bounded(otherTenant.lookup(threadId, ids), `${kind}: other tenant`), {});
    assert.equal(await bounded(otherTenant.claim({ threadId, toolCallId: '__proto__' }), `${kind}: other tenant claim`), 'claimed');
    await bounded(otherTenant.record({ threadId, toolCallId: '__proto__' }, alternate), `${kind}: other tenant record`);
    assert.deepEqual(await bounded(otherTenant.lookup(threadId, ['__proto__']), `${kind}: other tenant lookup`), {
      ['__proto__']: { status: 'done', result: alternate },
    });
  }
  found['__proto__'].status = 'failed';
  assert.deepEqual(await bounded(store.lookup(threadId, ids), `${kind}: original detached lookup`), expected);
  console.log(`${kind}: special-ID execution lookup, string results, serialization and scope isolation passed`);
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
        await identityScenario(kind, store, kind === 'postgres'
          ? createPostgresClientToolExecutionStore(sql, { tenantId: 'identity-other-tenant' })
          : undefined);
      } catch (error) {
        failures.push(error);
      }
    }
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
