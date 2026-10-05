import { describe, expect, it } from 'vitest';
import { ChildObservations } from './children';
const child = (namespace = 'namespace', text = 'Observed suggestion') => ({
  namespace: [namespace],
  values: { subagent_type: 'research', task_description: 'Plan LAX to JFK' },
  messages: [
    {
      id: 'child',
      role: 'assistant',
      content: text,
      delivery: { generation: 'run', phase: 'complete', outcome: 'success' },
    },
  ],
  interrupts: [],
});
const context = {
  generation: 'run',
  rootIds: new Set(['root']),
  terminal: false,
};
describe('local child observations without inferred parent binding', () => {
  it.each(['subagent_type', 'task_description'])(
    'rejects a supplied undefined %s even if a later snapshot looks valid',
    (field) => {
      const store = new ChildObservations('view', 'turn');
      const malformed = child();
      Object.assign(malformed.values, { [field]: undefined });
      expect(store.observe([malformed], context)).toBe(false);
      expect(store.observe([child()], context)).toBe(false);
    }
  );
  it('retains separate identical tasks by full namespace and omits technical identities from rows', () => {
    const store = new ChildObservations('view-1', 'turn-1');
    expect(store.observe([child('a'), child('b')], context)).toBe(true);
    expect(store.rows()).toHaveLength(2);
    expect(new Set(store.rows().map((row) => row.key)).size).toBe(2);
    expect(
      store.rows().map(({ role, text, status }) => ({ role, text, status }))
    ).toEqual([
      { role: 'research', text: 'Observed suggestion', status: 'Receiving' },
      { role: 'research', text: 'Observed suggestion', status: 'Receiving' },
    ]);
    expect(store.finish('Observed response')).toBe(true);
    expect(store.rows().map((row) => row.status)).toEqual([
      'Observed response',
      'Observed response',
    ]);
  });
  it('keys retained rows by owner and turn even when namespace repeats', () => {
    const keys = [
      ['view1', 'turn1'],
      ['view1', 'turn2'],
      ['view2', 'turn1'],
    ].map(([view, turn]) => {
      const store = new ChildObservations(view, turn);
      store.observe([child()], context);
      return store.rows()[0].key;
    });
    expect(new Set(keys).size).toBe(3);
  });
  it('defers transitional empty values and messages without inventing a row', () => {
    const store = new ChildObservations('view', 'turn');
    expect(
      store.observe(
        [{ namespace: ['a'], values: {}, messages: [], interrupts: [] }],
        context
      )
    ).toBe(true);
    expect(store.rows()).toEqual([]);
    expect(store.observe([child('a')], context)).toBe(true);
    expect(store.rows()).toHaveLength(1);
  });
  it('admits valid terminal empty text without displaying a synthetic answer', () => {
    const store = new ChildObservations('view', 'turn');
    expect(
      store.observe([child('a', '')], { ...context, terminal: true })
    ).toBe(true);
    expect(store.finish('Observed response')).toBe(true);
    expect(store.rows()).toEqual([]);
  });
  it('accepts growing streaming text then immutable completed text', () => {
    const store = new ChildObservations('view', 'turn');
    const a = child();
    a.messages[0].delivery = {
      generation: 'run',
      phase: 'streaming',
      outcome: undefined as never,
    };
    expect(store.observe([a], context)).toBe(true);
    expect(
      store.observe([child('namespace', 'Observed suggestion extended')], {
        ...context,
        terminal: true,
      })
    ).toBe(true);
    expect(store.finish('Observed response')).toBe(true);
    expect(store.rows()[0].text).toBe('Observed suggestion extended');
  });
  it.each([
    'empty-namespace',
    'duplicate-namespace',
    'wrong-role',
    'empty-task',
    'extra-value',
    'duplicate-message',
    'root-collision',
    'foreign-generation',
    'tool-role',
    'child-tool',
    'interrupt',
    'error',
    'unfinished-terminal',
    'missing-terminal-values',
    'missing-terminal-message',
  ])('quarantines %s permanently', (mode) => {
    const store = new ChildObservations('view', 'turn');
    const a = child();
    let children: unknown[] = [a];
    let terminal = false;
    if (mode === 'empty-namespace') a.namespace = [];
    if (mode === 'duplicate-namespace') children = [a, a];
    if (mode === 'wrong-role') a.values.subagent_type = 'other';
    if (mode === 'empty-task') a.values.task_description = '';
    if (mode === 'extra-value') Object.assign(a.values, { other: true });
    if (mode === 'duplicate-message') a.messages.push(a.messages[0]);
    if (mode === 'root-collision') a.messages[0].id = 'root';
    if (mode === 'foreign-generation')
      a.messages[0].delivery.generation = 'old';
    if (mode === 'tool-role') a.messages[0].role = 'tool';
    if (mode === 'child-tool')
      Object.assign(a.messages[0], { toolCallIds: ['call'] });
    if (mode === 'interrupt') Object.assign(a, { interrupts: [{}] });
    if (mode === 'error') Object.assign(a, { error: { message: 'private' } });
    if (mode === 'unfinished-terminal') {
      a.messages[0].delivery.phase = 'streaming';
      terminal = true;
    }
    if (mode === 'missing-terminal-values') {
      Object.assign(a, { values: {} });
      terminal = true;
    }
    if (mode === 'missing-terminal-message') {
      a.messages = [];
      terminal = true;
    }
    expect(store.observe(children, { ...context, terminal })).toBe(false);
    expect(store.observe([], context)).toBe(false);
    expect(store.finish('Observed response')).toBe(false);
  });
  it.each([
    'role',
    'task',
    'completed-text',
    'message-id',
    'disappearance',
    'phase-regression',
  ])('rejects revised admitted %s', (mode) => {
    const store = new ChildObservations('view', 'turn');
    expect(store.observe([child()], context)).toBe(true);
    const a = child();
    if (mode === 'role') a.values.subagent_type = 'booking';
    if (mode === 'task') a.values.task_description = 'Changed';
    if (mode === 'completed-text') a.messages[0].content = 'Changed';
    if (mode === 'message-id') a.messages[0].id = 'replaced';
    if (mode === 'phase-regression') a.messages[0].delivery.phase = 'streaming';
    expect(store.observe(mode === 'disappearance' ? [] : [a], context)).toBe(
      false
    );
  });
  it.each(['Stopped', 'Incomplete'] as const)(
    'ends partial observations as %s without claiming success',
    (status) => {
      const store = new ChildObservations('view', 'turn');
      const a = child();
      a.messages[0].delivery = {
        generation: 'run',
        phase: 'streaming',
        outcome: undefined as never,
      };
      expect(store.observe([a], context)).toBe(true);
      expect(store.finish(status)).toBe(true);
      expect(store.rows()[0].status).toBe(status);
      expect(store.observe([child('late')], context)).toBe(false);
      expect(store.rows()).toHaveLength(1);
    }
  );
  it('rejects accessors, hostile prototypes and formatting hooks without invoking them', () => {
    let reads = 0;
    const getter = Object.defineProperty({}, 'namespace', {
      get() {
        reads++;
        return ['a'];
      },
    });
    const hook = {
      ...child(),
      toJSON() {
        reads++;
        return child();
      },
    };
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    for (const raw of [
      getter,
      hook,
      Object.create(child()),
      { ...child(), values: { n: NaN } },
      cyclic,
    ]) {
      const store = new ChildObservations('view', 'turn');
      expect(store.observe([raw], context)).toBe(false);
    }
    expect(reads).toBe(0);
  });
});
