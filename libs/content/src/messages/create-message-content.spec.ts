import { describe, expect, it, vi } from 'vitest';
import {
  completeDelivery,
  streamingDelivery,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import { createMarkdown } from '../markdown/index.js';
import { createMessageContent } from './index.js';

const message = (
  id: string,
  content: string,
  extra: Partial<Message> = {}
): Message =>
  Object.freeze({
    id,
    role: 'assistant',
    content,
    delivery: streamingDelivery('g1'),
    ...extra,
  });
const snapshot = (
  messages: readonly Message[],
  toolCalls: AgentSnapshot['toolCalls'] = []
): AgentSnapshot =>
  Object.freeze({
    status: 'idle',
    messages: Object.freeze([...messages]),
    toolCalls: Object.freeze([...toolCalls]),
  });

function counting() {
  const created: string[] = [];
  const disposed: string[] = [];
  const updates: string[] = [];
  const factory: typeof createMarkdown = (document, options) => {
    const owner = createMarkdown(document, options);
    const id = document.content;
    created.push(id);
    return {
      ...owner,
      update(next) {
        updates.push(next.content);
        owner.update(next);
      },
      dispose() {
        disposed.push(id);
        owner.dispose();
      },
    };
  };
  return { factory, created, disposed, updates };
}

describe('createMessageContent', () => {
  it.each(['assistant', 'user', 'system', 'tool'] as const)(
    'owns supplied reasoning separately for the %s role',
    (role) => {
      const content = createMessageContent();
      const input = snapshot([
        message('a', 'Answer', { role, reasoning: '**Why**' }),
      ]);
      const rows = content.project(input);
      expect(rows[0].reasoning?.document).toEqual({
        generation: 'g1:reasoning',
        phase: 'streaming',
        content: '**Why**',
      });
      expect(rows[0].reasoning?.root).not.toBeNull();
      expect(rows[0].reasoning).not.toBe(rows[0].markdown);
      expect(rows[0].markdown.document.content).toBe('Answer');
      expect(Object.isFrozen(rows[0].reasoning)).toBe(true);
      expect(content.project(input)).toBe(rows);
      expect(content.project(snapshot(input.messages))).toBe(rows);
      content.dispose();
    }
  );

  it('omits absent and empty reasoning while preserving whitespace', () => {
    const { factory, created } = counting();
    const content = createMessageContent({ markdownFactory: factory });
    const rows = content.project(
      snapshot([
        message('a', 'A'),
        message('b', 'B', { reasoning: '' }),
        message('c', 'C', { reasoning: ' ' }),
      ])
    );
    expect(rows[0]).not.toHaveProperty('reasoning');
    expect(rows[1]).not.toHaveProperty('reasoning');
    expect(rows[2].reasoning?.document.content).toBe(' ');
    expect(created).toEqual(['A', 'B', 'C', ' ']);
    content.dispose();
  });

  it('preserves answer and sibling identities through reasoning append and correction', () => {
    const content = createMessageContent();
    const stable = message('a', 'Stable', { reasoning: 'Saved' });
    const first = content.project(
      snapshot([stable, message('b', 'Answer', { reasoning: 'Plan' })])
    );
    for (const reasoning of ['Plan more', 'Corrected']) {
      const rows = content.project(
        snapshot([stable, message('b', 'Answer', { reasoning })])
      );
      expect(rows[0]).toBe(first[0]);
      expect(rows[1].markdown).toBe(first[1].markdown);
      expect(rows[1].reasoning?.document.content).toBe(reasoning);
      expect(rows[1].reasoning).not.toBe(first[1].reasoning);
    }
    expect(first[1].reasoning?.document.content).toBe('Plan');
    content.dispose();
  });

  it('preserves the reasoning snapshot through an answer-only update', () => {
    const content = createMessageContent();
    const first = content.project(
      snapshot([message('a', 'Answer', { reasoning: 'Why' })])
    );
    const next = content.project(
      snapshot([message('a', 'Answer more', { reasoning: 'Why' })])
    );
    expect(next[0].reasoning).toBe(first[0].reasoning);
    expect(next[0].markdown).not.toBe(first[0].markdown);
    content.dispose();
  });

  it('updates reasoning delivery independently of text and accepts a replacement generation', () => {
    const factory = vi.fn(createMarkdown);
    const content = createMessageContent({ markdownFactory: factory });
    content.project(snapshot([message('a', 'Answer', { reasoning: 'Why' })]));
    const complete = content.project(
      snapshot([
        message('a', 'Answer', {
          reasoning: 'Why',
          delivery: completeDelivery('g1', 'paused'),
        }),
      ])
    );
    expect(complete[0].reasoning?.document.phase).toBe('complete');
    const next = content.project(
      snapshot([
        message('a', 'Answer', {
          reasoning: 'New',
          delivery: streamingDelivery('g2'),
        }),
      ])
    );
    expect(next[0].reasoning?.document).toEqual({
      generation: 'g2:reasoning',
      phase: 'streaming',
      content: 'New',
    });
    expect(factory).toHaveBeenCalledTimes(2);
    expect(
      factory.mock.calls.every(
        ([, options]) => options?.violationPolicy === 'rebuild'
      )
    ).toBe(true);
    content.dispose();
  });

  it('creates late reasoning and releases disappeared, empty and removed owners once', () => {
    const { factory, created, disposed } = counting();
    const content = createMessageContent({ markdownFactory: factory });
    const first = content.project(snapshot([message('a', 'Answer')]));
    const late = content.project(
      snapshot([message('a', 'Answer', { reasoning: 'Late' })])
    );
    expect(late[0].markdown).toBe(first[0].markdown);
    content.project(snapshot([message('a', 'Answer')]));
    content.project(snapshot([message('a', 'Answer', { reasoning: 'Again' })]));
    content.project(snapshot([message('a', 'Answer', { reasoning: '' })]));
    const retained = content.project(
      snapshot([message('a', 'Answer', { reasoning: 'Last' })])
    );
    content.project(snapshot([]));
    content.dispose();
    content.dispose();
    expect(created).toEqual(['Answer', 'Late', 'Again', 'Last']);
    expect(disposed).toEqual(['Late', 'Again', 'Answer', 'Last']);
    expect(retained[0].reasoning?.document.content).toBe('Last');
    expect(late[0].reasoning?.document.content).toBe('Late');
  });

  it('keeps retained reasoning readable and the disposed projection inert', () => {
    const { factory, disposed } = counting();
    const content = createMessageContent({ markdownFactory: factory });
    const rows = content.project(
      snapshot([message('a', 'Answer', { reasoning: 'Keep' })])
    );
    content.dispose();
    content.dispose();
    expect(disposed).toEqual(['Answer', 'Keep']);
    expect(rows[0].reasoning?.root).not.toBeNull();
    expect(
      content.project(snapshot([message('b', 'New', { reasoning: 'Late' })]))
    ).toBe(rows);
  });

  it.each(['factory', 'update'] as const)(
    'retries identical input after a reasoning %s failure',
    (failure) => {
      let fail = true;
      const factory: typeof createMarkdown = (document, options) => {
        if (failure === 'factory' && document.content === 'New' && fail) {
          fail = false;
          throw new Error('reasoning failure');
        }
        const owner = createMarkdown(document, options);
        return {
          ...owner,
          update(next) {
            if (failure === 'update' && next.content === 'New' && fail) {
              fail = false;
              throw new Error('reasoning failure');
            }
            owner.update(next);
          },
        };
      };
      const content = createMessageContent({ markdownFactory: factory });
      const before = content.project(
        snapshot([
          message('a', 'Answer', {
            reasoning: failure === 'update' ? 'Old' : undefined,
          }),
        ])
      );
      const input = snapshot([message('a', 'Answer', { reasoning: 'New' })]);
      expect(() => content.project(input)).toThrow('reasoning failure');
      expect(before[0].reasoning?.document.content).toBe(
        failure === 'update' ? 'Old' : undefined
      );
      const rows = content.project(input);
      expect(rows[0].reasoning?.document.content).toBe('New');
      expect(rows[0].markdown).toBe(before[0].markdown);
      expect(content.project(input)).toBe(rows);
      content.dispose();
    }
  );

  it('projects rows with Markdown snapshots and frozen results', () => {
    const content = createMessageContent();
    const rows = content.project(snapshot([message('a', '# Hi')]));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('a');
    expect(rows[0].role).toBe('assistant');
    expect(rows[0].markdown.document.content).toBe('# Hi');
    expect(rows[0].markdown.root).not.toBeNull();
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
  });

  it('is idempotent for identical inputs and reuses unchanged rows', () => {
    const { factory, created, updates } = counting();
    const content = createMessageContent({ markdownFactory: factory });
    const a = message('a', 'first');
    const first = snapshot([a, message('b', 'str')]);
    const rows = content.project(first);
    expect(content.project(first)).toBe(rows);
    expect(content.project(snapshot([...first.messages]))).toBe(rows);
    const next = content.project(snapshot([a, message('b', 'stream')]));
    expect(next).not.toBe(rows);
    expect(next[0]).toBe(rows[0]);
    expect(next[1]).not.toBe(rows[1]);
    expect(created).toEqual(['first', 'str']);
    expect(updates).toEqual(['stream']);
  });

  it('updates an owner on generation or phase change and disposes removed ids', () => {
    const { factory, created, disposed, updates } = counting();
    const content = createMessageContent({ markdownFactory: factory });
    content.project(snapshot([message('a', 'x'), message('b', 'y')]));
    content.project(
      snapshot([
        message('a', 'x', { delivery: completeDelivery('g1', 'success') }),
      ])
    );
    expect(updates).toEqual(['x']);
    expect(disposed).toEqual(['y']);
    content.project(
      snapshot([message('a', 'x', { delivery: streamingDelivery('g2') })])
    );
    expect(updates).toEqual(['x', 'x']);
    expect(created).toEqual(['x', 'y']);
  });

  it('attaches tool calls by toolCallIds or toolCallId in toolCalls order', () => {
    const content = createMessageContent();
    const calls = [
      Object.freeze({
        id: 'c2',
        name: 'lookup',
        args: {},
        status: 'running' as const,
      }),
      Object.freeze({
        id: 'c1',
        name: 'lookup',
        args: {},
        status: 'pending' as const,
      }),
    ];
    const rows = content.project(
      snapshot(
        [
          message('a', '', { toolCallIds: ['c1', 'c2'] }),
          message('t', 'done', { role: 'tool', toolCallId: 'c1' }),
        ],
        calls
      )
    );
    expect(rows[0].toolCalls).toEqual([calls[0], calls[1]]);
    expect(rows[1].toolCalls).toEqual([calls[1]]);
    expect(Object.isFrozen(rows[0].toolCalls)).toBe(true);
  });

  it('disposes all owners once and keeps returned rows readable', () => {
    const { factory, disposed } = counting();
    const content = createMessageContent({ markdownFactory: factory });
    const rows = content.project(snapshot([message('a', '# Keep')]));
    content.dispose();
    content.dispose();
    expect(disposed).toEqual(['# Keep']);
    expect(rows[0].markdown.document.content).toBe('# Keep');
    expect(content.project(snapshot([message('b', 'late')]))).toBe(rows);
  });

  it('uses the rebuild violation policy', () => {
    const factory = vi.fn(createMarkdown);
    createMessageContent({ markdownFactory: factory }).project(
      snapshot([message('a', 'x')])
    );
    expect(factory.mock.calls[0][1]).toEqual({ violationPolicy: 'rebuild' });
  });

  it('retries the same snapshot after a factory failure', () => {
    let fail = true;
    const created: string[] = [];
    const factory: typeof createMarkdown = (document, options) => {
      created.push(document.content);
      if (fail) {
        fail = false;
        throw new Error('boom');
      }
      return createMarkdown(document, options);
    };
    const content = createMessageContent({ markdownFactory: factory });
    const input = snapshot([message('a', 'x')]);
    expect(() => content.project(input)).toThrow('boom');
    const rows = content.project(input);
    expect(created).toEqual(['x', 'x']);
    expect(rows).toHaveLength(1);
    expect(rows[0].markdown.document.content).toBe('x');
  });

  it('updates an owner when only the generation changes', () => {
    const { factory, updates } = counting();
    const content = createMessageContent({ markdownFactory: factory });
    content.project(snapshot([message('a', 'x')]));
    content.project(
      snapshot([message('a', 'x', { delivery: streamingDelivery('g2') })])
    );
    expect(updates).toEqual(['x']);
  });

  it('reuses rows for a new toolCalls array of the same call objects', () => {
    const content = createMessageContent();
    const call = Object.freeze({
      id: 'c1',
      name: 'lookup',
      args: {},
      status: 'running' as const,
    });
    const a = message('a', 'x', { toolCallIds: ['c1'] });
    const rows = content.project(snapshot([a], [call]));
    expect(content.project(snapshot([a], [call]))).toBe(rows);
  });

  it('rebuilds only rows attached to a replaced tool call', () => {
    const content = createMessageContent();
    const c1 = Object.freeze({
      id: 'c1',
      name: 'lookup',
      args: {},
      status: 'running' as const,
    });
    const c2 = Object.freeze({
      id: 'c2',
      name: 'lookup',
      args: {},
      status: 'running' as const,
    });
    const a = message('a', 'x', { toolCallIds: ['c1'] });
    const b = message('b', 'y', { toolCallIds: ['c2'] });
    const rows = content.project(snapshot([a, b], [c1, c2]));
    const done = Object.freeze({
      id: 'c1',
      name: 'lookup',
      args: {},
      status: 'complete' as const,
      result: 'ok',
    });
    const next = content.project(snapshot([a, b], [done, c2]));
    expect(next).not.toBe(rows);
    expect(next[0]).not.toBe(rows[0]);
    expect(next[0].toolCalls[0]).toBe(done);
    expect(next[1]).toBe(rows[1]);
  });
});
