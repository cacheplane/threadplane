import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@threadplane/core';
import {
  captureTerminal,
  copyData,
  messageKey,
  type ThreadsState,
} from './authority';
function terminal(): ThreadsState {
  return {
    status: 'idle',
    interrupts: [],
    subgraphs: [],
    toolCalls: [],
    messages: [
      {
        id: 'human',
        role: 'user',
        content: 'First question',
        delivery: {
          generation: 'human',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        id: 'answer',
        role: 'assistant',
        content: 'First answer',
        delivery: {
          generation: 'answer',
          phase: 'complete',
          outcome: 'success',
        },
      },
    ],
    history: [
      {
        checkpoint: {
          thread_id: 'thread',
          checkpoint_ns: '',
          checkpoint_id: 'saved',
        },
        next: [],
      },
    ],
  };
}
function change(target: unknown, key: PropertyKey, value: unknown) {
  if (!target || typeof target !== 'object')
    throw new Error('Invalid authored fixture');
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
describe('saved conversation evidence', () => {
  it('captures immutable exact thread, checkpoint and transcript evidence', () => {
    const state = terminal(),
      saved = captureTerminal(state, 'thread');
    expect(saved).not.toBeNull();
    expect(saved?.threadId).toBe('thread');
    expect(saved?.messages).toEqual(state.messages);
    expect(Object.isFrozen(saved?.messages[0].delivery)).toBe(true);
    (state.messages[0] as { content: string }).content = 'mutated';
    expect(saved?.messages[0].content).toBe('First question');
  });
  it.each(['thread', 'checkpoint', 'content', 'id', 'role'])(
    'distinguishes changed %s evidence',
    (field) => {
      const original = terminal(),
        changed = terminal();
      if (field === 'thread' || field === 'checkpoint')
        change(
          changed.history?.[0]?.checkpoint,
          field === 'thread' ? 'thread_id' : 'checkpoint_id',
          'different'
        );
      else
        change(
          changed.messages[1],
          field,
          field === 'role' ? 'user' : 'different'
        );
      const a = captureTerminal(original, 'thread'),
        b = captureTerminal(changed, 'thread');
      expect(a).not.toBeNull();
      expect(b?.signature).not.toBe(a?.signature);
    }
  );
  it('uses id, role and content as message identity while metadata remains display-only', () => {
    const m = terminal().messages[1];
    expect(messageKey({ ...m, reasoning: 'optional' })).toBe(messageKey(m));
    expect(messageKey({ ...m, content: 'different' })).not.toBe(messageKey(m));
  });
  it.each([
    'running',
    'error',
    'tools',
    'children',
    'interrupt',
    'pending',
    'missing-history',
    'foreign-root',
    'duplicate',
    'tool-message',
    'calls',
    'call-id',
    'incomplete',
    'failure',
    'generation',
    'empty-id',
    'bad-content',
    'missing-user',
    'extra-user',
  ])('rejects unsupported canonical state: %s', (mode) => {
    const state = terminal();
    if (mode === 'running') change(state, 'status', 'running');
    if (mode === 'error') change(state, 'error', { message: 'failure' });
    if (mode === 'tools') change(state, 'toolCalls', [{ id: 'tool' }]);
    if (mode === 'children') change(state, 'subgraphs', [{}]);
    if (mode === 'interrupt') change(state, 'interrupts', [{}]);
    if (mode === 'pending') change(state.history?.[0], 'next', ['generate']);
    if (mode === 'missing-history') change(state, 'history', undefined);
    if (mode === 'foreign-root')
      change(state.history?.[0]?.checkpoint, 'checkpoint_ns', 'child');
    if (mode === 'duplicate') change(state.messages[1], 'id', 'human');
    if (mode === 'tool-message') change(state.messages[1], 'role', 'tool');
    if (mode === 'calls') change(state.messages[1], 'toolCallIds', ['call']);
    if (mode === 'call-id') change(state.messages[1], 'toolCallId', 'call');
    if (mode === 'incomplete')
      change(state.messages[1], 'delivery', {
        phase: 'streaming',
        generation: 'answer',
      });
    if (mode === 'failure')
      change(state.messages[1].delivery, 'outcome', 'error');
    if (mode === 'generation')
      change(state.messages[1].delivery, 'generation', 'live');
    if (mode === 'empty-id') change(state.messages[1], 'id', '');
    if (mode === 'bad-content')
      change(state.messages[1], 'content', { text: 'answer' });
    if (mode === 'missing-user')
      change(state, 'messages', state.messages.slice(1));
    if (mode === 'extra-user') change(state.messages[1], 'role', 'user');
    expect(captureTerminal(state, 'thread')).toBeNull();
  });
  it.each(['messages', 'toolCalls', 'interrupts', 'subgraphs', 'history'])(
    'requires an own well-formed %s collection',
    (field) => {
      const state = terminal();
      Reflect.deleteProperty(state, field);
      expect(captureTerminal(state, 'thread')).toBeNull();
      change(state, field, { length: 0 });
      expect(captureTerminal(state, 'thread')).toBeNull();
    }
  );
  it('rejects accessor data without invoking it', () => {
    const state = terminal(),
      getter = vi.fn(() => []);
    Object.defineProperty(state, 'interrupts', { get: getter });
    expect(captureTerminal(state, 'thread')).toBeNull();
    expect(getter).not.toHaveBeenCalled();
    expect(() => copyData(state)).toThrow();
  });
  it.each([
    'cycle',
    'prototype',
    'toJSON',
    'symbol',
    'nonfinite',
    'sparse',
    'extra-array',
  ])('rejects non-plain source data: %s', (mode) => {
    const state = terminal();
    if (mode === 'cycle') change(state, 'extra', state);
    if (mode === 'prototype') Object.setPrototypeOf(state, { inherited: true });
    if (mode === 'toJSON') change(state, 'toJSON', () => ({}));
    if (mode === 'symbol') change(state, Symbol('hidden'), 'x');
    if (mode === 'nonfinite') change(state, 'extra', NaN);
    if (mode === 'sparse') change(state, 'messages', new Array(2));
    if (mode === 'extra-array') change(state.messages, 'extra', 'hidden');
    expect(captureTerminal(state, 'thread')).toBeNull();
    expect(() => copyData(state)).toThrow();
  });
  it('rejects inherited critical fields', () => {
    const state = terminal(),
      message = state.messages[0] as Message;
    const { id, ...rest } = message;
    const inherited = Object.assign(Object.create({ id }), rest);
    expect(
      captureTerminal(
        { ...state, messages: [inherited, state.messages[1]] },
        'thread'
      )
    ).toBeNull();
  });
});
