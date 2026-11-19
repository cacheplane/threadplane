import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentSnapshot } from '@threadplane/core';
import { createMessageContent } from '@threadplane/content/messages';
import { MessageList } from './index';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Only integration tests compose the actual private native owner.
import {
  projectMessages,
  projectToolCalls,
} from '../../../ag-ui/src/runtime/message-projection';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Only integration tests compose the actual private native owner.
import {
  initialObservation,
  type Observation,
} from '../../../ag-ui/src/runtime/session-observation';

afterEach(cleanup);

const native = (extra: Partial<Observation> = {}): Observation =>
  Object.freeze({
    ...initialObservation([
      { id: 'u', role: 'user', content: 'Ask' },
      { id: 'r1', role: 'reasoning', content: 'Plan the search.' },
      {
        id: 'a1',
        role: 'assistant',
        toolCalls: [
          {
            id: 'call',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"tea"}' },
          },
        ],
      },
      { id: 't', role: 'tool', content: 'Result', toolCallId: 'call' },
      { id: 'r2', role: 'reasoning', content: 'Compare the sources.' },
      { id: 'a2', role: 'assistant', content: 'The answer is 42.' },
    ]),
    ...extra,
  });
function rows(snapshot: Observation) {
  const content = createMessageContent();
  const core: AgentSnapshot = {
    status: snapshot.status,
    messages: projectMessages(snapshot),
    toolCalls: projectToolCalls(snapshot),
  };
  return { content, rows: content.project(core) };
}

describe('MessageList over projected AG-UI messages', () => {
  it('shows a multi-step turn as one reasoning disclosure with the measured time', () => {
    const view = rows(
      native({ reasoningDurations: { r1: 1_200, r2: 3_100 } })
    );
    const { container } = render(<MessageList rows={view.rows} />);
    const toggles = container.querySelectorAll('.tp-reasoning__toggle');
    expect(toggles).toHaveLength(1);
    expect(toggles[0].textContent).toMatch(/Thought for 4s · 2 steps$/);
    expect(container.textContent).toContain('The answer is 42.');
    expect(container.textContent).toContain('Ask');
    view.content.dispose();
  });

  it('labels restored reasoning without a time and running reasoning as in progress', () => {
    const restored = rows(native());
    const first = render(<MessageList rows={restored.rows} />);
    expect(
      first.container.querySelector('.tp-reasoning__toggle')?.textContent
    ).toMatch(/Thought in 2 steps$/);
    first.unmount();
    restored.content.dispose();
    const running = rows(native({ status: 'running' }));
    const second = render(<MessageList rows={running.rows} running />);
    expect(
      second.container.querySelector('.tp-reasoning__toggle')?.textContent
    ).toMatch(/Thinking…$/);
    running.content.dispose();
  });

  it('gives the step that called a tool its call, arguments and result', () => {
    const seen: unknown[] = [];
    const view = rows(native());
    const { container } = render(
      <MessageList
        rows={view.rows}
        renderToolCall={(call) => {
          seen.push(call);
          return <span data-testid="call">{call.name}</span>;
        }}
      />
    );
    expect(seen[0]).toEqual({
      id: 'call',
      name: 'search',
      args: { q: 'tea' },
      status: 'complete',
      result: 'Result',
    });
    expect(
      container.querySelectorAll('[data-testid="call"]').length
    ).toBeGreaterThan(0);
    // The tool record is a row of its own, linked to the same call.
    expect(view.rows.map((row) => row.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(view.rows[2].toolCalls).toEqual(view.rows[1].toolCalls);
    view.content.dispose();
    // A call still waiting for its result while the session runs.
    const waiting = native({ status: 'running' });
    const running = rows(
      Object.freeze({ ...waiting, transcript: waiting.transcript.slice(0, 3) })
    );
    expect(running.rows[1].toolCalls).toEqual([
      { id: 'call', name: 'search', args: { q: 'tea' }, status: 'running' },
    ]);
    running.content.dispose();
  });
});
