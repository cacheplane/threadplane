import { expect, it } from 'vitest';
import { captureTerminal, checkpointSource } from './terminal';
import { createObservation } from './observation';
import { evidence } from './evidence.testing';
function setup() {
  const e = evidence(),
    o = createObservation('Show dashboard');
  o.observe(e.before);
  o.observe(e.after);
  o.observe(e.saved, true);
  return { ...e, o };
}
it('accepts exact saved checkpoint and completion IDs without requiring saved run metadata', () => {
  const e = setup();
  expect(captureTerminal(e.saved, e.raw, 'thread', e.o, {}, [])).toMatchObject({
    dashboard: {},
    surfaces: [{ messageId: 'parent' }],
  });
});
it('rejects incomplete, foreign, stale, task-error and missing saved evidence', () => {
  const e = setup();
  for (const raw of [
    undefined,
    { ...e.raw, tasks: [{ error: 'failure' }] },
    { ...e.raw, next: ['tools'] },
    {
      ...e.raw,
      checkpoint: { ...(e.raw.checkpoint as object), thread_id: 'foreign' },
    },
    { ...e.raw, values: { ...e.raw.values, completed_turn_id: 'old' } },
    {
      ...e.raw,
      values: { ...e.raw.values, completed_message_ids: ['human', 'answer'] },
    },
    {
      ...e.raw,
      values: {
        ...e.raw.values,
        dashboard: { on_time: { value: 999, delta: null } },
      },
    },
  ])
    expect(
      captureTerminal(e.saved, raw, 'thread', e.o, {}, [])
    ).toBeUndefined();
});
it('rejects matching loaded and raw dashboard unsupported by current data tools', () => {
  const e = setup(),
    dashboard = { on_time: { value: 999, delta: null } };
  expect(
    captureTerminal(
      { ...e.saved, values: { ...e.saved.values, dashboard } },
      { ...e.raw, values: { ...e.raw.values, dashboard } },
      'thread',
      e.o,
      {},
      []
    )
  ).toBeUndefined();
});
it('keeps a validated nonempty-parent no-op inspectable without manufacturing a surface', () => {
  const e = evidence(),
    o = createObservation('Show dashboard');
  const before = {
    ...e.before,
    messages: [e.human, { ...e.parent, content: 'Prose.' }, e.result],
  };
  o.observe(before);
  const after = { ...e.after, messages: [...before.messages, e.final] };
  o.observe(after);
  const saved = {
    ...e.saved,
    toolCalls: [e.tool],
    messages: after.messages.map((m) => ({
      ...m,
      delivery: { ...m.delivery, generation: m.id },
    })),
  };
  o.observe(saved, true);
  const raw = {
    ...e.raw,
    values: {
      ...e.raw.values,
      messages: e.raw.values.messages.map((m) =>
        m.id === 'parent'
          ? { ...m, content: 'Prose.' }
          : m.id === 'result'
          ? { ...m, content: e.tool.result }
          : m
      ),
    },
  };
  expect(captureTerminal(saved, raw, 'thread', o, {}, [])).toMatchObject({
    surfaces: [],
    notices: [{ messageId: 'parent' }],
  });
});
it('rejects a raw tool error even when its content matches the neutral completed result', () => {
  const e = setup();
  const raw = {
    ...e.raw,
    values: {
      ...e.raw.values,
      messages: e.raw.values.messages.map((m) =>
        m.type === 'tool' ? { ...m, status: 'error' } : m
      ),
    },
  };
  expect(captureTerminal(e.saved, raw, 'thread', e.o, {}, [])).toBeUndefined();
});
it('rejects foreign namespace or inconsistent root checkpoint maps', () => {
  const source = {
    thread_id: 'thread',
    checkpoint_ns: '',
    checkpoint_id: 'cp',
  };
  expect(
    checkpointSource({ ...source, checkpoint_map: { '': 'wrong' } }, 'thread')
  ).toBeUndefined();
  expect(
    checkpointSource({ ...source, checkpoint_map: { child: 'cp' } }, 'thread')
  ).toBeUndefined();
});
it('rejects raw semantic metadata inconsistent with the loaded message', () => {
  const e = setup();
  for (const fields of [
    { name: 'foreign' },
    { reasoning: 'foreign' },
    { additional_kwargs: { reasoning_content: 'foreign' } },
    { additional_kwargs: { citations: ['https://example.test'] } },
  ]) {
    const raw = {
      ...e.raw,
      values: {
        ...e.raw.values,
        messages: e.raw.values.messages.map((m) =>
          m.id === 'answer' ? { ...m, ...fields } : m
        ),
      },
    };
    expect(
      captureTerminal(e.saved, raw, 'thread', e.o, {}, [])
    ).toBeUndefined();
  }
});
