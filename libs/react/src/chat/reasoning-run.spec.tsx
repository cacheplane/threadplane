import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  completeDelivery,
  streamingDelivery,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import { createMarkdown } from '@threadplane/content/markdown';
import { createMessageContent } from '@threadplane/content/messages';
import { MessageList, Reasoning } from './index';

afterEach(cleanup);

const msg = (id: string, extra: Partial<Message> = {}): Message =>
  Object.freeze({
    id,
    role: 'assistant',
    content: '',
    delivery: completeDelivery(id, 'success'),
    ...extra,
  }) as Message;
const snap = (messages: readonly Message[]): AgentSnapshot =>
  Object.freeze({
    status: 'idle',
    messages: Object.freeze([...messages]),
    toolCalls: Object.freeze([]),
  }) as AgentSnapshot;
const turn = (last: Partial<Message> = {}) => [
  msg('u', { role: 'user', content: 'Ask' }),
  msg('a', { reasoning: 'Plan', reasoningDurationMs: 1000 }),
  msg('t', { role: 'tool', content: 'result' }),
  msg('b', {
    reasoning: 'Check',
    reasoningDurationMs: 3200,
    content: 'Answer',
    ...last,
  }),
];
const toggles = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.tp-reasoning__toggle')).map(
    (button) => button.textContent?.replace(/^[▸▾]\s*/, '')
  );

describe('Reasoning steps', () => {
  const document = createMarkdown(
    { generation: 'g', phase: 'complete', content: 'Why' },
    { violationPolicy: 'rebuild' }
  ).getSnapshot();
  it.each([
    [{ steps: 3, durationMs: 4200 }, 'Thought for 4s · 3 steps'],
    [{ steps: 3 }, 'Thought in 3 steps'],
    [{ steps: 1, durationMs: 4200 }, 'Thought for 4s'],
    [{ steps: 1 }, 'Show reasoning'],
    [{ steps: Number.NaN }, 'Show reasoning'],
    [{ steps: 2, label: 'Analysis' }, 'Analysis'],
  ])('labels %j as %s', (props, label) => {
    const view = render(<Reasoning snapshot={document} {...props} />);
    expect(view.getByRole('button', { name: label })).toBeTruthy();
  });
  it('says Thinking while a multi-step document streams', () => {
    const streaming = createMarkdown(
      { generation: 'g', phase: 'streaming', content: 'Why' },
      { violationPolicy: 'rebuild' }
    ).getSnapshot();
    const view = render(
      <Reasoning snapshot={streaming} steps={2} durationMs={1000} />
    );
    expect(view.getByRole('button', { name: 'Thinking…' })).toBeTruthy();
  });
});

describe('MessageList reasoning runs', () => {
  it('shows one disclosure for a multi-step turn, on its first step', () => {
    const content = createMessageContent();
    const view = render(<MessageList rows={content.project(snap(turn()))} />);
    expect(toggles(view.container)).toEqual(['Thought for 4s · 2 steps']);
    const first = view.container.querySelectorAll('article')[1];
    expect(first.querySelector('.tp-reasoning')).toBeTruthy();
    fireEvent.click(
      view.getByRole('button', { name: 'Thought for 4s · 2 steps' })
    );
    const body = view.getByRole('region', { name: 'Reasoning' });
    expect(
      Array.from(body.querySelectorAll('p')).map((node) => node.textContent)
    ).toEqual(['Plan', 'Check']);
    content.dispose();
  });

  it('shows the duration of a single step and no count', () => {
    const content = createMessageContent();
    const view = render(
      <MessageList
        rows={content.project(
          snap([msg('a', { reasoning: 'Plan', reasoningDurationMs: 61000 })])
        )}
      />
    );
    expect(toggles(view.container)).toEqual(['Thought for 1m 1s']);
    content.dispose();
  });

  it('opens while a later step streams and keeps the joined text', () => {
    const content = createMessageContent();
    const view = render(
      <MessageList
        rows={content.project(
          snap(
            turn({
              reasoning: 'Che',
              reasoningDurationMs: undefined,
              content: '',
              delivery: streamingDelivery('b'),
            })
          )
        )}
      />
    );
    expect(toggles(view.container)).toEqual(['Thinking…']);
    expect(view.getByRole('region', { name: 'Reasoning' }).textContent).toBe(
      'PlanChe'
    );
    view.rerender(<MessageList rows={content.project(snap(turn()))} />);
    expect(toggles(view.container)).toEqual(['Thought for 4s · 2 steps']);
    content.dispose();
  });

  it('shows each step on its own message when merging is off', () => {
    const content = createMessageContent();
    const view = render(
      <MessageList
        rows={content.project(snap(turn()))}
        mergeReasoning={false}
      />
    );
    expect(toggles(view.container)).toEqual([
      'Thought for 1s',
      'Thought for 3s',
    ]);
    content.dispose();
  });
});
