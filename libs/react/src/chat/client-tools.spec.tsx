import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  completeDelivery,
  type AgentSession,
  type AgentSnapshot,
} from '@threadplane/core';
import { createMessageContent } from '@threadplane/content/messages';
import {
  Chat,
  MessageList,
  ask,
  createClientTools,
  useClientToolCalls,
  type ChatClientTools,
  type MessageListProps,
} from './index';

afterEach(cleanup);

type Calls = AgentSnapshot['toolCalls'];
interface DayArgs {
  days: string[];
}
function dayTools() {
  return createClientTools({
    pick_day: ask<DayArgs, { day: string }>({
      description: 'Ask which day to plan.',
      parameters: { type: 'object' },
      render: ({ args, answer, toolCallId }) => (
        <div data-ask={toolCallId}>
          {args.days.map((day) => (
            <button key={day} type="button" onClick={() => answer({ day })}>
              {day}
            </button>
          ))}
        </div>
      ),
    }),
  });
}
const running = (id: string, days: string[], name = 'pick_day') => ({
  id,
  name,
  args: { days },
  status: 'running',
});
const transcript = (calls: readonly object[], status = 'running') =>
  ({
    status,
    messages: [
      {
        id: 'a',
        role: 'assistant',
        content: 'Which day?',
        delivery: completeDelivery('g', 'success'),
        toolCallIds: (calls as { id: string }[]).map((call) => call.id),
      },
    ],
    toolCalls: calls as unknown as Calls,
  } as AgentSnapshot);

function fakeSession(initial: AgentSnapshot) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const raw = {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    submit: vi.fn(async () => 'success' as const),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const set = (next: AgentSnapshot) => {
    snapshot = next;
    act(() => listeners.forEach((notify) => notify()));
  };
  return { session: raw as unknown as AgentSession, set };
}
/** Starts a handler the way a session does, and reports how it settles. */
function start(
  tools: ReturnType<typeof dayTools>,
  days: string[],
  signal = new AbortController().signal
) {
  const settled = vi.fn();
  const failed = vi.fn();
  act(() => {
    void Promise.resolve(
      tools.tools.pick_day.handler({ days }, { signal })
    ).then(settled, failed);
  });
  return { settled, failed };
}
const flush = () => act(async () => undefined);

describe('createClientTools', () => {
  it('exposes each ask tool to the session as a function tool with its metadata', () => {
    const tools = createClientTools({
      pick_day: ask<DayArgs, { day: string }>({
        description: 'Ask which day to plan.',
        parameters: { type: 'object' },
        followUp: false,
        render: () => null,
      }),
    });
    expect(Object.keys(tools.tools)).toEqual(['pick_day']);
    expect(tools.tools.pick_day).toMatchObject({
      description: 'Ask which day to plan.',
      parameters: { type: 'object' },
      followUp: false,
    });
    expect(tools.tools.pick_day).not.toHaveProperty('render');
  });

  it('keeps a call waiting until the first answer, which becomes the tool result', async () => {
    const tools = dayTools();
    const notify = vi.fn();
    tools.subscribe(notify);
    const call = start(tools, ['Mon', 'Tue']);
    expect(tools.getSnapshot()).toEqual([
      { name: 'pick_day', args: { days: ['Mon', 'Tue'] } },
    ]);
    expect(notify).toHaveBeenCalledTimes(1);
    await flush();
    expect(call.settled).not.toHaveBeenCalled();

    const { container } = render(
      <>{tools.render(running('c1', ['Mon', 'Tue']))}</>
    );
    const [monday, tuesday] = container.querySelectorAll('button');
    fireEvent.click(tuesday);
    fireEvent.click(monday);
    await flush();
    expect(call.settled).toHaveBeenCalledTimes(1);
    expect(call.settled).toHaveBeenCalledWith({ day: 'Tue' });
    expect(tools.getSnapshot()).toEqual([]);
    expect(notify).toHaveBeenCalledTimes(2);
    // The answered call has no view any more, even while the session still reports it running.
    expect(tools.render(running('c1', ['Mon', 'Tue']))).toBeUndefined();
  });

  it('rejects a waiting call when its signal aborts and ignores a late answer', async () => {
    const tools = dayTools();
    const stop = new AbortController();
    const call = start(tools, ['Mon'], stop.signal);
    const { container } = render(<>{tools.render(running('c1', ['Mon']))}</>);
    act(() => stop.abort());
    await flush();
    expect(call.failed).toHaveBeenCalledTimes(1);
    expect(call.failed.mock.calls[0][0]).toMatchObject({ name: 'AbortError' });
    expect(tools.getSnapshot()).toEqual([]);
    fireEvent.click(container.querySelector('button') as HTMLElement);
    await flush();
    expect(call.settled).not.toHaveBeenCalled();

    const late = start(tools, ['Mon'], stop.signal);
    await flush();
    expect(late.failed).toHaveBeenCalledTimes(1);
    expect(tools.getSnapshot()).toEqual([]);
  });

  it('pairs parallel calls by their arguments and keeps each pairing', async () => {
    const tools = dayTools();
    const first = start(tools, ['Mon']);
    const second = start(tools, ['Tue']);
    // The transcript lists them in the other order.
    const view = () =>
      render(
        <>
          {tools.render(running('c2', ['Tue']))}
          {tools.render(running('c1', ['Mon']))}
        </>
      ).container;
    expect(
      [...view().querySelectorAll('[data-ask]')].map(
        (el) => `${el.getAttribute('data-ask')}:${el.textContent}`
      )
    ).toEqual(['c2:Tue', 'c1:Mon']);
    cleanup();
    fireEvent.click(
      view().querySelector('[data-ask="c1"] button') as HTMLElement
    );
    await flush();
    expect(first.settled).toHaveBeenCalledWith({ day: 'Mon' });
    expect(second.settled).not.toHaveBeenCalled();
    expect(tools.render(running('c2', ['Tue']))).toBeDefined();
  });

  it('gives identical calls one waiting handler each', async () => {
    const tools = dayTools();
    const first = start(tools, ['Mon']);
    const second = start(tools, ['Mon']);
    const { container } = render(
      <>
        {tools.render(running('c1', ['Mon']))}
        {tools.render(running('c2', ['Mon']))}
        {tools.render(running('c3', ['Mon']))}
      </>
    );
    expect(container.querySelectorAll('[data-ask]')).toHaveLength(2);
    fireEvent.click(
      container.querySelector('[data-ask="c2"] button') as HTMLElement
    );
    await flush();
    expect(
      first.settled.mock.calls.length + second.settled.mock.calls.length
    ).toBe(1);
  });

  it('draws nothing for other tools, settled calls, or a call with no handler waiting', () => {
    const tools = dayTools();
    expect(tools.render(running('c1', ['Mon']))).toBeUndefined();
    start(tools, ['Mon']);
    expect(tools.render(running('c1', ['Mon'], 'lookup'))).toBeUndefined();
    expect(
      tools.render({ ...running('c1', ['Mon']), status: 'complete' })
    ).toBeUndefined();
    expect(
      tools.render({ ...running('c1', ['Mon']), status: 'error' })
    ).toBeUndefined();
    expect(tools.render(running('c1', ['Mon']))).toBeDefined();
  });
});

