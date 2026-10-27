import assert from 'node:assert/strict';
import test from 'node:test';
import * as subject from './verify-ag-ui-a2ui.mjs';
test('stdio capture is byte bounded and remains explicitly incomplete after overflow', () => {
  const capture = subject.createBoundedCapture(4);
  assert.equal(capture.push(Buffer.from('abc')), true);
  assert.equal(capture.push(Buffer.from('def')), false);
  assert.equal(capture.push(Buffer.alloc(10000, 120)), false);
  const receipt = capture.receipt();
  assert.equal(receipt.bytesRetained, 4);
  assert.equal(receipt.bytesSeen, 10006);
  assert.equal(receipt.complete, false);
  assert.equal(receipt.text, 'abcd');
});
const notice = (turn = 1) => ({
  type: 'settled',
  turn,
  threadId: 'thread',
  runId: `run-${turn}`,
});
test('IPC admission commits a sequential own turn once', () => {
  const gate = subject.createTurnAdmission();
  const token = gate.begin(notice());
  assert.equal(gate.commit(token), true);
  const next = gate.begin(notice(2));
  assert.equal(gate.commit(next), true);
});
test('duplicate IPC while first admission awaits fences original commit', () => {
  const gate = subject.createTurnAdmission();
  const token = gate.begin(notice());
  assert.throws(() => gate.begin(notice()));
  assert.throws(() => gate.commit(token));
});
test('external failure during pending admission forbids later acceptance', () => {
  const gate = subject.createTurnAdmission();
  const token = gate.begin(notice());
  gate.fail('reader closure unknown');
  assert.throws(() => gate.commit(token));
  assert.throws(() => gate.begin(notice(2)));
});
test('late already-committed IPC fences all later turns', () => {
  const gate = subject.createTurnAdmission();
  gate.commit(gate.begin(notice()));
  assert.throws(() => gate.begin(notice()));
  assert.throws(() => gate.begin(notice(2)));
});
for (const [name, message] of Object.entries({
  outOfOrder: notice(2),
  malformed: {},
  foreignType: { ...notice(), type: 'other' },
}))
  test(`IPC rejects ${name} then remains fenced`, () => {
    const gate = subject.createTurnAdmission();
    assert.throws(() => gate.begin(message));
    assert.throws(() => gate.begin(notice()));
  });
