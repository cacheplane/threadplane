import { completeDelivery, type AgentSubagent } from '@threadplane/core';
import { describe, expect, it, vi } from 'vitest';
import { sessionSubagents } from './session-subagents';

const child = (over: Partial<AgentSubagent> = {}): AgentSubagent => ({
  id: 'c',
  name: 'researcher',
  description: 'Find sources',
  toolCallId: 'task-1',
  status: 'complete',
  messages: [
    {
      id: 'u',
      role: 'user',
      content: 'Find sources',
      delivery: completeDelivery('g', 'success'),
    },
    {
      id: 'a',
      role: 'assistant',
      content: 'Found two',
      reasoning: 'Looking',
      toolCallIds: ['search-1', 'missing'],
      delivery: completeDelivery('g', 'success'),
    },
    {
      id: 'empty',
      role: 'assistant',
      content: '',
      delivery: completeDelivery('g', 'success'),
    },
  ],
  toolCalls: [
    {
      id: 'search-1',
      name: 'search',
      args: { q: 'sources' },
      status: 'complete',
      result: { hits: 2 },
    },
  ],
  ...over,
});

describe('sessionSubagents', () => {
  it('builds card data from a core child agent', () => {
    const [card] = sessionSubagents([child()], {
      toolLabel: (name) => (name === 'search' ? 'Searching' : undefined),
    });
    expect(card).toMatchObject({
      id: 'c',
      name: 'researcher',
      description: 'Find sources',
      toolCallId: 'task-1',
      status: 'complete',
    });
    // Only the child's own answers are shown; an empty one adds nothing.
    expect(card.messages).toHaveLength(1);
    expect(card.messages[0]).toMatchObject({
      id: 'a',
      text: 'Found two',
      reasoning: 'Looking',
    });
    // A call the child does not list is skipped, not invented.
    expect(card.messages[0].activities).toEqual([
      expect.objectContaining({
        id: 'search-1',
        name: 'search',
        label: 'Searching',
        phase: 'complete',
        resultText: JSON.stringify({ hits: 2 }, null, 2),
      }),
    ]);
  });

  it('carries a failure as the card summary and omits absent fields', () => {
    const [card] = sessionSubagents([
      {
        id: 'x',
        status: 'error',
        error: 'It failed',
        messages: [],
        toolCalls: [],
      },
    ]);
    expect(card).toEqual({
      id: 'x',
      status: 'error',
      messages: [],
      errorSummary: 'It failed',
    });
  });

  it('keeps references while a child and the callbacks are unchanged', () => {
    const first = child();
    const second = child({ id: 'd' });
    const toolLabel = vi.fn(() => undefined);
    const children = [first, second];
    const cards = sessionSubagents(children, { toolLabel });
    expect(sessionSubagents(children, { toolLabel })).toBe(cards);
    // A new list with one changed child keeps the other child's card.
    const next = sessionSubagents(
      [first, child({ id: 'd', status: 'error' })],
      {
        toolLabel,
      }
    );
    expect(next).not.toBe(cards);
    expect(next[0]).toBe(cards[0]);
    expect(next[1]).not.toBe(cards[1]);
    // A different callback rebuilds, so a stale label is never shown.
    expect(
      sessionSubagents(children, { toolLabel: () => 'Other' })[0]
    ).not.toBe(cards[0]);
  });

  it('contains a throwing outcome callback', () => {
    const [card] = sessionSubagents([child()], {
      toolOutcome: () => {
        throw new Error('app bug');
      },
    });
    expect(card.messages[0].activities?.[0].phase).toBe('complete');
  });
});
