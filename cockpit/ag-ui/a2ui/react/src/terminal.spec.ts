import { describe, expect, it } from 'vitest';
import { createNativeObservation } from './terminal';

// Pure controls use public-shaped fake snapshots; these are not native graph evidence.
const human = { id: 'native-user', role: 'user', content: 'flight please' };
const answer = {
  id: 'native-answer',
  role: 'assistant',
  content: 'confirmed response',
};
const running = () => ({
  status: 'running',
  transcript: [human],
  state: {},
  subagents: [],
  run: { id: 'native-run' },
});
const finished = () => ({
  ...running(),
  status: 'idle',
  transcript: [human, answer],
  run: {
    id: 'native-run',
    outcome: 'success',
    terminal: { type: 'RUN_FINISHED', threadId: 'thread', runId: 'native-run' },
  },
});
function observation(overrides: Record<string, unknown> = {}) {
  return createNativeObservation({
    owner: {},
    generation: 1,
    threadId: 'thread',
    message: human.content,
    previous: [],
    usedRunIds: [],
    ...overrides,
  });
}
describe('native ordinary flight terminal admission (fake transport controls)', () => {
  it('binds immutable native identity on the initial running observation', () => {
    const owner = {};
    const selected = observation({ owner });
    selected.observe(running());
    expect(selected.identity()).toEqual({
      owner,
      generation: 1,
      runId: 'native-run',
      human,
      previous: [],
    });
    expect(Object.isFrozen(selected.identity())).toBe(true);
    selected.observe(running());
    expect(selected.confirm('success', finished())).toEqual([human, answer]);
  });
  it('requires initial observation and cannot capture identity from terminal alone', () => {
    const selected = observation();
    selected.observe(finished());
    expect(selected.identity()).toBeUndefined();
    expect(selected.confirm('success', finished())).toBeUndefined();
  });
  it.each(['error', 'aborted', 'paused', 'interrupted', undefined])(
    'rejects submit outcome %s despite successful snapshot',
    (outcome) => {
      const selected = observation();
      selected.observe(running());
      expect(selected.confirm(outcome, finished())).toBeUndefined();
    }
  );
  it.each([
    { run: { id: 'native-run' } },
    {
      run: {
        id: 'foreign',
        outcome: 'success',
        terminal: {
          type: 'RUN_FINISHED',
          threadId: 'thread',
          runId: 'foreign',
        },
      },
    },
    { status: 'running' },
    { decision: { kind: 'native' } },
    { subagents: [{}] },
    { run: { ...finished().run, legacyInterrupt: {} } },
    {
      run: {
        ...finished().run,
        terminal: { ...finished().run.terminal, threadId: 'foreign' },
      },
    },
    {
      run: {
        ...finished().run,
        terminal: {
          ...finished().run.terminal,
          outcome: { type: 'success', pendingToolCallIds: ['pending'] },
        },
      },
    },
    { transcript: [human, { ...answer, toolCalls: [{ id: 'tool' }] }] },
    { transcript: [human, { ...answer, role: 'activity' }] },
    { transcript: [human, answer, { ...answer, id: 'extra' }] },
    { transcript: [human, { ...answer, id: human.id }] },
  ])('rejects ambiguous terminal %j', (change) => {
    const selected = observation();
    selected.observe(running());
    expect(
      selected.confirm('success', { ...finished(), ...change })
    ).toBeUndefined();
  });
  it.each([
    { usedRunIds: ['native-run'] },
    { message: 'different submitted text' },
    { previous: [human] },
  ])('rejects reused or mismatched initial identity %j', (options) => {
    const selected = observation(options);
    selected.observe(running());
    expect(selected.identity()).toBeUndefined();
    expect(selected.confirm('success', finished())).toBeUndefined();
  });
  it('retains intermediate structured observations without granting terminal authority', () => {
    const selected = observation();
    selected.observe(running());
    selected.observe({
      ...running(),
      transcript: [
        human,
        {
          id: 'title',
          role: 'activity',
          activityType: 'title',
          content: { title: 'flight' },
        },
      ],
    });
    expect(selected.confirm('success', finished())).toEqual([human, answer]);
  });
  it('permanently rejects conflicting running identities', () => {
    const selected = observation();
    selected.observe(running());
    selected.observe({ ...running(), run: { id: 'foreign' } });
    expect(selected.confirm('success', finished())).toBeUndefined();
  });
  it('owns caller prefix and initial user data immutably', () => {
    const prefix = [
      { id: 'old-user', role: 'user', content: 'before' },
      { id: 'old-answer', role: 'assistant', content: 'before answer' },
    ];
    const native = { ...running(), transcript: [...prefix, { ...human }] };
    const selected = observation({ previous: prefix });
    selected.observe(native);
    const captured = selected.identity();
    prefix[0].content = 'caller mutation';
    native.transcript[2].content = 'native mutation';
    expect(captured?.previous[0].content).toBe('before');
    expect(captured?.human.content).toBe(human.content);
    expect(Object.isFrozen(captured?.previous)).toBe(true);
    expect(Object.isFrozen(captured?.human)).toBe(true);
    if (!captured) throw Error('Expected native identity');
    const final = {
      ...finished(),
      transcript: [...captured.previous, human, answer],
    };
    expect(selected.confirm('success', final)).toEqual(final.transcript);
    expect(Object.isFrozen(selected.confirm('success', final))).toBe(true);
  });
  it('requires an unchanged complete prior prefix', () => {
    const prior = [
      { id: 'prior-u', role: 'user', content: 'before' },
      { id: 'prior-a', role: 'assistant', content: 'prior answer' },
    ];
    const selected = observation({ previous: prior });
    selected.observe({ ...running(), transcript: [...prior, human] });
    const final = { ...finished(), transcript: [...prior, human, answer] };
    expect(selected.confirm('success', final)).toEqual(final.transcript);
    expect(
      selected.confirm('success', {
        ...final,
        transcript: [
          { ...prior[0], content: 'changed' },
          prior[1],
          human,
          answer,
        ],
      })
    ).toBeUndefined();
  });
  it('never repairs an invalid first running observation', () => {
    const selected = observation();
    selected.observe({ ...running(), transcript: [human, answer] });
    selected.observe(running());
    expect(selected.identity()).toBeUndefined();
    expect(selected.confirm('success', finished())).toBeUndefined();
  });
  it.each([{ type: 'success' }, { type: 'success', pendingToolCallIds: [] }])(
    'accepts explicit completed success %j',
    (outcome) => {
      const selected = observation();
      selected.observe(running());
      const final = finished();
      expect(
        selected.confirm('success', {
          ...final,
          run: { ...final.run, terminal: { ...final.run.terminal, outcome } },
        })
      ).toEqual(final.transcript);
    }
  );
  it.each([
    null,
    {},
    { type: 'cancelled' },
    { type: 'interrupt', interrupts: [] },
    { type: 'success', pendingToolCallIds: null },
    { type: 'success', unexpected: true },
  ])('rejects unsupported explicit terminal outcome %j', (outcome) => {
    const selected = observation();
    selected.observe(running());
    const final = finished();
    expect(
      selected.confirm('success', {
        ...final,
        run: { ...final.run, terminal: { ...final.run.terminal, outcome } },
      })
    ).toBeUndefined();
  });
  it('rechecks caller lifetime during initial and final data capture', () => {
    let live = true;
    const selected = observation({ valid: () => live });
    selected.observe(running());
    live = false;
    expect(selected.identity()).toBeUndefined();
    expect(selected.confirm('success', finished())).toBeUndefined();
  });
  it('rejects accessor data without invoking the getter', () => {
    let called = false;
    const selected = observation();
    const initial = running();
    Object.defineProperty(initial.run, 'id', {
      enumerable: true,
      get() {
        called = true;
        return 'native-run';
      },
    });
    selected.observe(initial);
    expect(called).toBe(false);
    expect(selected.identity()).toBeUndefined();
  });
  it('rechecks lifetime after a descriptor trap reenters teardown', () => {
    let live = true;
    const selected = observation({ valid: () => live });
    const initial = new Proxy(running(), {
      getOwnPropertyDescriptor(target, key) {
        if (key === 'status') live = false;
        return Object.getOwnPropertyDescriptor(target, key);
      },
    });
    selected.observe(initial);
    expect(selected.identity()).toBeUndefined();
    expect(selected.confirm('success', finished())).toBeUndefined();
  });
});