test('IPC refuses changed thread or repeated run in later positive turns', () => {
  for (const patch of [{ threadId: 'foreign' }, { runId: 'run-1' }]) {
    const gate = subject.createTurnAdmission();
    gate.commit(gate.begin(notice()));
    assert.throws(() => gate.begin({ ...notice(2), ...patch }));
  }
});
test('IPC commit rejects foreign or reused token', () => {
  const first = subject.createTurnAdmission(),
    second = subject.createTurnAdmission();
  const token = first.begin(notice());
  assert.throws(() => second.commit(token));
  first.commit(token);
  assert.throws(() => first.commit(token));
});
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('default CLI is empirically inert before dependency builds', () => {
  const output = execFileSync(
    process.execPath,
    [fileURLToPath(new URL('./verify-ag-ui-a2ui.mjs', import.meta.url))],
    { encoding: 'utf8', timeout: 2000, maxBuffer: 8192 }
  );
  assert.match(output, /paths required to execute/);
});
test('installed harness imports pure policy without installer guard', () => {
  const source = readFileSync(
    new URL(
      '../../fixtures/react-parity/native-ag-ui-a2ui/installed-probe.mjs',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(source, /from '.\/ag-ui-a2ui-proof-policy.mjs'/);
  assert.doesNotMatch(
    source,
    /verify-ag-ui-a2ui|ag-ui-candidate-package|emitCandidate|packCandidate|installCandidate|import\.meta\.url/
  );
  const helper = readFileSync(
    new URL('./ag-ui-a2ui-proof-policy.mjs', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(
    helper,
    /child_process|node:fs|fetch\(|import\.meta|process\.argv/
  );
});
test('canonical empty data model uses the actual two-envelope wrapper', () => {
  const input = validTurn();
  const content =
    input.snapshot.transcript[1].content.split('\n').slice(0, 3).join('\n') +
    '\n';
  input.snapshot.transcript[1].content = content;
  input.oracle.state.values.messages[1].content = content;
  input.oracle.history[0] = structuredClone(input.oracle.state);
  assert.equal(subject.validateSettledTurn(input).surface.data, undefined);
});
test('explicit CLI requires all concrete owned paths and has inert default', () => {
  assert.equal(typeof subject.parseCli, 'function');
  assert.equal(subject.parseCli([]), null);
  const options = subject.parseCli([
    '--retain',
    '/private/tmp/proof',
    '--python',
    '/private/tmp/env/bin/python',
    '--environment',
    '/private/tmp/env',
    '--home',
    '/private/tmp/home',
    '--tmpdir',
    '/private/tmp/tmp',
  ]);
  assert.equal(options.retain, '/private/tmp/proof');
  for (const args of [
    ['--retain', 'relative'],
    ['--wat', '/private/tmp/a'],
    ['--retain', '/private/tmp/a'],
    ['--retain', '/private/tmp/a', '--retain', '/private/tmp/b'],
  ])
    assert.throws(() => subject.parseCli(args));
});
function validTurn() {
  const content =
    '---a2ui_JSON---\n' +
    JSON.stringify({
      version: 'v0.9',
      createSurface: {
        surfaceId: 'booking',
        catalogId:
          'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
      },
    }) +
    '\n' +
    JSON.stringify({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'booking',
        components: [{ id: 'root', component: 'Column', children: [] }],
      },
    }) +
    '\n' +
    JSON.stringify({
      version: 'v0.9',
      updateDataModel: {
        surfaceId: 'booking',
        path: '/',
        value: { origin: ['LAX'], dest: ['JFK'], passengers: 1 },
      },
    }) +
    '\n';
  const human = { id: 'h1', role: 'user', content: 'I want to fly LAX to JFK' };
  const assistant = { id: 'a1', role: 'assistant', content };
  const checkpoint = {
    thread_id: 't1',
    checkpoint_ns: '',
    checkpoint_id: 'cp1',
  };
  const state = {
    checkpoint,
    next: [],
    tasks: [],
    values: {
      messages: [
        { id: 'h1', type: 'human', content: human.content },
        {
          id: 'a1',
          type: 'ai',
          content,
          tool_calls: [],
          invalid_tool_calls: [],
        },
      ],
    },
  };
  return {
    outcome: 'success',
    snapshot: {
      status: 'idle',
      transcript: [human, assistant],
      subagents: [],
      run: {
        id: 'r1',
        outcome: 'success',
        terminal: { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' },
      },
    },
    threadId: 't1',
    runId: 'r1',
    human,
    previous: [],
    turn: 1,
    oracle: { state, history: [structuredClone(state)] },
  };
}
test('terminal and independent canonical graph agree on exact ordinary turn', () => {
  assert.equal(typeof subject.validateSettledTurn, 'function');
  assert.deepEqual(
    subject.validateSettledTurn(validTurn()).transcript,
    validTurn().snapshot.transcript
  );
});
const corruptions = {
  'terminal pending tool ids with success': (x) =>
    (x.snapshot.run.terminal.outcome = {
      type: 'success',
      pendingToolCallIds: ['tool-x'],
    }),
  'foreign terminal run': (x) => (x.snapshot.run.terminal.runId = 'foreign'),
  'foreign native run': (x) => (x.snapshot.run.id = 'foreign'),
  'foreign terminal thread': (x) =>
    (x.snapshot.run.terminal.threadId = 'foreign'),
  'changed authored human': (x) =>
    (x.snapshot.transcript[0].content = 'changed'),
  'native error despite graph success': (x) => (x.outcome = 'error'),
  'native aborted despite graph success': (x) => (x.outcome = 'aborted'),
  'native interrupted despite graph success': (x) =>
    (x.outcome = 'interrupted'),
  'missing success': (x) => delete x.outcome,
  'missing native run success': (x) => delete x.snapshot.run.outcome,
  'terminal error': (x) =>
    (x.snapshot.run.terminal = { type: 'RUN_ERROR', message: 'bad' }),
  'terminal absent': (x) => delete x.snapshot.run.terminal,
  'terminal pause': (x) =>
    (x.snapshot.run.terminal.outcome = { type: 'interrupt', interrupts: [] }),
  'pending decision': (x) => (x.snapshot.decision = { status: 'pending' }),
  'legacy interrupt': (x) =>
    (x.snapshot.run.legacyInterrupt = { type: 'CUSTOM' }),
  'pending tool': (x) =>
    (x.snapshot.transcript[1].toolCalls = [
      { id: 'tc', function: { name: 'x', arguments: '{}' } },
    ]),
  subagent: (x) => (x.snapshot.subagents = [{ id: 'child' }]),
  'retained callback row': (x) =>
    x.snapshot.transcript.splice(1, 0, {
      id: 'callback',
      role: 'assistant',
      content: 'title',
    }),
  'duplicate row ids': (x) => (x.snapshot.transcript[1].id = 'h1'),
  nonidle: (x) => (x.snapshot.status = 'running'),
  'graph wrong thread': (x) => (x.oracle.state.checkpoint.thread_id = 'other'),
  'graph wrong namespace': (x) =>
    (x.oracle.state.checkpoint.checkpoint_ns = 'child'),
  'graph missing checkpoint': (x) =>
    delete x.oracle.state.checkpoint.checkpoint_id,
  'graph pending next': (x) => (x.oracle.state.next = ['generate_title']),
  'graph pending task': (x) =>
    (x.oracle.state.tasks = [{ error: null, interrupts: [] }]),
  'graph noncanonical row': (x) =>
    x.oracle.state.values.messages.push({
      id: 'title',
      type: 'ai',
      content: 'callback',
    }),
  'graph changed assistant': (x) =>
    (x.oracle.state.values.messages[1].content = 'other'),
  'graph extra tool': (x) =>
    (x.oracle.state.values.messages[1].tool_calls = [{}]),
  'missing matching latest history': (x) =>
    (x.oracle.history[0].checkpoint.checkpoint_id = 'other'),
  'graph history disagreement': (x) =>
    (x.oracle.history[0].values.messages[1].content = 'other'),
  'boundary only embedded': (x) =>
    (x.snapshot.transcript[1].content =
      'prefix' + x.snapshot.transcript[1].content),
};
for (const [name, mutate] of Object.entries(corruptions))
  test(`settlement rejects ${name}`, () => {
    assert.equal(typeof subject.validateSettledTurn, 'function');
    const input = validTurn();
    mutate(input);
    assert.throws(() => subject.validateSettledTurn(input));
  });
test('settlement rejects semantic prior prefix change', () => {
  assert.equal(typeof subject.validateSettledTurn, 'function');
  const input = validTurn();
  input.turn = 2;
  input.previous = [
    { id: 'old-h', role: 'user', content: 'before' },
    { id: 'old-a', role: 'assistant', content: 'answer' },
  ];
  input.snapshot.transcript.unshift(...structuredClone(input.previous));
  input.snapshot.transcript[0].content = 'changed';
  assert.throws(() => subject.validateSettledTurn(input));
});
test('proof module import is inert and coordinator explicit', () =>
  assert.equal(typeof subject.createProofCoordinator, 'function'));
for (const outcome of ['aborted', 'error', 'success'])
  test(`Stop fences late admission and preserves native ${outcome}`, async () => {
    assert.equal(typeof subject.createProofCoordinator, 'function');
    let finish;
    let disposals = 0;
    let calls = 0;
    const native = {
      submit: () =>
        ++calls === 1
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : Promise.resolve('success'),
      stop: async () => {},
      dispose: async () => {
        disposals++;
      },
    };
    const coordinator = subject.createProofCoordinator(
      () => native,
      () => 'thread-a'
    );
    const pending = coordinator.submit({});
    await coordinator.stop();
    finish(outcome);
    assert.equal(await pending, outcome);
    await assert.rejects(coordinator.submit({}), /quarantined/);
    assert.equal(disposals, 1);
    assert.equal(coordinator.receipt().uncertain, true);
  });
test('New retires old owner and thread before accepting fresh generation', async () => {
  assert.equal(typeof subject.createProofCoordinator, 'function');
  let count = 0;
  let disposed = 0;
  const coordinator = subject.createProofCoordinator(
    () => ({
      submit: async () => 'success',
      stop: async () => {},
      dispose: async () => {
        disposed++;
      },
    }),
    () => `thread-${++count}`
  );
  const before = coordinator.receipt();
  await coordinator.newThread();
  const after = coordinator.receipt();
  assert.notEqual(before.threadId, after.threadId);
  assert.equal(after.generation, before.generation + 1);
  assert.equal(disposed, 1);
  assert.equal(await coordinator.submit({}), 'success');
  await coordinator.dispose();
});
test('unconfirmed failure is retained and never automatically replayed', async () => {
  assert.equal(typeof subject.createProofCoordinator, 'function');
  let calls = 0;
  const coordinator = subject.createProofCoordinator(
    () => ({
      submit: async () => {
        calls++;
        throw new Error('unconfirmed');
      },
      dispose: async () => {},
      stop: async () => {},
    }),
    () => 't'
  );
  await assert.rejects(coordinator.submit({}), /unconfirmed/);
  await assert.rejects(coordinator.submit({}), /quarantined/);
  assert.equal(calls, 1);
  assert.equal(coordinator.receipt().uncertain, true);
  await coordinator.dispose();
});
test('New fences an old completion while the fresh owner remains usable', async () => {
  let finish;
  let owners = 0;
  let threads = 0;
  const coordinator = subject.createProofCoordinator(
    () => ({
      submit:
        ++owners === 1
          ? () =>
              new Promise((resolve) => {
                finish = resolve;
              })
          : async () => 'success',
      stop: async () => {},
      dispose: async () => {},
    }),
    () => `thread-${++threads}`
  );
  const old = coordinator.submit({});
  await coordinator.newThread();
  assert.equal(await coordinator.submit({}), 'success');
  finish('success');
  assert.equal(await old, 'success');
  const receipt = coordinator.receipt();
  assert.equal(receipt.attempts[0].admitted, false);
  assert.equal(receipt.attempts[1].admitted, true);
  assert.equal(receipt.uncertain, true);
  await coordinator.dispose();
});
test('native Stop alone leaves native owner reusable; coordinator owns quarantine', async () => {
  let calls = 0;
  const owner = {
    submit: async () => {
      calls++;
      return 'success';
    },
    stop: async () => {},
    dispose: async () => {},
  };
  await owner.stop();
  assert.equal(await owner.submit({}), 'success');
  const coordinator = subject.createProofCoordinator(
    () => owner,
    () => 't'
  );
  await coordinator.stop();
  await assert.rejects(coordinator.submit({}), /quarantined/);
  assert.equal(calls, 1);
});
test('dispose during New retirement prevents fresh owner acquisition', async () => {
  let release;
  let created = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let threads = 0;
  const coordinator = subject.createProofCoordinator(
    () => {
      created++;
      return {
        dispose: () => gate,
        stop: async () => {},
        submit: async () => 'success',
      };
    },
    () => `t-${++threads}`
  );
  const replacing = coordinator.newThread();
  const disposed = coordinator.dispose();
  release();
  await assert.rejects(replacing, /disposed|retired/);
  await disposed;
  assert.equal(created, 1);
});
test('overlapping New operations cannot acquire and overwrite owners', async () => {
  let release;
  let created = 0;
  let threads = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const coordinator = subject.createProofCoordinator(
    () => {
      const index = ++created;
      return {
        dispose: () => (index === 1 ? gate : Promise.resolve()),
        stop: async () => {},
        submit: async () => 'success',
      };
    },
    () => `t-${++threads}`
  );
  const replacing = coordinator.newThread();
  const overlapping = coordinator.newThread();
  release();
  await replacing;
  await assert.rejects(overlapping, /control|active/);
  assert.equal(created, 2);
  await coordinator.dispose();
});
test('New cannot replace the owner while Stop awaits native stop', async () => {
  let release;
  let created = 0;
  let threads = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const coordinator = subject.createProofCoordinator(
    () => {
      created++;
      return {
        dispose: async () => {},
        stop: () => gate,
        submit: async () => 'success',
      };
    },
    () => `t-${++threads}`
  );
  const stopping = coordinator.stop();
  const replacing = coordinator.newThread();
  release();
  await stopping;
  await assert.rejects(replacing, /control|active/);
  assert.equal(created, 1);
  await coordinator.dispose();
});
for (const outcome of ['aborted', 'error'])
  test(`native ${outcome} is exposed unchanged when retirement rejects`, async () => {
    const coordinator = subject.createProofCoordinator(
      () => ({
        submit: async () => outcome,
        stop: async () => {},
        dispose: async () => {
          throw new Error('dispose failed');
        },
      }),
      () => 't'
    );
    assert.equal(await coordinator.submit({}), outcome);
    const receipt = coordinator.receipt();
    assert.equal(receipt.attempts[0].outcome, outcome);
    assert.equal(receipt.resourceAcceptance, 'failed');
    assert.match(receipt.cleanup[0].error, /dispose failed/);
    assert.throws(
      () => coordinator.assertResourcesClosed(),
      /cleanup|resource/
    );
    await assert.rejects(coordinator.submit({}), /quarantined/);
    await assert.rejects(coordinator.dispose(), /dispose failed/);
  });
test('late native success after rejected Stop disposal remains success with failed cleanup receipt', async () => {
  let finish;
  const coordinator = subject.createProofCoordinator(
    () => ({
      submit: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      stop: async () => {},
      dispose: async () => {
        throw new Error('dispose failed');
      },
    }),
    () => 't'
  );
  const pending = coordinator.submit({});
  await assert.rejects(coordinator.stop(), /dispose failed/);
  finish('success');
  assert.equal(await pending, 'success');
  assert.equal(coordinator.receipt().attempts[0].admitted, false);
  assert.equal(coordinator.receipt().resourceAcceptance, 'failed');
  assert.throws(() => coordinator.assertResourcesClosed(), /cleanup|resource/);
});
test('native rejection remains original error even when cleanup also fails', async () => {
  const nativeError = new Error('native submit failed');
  const coordinator = subject.createProofCoordinator(
    () => ({
      submit: async () => {
        throw nativeError;
      },
      stop: async () => {},
      dispose: async () => {
        throw new Error('cleanup failed');
      },
    }),
    () => 't'
  );
  await assert.rejects(
    coordinator.submit({}),
    (error) => error === nativeError
  );
  assert.equal(coordinator.receipt().resourceAcceptance, 'failed');
  assert.match(coordinator.receipt().cleanup[0].error, /cleanup failed/);
});
test('reentrant disposal in freshThread prevents replacement factory acquisition', async () => {
  let coordinator;
  let created = 0;
  let threads = 0;
  let disposition;
  coordinator = subject.createProofCoordinator(
    () => {
      created++;
      return {
        submit: async () => 'success',
        stop: async () => {},
        dispose: async () => {},
      };
    },
    () => {
      if (++threads > 1) disposition = coordinator.dispose();
      return `t-${threads}`;
    }
  );
  await assert.rejects(coordinator.newThread(), /disposed|retired/);
  await disposition;
  assert.equal(created, 1);
  assert.equal(coordinator.receipt().disposed, true);
  coordinator.assertResourcesClosed();
});
test('reentrant disposal inside replacement factory closes the acquired replacement', async () => {
  let coordinator;
  let created = 0;
  let threads = 0;
  let disposition;
  const closed = [];
  coordinator = subject.createProofCoordinator(
    () => {
      const identity = ++created;
      if (identity > 1) disposition = coordinator.dispose();
      return {
        submit: async () => 'success',
        stop: async () => {},
        dispose: async () => {
          closed.push(identity);
        },
      };
    },
    () => `t-${++threads}`
  );
  await assert.rejects(coordinator.newThread(), /disposed|retired/);
  await disposition;
  assert.deepEqual(closed, [1, 2]);
  assert.equal(coordinator.receipt().disposed, true);
  coordinator.assertResourcesClosed();
});
test('New rejects the same retired owner without reopening admission or disposing twice', async () => {
  let threads = 0;
  let disposals = 0;
  const owner = {
    submit: async () => 'success',
    stop: async () => {},
    dispose: async () => {
      disposals++;
    },
  };
  const coordinator = subject.createProofCoordinator(
    () => owner,
    () => `t-${++threads}`
  );
  await assert.rejects(coordinator.newThread(), /fresh owner|retired owner/);
  assert.equal(coordinator.receipt().quarantined, true);
  assert.equal(disposals, 1);
  await assert.rejects(coordinator.submit({}), /quarantined/);
  await coordinator.dispose();
  assert.equal(disposals, 1);
});
test('New rejects an older retired owner without disposing either owner twice', async () => {
  const disposed = [];
  let threads = 0;
  let acquisitions = 0;
  const first = {
    submit: async () => 'success',
    stop: async () => {},
    dispose: async () => {
      disposed.push('first');
    },
  };
  const second = {
    submit: async () => 'success',
    stop: async () => {},
    dispose: async () => {
      disposed.push('second');
    },
  };
  const coordinator = subject.createProofCoordinator(
    () => (++acquisitions === 2 ? second : first),
    () => `t-${++threads}`
  );
  await coordinator.newThread();
  await assert.rejects(coordinator.newThread(), /fresh owner|retired owner/);
  assert.equal(coordinator.receipt().quarantined, true);
  assert.deepEqual(disposed, ['first', 'second']);
  await assert.rejects(coordinator.submit({}), /quarantined/);
  await coordinator.dispose();
  assert.deepEqual(disposed, ['first', 'second']);
});
test('New rejects any previously acquired thread before acquiring a replacement owner', async () => {
  const threads = ['t1', 't2', 't1'];
  let acquisitions = 0;
  const coordinator = subject.createProofCoordinator(
    () => {
      acquisitions++;
      return {
        submit: async () => 'success',
        stop: async () => {},
        dispose: async () => {},
      };
    },
    () => threads.shift()
  );
  await coordinator.newThread();
  await assert.rejects(coordinator.newThread(), /fresh thread/);
  assert.equal(acquisitions, 2);
  assert.equal(coordinator.receipt().threadId, 't2');
  assert.equal(coordinator.receipt().quarantined, true);
  await assert.rejects(coordinator.submit({}), /quarantined/);
  await coordinator.dispose();
});
