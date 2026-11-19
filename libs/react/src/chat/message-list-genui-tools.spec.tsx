import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  completeDelivery,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import { createMessageContent } from '@threadplane/content/messages';
import { MessageList } from './index';

afterEach(cleanup);

type Calls = AgentSnapshot['toolCalls'];
const call = (id: string, name: string) => ({
  id,
  name,
  args: { query: id },
  status: 'complete',
  result: `${id} result`,
});
function project(names: readonly string[], withToolRows = false) {
  const calls = names.map((name, i) => call(`c${i}`, name));
  const messages: Message[] = [
    {
      id: 'a',
      role: 'assistant',
      content: 'Answer',
      delivery: completeDelivery('g', 'success'),
      toolCallIds: calls.map((item) => item.id),
    },
    ...(withToolRows
      ? calls.map(
          (item): Message => ({
            id: `t-${item.id}`,
            role: 'tool',
            content: `literal ${item.id}`,
            delivery: completeDelivery(`t-${item.id}`, 'success'),
            toolCallId: item.id,
          })
        )
      : []),
  ];
  return createMessageContent().project({
    status: 'idle',
    messages,
    toolCalls: calls as unknown as Calls,
  });
}
const toolIds = (container: HTMLElement) =>
  [...container.querySelectorAll('.tp-tool-activity')].map((el) =>
    el.getAttribute('data-tool-id')
  );

describe('MessageList generative UI dispatcher tools', () => {
  it.each(['generate_a2ui_schema', 'generate_json_render_spec', 'render_spec'])(
    'hides the %s call by default',
    (name) => {
      const view = render(<MessageList rows={project([name])} />);
      expect(toolIds(view.container)).toEqual([]);
      expect(view.container.textContent).not.toContain(name);
      expect(view.queryByText(/Used 1 tool/)).toBeNull();
    }
  );

  it('leaves other tools alone and counts only the visible ones in the group', () => {
    const view = render(
      <MessageList rows={project(['lookup', 'render_spec', 'search'])} />
    );
    expect(toolIds(view.container)).toEqual(['c0', 'c2']);
    expect(view.getByText('Used 2 tools')).toBeTruthy();
  });

  it('hides the tool rows that answer a hidden call', () => {
    const view = render(
      <MessageList rows={project(['render_spec', 'lookup'], true)} />
    );
    expect(view.container.textContent).not.toContain('literal c0');
    expect(toolIds(view.container)).toEqual(['c1']);
  });

  it('hides the names given to genuiToolNames instead of the defaults', () => {
    const view = render(
      <MessageList
        rows={project(['render_spec', 'my_dispatcher'])}
        genuiToolNames={['my_dispatcher']}
      />
    );
    expect(toolIds(view.container)).toEqual(['c0']);
  });

  it('shows every call when genuiToolNames is empty', () => {
    const view = render(
      <MessageList rows={project(['render_spec'])} genuiToolNames={[]} />
    );
    expect(toolIds(view.container)).toEqual(['c0']);
  });

  it('keeps a hidden call visible to a custom renderMessage', () => {
    const seen: string[] = [];
    render(
      <MessageList
        rows={project(['render_spec'])}
        renderMessage={(row) => {
          seen.push(...row.toolCalls.map((item) => item.name));
          return null;
        }}
      />
    );
    expect(seen).toEqual(['render_spec']);
  });
});
