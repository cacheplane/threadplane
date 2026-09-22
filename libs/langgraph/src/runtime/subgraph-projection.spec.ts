import { describe, expect, it } from 'vitest';
import {
  captureStreamEvent,
  initialSubgraphs,
  projectSubgraphs,
  rebaseSubgraphs,
  settleSubgraphs,
} from './subgraph-projection';
import { ownLangGraphSnapshot } from './ownership';
import type { StreamEvent } from './transport.types';

const chunk = (content: string): StreamEvent => ({
  type: 'messages|child',
  messageMetadata: {},
  messages: [{ type: 'ai', id: 'a', content }],
});
describe('pure subgraph projection', () => {
  it('captures a fresh interrupt payload once and accepts authoritative empty controls', () => {
    let reads = 0;
    let nestedReads = 0;
    let state = projectSubgraphs(
      initialSubgraphs(),
      {
        type: 'updates|child',
        data: {
          get __interrupt__() {
            reads += 1;
            return [
              {
                id: 'ask',
                get value() {
                  nestedReads += 1;
                  return true;
                },
              },
            ];
          },
        },
      },
      'one'
    );
    expect(reads).toBe(1);
    expect(nestedReads).toBe(1);
    state = initialSubgraphs(state.subgraphs);
    state = projectSubgraphs(
      state,
      { type: 'checkpoints|child', data: {} },
      'two'
    );
    expect(state.subgraphs[0].interrupts).toEqual([]);
  });
  it('replaces stale controls with the first interrupt-only batch after resume', () => {
    let state = projectSubgraphs(
      initialSubgraphs(),
      {
        type: 'updates|child',
        data: {
          __interrupt__: [
            { id: 'same', value: true },
            { id: 'old', value: false },
          ],
        },
      },
      'one'
    );
    state = initialSubgraphs(state.subgraphs);
    state = projectSubgraphs(
      state,
      {
        type: 'updates|child',
        data: { __interrupt__: [{ id: 'same', value: true }] },
      },
      'two'
    );
    expect(state.subgraphs[0].interrupts).toEqual([
      { id: 'same', value: true },
    ]);
    const observed = state.subgraphs;
    state = initialSubgraphs(state.subgraphs);
    state = projectSubgraphs(
      state,
      {
        type: 'updates|child',
        data: { __interrupt__: [{ id: 'same', value: true }] },
      },
      'three'
    );
    expect(state.subgraphs).toBe(observed);
    state = projectSubgraphs(state, chunk('After current interrupt'), 'three');
    expect(state.subgraphs[0].interrupts).toEqual([
      { id: 'same', value: true },
    ]);
  });
  it('preserves child transcript identity through values-only and equal canonical frames', () => {
    let state = projectSubgraphs(initialSubgraphs(), chunk('First'), 'one');
    const messages = state.subgraphs[0].messages;
    state = projectSubgraphs(
      state,
      { type: 'values|child', data: { count: 1 } },
      'one'
    );
    expect(state.subgraphs[0].messages).toBe(messages);
    const frame: StreamEvent = {
      type: 'values|child',
      data: { count: 1, messages: [{ type: 'ai', id: 'a', content: 'First' }] },
    };
    state = projectSubgraphs(state, frame, 'one');
    const before = state.subgraphs;
    state = projectSubgraphs(state, frame, 'one');
    expect(state.subgraphs).toBe(before);
  });
  it('never reads child payloads on a root token', () => {
    const before = projectSubgraphs(initialSubgraphs(), chunk('First'), 'one');
    const next = projectSubgraphs(
      before,
      {
        type: 'messages',
        get data() {
          throw new Error('unrelated');
        },
      },
      'one'
    );
    expect(next).toBe(before);
    const snapshot = ownLangGraphSnapshot({
      status: 'running',
      messages: [],
      toolCalls: [],
      values: undefined,
      interrupts: [],
      subgraphs: before.subgraphs,
    });
    expect(
      ownLangGraphSnapshot({ ...snapshot, status: 'idle' }, snapshot).subgraphs
    ).toBe(snapshot.subgraphs);
  });

  it('captures routing once even when a payload getter changes the source namespace', () => {
    const namespace = ['child'];
    const event: StreamEvent = {
      type: 'messages',
      namespace,
      get messages() {
        namespace[0] = 'wrong';
        return [{ type: 'ai', id: 'a', content: 'Right' }];
      },
    };
    const captured = captureStreamEvent(event);
    expect(
      projectSubgraphs(initialSubgraphs(), captured, 'one').subgraphs[0]
        .namespace
    ).toEqual(['child']);
  });

  it('keeps error delivery and canonical content through fresh values-only state', () => {
    let state = projectSubgraphs(
      initialSubgraphs(),
      chunk('Long draft'),
      'one'
    );
    state = projectSubgraphs(
      state,
      {
        type: 'values|child',
        data: { messages: [{ type: 'ai', id: 'a', content: '' }], count: 1 },
      },
      'one'
    );
    state = projectSubgraphs(state, { type: 'error|child' }, 'one');
    const failed = state.subgraphs[0];
    state = projectSubgraphs(
      state,
      { type: 'values|child', data: { count: 2 } },
      'one'
    );
    expect(state.subgraphs[0].messages[0].delivery).toBe(
      failed.messages[0].delivery
    );
    expect(state.subgraphs[0].error).toBe(failed.error);
    state = settleSubgraphs(state, 'success', true);
    expect(state.subgraphs[0].messages[0].content).toBe('');
    expect(state.subgraphs[0].messages[0].delivery).toMatchObject({
      outcome: 'error',
    });
  });

  it('keeps anonymous identity and retained canonical candidates across reconnect', () => {
    let state = projectSubgraphs(
      initialSubgraphs(),
      {
        type: 'messages|child',
        messageMetadata: {},
        messages: [{ type: 'ai', content: 'A' }],
      },
      'one'
    );
    const id = state.subgraphs[0].messages[0].id;
    state = settleSubgraphs(state, 'interrupted');
    state = rebaseSubgraphs(state, 'two');
    state = projectSubgraphs(
      state,
      {
        type: 'messages|child',
        messageMetadata: {},
        messages: [{ type: 'ai', content: 'B' }],
      },
      'two'
    );
    expect(state.subgraphs[0].messages[0]).toMatchObject({
      id,
      content: 'AB',
      delivery: { generation: 'two', phase: 'streaming' },
    });
  });

  it('settles a rebased physical projection on a later child error', () => {
    let state = projectSubgraphs(
      initialSubgraphs(),
      chunk('First'),
      'one-step-1'
    );
    state = rebaseSubgraphs(settleSubgraphs(state, 'interrupted'), 'two');
    state = projectSubgraphs(state, { type: 'error|child' }, 'two-step-1');
    expect(state.subgraphs[0].messages[0].delivery).toMatchObject({
      generation: 'two',
      outcome: 'error',
    });
  });
});
