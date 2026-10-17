import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
export function createBoundedCapture(limit) {
  assert.ok(Number.isSafeInteger(limit) && limit > 0);
  const chunks = [];
  let seen = 0,
    retained = 0;
  return {
    push(chunk) {
      const bytes = Buffer.from(chunk);
      seen = Math.min(Number.MAX_SAFE_INTEGER, seen + bytes.length);
      const selected = bytes.subarray(0, Math.max(0, limit - retained));
      if (selected.length) chunks.push(Buffer.from(selected));
      retained += selected.length;
      return seen <= limit;
    },
    receipt: () => ({
      text: Buffer.concat(chunks).toString('utf8'),
      bytesRetained: retained,
      bytesSeen: seen,
      complete: seen <= limit,
    }),
  };
}
export function createTurnAdmission() {
  let pending,
    lastTurn = 0,
    threadId,
    failed;
  const runs = new Set();
  const fail = (error) => {
    failed ??= String(error).slice(0, 2048);
  };
  const guard = (operation) => {
    try {
      assert.equal(failed, undefined, 'IPC admission fenced by prior failure');
      return operation();
    } catch (error) {
      fail(error);
      throw error;
    }
  };
  return {
    begin(message) {
      return guard(() => {
        assert.equal(pending, undefined, 'IPC admission already pending');
        assert.equal(message?.type, 'settled');
        assert.equal(message.turn, lastTurn + 1);
        assert.ok(message.turn <= 4);
        assert.ok(
          typeof message.threadId === 'string' &&
            message.threadId &&
            (!threadId || threadId === message.threadId),
          'Stable own thread'
        );
        assert.ok(
          typeof message.runId === 'string' &&
            message.runId &&
            !runs.has(message.runId),
          'Fresh own run'
        );
        pending = Object.freeze({
          turn: message.turn,
          threadId: message.threadId,
          runId: message.runId,
        });
        return pending;
      });
    },
    commit(token) {
      return guard(() => {
        assert.ok(pending && token === pending, 'Exact pending IPC token');
        threadId = token.threadId;
        lastTurn = token.turn;
        runs.add(token.runId);
        pending = undefined;
        return true;
      });
    },
    fail,
    receipt: () => ({
      lastTurn,
      threadId,
      failed,
      pending: Boolean(pending),
      runs: [...runs],
    }),
  };
}

