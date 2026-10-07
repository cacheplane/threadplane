import { describe, expect, it } from 'vitest';
import { capturePreview } from './preview';
const source = {
  thread_id: 't',
  checkpoint_ns: '' as const,
  checkpoint_id: 'c',
  checkpoint_map: { '': 'c' },
};
const state = () => ({
  checkpoint: { ...source },
  next: [],
  tasks: [],
  values: {
    messages: [
      { id: 'h', type: 'human', content: '  input\n' },
      { id: 'a', type: 'ai', content: ' answer ' },
    ],
  },
});
describe('raw known-checkpoint preview', () => {
  it.each([
    { function_call: { name: 'execute' } },
    { toolCallId: 'tool' },
    { toolCallIds: ['tool'] },
    { interrupts: [{}] },
    { subgraphs: [{}] },
  ])('rejects alternate execution-bearing message data %s', (patch) => {
    const raw = state();
    Object.assign(raw.values.messages[1], patch);
    expect(capturePreview(raw, source)).toBeNull();
  });
  it.each([
    { __interrupt__: [{}] },
    { interrupts: [{}] },
    { subgraphs: [{}] },
    { tool_calls: [{}] },
    { error: 'failed' },
  ])('rejects execution-bearing values %s', (patch) => {
    const raw = state();
    Object.assign(raw.values, patch);
    expect(capturePreview(raw, source)).toBeNull();
  });
  it('preserves literal content and independent immutable source and prefix', () => {
    const raw = state();
    const preview = capturePreview(raw, source)!;
    raw.values.messages[0].content = 'changed';
    expect(preview.messages.map((m) => [m.id, m.role, m.content])).toEqual([
      ['h', 'user', '  input\n'],
      ['a', 'assistant', ' answer '],
    ]);
    expect(preview.messages[0].delivery).toEqual({
      generation: 'h',
      phase: 'complete',
      outcome: 'success',
    });
    expect(preview.source).toEqual(source);
    expect(Object.isFrozen(preview.messages[0])).toBe(true);
  });
  it.each([
    { thread_id: 'other' },
    { checkpoint_id: 'other' },
    { checkpoint_ns: 'child' },
    { checkpoint_map: {} },
    { checkpoint_map: undefined },
  ])('rejects mismatched identity %s', (patch) =>
    expect(
      capturePreview(
        { ...state(), checkpoint: { ...source, ...patch } },
        source
      )
    ).toBeNull()
  );
  it.each([
    { next: ['generate'] },
    { next: null },
    { tasks: [{}] },
    { tasks: undefined },
    { error: 'bad' },
    { interrupts: [{}] },
    { subgraphs: [{}] },
    { tool_calls: [{}] },
  ])('rejects unsafe state %s', (patch) =>
    expect(capturePreview({ ...state(), ...patch }, source)).toBeNull()
  );
  it.each([
    { id: 'h' },
    { type: 'tool' },
    { content: [] },
    { tool_calls: [{}] },
    { invalid_tool_calls: [{}] },
    { additional_kwargs: { tool_calls: [{}] } },
    { type: 'assistant' },
  ])('rejects noncanonical message %s', (patch) => {
    const raw = state();
    Object.assign(raw.values.messages[1], patch);
    expect(capturePreview(raw, source)).toBeNull();
  });
  it('rejects odd transcript and accessor state without reading it', () => {
    const raw = state();
    raw.values.messages.pop();
    expect(capturePreview(raw, source)).toBeNull();
    let reads = 0;
    expect(
      capturePreview(
        {
          ...state(),
          get next() {
            reads++;
            return [];
          },
        },
        source
      )
    ).toBeNull();
    expect(reads).toBe(0);
  });
});
