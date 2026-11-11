import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  completeDelivery,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import { createMessageContent } from '@threadplane/content/messages';
import { MessageList, type MessageListProps } from './index';

afterEach(cleanup);

type Calls = AgentSnapshot['toolCalls'];
const call = (id: string, name: string, extra: object = {}) => ({
  id,
  name,
  args: { query: id },
  status: 'complete',
  result: `${id} result`,
  ...extra,
});
function project(calls: readonly ReturnType<typeof call>[]) {
  const message: Message = {
    id: 'a',
    role: 'assistant',
    content: 'Answer',
    delivery: completeDelivery('success'),
    toolCallIds: calls.map((item) => item.id),
  };
  return createMessageContent().project({
    status: 'idle',
    messages: [message],
    toolCalls: calls as unknown as Calls,
  });
}
/** Direct children of the message's after-content region that belong to tools, in DOM order. */
const sequence = (container: HTMLElement) =>
  [
    ...container.querySelectorAll(
      '.tp-chat-tool-call, .tp-tool-activity-group, .tp-tool-activity'
    ),
  ]
    .filter(
      (el) =>
        !el.parentElement?.closest('.tp-tool-activity-group, .tp-chat-tool-call')
    )
    .map((el) =>
      el.classList.contains('tp-chat-tool-call')
        ? `custom:${el.getAttribute('data-tool-id')}`
        : el.classList.contains('tp-tool-activity-group')
        ? `group:${[...el.querySelectorAll('.tp-tool-activity')]
            .map((row) => row.getAttribute('data-tool-id'))
            .join(',')}`
        : `row:${el.getAttribute('data-tool-id')}`
    );
const weather: NonNullable<MessageListProps['renderToolCall']> = (item) =>
  item.name === 'weather' ? <p>Weather card {item.id}</p> : undefined;

describe('MessageList renderToolCall', () => {
  it('replaces only the calls it returns content for and keeps the rest built in', () => {
    const rows = project([call('c0', 'lookup'), call('c1', 'weather')]);
    const view = render(<MessageList rows={rows} renderToolCall={weather} />);
    expect(sequence(view.container)).toEqual(['group:c0', 'custom:c1']);
    const card = view.getByText('Weather card c1');
    expect(card.parentElement?.className).toBe('tp-chat-tool-call');
    // The replaced call has no built-in row, Details or summary of its own.
    expect(
      view.container.querySelectorAll('.tp-tool-activity[data-tool-id="c1"]')
    ).toHaveLength(0);
    expect(view.getByText('Used 1 tool')).toBeTruthy();
  });

  it('passes the projected call and its resolved activity', () => {
    const rows = project([
      call('c0', 'weather', { args: { city: 'Lyon' }, result: { high: 21 } }),
    ]);
    const seen: unknown[] = [];
    render(
      <MessageList
        rows={rows}
        toolLabel={() => 'Checking the weather'}
        renderToolCall={(item, activity) => {
          seen.push([item, activity]);
          return null;
        }}
      />
    );
    expect(seen).toHaveLength(1);
    const [item, activity] = seen[0] as [
      (typeof rows)[number]['toolCalls'][number],
      { id: string; label?: string; phase?: string; resultText?: string }
    ];
    expect(item).toBe(rows[0].toolCalls[0]);
    expect(item.args).toEqual({ city: 'Lyon' });
    expect(activity).toMatchObject({
      id: 'c0',
      name: 'weather',
      label: 'Checking the weather',
      phase: 'complete',
    });
    expect(activity.resultText).toContain('21');
  });

  it('keeps transcript order by splitting built-in runs around a replaced call', () => {
    const rows = project([
      call('c0', 'lookup'),
      call('c1', 'weather'),
      call('c2', 'lookup'),
      call('c3', 'save'),
    ]);
    const view = render(<MessageList rows={rows} renderToolCall={weather} />);
    expect(sequence(view.container)).toEqual([
      'group:c0',
      'custom:c1',
      'group:c2,c3',
    ]);
    view.rerender(
      <MessageList
        rows={rows}
        renderToolCall={weather}
        groupRelatedTools={false}
      />
    );
    expect(sequence(view.container)).toEqual([
      'row:c0',
      'custom:c1',
      'row:c2',
      'row:c3',
    ]);
  });

  it('shows nothing for null or false and falls back only for undefined', () => {
    const rows = project([
      call('c0', 'hidden'),
      call('c1', 'off'),
      call('c2', 'lookup'),
    ]);
    const view = render(
      <MessageList
        rows={rows}
        renderToolCall={(item) =>
          item.name === 'hidden' ? null : item.name === 'off' ? false : undefined
        }
      />
    );
    expect(sequence(view.container)).toEqual(['group:c2']);
    expect(view.container.querySelectorAll('[data-tool-id]')).toHaveLength(1);
  });

  it('withholds result content, previews and retry from a replaced call', () => {
    const rows = project([
      call('c0', 'weather'),
      call('c1', 'lookup'),
    ]);
    const onToolRetry = vi.fn();
    const results: string[] = [];
    const view = render(
      <MessageList
        rows={rows}
        renderToolCall={weather}
        toolOutcome={() => ({
          status: 'failed',
          text: 'Could not finish.',
          retry: { label: 'Try again' },
        })}
        renderToolResult={(activity) => {
          results.push(activity.id);
          return <span>Result for {activity.id}</span>;
        }}
        onToolRetry={onToolRetry}
      />
    );
    expect(new Set(results)).toEqual(new Set(['c1']));
    expect(view.queryByText('Result for c0')).toBeNull();
    const retries = view.getAllByRole('button', { name: 'Try again' });
    expect(retries).toHaveLength(1);
    fireEvent.click(retries[0]);
    expect(onToolRetry.mock.calls.map(([activity]) => activity.id)).toEqual([
      'c1',
    ]);
  });

  it('keeps app content interactive and mounted across a rerender with the same rows', () => {
    const rows = project([call('c0', 'weather')]);
    const press = vi.fn();
    const renderToolCall: MessageListProps['renderToolCall'] = (item) => (
      <button type="button" onClick={() => press(item.id)}>
        Open {item.name}
      </button>
    );
    const view = render(
      <MessageList rows={rows} renderToolCall={renderToolCall} />
    );
    const button = view.getByRole('button', { name: 'Open weather' });
    view.rerender(
      <MessageList rows={rows} renderToolCall={renderToolCall} label="Trip" />
    );
    expect(view.getByRole('button', { name: 'Open weather' })).toBe(button);
    fireEvent.click(button);
    expect(press.mock.calls).toEqual([['c0']]);
  });

  it('is not consulted when renderMessage owns the row', () => {
    const rows = project([call('c0', 'weather')]);
    const renderToolCall = vi.fn();
    const view = render(
      <MessageList
        rows={rows}
        renderMessage={(row) => <p>Owned {row.id}</p>}
        renderToolCall={renderToolCall}
      />
    );
    expect(view.getByText('Owned a')).toBeTruthy();
    expect(renderToolCall).not.toHaveBeenCalled();
  });

  it('server renders the app content in place of the built-in row', () => {
    const rows = project([call('c0', 'lookup'), call('c1', 'weather')]);
    const html = renderToString(
      <MessageList rows={rows} renderToolCall={weather} />
    );
    expect(html).toContain('Weather card');
    expect(html.indexOf('data-tool-id="c0"')).toBeLessThan(
      html.indexOf('tp-chat-tool-call')
    );
  });
});
