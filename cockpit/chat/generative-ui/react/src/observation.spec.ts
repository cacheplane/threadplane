import { expect, it } from 'vitest';
import { createObservation } from './observation';
import { evidence } from './evidence.testing';
it('admits the actual raw callback → wrapped root → loaded rendered tool transition', () => {
  const e = evidence(),
    observation = createObservation('Show dashboard');
  expect(() => observation.observe(e.before)).not.toThrow();
  expect(() => observation.observe(e.after)).not.toThrow();
  expect(() => observation.observe(e.saved, true)).not.toThrow();
});
it('captures one wrap across partial observations and rejects a second rewrite', () => {
  const e = evidence(),
    o = createObservation('Show dashboard');
  o.observe(e.before);
  o.observe({ ...e.after, messages: [e.human, e.after.messages[1], e.result] });
  o.observe(e.after);
  expect(() =>
    o.observe({
      ...e.after,
      messages: e.after.messages.map((m) =>
        m.id === 'parent' ? { ...m, content: 'rewritten' } : m
      ),
    })
  ).toThrow();
});
it('rejects unrelated completed mutation, reordering, changed arguments and foreign generation', () => {
  const e = evidence();
  const bad = [
    { ...e.after, messages: [e.human, e.result, e.parent] },
    {
      ...e.after,
      messages: e.after.messages.map((m) =>
        m.id === 'human' ? { ...m, content: 'different' } : m
      ),
    },
    { ...e.after, toolCalls: [{ ...e.tool, args: {} }] },
    {
      ...e.after,
      messages: e.after.messages.map((m) => ({
        ...m,
        delivery: { ...m.delivery, generation: 'foreign' },
      })),
    },
  ];
  for (const state of bad) {
    const o = createObservation('Show dashboard');
    o.observe(e.before);
    expect(() => o.observe(state)).toThrow();
  }
});
it('requires previously empty parent and raw result, preserving a nonempty parent as a no-op', () => {
  const e = evidence(),
    o = createObservation('Show dashboard');
  const before = {
    ...e.before,
    messages: [e.human, { ...e.parent, content: 'Prose.' }, e.result],
  };
  o.observe(before);
  expect(() =>
    o.observe({
      ...before,
      status: 'idle',
      messages: [...before.messages, e.final],
    })
  ).not.toThrow();
  expect(() => o.observe(e.after)).toThrow();
  expect(() => createObservation('Show dashboard').observe(e.after)).toThrow();
});
it('requires ordered exact previous transcript and tools', () => {
  const e = evidence(),
    o = createObservation('Next', e.saved.messages, e.saved.toolCalls);
  expect(() => o.observe(e.saved)).not.toThrow();
  expect(() => o.observe({ ...e.saved, toolCalls: [] })).toThrow();
});
it('allows provisional pending arguments to finish but then locks them', () => {
  const e = evidence(),
    o = createObservation('Show dashboard');
  o.observe({
    ...e.before,
    messages: [
      e.human,
      {
        ...e.parent,
        delivery: { generation: 'generation', phase: 'streaming' },
      },
    ],
    toolCalls: [
      { id: 'render', name: 'render_spec', args: {}, status: 'pending' },
    ],
  });
  expect(() => o.observe(e.before)).not.toThrow();
  expect(() =>
    o.observe({ ...e.before, toolCalls: [{ ...e.tool, args: {} }] })
  ).toThrow();
});
it('does not treat an earlier empty streaming parent as an empty parent at wrap time', () => {
  const e = evidence(),
    o = createObservation('Show dashboard');
  o.observe({
    ...e.before,
    messages: [
      e.human,
      {
        ...e.parent,
        delivery: { generation: 'generation', phase: 'streaming' },
      },
    ],
    toolCalls: [
      {
        id: 'render',
        name: 'render_spec',
        args: e.tool.args,
        status: 'pending',
      },
    ],
  });
  o.observe({
    ...e.before,
    messages: [
      e.human,
      {
        ...e.parent,
        content: 'Prose.',
        delivery: { generation: 'generation', phase: 'streaming' },
      },
      e.result,
    ],
  });
  expect(() => o.observe(e.after)).toThrow();
});
it('does not allow completed message delivery to revert to streaming', () => {
  const e = evidence(),
    o = createObservation('Show dashboard');
  o.observe(e.before);
  expect(() =>
    o.observe({
      ...e.before,
      messages: e.before.messages.map((m) =>
        m.id === 'parent'
          ? { ...m, delivery: { generation: 'generation', phase: 'streaming' } }
          : m
      ),
    })
  ).toThrow();
});
it('rejects a reused active generation after history has canonicalized prior deliveries', () => {
  const e = evidence();
  const o = createObservation('Show dashboard', [], [], ['generation']);
  expect(() => o.observe(e.before)).toThrow();
});
it('keeps previous confirmed delivery metadata immutable during later turns', () => {
  const e = evidence(),
    o = createObservation('Next', e.saved.messages, e.saved.toolCalls);
  expect(() =>
    o.observe({
      ...e.saved,
      messages: e.saved.messages.map((m) => ({
        ...m,
        delivery: { ...m.delivery, generation: 'rewritten' },
      })),
    })
  ).toThrow();
});
it('rejects intervening streaming prose after completed raw render evidence grants a wrap', () => {
  const e = evidence(),
    o = createObservation('Show dashboard');
  const streaming = {
    ...e.parent,
    delivery: { generation: 'generation', phase: 'streaming' as const },
  };
  const raw = { ...e.before, messages: [e.human, streaming, e.result] };
  o.observe(raw);
  expect(o.wraps).toHaveLength(1);
  expect(() =>
    o.observe({
      ...raw,
      messages: [
        e.human,
        { ...streaming, content: 'Intervening prose.' },
        e.result,
      ],
    })
  ).toThrow();
});
it('allows the captured empty streaming parent to become exact JSON once and repeat unchanged', () => {
  const e = evidence(),
    o = createObservation('Show dashboard');
  const streaming = {
    ...e.parent,
    delivery: { generation: 'generation', phase: 'streaming' as const },
  };
  const raw = { ...e.before, messages: [e.human, streaming, e.result] };
  o.observe(raw);
  o.observe(raw);
  const wrapped = {
    ...raw,
    messages: [
      e.human,
      { ...streaming, content: e.after.messages[1].content },
      e.result,
    ],
  };
  expect(() => o.observe(wrapped)).not.toThrow();
  expect(() => o.observe(wrapped)).not.toThrow();
  expect(() => o.observe(e.after)).not.toThrow();
  expect(() => o.observe(e.saved, true)).not.toThrow();
});
it.each(['', 'Regressed prose.'])(
  'rejects streaming JSON regression to %j after the captured wrap',
  (content) => {
    const e = evidence(),
      o = createObservation('Show dashboard');
    const streaming = {
      ...e.parent,
      delivery: { generation: 'generation', phase: 'streaming' as const },
    };
    const raw = { ...e.before, messages: [e.human, streaming, e.result] };
    o.observe(raw);
    o.observe({
      ...raw,
      messages: [
        e.human,
        { ...streaming, content: e.after.messages[1].content },
        e.result,
      ],
    });
    expect(() =>
      o.observe({
        ...raw,
        messages: [e.human, { ...streaming, content }, e.result],
      })
    ).toThrow();
  }
);