describe('Chat clientTools', () => {
  it('shows a waiting ask below the call, which keeps its row, and returns the answer', async () => {
    const tools = dayTools();
    const { session, set } = fakeSession(
      transcript([running('c1', ['Mon', 'Tue'])])
    );
    const { container } = render(
      <Chat session={session} clientTools={tools} />
    );
    // The session reports the call before its handler starts: only the built-in row shows.
    expect(container.querySelector('[data-ask]')).toBeNull();
    const row = container.querySelector('.tp-tool-activity');
    expect(row).not.toBeNull();

    const call = start(tools, ['Mon', 'Tue']);
    const card = container.querySelector(
      '.tp-chat-tool-call[data-tool-prompt="c1"] [data-ask="c1"]'
    );
    expect(card).not.toBeNull();
    // The call keeps its row, and the view follows it.
    expect(container.querySelector('.tp-tool-activity')).toBe(row);
    expect(
      (row as Element).compareDocumentPosition(card as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    const button = card?.querySelectorAll('button')[1] as HTMLElement;
    button.focus();
    fireEvent.click(button);
    await flush();
    expect(call.settled).toHaveBeenCalledWith({ day: 'Tue' });
    expect(container.querySelector('[data-ask]')).toBeNull();
    expect(container.querySelector('.tp-tool-activity')).not.toBeNull();
    expect(document.activeElement).toBe(container.querySelector('textarea'));

    set(
      transcript(
        [
          {
            ...running('c1', ['Mon', 'Tue']),
            status: 'complete',
            result: { day: 'Tue' },
          },
        ],
        'idle'
      )
    );
    expect(container.querySelector('[data-ask]')).toBeNull();
    expect(container.querySelector('.tp-tool-activity')).not.toBeNull();
  });

  it('adds a waiting ask without taking any call from renderToolCall', () => {
    const tools = dayTools();
    const { session } = fakeSession(
      transcript([running('c1', ['Mon']), running('c2', ['x'], 'lookup')])
    );
    const renderToolCall: NonNullable<MessageListProps['renderToolCall']> = (
      call
    ) => <p data-app={call.id}>App view</p>;
    const { container } = render(
      <Chat
        session={session}
        clientTools={tools}
        renderToolCall={renderToolCall}
      />
    );
    expect(
      [...container.querySelectorAll('[data-app]')].map((el) =>
        el.getAttribute('data-app')
      )
    ).toEqual(['c1', 'c2']);
    start(tools, ['Mon']);
    expect(container.querySelector('[data-ask="c1"]')).not.toBeNull();
    expect(
      [...container.querySelectorAll('[data-app]')].map((el) =>
        el.getAttribute('data-app')
      )
    ).toEqual(['c1', 'c2']);
  });

  it('keeps the waiting call in its running group, with the ask after the group', () => {
    const tools = dayTools();
    const { session } = fakeSession(
      transcript([
        { ...running('c0', ['x'], 'lookup'), status: 'complete', result: 1 },
        running('c1', ['Mon']),
        { ...running('c2', ['y'], 'lookup'), status: 'complete', result: 2 },
      ])
    );
    const { container } = render(
      <Chat session={session} clientTools={tools} />
    );
    start(tools, ['Mon']);
    const groups = container.querySelectorAll('.tp-tool-activity-group');
    expect(groups).toHaveLength(1);
    expect(groups[0].getAttribute('data-active')).toBe('true');
    const ask = container.querySelector('[data-ask="c1"]') as Element;
    expect(groups[0].contains(ask)).toBe(false);
    expect(
      groups[0].compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('shows no ask without the clientTools prop, even while a handler waits', () => {
    const tools = dayTools();
    const { session } = fakeSession(transcript([running('c1', ['Mon'])]));
    const { container } = render(<Chat session={session} />);
    start(tools, ['Mon']);
    expect(container.querySelector('[data-ask]')).toBeNull();
    expect(container.querySelector('.tp-tool-activity')).not.toBeNull();
  });

  it('moves focus to the next waiting ask when one of several is answered', async () => {
    const tools = dayTools();
    const calls = [running('c1', ['Mon']), running('c2', ['Tue'])];
    const { session } = fakeSession(transcript(calls));
    const { container } = render(
      <Chat session={session} clientTools={tools} />
    );
    start(tools, ['Mon']);
    start(tools, ['Tue']);
    const first = container.querySelector(
      '[data-ask="c1"] button'
    ) as HTMLElement;
    first.focus();
    fireEvent.click(first);
    await flush();
    expect(container.querySelector('[data-ask="c1"]')).toBeNull();
    // The answered button is gone; the remaining question takes over, not the page.
    expect(document.activeElement).toBe(
      container.querySelector('[data-ask="c2"] button')
    );
  });

  it('leaves focus alone when it is elsewhere as one of several asks is answered', async () => {
    const tools = dayTools();
    const calls = [running('c1', ['Mon']), running('c2', ['Tue'])];
    const { session } = fakeSession(transcript(calls));
    const { container } = render(
      <>
        <input aria-label="Elsewhere" />
        <Chat session={session} clientTools={tools} />
      </>
    );
    start(tools, ['Mon']);
    start(tools, ['Tue']);
    const elsewhere = container.querySelector('input') as HTMLElement;
    elsewhere.focus();
    fireEvent.click(
      container.querySelector('[data-ask="c1"] button') as HTMLElement
    );
    await flush();
    expect(container.querySelector('[data-ask="c2"]')).not.toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('removes the ask when the run is stopped', async () => {
    const tools = dayTools();
    const stop = new AbortController();
    const { session } = fakeSession(transcript([running('c1', ['Mon'])]));
    const { container } = render(
      <Chat session={session} clientTools={tools} />
    );
    const call = start(tools, ['Mon'], stop.signal);
    expect(container.querySelector('[data-ask="c1"]')).not.toBeNull();
    act(() => stop.abort());
    await flush();
    expect(call.failed).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-ask]')).toBeNull();
  });
});

describe('useClientToolCalls', () => {
  function List({ tools }: { readonly tools?: ChatClientTools }) {
    const rows = createMessageContent().project(
      transcript([running('c1', ['Mon'])])
    );
    return (
      <MessageList
        rows={rows}
        renderToolCallPrompt={useClientToolCalls(tools)}
      />
    );
  }
  it('lets MessageList draw a waiting ask and re-renders when it starts', () => {
    const tools = dayTools();
    const { container } = render(<List tools={tools} />);
    expect(container.querySelector('[data-ask]')).toBeNull();
    start(tools, ['Mon']);
    expect(container.querySelector('[data-ask="c1"]')).not.toBeNull();
  });
  it('renders a waiting ask on the server', () => {
    const tools = dayTools();
    void tools.tools.pick_day.handler(
      { days: ['Mon'] },
      { signal: new AbortController().signal }
    );
    expect(renderToString(<List tools={tools} />)).toContain('data-ask="c1"');
  });
  it('is inert without client tools', () => {
    const { container } = render(<List />);
    expect(container.querySelector('.tp-tool-activity')).not.toBeNull();
  });
});