/** Proof policy owns quarantine; native Session outcomes remain unchanged. */
export function createProofCoordinator(factory, freshThread = randomUUID) {
  let generation = 0,
    threadId = freshThread(),
    owner = factory(threadId);
  let quarantined = false,
    disposed = false,
    active = false,
    controlling = false;
  const attempts = [],
    retired = [],
    cleanup = [];
  const retirements = new Map();
  const acquiredThreads = new Set([threadId]);
  const retire = (capturedOwner) => {
    quarantined = true;
    if (!retirements.has(capturedOwner)) {
      const record = { generation, status: 'pending' };
      cleanup.push(record);
      retirements.set(
        capturedOwner,
        Promise.resolve()
          .then(() => capturedOwner.dispose())
          .then(
            () => {
              record.status = 'closed';
            },
            (error) => {
              record.status = 'failed';
              record.error = String(error).slice(0, 1024);
              throw error;
            }
          )
      );
    }
    return retirements.get(capturedOwner);
  };
  const resourceAcceptance = () =>
    cleanup.some((record) => record.status === 'failed')
      ? 'failed'
      : cleanup.some((record) => record.status === 'pending')
      ? 'pending'
      : retirements.has(owner)
      ? 'closed'
      : 'open';
  return {
    async submit(input) {
      if (disposed || quarantined) throw new Error('Coordinator quarantined');
      if (active) throw new Error('Coordinator already active');
      active = true;
      const epoch = generation,
        capturedOwner = owner;
      const attempt = { generation: epoch, threadId, uncertain: true };
      attempts.push(attempt);
      try {
        const outcome = await capturedOwner.submit(input);
        attempt.outcome = outcome;
        attempt.admitted =
          epoch === generation &&
          !quarantined &&
          !disposed &&
          outcome === 'success';
        attempt.uncertain = !attempt.admitted;
        if (epoch === generation && !attempt.admitted)
          await retire(capturedOwner).catch(() => {});
        return outcome;
      } catch (error) {
        attempt.error = String(error).slice(0, 1024);
        if (epoch === generation) await retire(capturedOwner).catch(() => {});
        throw error;
      } finally {
        if (epoch === generation) active = false;
      }
    },
    async stop() {
      if (controlling) throw new Error('Coordinator control active');
      controlling = true;
      const capturedOwner = owner;
      quarantined = true;
      try {
        await capturedOwner.stop();
      } finally {
        try {
          await retire(capturedOwner);
        } finally {
          controlling = false;
        }
      }
    },
    async newThread() {
      if (disposed) throw new Error('Coordinator disposed');
      if (controlling) throw new Error('Coordinator control active');
      controlling = true;
      generation++;
      const epoch = generation,
        capturedOwner = owner;
      retired.push({ threadId, generation: generation - 1 });
      try {
        await retire(capturedOwner);
        if (disposed || epoch !== generation)
          throw new Error('Coordinator disposed or generation retired');
        const nextThread = freshThread();
        if (disposed || epoch !== generation)
          throw new Error('Coordinator disposed or generation retired');
        if (!nextThread || acquiredThreads.has(nextThread))
          throw new Error('New requires fresh thread');
        acquiredThreads.add(nextThread);
        const nextOwner = factory(nextThread);
        if (disposed || epoch !== generation) {
          await retire(nextOwner);
          throw new Error('Coordinator disposed or generation retired');
        }
        if (retirements.has(nextOwner))
          throw new Error('New requires fresh owner; retired owner rejected');
        threadId = nextThread;
        owner = nextOwner;
        active = false;
        quarantined = false;
      } finally {
        controlling = false;
      }
    },
    async dispose() {
      disposed = true;
      generation++;
      await retire(owner);
    },
    assertResourcesClosed() {
      if (resourceAcceptance() !== 'closed')
        throw new Error('Coordinator resource cleanup unconfirmed or failed');
    },
    receipt() {
      return structuredClone({
        generation,
        threadId,
        quarantined,
        disposed,
        active,
        uncertain: attempts.some((a) => a.uncertain),
        attempts,
        retired,
        cleanup,
        acquiredThreadIds: [...acquiredThreads],
        resourceAcceptance: resourceAcceptance(),
      });
    },
  };
}

// No package/install/process/network activity on import or construction.

export function ordinaryTranscript(rows, graph = false) {
  assert.ok(Array.isArray(rows), 'Actual transcript required');
  const ids = new Set();
  return rows.map((row, index) => {
    const role = graph
      ? { human: 'user', ai: 'assistant' }[row.type]
      : row.role;
    assert.equal(
      role,
      index % 2 ? 'assistant' : 'user',
      'Canonical ordinary human/assistant history'
    );
    assert.ok(
      typeof row.id === 'string' && row.id && !ids.has(row.id),
      'Unique ordinary message identity'
    );
    ids.add(row.id);
    assert.equal(typeof row.content, 'string', 'Ordinary text content');
    assert.ok(row.subagentRunId == null, 'Root messages only');
    for (const key of ['toolCalls', 'tool_calls', 'invalid_tool_calls'])
      assert.ok(
        row[key] == null || (Array.isArray(row[key]) && row[key].length === 0),
        'No pending/structured tool rows'
      );
    return { id: row.id, role, content: row.content };
  });
}

