import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentSnapshot } from '@threadplane/core';
import { createMessageContent } from '@threadplane/content/messages';
import { MessageList } from './index';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Only integration tests compose the actual private native owner.
import { projectMessages } from '../../../ag-ui/src/runtime/message-projection';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Only integration tests compose the actual private native owner.
import {
  initialObservation,
  type SessionSnapshot,
} from '../../../ag-ui/src/runtime/session-observation';

afterEach(cleanup);

const native = (extra: Partial<SessionSnapshot> = {}): SessionSnapshot =>
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
            function: { name: 'search', arguments: '{}' },
          },
        ],
      },
      { id: 't', role: 'tool', content: 'Result', toolCallId: 'call' },
      { id: 'r2', role: 'reasoning', content: 'Compare the sources.' },
      { id: 'a2', role: 'assistant', content: 'The answer is 42.' },
    ]),
    ...extra,
  });
function rows(snapshot: SessionSnapshot) {
  const content = createMessageContent();
  const core: AgentSnapshot = {
    status: snapshot.status,
    messages: projectMessages(snapshot),
    toolCalls: [],
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
});
