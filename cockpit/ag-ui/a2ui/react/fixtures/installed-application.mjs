/** Private installed-consumer child: actual application and actual native Session. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSession } from '@threadplane/ag-ui';
import { createA2uiApplication } from '../../../../../compiled/application.mjs';
const args = process.argv.slice(2),
  options = {};
assert.equal(args.length, 10);
for (let index = 0; index < args.length; index += 2) {
  assert.ok(
    ['--retain', '--python', '--environment', '--home', '--tmpdir'].includes(
      args[index]
    )
  );
  assert.ok(!Object.hasOwn(options, args[index].slice(2)));
  options[args[index].slice(2)] = args[index + 1];
}
const require = createRequire(import.meta.url);
const candidate = require.resolve('@threadplane/ag-ui');
assert.ok(
  realpathSync(candidate).startsWith(
    realpathSync(process.cwd()) + '/node_modules/@threadplane/ag-ui/'
  )
);
const { createA2uiServer } = await import(
  process.env.THREADPLANE_CANONICAL_FIXTURE
);
const receipt = {
  kind: 'actual installed native application and borrowed shared actions',
  candidate,
  nativeObservations: [],
  publications: [],
  turns: [],
  cleanup: [],
  failures: [],
};
let fixture,
  application,
  nativeRelease,
  failure,
  observationFailure,
  observedBytes = 0;
const originalFetch = globalThis.fetch;
function boundedNative(snapshot) {
  try {
    const encoded = JSON.stringify(snapshot);
    observedBytes += Buffer.byteLength(encoded);
    assert.ok(
      receipt.nativeObservations.length < 2048 &&
        observedBytes <= 24 * 1024 * 1024,
      'Native observation bound'
    );
    receipt.nativeObservations.push(snapshot);
  } catch (error) {
    observationFailure ??= error;
  }
}
function recordTurn(kind) {
  assert.ifError(observationFailure);
  const state = application.getSnapshot();
  assert.equal(state.busy, false);
  assert.equal(state.canSubmit, true);
  assert.equal(state.outcome, 'success');
  assert.equal(state.messages.length, (receipt.turns.length + 1) * 2);
  assert.equal(state.surfaces.length, receipt.turns.length + 1);
  assert.equal(state.surfaces.at(-1).kind, kind);
  assert.equal(state.activeSurface, state.surfaces.at(-1).id);
  assert.equal(state.native.status, 'idle');
  assert.equal(state.native.run.outcome, 'success');
  assert.equal(state.native.run.terminal.type, 'RUN_FINISHED');
  const initial = receipt.nativeObservations.find(
    (s) =>
      s.status === 'running' &&
      s.run?.id === state.native.run.id &&
      s.transcript.length === state.messages.length - 1
  );
  assert.ok(initial, 'Actual initial running callback required');
  assert.deepEqual(initial.transcript, state.messages.slice(0, -1));
  assert.equal(initial.transcript.at(-1).role, 'user');
  assert.equal(initial.run.outcome, undefined);
  const turn = {
    kind,
    threadId: state.threadId,
    runId: state.native.run.id,
    initial,
    native: state.native,
    originalSubmitOutcome: state.outcome,
    messages: state.messages,
    surfaces: state.surfaces.map((view) => ({
      id: view.id,
      kind: view.kind,
      messageId: view.messageId,
      wire: view.wire,
      model: view.model,
      form: view.form?.getSnapshot(),
    })),
  };
  receipt.turns.push(turn);
  return state.surfaces.at(-1);
}
function activate(view, key, nextKind) {
  const count = receipt.turns.length + 1;
  let release, timer;
  const settled = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(Error('Application action settlement deadline')),
      20000
    );
    release = application.subscribe(() => {
      const state = application.getSnapshot();
      if (!state.busy && (state.error || state.surfaces.length === count))
        resolve();
    });
  });
  let accepted = false;
  try {
    accepted = view.actions[key]();
  } catch (error) {
    clearTimeout(timer);
    release();
    throw error;
  }
  if (!accepted) {
    clearTimeout(timer);
    release();
    throw Error('Shared command rejected');
  }
  return settled
    .finally(() => {
      clearTimeout(timer);
      release();
    })
    .then(() => recordTurn(nextKind));
}
try {
  fixture = await createA2uiServer({
    python: options.python,
    environment: options.environment,
    home: options.home,
    tmpdir: options.tmpdir,
  });
  globalThis.fetch = (input, init) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url
    );
    assert.equal(
      url.href,
      fixture.url,
      'Only the owned canonical loopback endpoint'
    );
    assert.equal(init?.method ?? input?.method, 'POST');
    return originalFetch(input, { ...init, redirect: 'error' });
  };
  let factoryCalls = 0;
  application = createA2uiApplication({
    sessionFactory(threadId) {
      factoryCalls++;
      // No catalogue, fake transport, alternate protocol or checkpoint data enters this owner.
      const native = createSession({ threadId, url: fixture.url });
      boundedNative(native.getSnapshot());
      nativeRelease = native.subscribe(() =>
        boundedNative(native.getSnapshot())
      );
      return native;
    },
  });
  application.subscribe(() => {
    try {
      const state = application.getSnapshot();
      assert.ok(
        receipt.publications.length < 2048,
        'Application publication bound'
      );
      receipt.publications.push({
        threadId: state.threadId,
        busy: state.busy,
        canSubmit: state.canSubmit,
        outcome: state.outcome,
        activeSurface: state.activeSurface,
        messageIds: state.messages.map((message) => message.id),
        surfaces: state.surfaces.map((view) => ({
          id: view.id,
          kind: view.kind,
          messageId: view.messageId,
        })),
      });
    } catch (error) {
      observationFailure ??= error;
    }
  });
  assert.equal(factoryCalls, 0);
  assert.equal(fixture.stats().requests.length, 0);
  assert.equal(await application.submit('I want to fly LAX to JFK'), true);
  const booking = recordTurn('booking');
  booking.edits.origin('SFO');
  booking.edits.dest('SEA');
  booking.edits.date('2027-02-17');
  booking.edits.passengers('003');
  booking.edits.fare('Business');
  assert.deepEqual(
    { ...booking.form.getSnapshot().model },
    {
      origin: ['SFO'],
      dest: ['SEA'],
      date: '2027-02-17',
      passengers: 3,
      fare_class: ['Business'],
    }
  );
  const lexical = booking.form.getSnapshot();
  const results = await activate(booking, 'submit', 'results');
  booking.edits.passengers('9');
  assert.equal(booking.form.getSnapshot(), lexical);
  assert.equal(booking.actions.submit(), false);
  assert.equal(lexical.drafts.passengers, '003');
  const messages = results.wire
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
  const selected = messages
    .flatMap((message) => message.updateComponents?.components ?? [])
    .find(
      (component) =>
        component.action?.event?.name === 'flightSelect' &&
        component.action.event.context.flightId === 'UA204'
    );
  assert.ok(selected, 'Canonical SFO/SEA UA204 shared action');
  const confirmation = await activate(results, selected.id, 'confirmation');
  assert.match(confirmation.wire, /UA204/);
  const restored = await activate(confirmation, 'modify', 'booking');
  assert.deepEqual(
    { ...restored.form.getSnapshot().model },
    {
      origin: ['SFO'],
      dest: ['SEA'],
      date: '2027-02-17',
      passengers: 3,
      fare_class: ['Business'],
    }
  );
  assert.equal(factoryCalls, 1);
  const records = fixture.stats().requests;
  assert.equal(records.length, 4);
  const runIds = new Set(),
    userIds = new Set();
  for (const [index, turn] of receipt.turns.entries()) {
    const record = records[index],
      oracle = record.worker.observations.state;
    assert.deepEqual(
      record.sentWire,
      record.worker.wire,
      'Canonical serialized wire unchanged'
    );
    assert.equal(record.body.threadId, turn.threadId);
    assert.equal(record.body.runId, turn.runId);
    assert.equal(
      record.body.messages.at(-1).id,
      turn.initial.transcript.at(-1).id
    );
    assert.deepEqual(record.body.tools, []);
    assert.deepEqual(record.worker.observations.deniedNetwork, []);
    assert.equal(oracle.values.messages.length, (index + 1) * 2);
    assert.deepEqual(oracle.next, []);
    assert.deepEqual(oracle.tasks, []);
    assert.equal(oracle.checkpoint.thread_id, turn.threadId);
    for (const [row, message] of oracle.values.messages.map((row, n) => [
      row,
      turn.messages[n],
    ])) {
      assert.equal(row.id, message.id);
      assert.equal(row.type, message.role === 'user' ? 'human' : 'ai');
      assert.equal(row.content, message.content);
    }
    assert.ok(!runIds.has(turn.runId));
    runIds.add(turn.runId);
    const user = turn.initial.transcript.at(-1);
    assert.ok(!userIds.has(user.id));
    userIds.add(user.id);
    turn.oracle = {
      checkpoint: oracle.checkpoint,
      messages: oracle.values.messages,
      next: oracle.next,
      tasks: oracle.tasks,
    };
  }
  assert.ok(
    records[0].worker.observations.models.length >= 2,
    'Actual invalid-first model retry retained'
  );
  assert.ok(records.some((record) => record.worker.observations.title.length));
  assert.ok(
    records.some((record) => record.worker.observations.metadata.length)
  );
  assert.ok(records.some((record) => record.worker.observations.tools.length));
  assert.equal(
    new Set(records.map((record) => record.worker.observations.graphIdentity))
      .size,
    1
  );
  assert.equal(
    new Set(
      records.map((record) => record.worker.observations.checkpointerIdentity)
    ).size,
    1
  );
  for (const publication of receipt.publications)
    if (publication.activeSurface) {
      assert.equal(publication.busy, false);
      assert.equal(publication.canSubmit, true);
      assert.ok(
        publication.surfaces.some(
          (view) =>
            view.id === publication.activeSurface &&
            publication.messageIds.includes(view.messageId)
        )
      );
    }
  await application.newConversation();
  assert.equal(restored.actions.submit(), false);
  assert.equal(application.getSnapshot().threadId, null);
  assert.equal(fixture.stats().requests.length, 4);
  assert.ifError(observationFailure);
} catch (error) {
  failure = error;
  receipt.failures.push({ message: error.message, stack: error.stack });
} finally {
  if (application) {
    try {
      application.revoke();
      await application.dispose();
      receipt.cleanup.push({ name: 'application', closed: true });
    } catch (error) {
      failure ??= error;
      receipt.cleanup.push({
        name: 'application',
        closed: false,
        error: String(error),
      });
    }
  }
  try {
    nativeRelease?.();
    receipt.cleanup.push({ name: 'native observation', closed: true });
  } catch (error) {
    failure ??= error;
    receipt.cleanup.push({
      name: 'native observation',
      closed: false,
      error: String(error),
    });
  }
  globalThis.fetch = originalFetch;
  if (fixture) {
    try {
      await fixture.close();
      receipt.cleanup.push({ name: 'canonical fixture', closed: true });
    } catch (error) {
      failure ??= error;
      receipt.cleanup.push({
        name: 'canonical fixture',
        closed: false,
        error: String(error),
      });
    }
    receipt.fixture = fixture.stats();
  }
  receipt.observedBytes = observedBytes;
  const bytes = JSON.stringify(receipt, null, 2) + '\n';
  assert.ok(
    Buffer.byteLength(bytes) <= 64 * 1024 * 1024,
    'Application receipt bound'
  );
  writeFileSync(join(options.retain, 'application-receipt.json'), bytes);
}
if (failure) throw failure;
assert.ok(receipt.cleanup.every((row) => row.closed));
assert.ok(Object.values(receipt.fixture.closure).every(Boolean));
console.log(
  JSON.stringify({
    turns: receipt.turns.length,
    messages: receipt.turns.map((turn) => turn.messages.length),
    bufferedOrderedTerminalProof: true,
  })
);