export function parseA2ui(content) {
  assert.ok(
    typeof content === 'string' && content.startsWith('---a2ui_JSON---\n'),
    'Exact A2UI assistant boundary'
  );
  const lines = content.slice('---a2ui_JSON---\n'.length).trimEnd().split('\n');
  assert.ok(
    lines.length === 2 || lines.length === 3,
    'Canonical two/three-envelope surface'
  );
  const envelopes = lines.map((line) => JSON.parse(line));
  for (const envelope of envelopes) assert.equal(envelope.version, 'v0.9');
  const [create, components, data] = envelopes;
  const surfaceId = create.createSurface?.surfaceId;
  assert.ok(typeof surfaceId === 'string' && surfaceId);
  assert.equal(
    create.createSurface.catalogId,
    'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'
  );
  assert.equal(components.updateComponents?.surfaceId, surfaceId);
  assert.ok(Array.isArray(components.updateComponents.components));
  assert.equal(
    components.updateComponents.components.filter((c) => c.id === 'root')
      .length,
    1
  );
  if (data) {
    assert.equal(data.updateDataModel?.surfaceId, surfaceId);
    assert.equal(data.updateDataModel.path, '/');
  }
  return {
    surfaceId,
    components: components.updateComponents.components,
    data: data?.updateDataModel.value,
    envelopes,
  };
}

/** Independent fixture authority. Graph success never rescues native failure. */
export function validateSettledTurn({
  outcome,
  snapshot,
  threadId,
  runId,
  human,
  previous,
  turn,
  oracle,
}) {
  assert.equal(outcome, 'success', 'Actual submit must resolve success');
  assert.equal(snapshot.status, 'idle', 'Actual native owner must be idle');
  assert.equal(snapshot.run?.outcome, 'success', 'Actual native run success');
  assert.equal(snapshot.run.id, runId, 'Exact native run');
  const terminal = snapshot.run.terminal;
  assert.equal(terminal?.type, 'RUN_FINISHED', 'Actual root terminal required');
  assert.equal(terminal.threadId, threadId, 'Exact root thread');
  assert.equal(terminal.runId, runId, 'Exact root run');
  assert.ok(
    terminal.outcome === undefined || terminal.outcome?.type === 'success',
    'Successful root terminal'
  );
  assert.ok(
    !terminal.outcome?.pendingToolCallIds?.length,
    'No terminal pending tool IDs'
  );
  assert.equal(snapshot.decision, undefined, 'No native pause/decision');
  assert.equal(
    snapshot.run.legacyInterrupt,
    undefined,
    'No legacy interruption'
  );
  assert.deepEqual(snapshot.subagents, [], 'No subagents');
  const transcript = ordinaryTranscript(snapshot.transcript);
  assert.ok(Number.isInteger(turn) && turn >= 1 && turn <= 4);
  assert.equal(
    transcript.length,
    2 * turn,
    'Exact canonical terminal row count'
  );
  assert.equal(previous.length, 2 * (turn - 1));
  assert.deepEqual(
    transcript.slice(0, -2),
    ordinaryTranscript(previous),
    'Unchanged prior semantic prefix'
  );
  assert.deepEqual(transcript.at(-2), human, 'Exact authored human');
  const surface = parseA2ui(transcript.at(-1).content);
  const state = oracle.state;
  assert.equal(
    state.checkpoint?.thread_id,
    threadId,
    'Graph checkpoint exact thread'
  );
  assert.equal(state.checkpoint.checkpoint_ns, '', 'Graph root namespace');
  assert.ok(
    typeof state.checkpoint.checkpoint_id === 'string' &&
      state.checkpoint.checkpoint_id,
    'Graph checkpoint identity'
  );
  assert.deepEqual(state.next, [], 'Graph finished next');
  assert.deepEqual(state.tasks, [], 'Graph no tasks/errors/interrupts');
  assert.deepEqual(
    ordinaryTranscript(state.values.messages, true),
    transcript,
    'Independent graph/native agreement'
  );
  assert.ok(
    Array.isArray(oracle.history) && oracle.history.length > 0,
    'Actual checkpoint history'
  );
  assert.deepEqual(
    oracle.history[0].checkpoint,
    state.checkpoint,
    'Latest checkpoint tuple agrees'
  );
  assert.deepEqual(
    oracle.history[0],
    state,
    'Latest checkpoint history matches actual root saved state'
  );
  return { transcript, surface, checkpoint: state.checkpoint };
}
