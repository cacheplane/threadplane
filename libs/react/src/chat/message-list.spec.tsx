import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { subagentsFromEvidence } from './subagent-evidence.js';
import { renderToString } from 'react-dom/server';
import {
  streamingDelivery,
  completeDelivery,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import {
  createMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';
import {
  MessageList,
  type MessageListScrollControls,
  type MessageListRowContext,
  type ChatMessageRole,
} from './index';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const msg = (
  id: string,
  content: string,
  extra: Partial<Message> = {}
): Message =>
  Object.freeze({
    id,
    role: 'assistant',
    content,
    delivery: streamingDelivery('g'),
    ...extra,
  }) as Message;
const snap = (
  messages: Message[],
  toolCalls: AgentSnapshot['toolCalls'] = []
): AgentSnapshot =>
  Object.freeze({ status: 'idle', messages, toolCalls }) as AgentSnapshot;

describe('MessageList', () => {
  it('derives default previous-role attributes from supplied projected rows, including mismatched payload roles', () => {
    const content = createMessageContent();
    const base = content.project(
      snap(['a', 'b', 'c', 'd', 'e'].map((id) => msg(id, id)))
    );
    const roles = ['user', 'assistant', 'system', 'tool', 'user'] as const;
    const rows = base.map((row, index) =>
      Object.freeze({ ...row, role: roles[index] })
    );
    expect(rows[0].message.role).toBe('assistant');
    const view = render(<MessageList rows={rows} />);
    const articles = view.getAllByRole('article');
    expect(
      articles.map((article) => article.getAttribute('data-prev-role'))
    ).toEqual([null, 'user', 'assistant', 'system', 'tool']);
    expect(
      articles.map((article) => article.getAttribute('data-current'))
    ).toEqual(['false', 'false', 'false', 'false', 'true']);
    content.dispose();
  });
  it('updates positional previous roles across append, removal, reorder and immutable preceding-role replacement', () => {
    const content = createMessageContent();
    const [a, b, c] = content.project(
      snap([
        msg('a', 'A', { role: 'user' }),
        msg('b', 'B'),
        msg('c', 'C', { role: 'system' }),
      ])
    );
    const counts = new Map<string, number>();
    const retained: MessageListRowContext[] = [];
    const renderMessage = (row: MessageRow, context: MessageListRowContext) => {
      counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
      retained.push(context);
      return (
        <p
          data-testid={row.id}
          data-prev-role={context.prevRole}
          data-current={String(context.current)}
        >
          {row.id}
        </p>
      );
    };
    const view = render(
      <MessageList rows={[a, b]} renderMessage={renderMessage} />
    );
    const first = retained[0];
    const oldFinal = retained[1];
    expect(view.getByTestId('a').hasAttribute('data-prev-role')).toBe(false);
    expect(view.getByTestId('b').getAttribute('data-prev-role')).toBe('user');
    view.rerender(
      <MessageList rows={[a, b, c]} renderMessage={renderMessage} />
    );
    expect(counts.get('a')).toBe(1);
    expect(counts.get('b')).toBe(2);
    expect(view.getByTestId('b').getAttribute('data-current')).toBe('false');
    expect(view.getByTestId('c').getAttribute('data-prev-role')).toBe(
      'assistant'
    );
    view.rerender(<MessageList rows={[a, c]} renderMessage={renderMessage} />);
    expect(counts.get('a')).toBe(1);
    expect(view.getByTestId('c').getAttribute('data-prev-role')).toBe('user');
    view.rerender(<MessageList rows={[c, a]} renderMessage={renderMessage} />);
    expect(view.getByTestId('c').hasAttribute('data-prev-role')).toBe(false);
    expect(view.getByTestId('a').getAttribute('data-prev-role')).toBe('system');
    const replaced = Object.freeze({ ...c, role: 'tool' as const });
    view.rerender(
      <MessageList rows={[replaced, a]} renderMessage={renderMessage} />
    );
    expect(view.getByTestId('a').getAttribute('data-prev-role')).toBe('tool');
    expect(first).toEqual({ current: false, prevRole: undefined });
    expect(oldFinal).toEqual({ current: true, prevRole: 'user' });
    content.dispose();
  });
  it('reuses ten frozen contexts across rows and list instances without changing retained values', () => {
    const content = createMessageContent();
    const [preceding, target, trailing] = content.project(
      snap([msg('preceding', 'P'), msg('target', 'T'), msg('trailing', 'End')])
    );
    const contexts = new Map<string, MessageListRowContext>();
    const renderMessage = (row: MessageRow, context: MessageListRowContext) => {
      if (row.id !== 'target') return null;
      const key = `${context.current}/${context.prevRole}`;
      expect(Object.isFrozen(context)).toBe(true);
      expect(Object.keys(context).sort()).toEqual(['current', 'prevRole']);
      const previous = contexts.get(key);
      if (previous) expect(context).toBe(previous);
      else contexts.set(key, context);
      return null;
    };
    const roles: readonly (ChatMessageRole | undefined)[] = [
      undefined,
      'user',
      'assistant',
      'system',
      'tool',
    ];
    for (let pass = 0; pass < 2; pass++) {
      const view = render(
        <MessageList rows={[]} renderMessage={renderMessage} />
      );
      for (const current of [false, true]) {
        for (const role of roles) {
          const rows = [
            ...(role === undefined
              ? []
              : [Object.freeze({ ...preceding, role })]),
            target,
            ...(current ? [] : [trailing]),
          ];
          view.rerender(
            <MessageList rows={rows} renderMessage={renderMessage} />
          );
        }
      }
      view.unmount();
    }
    expect(contexts.size).toBe(10);
    expect(new Set(contexts.values()).size).toBe(10);
    for (const [key, context] of contexts)
      expect(`${context.current}/${context.prevRole}`).toBe(key);
    content.dispose();
  });
  it('groups built-in calls by default, including a single call, and honors explicit opt-out and custom rendering', () => {
    const content = createMessageContent();
    const project = (count: number, withTrailingUser = false) =>
      content.project(
        snap(
          [
            msg('a', 'Answer', { toolCallIds: ['a', 'b'].slice(0, count) }),
            ...(withTrailingUser ? [msg('u', 'Next', { role: 'user' })] : []),
          ],
          [
            { id: 'a', name: 'lookup', args: {}, status: 'running' },
            {
              id: 'b',
              name: 'save',
              args: {},
              status: 'complete',
              result: false,
            },
          ].slice(0, count) as AgentSnapshot['toolCalls']
        )
      );
    const view = render(
      <MessageList rows={project(1)} toolLabel={() => 'Checking references'} />
    );
    const details = view.container.querySelector(
      '.tp-tool-activity-group__details'
    ) as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe(
      'Checking references'
    );
    details.open = true;
    view.rerender(
      <MessageList rows={project(2)} toolLabel={() => 'Checking references'} />
    );
    expect(
      view.container.querySelectorAll('.tp-tool-activity-group')
    ).toHaveLength(1);
    expect(
      view.container.querySelector('.tp-tool-activity-group__details')
    ).toBe(details);
    expect(details.open).toBe(true);
    expect(
      view.container.querySelectorAll('.tp-chat-message__caret')
    ).toHaveLength(1);
    view.rerender(
      <MessageList
        rows={project(2, true)}
        toolLabel={() => 'Checking references'}
      />
    );
    expect(
      view.container.querySelector('.tp-tool-activity-group__details')
    ).toBe(details);
    expect(details.open).toBe(true);
    expect(
      view
        .getByRole('article', { name: 'assistant message' })
        .getAttribute('data-current')
    ).toBe('false');
    expect(
      view.container.querySelectorAll('.tp-chat-message__caret')
    ).toHaveLength(0);
    view.rerender(<MessageList rows={project(2)} groupRelatedTools={false} />);
    expect(view.container.querySelector('.tp-tool-activity-group')).toBeNull();
    expect(view.container.querySelectorAll('.tp-tool-activity')).toHaveLength(
      2
    );
    view.rerender(
      <MessageList
        rows={project(2)}
        renderMessage={() => <button>Custom tools</button>}
      />
    );
    expect(
      view.container.querySelector('.tp-tool-activity,.tp-tool-activity-group')
    ).toBeNull();
    expect(view.getByRole('button', { name: 'Custom tools' })).toBeTruthy();
    content.dispose();
  });
  for (const outcome of [
    'success',
    'error',
    'aborted',
    'interrupted',
    'paused',
  ] as const) {
    it(`removes the current caret for complete delivery outcome ${outcome}`, () => {
      const content = createMessageContent();
      const view = render(
        <MessageList rows={content.project(snap([msg('a', 'Answer')]))} />
      );
      expect(
        view.container.querySelectorAll('.tp-chat-message__caret')
      ).toHaveLength(1);
      view.rerender(
        <MessageList
          rows={content.project(
            snap([
              msg('a', 'Answer', { delivery: completeDelivery('g', outcome) }),
            ])
          )}
        />
      );
      expect(
        view.container.querySelectorAll('.tp-chat-message__caret')
      ).toHaveLength(0);
      expect(view.getByRole('article').getAttribute('data-streaming')).toBe(
        'false'
      );
      content.dispose();
    });
  }
  it('tracks the final supplied row through append, removal and reorder without rerendering unchanged history', () => {
    const content = createMessageContent();
    const [a, b, c] = content.project(
      snap([msg('a', 'A'), msg('b', 'B'), msg('c', 'C')])
    );
    const counts = new Map<string, number>();
    const renderMessage = (
      row: MessageRow,
      context: { readonly current: boolean }
    ) => {
      counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
      return (
        <p data-testid={row.id} data-current={String(context.current)}>
          {row.message.content}
        </p>
      );
    };
    const view = render(
      <MessageList rows={[a, b]} renderMessage={renderMessage} />
    );
    expect(view.getByTestId('b').getAttribute('data-current')).toBe('true');
    view.rerender(
      <MessageList rows={[a, b, c]} renderMessage={renderMessage} />
    );
    expect(counts.get('a')).toBe(1);
    expect(counts.get('b')).toBe(2);
    expect(view.getByTestId('b').getAttribute('data-current')).toBe('false');
    expect(view.getByTestId('c').getAttribute('data-current')).toBe('true');
    view.rerender(<MessageList rows={[a, b]} renderMessage={renderMessage} />);
    expect(view.getByTestId('b').getAttribute('data-current')).toBe('true');
    view.rerender(<MessageList rows={[b, a]} renderMessage={renderMessage} />);
    expect(view.getByTestId('b').getAttribute('data-current')).toBe('false');
    expect(view.getByTestId('a').getAttribute('data-current')).toBe('true');
    content.dispose();
  });
  for (const role of ['user', 'system', 'tool'] as const) {
    it(`shows a caret only for a final streaming assistant, clearing it for final ${role}`, () => {
      const content = createMessageContent();
      const rows = content.project(
        snap([msg('a', 'Historical'), msg('b', '')])
      );
      const view = render(<MessageList rows={rows} />);
      expect(
        view.container.querySelectorAll('.tp-chat-message__caret')
      ).toHaveLength(1);
      expect(view.getAllByRole('article')[0].getAttribute('data-current')).toBe(
        'false'
      );
      const final = content.project(snap([msg('u', 'Final', { role })]))[0];
      view.rerender(<MessageList rows={[...rows, final]} />);
      expect(
        view.container.querySelectorAll('.tp-chat-message__caret')
      ).toHaveLength(0);
      expect(
        view
          .getByRole('article', { name: `${role} message` })
          .getAttribute('data-current')
      ).toBe('true');
      content.dispose();
    });
  }
  it('passes positional context through a custom renderer before accessing default presentation inputs', () => {
    const content = createMessageContent();
    const row = content.project(snap([msg('a', 'Answer')]))[0];
    const custom = {
      ...row,
      get markdown(): MessageRow['markdown'] {
        throw new Error('Default Markdown work');
      },
    };
    const toolLabel = vi.fn();
    const toolOutcome = vi.fn();
    const view = render(
      <MessageList
        rows={[custom]}
        toolLabel={toolLabel}
        toolOutcome={toolOutcome}
        renderMessage={(value, context) => (
          <p>
            {value.id}:{String(context.current)}
          </p>
        )}
      />
    );
    expect(view.getByText('a:true')).toBeTruthy();
    expect(toolLabel).not.toHaveBeenCalled();
    expect(toolOutcome).not.toHaveBeenCalled();
    expect(view.container.querySelector('article')).toBeNull();
    content.dispose();
  });
  it('keeps reasoning before and Sources/tool chrome after the independently directed text body', () => {
    const content = createMessageContent();
    const rows = content.project(
      snap(
        [
          msg('a', 'مرحبا', {
            reasoning: 'Why',
            citations: [{ id: 'source', index: 1, title: 'Source' }],
            toolCallIds: ['call'],
          }),
        ],
        [
          {
            id: 'call',
            name: 'lookup',
            args: {},
            status: 'complete',
            result: 'Result',
          },
        ] as AgentSnapshot['toolCalls']
      )
    );
    const view = render(<MessageList rows={rows} />);
    const article = view.getByRole('article');
    const body = article.querySelector('.tp-chat-message__body');
    const reasoning = article.querySelector('.tp-reasoning');
    const sources = view.getByRole('region', { name: 'Sources' });
    const tool = article.querySelector('.tp-tool-activity-group');
    expect(body?.textContent).toBe('مرحبا');
    expect(reasoning?.parentElement).toBe(article);
    expect(reasoning?.nextElementSibling).toBe(body);
    expect(sources.parentElement).toBe(article);
    expect(body?.nextElementSibling).toBe(sources);
    expect(sources.nextElementSibling).toBe(tool);
    content.dispose();
  });
  it('uses the passive message boundary for each default role while custom renderers bypass it', () => {
    const content = createMessageContent();
    const rows = content.project(
      snap(
        ['user', 'assistant', 'system', 'tool'].map((role) =>
          msg(role, `Content ${role}`, { role: role as Message['role'] })
        )
      )
    );
    const view = render(<MessageList rows={rows} />);
    for (const role of ['user', 'assistant', 'system', 'tool']) {
      const article = view.getByRole('article', { name: `${role} message` });
      expect(article.querySelectorAll('.tp-chat-message__body')).toHaveLength(
        1
      );
      expect(
        article.querySelector('.tp-chat-message__body')?.getAttribute('dir')
      ).toBe('auto');
      expect(
        article.querySelector('.tp-chat-message__body')?.textContent
      ).toContain(`Content ${role}`);
    }
    expect(view.getAllByText('You:')).toHaveLength(1);
    expect(view.getAllByText('Assistant:')).toHaveLength(1);
    view.rerender(
      <MessageList
        rows={rows}
        renderMessage={(row) => <p>{row.message.content}</p>}
      />
    );
    expect(
      view.container.querySelector('article,.tp-chat-message__body')
    ).toBeNull();
    content.dispose();
  });
  it('forwards authored outcomes through nonempty default rows and leaves custom rendering in control', () => {
    const content = createMessageContent();
    const rows = content.project(
      snap(
        [msg('a', 'Answer', { toolCallIds: ['c'] })],
        [
          {
            id: 'c',
            name: 'lookup',
            args: {},
            status: 'complete',
            result: 'ok',
          },
        ]
      )
    );
    const toolOutcome = vi.fn(() => ({
      text: 'Reference verified',
      sources: [{ title: 'Signals', url: 'https://angular.dev/guide/signals' }],
    }));
    const view = render(
      <MessageList rows={rows} groupRelatedTools toolOutcome={toolOutcome} />
    );
    expect(view.getByText('Reference verified').closest('details')).toBeNull();
    expect(view.getByRole('link', { name: 'Signals' })).toBeTruthy();
    const article = view.getByRole('article', { name: 'assistant message' });
    const body = article.querySelector('.tp-chat-message__body');
    expect(body?.textContent).toBe('Answer');
    for (const chrome of [
      view.getByText('Reference verified'),
      view.getByRole('link', { name: 'Signals' }),
    ]) {
      expect(article.contains(chrome)).toBe(true);
      expect(body?.contains(chrome)).toBe(false);
    }
    toolOutcome.mockClear();
    view.rerender(
      <MessageList
        rows={rows}
        toolOutcome={toolOutcome}
        renderMessage={() => <p>Owned view</p>}
      />
    );
    expect(view.queryByText('Reference verified')).toBeNull();
    expect(toolOutcome).not.toHaveBeenCalled();
    content.dispose();
  });
  it('renders a child as a subagent card in place of the tool call that started it', () => {
    const content = createMessageContent();
    const rows = content.project(
      snap(
        [
          msg('a', 'Answer', { toolCallIds: ['delegate', 'save'] }),
          msg('b', 'Later'),
        ],
        [
          { id: 'delegate', name: 'delegate', args: {}, status: 'complete', result: 'ok' },
          { id: 'save', name: 'save', args: {}, status: 'complete', result: 'ok' },
        ] as AgentSnapshot['toolCalls']
      )
    );
    const subagents = [
      { id: 'child', toolCallId: 'delegate', name: 'reader', status: 'complete' as const, messages: [{ id: 'm', text: 'Read it' }] },
      { id: 'unplaced', name: 'elsewhere', status: 'running' as const, messages: [] },
    ];
    const ids = (root: ParentNode) =>
      [...root.querySelectorAll('.tp-tool-activity')].map((node) => node.getAttribute('data-tool-id'));
    const view = render(<MessageList rows={rows} subagents={subagents} />);
    const first = view.container.querySelectorAll('.tp-chat-message')[0];
    const cards = view.container.querySelectorAll('.tp-subagent-card');
    // Only the child with a matching call is placed; the other is left to the application.
    expect(cards).toHaveLength(1);
    expect(first.contains(cards[0])).toBe(true);
    expect(cards[0].getAttribute('data-subagent-id')).toBe('child');
    expect(cards[0].textContent).toContain('reader');
    // The delegating call is no longer a tool row; its sibling still is.
    expect(ids(first.querySelector('.tp-tool-activity-group')!)).toEqual(['save']);

    view.rerender(<MessageList rows={rows} subagents={subagents} groupRelatedTools={false} />);
    expect(view.container.querySelector('.tp-tool-activity-group')).toBeNull();
    expect(ids(view.container).filter((id) => id === 'delegate')).toEqual([]);
    expect(view.container.querySelectorAll('.tp-subagent-card')).toHaveLength(1);

    view.rerender(<MessageList rows={rows} />);
    expect(view.container.querySelector('.tp-subagent-card')).toBeNull();
    expect(ids(view.container)).toEqual(['delegate', 'save']);

    view.rerender(
      <MessageList rows={rows} subagents={subagents} renderMessage={(row) => <p>{row.id}</p>} />
    );
    expect(view.container.querySelector('.tp-subagent-card')).toBeNull();
  });

  it('keeps a finished child card when the next turn starts, given the earlier children', () => {
    const content = createMessageContent();
    const rows = content.project(
      snap(
        [
          msg('a', 'First answer', { toolCallIds: ['delegate'] }),
          msg('b', 'Second answer', { toolCallIds: ['again'] }),
        ],
        [
          { id: 'delegate', name: 'delegate', args: {}, status: 'complete', result: 'ok' },
          { id: 'again', name: 'delegate', args: {}, status: 'running' },
        ] as AgentSnapshot['toolCalls']
      )
    );
    const first = {
      started: { subagentRunId: 'one', name: 'reader', parentToolCallId: 'delegate' },
      terminal: { type: 'SUBAGENT_FINISHED' },
    };
    const second = { started: { subagentRunId: 'two', name: 'writer', parentToolCallId: 'again' } };
    const transcript = [
      { id: 'r', role: 'assistant', content: 'Read it', subagentRunId: 'one' },
    ];
    const cards = (root: ParentNode) =>
      [...root.querySelectorAll('.tp-subagent-card')].map((node) => [
        node.getAttribute('data-subagent-id'),
        node.getAttribute('data-status'),
      ]);
    // The second turn's snapshot lists only its own child as current.
    const turn = (earlierSubagents?: readonly (typeof first)[]) =>
      subagentsFromEvidence({ subagents: [second], earlierSubagents, transcript, running: true })
        .subagents;
    const view = render(<MessageList rows={rows} subagents={turn([first])} />);
    expect(cards(view.container)).toEqual([
      ['one', 'complete'],
      ['two', 'running'],
    ]);
    expect(view.container.querySelector('[data-subagent-id="one"]')!.textContent).toContain('Read it');
    // Without the earlier list the first card is gone and its call is a plain tool row again.
    view.rerender(<MessageList rows={rows} subagents={turn()} />);
    expect(cards(view.container)).toEqual([['two', 'running']]);
    expect(
      view.container.querySelector('.tp-tool-activity[data-tool-id="delegate"]')
    ).not.toBeNull();
  });

  describe('app-declared tool failures', () => {
    const calls = (results: readonly unknown[]): AgentSnapshot['toolCalls'] =>
      results.map((result, i) => ({
        id: `c${i}`,
        name: 'read_reference',
        args: {},
        status: 'complete' as const,
        result,
      })) as AgentSnapshot['toolCalls'];
    const project = (results: readonly unknown[]) => {
      const content = createMessageContent();
      const rows = content.project(
        snap(
          [
            msg('a', 'Answer', {
              toolCallIds: results.map((_, i) => `c${i}`),
            }),
          ],
          calls(results)
        )
      );
      return { content, rows };
    };
    const failB = (activity: { id: string }) =>
      activity.id === 'c1'
        ? { status: 'failed' as const, text: 'Reference B is unavailable.' }
        : undefined;
    it('partial failure shows one Complete and one Failed row', () => {
      const { content, rows } = project([
        'ok',
        { recoverable: true, error: 'x' },
      ]);
      const view = render(
        <MessageList rows={rows} groupRelatedTools toolOutcome={failB} />
      );
      expect(view.getByText('Used 2 tools · 1 failed')).toBeTruthy();
      expect(view.getByRole('status').textContent).toBe(
        'Used 2 tools · 1 failed. 1 complete · 1 failed.'
      );
      expect(
        view.container.querySelector('.tp-tool-activity-group > [role="alert"]')
          ?.textContent
      ).toBe('Reference B is unavailable.');
      const rowB = view.container.querySelector('[data-tool-id="c1"]');
      expect(rowB?.getAttribute('data-phase')).toBe('error');
      expect(
        view.container
          .querySelector('[data-tool-id="c0"]')
          ?.getAttribute('data-phase')
      ).toBe('complete');
      expect(rowB?.querySelector('details')?.textContent).toContain(
        '"recoverable": true'
      );
      content.dispose();
    });
    it('ungrouped failure shows exactly one alert with the failure text', () => {
      const { content, rows } = project([
        'ok',
        { recoverable: true, error: 'x' },
      ]);
      const view = render(
        <MessageList
          rows={rows}
          groupRelatedTools={false}
          toolOutcome={failB}
        />
      );
      const alerts = view.getAllByRole('alert');
      expect(alerts).toHaveLength(1);
      expect(alerts[0].textContent).toBe('Reference B is unavailable.');
      expect(view.container.textContent).not.toContain(
        'Some tools could not finish'
      );
      content.dispose();
    });
    it('a throwing toolOutcome leaves the call complete', () => {
      const { content, rows } = project(['ok', 'ok2']);
      const error = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const view = render(
        <MessageList
          rows={rows}
          groupRelatedTools
          toolOutcome={(activity) => {
            if (activity.id === 'c1') throw new Error('boom');
            return undefined;
          }}
        />
      );
      expect(view.getByText('Used 2 tools')).toBeTruthy();
      expect(
        [...view.container.querySelectorAll('.tp-tool-activity')].map((el) =>
          el.getAttribute('data-phase')
        )
      ).toEqual(['complete', 'complete']);
      expect(error).toHaveBeenCalledTimes(1);
      error.mockRestore();
      content.dispose();
    });
    it('falsy literal results stay complete', () => {
      const literals = [false, 0, '', [], null];
      const { content, rows } = project(literals);
      const view = render(
        <MessageList
          rows={rows}
          groupRelatedTools
          toolOutcome={() => undefined}
        />
      );
      expect(view.getByText('Used 5 tools')).toBeTruthy();
      const results = [
        ...view.container.querySelectorAll('.tp-tool-activity'),
      ].map(
        (el) => el.querySelector('details pre:nth-of-type(2)')?.textContent
      );
      expect(results).toEqual(['false', '0', '', '[]', 'null']);
      content.dispose();
    });
    it('renderToolResult renders outside the collapsed group', () => {
      const { content, rows } = project([
        'ok',
        { recoverable: true, error: 'x' },
      ]);
      const seen: string[] = [];
      const view = render(
        <MessageList
          rows={rows}
          groupRelatedTools
          toolOutcome={failB}
          renderToolResult={(activity) => {
            seen.push(`${activity.id}:${activity.phase}`);
            return activity.phase === 'error' ? (
              <button type="button">Retry B</button>
            ) : null;
          }}
        />
      );
      const details = view.container.querySelector(
        '.tp-tool-activity-group__details'
      ) as HTMLDetailsElement;
      expect(details.open).toBe(false);
      const buttons = view.getAllByRole('button', { name: 'Retry B' });
      expect(buttons).toHaveLength(1);
      expect(details.contains(buttons[0])).toBe(false);
      expect(
        buttons[0].closest('[data-tool-id]')?.getAttribute('data-tool-id')
      ).toBe('c1');
      expect(buttons[0].closest('.tp-tool-activity__results')).toBeTruthy();
      expect(seen).toContain('c1:error');
      expect(seen).toContain('c0:complete');
      content.dispose();
    });
    it('offers a declared retry until a later row repeats the call, and never while work is active', () => {
      const content = createMessageContent();
      const failRead = (activity: { phase?: string; resultText?: string }) =>
        activity.phase === 'complete' && activity.resultText?.includes('error')
          ? {
              status: 'failed' as const,
              text: 'Read unavailable',
              retry: { label: 'Retry sorted read' },
            }
          : undefined;
      const settled = {
        generation: 'g',
        phase: 'complete',
        outcome: 'success',
      } as Message['delivery'];
      const call = (id: string, patch: object) => ({
        id,
        name: 'read',
        args: { id: 'sorted' },
        status: 'complete',
        result: { error: 'x' },
        ...patch,
      });
      const rows = (second?: object) =>
        content.project(
          snap(
            [
              msg('a', 'First', { toolCallIds: ['c0'], delivery: settled }),
              ...(second
                ? [
                    msg('b', 'Second', {
                      toolCallIds: ['c1'],
                      delivery: settled,
                    }),
                  ]
                : []),
            ],
            [
              call('c0', {}),
              ...(second ? [call('c1', second)] : []),
            ] as AgentSnapshot['toolCalls']
          )
        );
      const onToolRetry = vi.fn();
      const view = render(
        <MessageList
          rows={rows()}
          toolOutcome={failRead}
          onToolRetry={onToolRetry}
        />
      );
      fireEvent.click(view.getByRole('button', { name: 'Retry sorted read' }));
      expect(onToolRetry).toHaveBeenCalledTimes(1);
      expect(onToolRetry.mock.calls[0][0].id).toBe('c0');
      view.rerender(
        <MessageList
          rows={rows({ status: 'running', result: undefined })}
          toolOutcome={failRead}
          onToolRetry={onToolRetry}
        />
      );
      expect(
        view.queryByRole('button', { name: 'Retry sorted read' })
      ).toBeNull();
      view.rerender(
        <MessageList
          rows={rows({ result: { title: 'ok' } })}
          toolOutcome={failRead}
          onToolRetry={onToolRetry}
        />
      );
      expect(
        view.queryByRole('button', { name: 'Retry sorted read' })
      ).toBeNull();
      expect(view.getAllByText('Read unavailable').length).toBeGreaterThan(0);
      view.rerender(
        <MessageList
          rows={rows({ args: { id: 'signals' }, result: 'ok' })}
          toolOutcome={failRead}
          onToolRetry={onToolRetry}
        />
      );
      expect(
        view.getByRole('button', { name: 'Retry sorted read' })
      ).toBeTruthy();
      view.rerender(<MessageList rows={rows()} toolOutcome={failRead} />);
      expect(
        view.queryByRole('button', { name: 'Retry sorted read' })
      ).toBeNull();
      content.dispose();
    });
    it('renders no results container when the slot returns nothing', () => {
      const { content, rows } = project(['ok']);
      const view = render(
        <MessageList
          rows={rows}
          groupRelatedTools
          renderToolResult={() => null}
        />
      );
      expect(
        view.container.querySelector('.tp-tool-activity__results')
      ).toBeNull();
      content.dispose();
    });
    it('renderToolResult renders as ToolActivity children when ungrouped', () => {
      const { content, rows } = project(['ok', 'bad']);
      const view = render(
        <MessageList
          rows={rows}
          groupRelatedTools={false}
          toolOutcome={failB}
          renderToolResult={(activity) =>
            activity.phase === 'error' ? (
              <button type="button">Retry B</button>
            ) : null
          }
        />
      );
      const button = view.getByRole('button', { name: 'Retry B' });
      expect(
        button.closest('.tp-tool-activity')?.getAttribute('data-tool-id')
      ).toBe('c1');
      content.dispose();
    });
  });
  it('keeps precommit and SSR actions inert and follows resize only while pinned in StrictMode', () => {
    const callbacks: (() => void)[] = [];
    const disconnects: ReturnType<typeof vi.fn>[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(() => callback([], this as unknown as ResizeObserver));
          disconnects.push(this.disconnect);
        }
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );
    let latest: MessageListScrollControls | undefined;
    const renderer = (controls: MessageListScrollControls) => {
      latest = controls;
      return null;
    };
    expect(
      renderToString(<MessageList rows={[]} renderScrollControl={renderer} />)
    ).toContain('role="region"');
    latest!.scrollToLatest();
    latest!.focus();
    const view = render(
      <StrictMode>
        <MessageList rows={[]} renderScrollControl={renderer} />
      </StrictMode>
    );
    const region = view.getByRole('region');
    const focus = vi.spyOn(region, 'focus');
    let height = 1000;
    let viewport = 200;
    let top = 800;
    Object.defineProperties(region, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, get: () => viewport },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value) => {
          top = Math.min(value, height - viewport);
        },
      },
    });
    expect(callbacks).toHaveLength(2);
    expect(disconnects[0]).toHaveBeenCalledTimes(1);
    act(callbacks[0]);
    expect(top).toBe(800);
    act(callbacks[1]);
    expect(top).toBe(800);
    fireEvent.scroll(region);
    height = 600;
    top = 400; // Browser clamps to the new maximum rather than user intent.
    fireEvent.scroll(region);
    expect(latest!.pinned).toBe(true);
    top = 300;
    fireEvent.scroll(region);
    const unpinned = latest;
    height = 1400;
    act(callbacks[1]);
    expect(top).toBe(300);
    expect(latest).toBe(unpinned);
    act(() => latest!.scrollToLatest());
    expect(top).toBe(1200);
    height = 1800;
    act(callbacks[1]);
    expect(top).toBe(1600);
    viewport = 400;
    act(callbacks[1]);
    expect(top).toBe(1400);
    expect(focus).not.toHaveBeenCalled();
    const retained = latest!;
    view.unmount();
    top = 25;
    height = 2000;
    act(callbacks[1]);
    retained.scrollToLatest();
    retained.focus();
    expect(top).toBe(25);
    expect(focus).not.toHaveBeenCalled();
    expect(disconnects[1]).toHaveBeenCalledTimes(1);
  });
  it('renders stable view controls outside the unchanged region and jumps explicitly without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const contexts: MessageListScrollControls[] = [];
    const control = (controls: MessageListScrollControls) => {
      contexts.push(controls);
      return (
        <button
          onClick={() => {
            controls.scrollToLatest();
            controls.focus();
          }}
        >
          {controls.pinned ? 'Pinned' : 'Latest'}
        </button>
      );
    };
    const rows: readonly never[] = [];
    const view = render(
      <MessageList rows={rows} renderScrollControl={control} className="mine" />
    );
    const region = view.getByRole('region', { name: 'Conversation' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.className).toBe('tp-chat-list mine');
    expect(region.parentElement).toBe(view.container);
    expect(region.contains(view.getByRole('button'))).toBe(false);
    const initial = contexts.at(-1)!;
    const focus = vi.spyOn(region, 'focus');
    let top = 800;
    let height = 1000;
    Object.defineProperties(region, {
      clientHeight: { configurable: true, get: () => 200 },
      scrollHeight: { configurable: true, get: () => height },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value) => {
          top = Math.min(value, height - 200);
        },
      },
    });
    fireEvent.scroll(region);
    top = 780;
    fireEvent.scroll(region); // Upward intent wins even inside the 32px threshold.
    expect(view.getByRole('button', { name: 'Latest' })).toBeTruthy();
    const unpinned = contexts.at(-1)!;
    expect(unpinned.pinned).toBe(false);
    expect(unpinned.scrollToLatest).toBe(initial.scrollToLatest);
    expect(unpinned.focus).toBe(initial.focus);
    height = 1400;
    view.rerender(
      <MessageList rows={[]} renderScrollControl={control}>
        Growing tail
      </MessageList>
    );
    expect(contexts.at(-1)).toBe(unpinned);
    expect(top).toBe(780);
    expect(focus).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Latest' }));
    expect(top).toBe(1200);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(document.activeElement).toBe(region);
    expect(contexts.at(-1)!.pinned).toBe(true);
    fireEvent.scroll(region);
    top = 1167;
    fireEvent.scroll(region);
    top = 1168;
    fireEvent.scroll(region);
    expect(contexts.at(-1)!.pinned).toBe(true); // Inclusive 32px threshold.
    view.rerender(
      <MessageList rows={[]} renderScrollControl={control}>
        Next tail
      </MessageList>
    );
    expect(top).toBe(1200);
    view.unmount();
    top = 100;
    unpinned.scrollToLatest();
    unpinned.focus();
    expect(top).toBe(100);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('cannot operate a replacement keyed list using stale controls', () => {
    const contexts: MessageListScrollControls[] = [];
    const control = (value: MessageListScrollControls) => {
      contexts.push(value);
      return null;
    };
    const view = render(
      <MessageList key="first" rows={[]} renderScrollControl={control} />
    );
    const old = contexts.at(-1)!;
    view.rerender(
      <MessageList key="second" rows={[]} renderScrollControl={control} />
    );
    const region = view.getByRole('region');
    const focus = vi.spyOn(region, 'focus');
    const set = vi.fn();
    Object.defineProperty(region, 'scrollTop', { set });
    old.scrollToLatest();
    old.focus();
    expect(set).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(contexts.at(-1)!.scrollToLatest).not.toBe(old.scrollToLatest);
  });
  it('resolves provider-only inline references and Markdown-only Sources from projected rows', () => {
    const content = createMessageContent();
    const rows = content.project(
      snap([
        msg('provider', 'Read [^p] and [^missing].', {
          citations: [
            { id: 'p', index: 7, title: 'Provider', url: '/provider' },
          ],
        }),
        msg(
          'markdown',
          'Read [^m].\n\n[^m]: Markdown source [link](/markdown)\n'
        ),
        msg('empty', 'No sources'),
      ])
    );
    const view = render(<MessageList rows={rows} />);
    expect(
      view
        .getByRole('link', { name: 'Citation 7: Provider (opens in new tab)' })
        .getAttribute('href')
    ).toBe('/provider');
    expect(view.getByLabelText('Unresolved citation missing').textContent).toBe(
      '[^missing]'
    );
    expect(view.getAllByRole('region', { name: 'Sources' })).toHaveLength(2);
    expect(view.getAllByRole('link', { name: 'Markdown source' })).toHaveLength(
      1
    );
    expect(view.queryByRole('dialog')).toBeNull();
    content.dispose();
  });

  it('merges Sources in stable index order and keeps unsafe provider collisions authoritative', () => {
    const content = createMessageContent();
    const rows = content.project(
      snap([
        msg(
          'mixed',
          'Read [^collision].\n\n[^collision]: [Fallback](/fallback)\n\n[^md]: Markdown only\n',
          {
            citations: [
              { id: 'late', index: 9, title: 'Late' },
              { id: 'tie-first', index: 2, title: 'Tie first' },
              { id: 'tie-second', index: 2, title: 'Tie second' },
              {
                id: 'collision',
                index: 1,
                title: '<b>Provider</b>',
                url: 'javascript:alert(1)',
                snippet: '<img src=x>',
              },
            ],
          }
        ),
      ])
    );
    const view = render(<MessageList rows={rows} />);
    expect(
      [
        ...view
          .getByRole('region', { name: 'Sources' })
          .querySelectorAll('.tp-citations__title'),
      ].map((node) => node.textContent)
    ).toEqual([
      '<b>Provider</b>',
      'Tie first',
      'Tie second',
      'Markdown only',
      'Late',
    ]);
    expect(
      view.getByLabelText('Citation 1: <b>Provider</b>').querySelector('a')
    ).toBeNull();
    expect(
      view.container.querySelector(
        'a[href="/fallback"],a[href^="javascript:"],b,img'
      )
    ).toBeNull();
    expect(view.getByText('<img src=x>')).toBeTruthy();
    content.dispose();
  });

  it('updates same-ID metadata without replacing accepted Markdown and removes provider-only Sources', () => {
    const content = createMessageContent();
    const project = (title?: string) =>
      content.project(
        snap([
          msg('same', 'Read [^p].', {
            citations: title
              ? [{ id: 'p', index: 4, title, url: '/' + title }]
              : [],
          }),
        ])
      );
    const before = project('before');
    const view = render(<MessageList rows={before} />);
    const after = project('after');
    expect(after[0].markdown).toBe(before[0].markdown);
    view.rerender(<MessageList rows={after} />);
    expect(
      view
        .getByRole('link', { name: 'Citation 4: after (opens in new tab)' })
        .getAttribute('href')
    ).toBe('/after');
    expect(view.queryByText('before')).toBeNull();
    view.rerender(<MessageList rows={project()} />);
    expect(view.queryByRole('region', { name: 'Sources' })).toBeNull();
    expect(view.getByLabelText('Unresolved citation p')).toBeTruthy();
    content.dispose();
  });

  it('withholds provider metadata from nonassistant Markdown while tools and custom rows stay literal', () => {
    const content = createMessageContent();
    const rows = content.project(
      snap(
        ['user', 'system', 'tool'].map((role) =>
          msg(role, 'Read [^p].\n\n[^m]: Local definition\n', {
            role: role as Message['role'],
            citations: [{ id: 'p', index: 1, title: 'Private provider' }],
          })
        )
      )
    );
    const view = render(<MessageList rows={rows} />);
    expect(view.getAllByLabelText('Unresolved citation p')).toHaveLength(2);
    expect(view.queryByRole('region', { name: 'Sources' })).toBeNull();
    expect(
      view.container.querySelector('.tp-chat-message--tool pre')?.textContent
    ).toContain('[^m]: Local definition');
    view.rerender(
      <MessageList
        rows={rows}
        renderMessage={(row) => <p>{row.message.content}</p>}
      />
    );
    expect(view.container.querySelector('sup,article,.tp-markdown')).toBeNull();
    content.dispose();
  });
  it('follows approval-only changes while pinned and preserves a reader who scrolled up', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const rows: readonly never[] = [];
    const view = render(<MessageList rows={rows} />);
    const region = view.getByRole('region', { name: 'Conversation' });
    let top = 0;
    Object.defineProperties(region, {
      scrollHeight: { configurable: true, get: () => 900 },
      clientHeight: { configurable: true, get: () => 100 },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value) => {
          top = value;
        },
      },
    });
    view.rerender(
      <MessageList rows={rows}>
        <button>Confirm</button>
      </MessageList>
    );
    expect(top).toBe(900);
    top = 200;
    fireEvent.scroll(region);
    view.rerender(
      <MessageList rows={rows}>
        <button>Cancel</button>
      </MessageList>
    );
    expect(top).toBe(200);
  });

  it('keeps application-owned approval controls inside the observed transcript content', () => {
    const content = createMessageContent();
    const rows = content.project(snap([msg('a', 'Review this booking')]));
    const view = render(
      <MessageList rows={rows}>
        <button type="button">Confirm booking</button>
      </MessageList>
    );
    const region = view.getByRole('region', { name: 'Conversation' });
    const action = view.getByRole('button', { name: 'Confirm booking' });
    expect(region.firstElementChild?.contains(action)).toBe(true);
    expect(region.textContent).toContain('Review this booking');
    view.rerender(<MessageList rows={rows} />);
    expect(view.queryByRole('button', { name: 'Confirm booking' })).toBeNull();
    content.dispose();
  });

  it('lets the keyboard focus the named transcript without focusing a message action', () => {
    const content = createMessageContent();
    const view = render(
      <MessageList
        rows={content.project(snap([msg('a', 'Read this earlier answer')]))}
      />
    );
    const region = view.getByRole('region', { name: 'Conversation' });
    region.focus();
    expect(document.activeElement).toBe(region);
    content.dispose();
  });

  it('retains row-update following when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const content = createMessageContent();
    const view = render(
      <MessageList rows={content.project(snap([msg('a', 'A')]))} />
    );
    const list = view.getByRole('region', { name: 'Conversation' });
    let top = 0;
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, get: () => 900 },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value) => {
          top = value;
        },
      },
    });
    view.rerender(
      <MessageList
        rows={content.project(snap([msg('a', 'A'), msg('b', 'B')]))}
      />
    );
    expect(top).toBe(900);
    content.dispose();
  });
  it('follows content and viewport resizing only while pinned and releases its observer', () => {
    let notify: () => void = () => {
      throw new Error('Resize observer was not installed');
    };
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          notify = () => callback([], this as unknown as ResizeObserver);
        }
        observe = observe;
        unobserve = vi.fn();
        disconnect = disconnect;
      }
    );
    const content = createMessageContent();
    const rows = content.project(snap([msg('a', 'Unchanged')]));
    const view = render(<MessageList rows={rows} />);
    const list = view.getByRole('region', { name: 'Conversation' });
    let height = 1000;
    let viewport = 200;
    let top = 800;
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, get: () => viewport },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value) => {
          top = value;
        },
      },
    });
    height = 1400;
    act(notify);
    expect(top).toBe(1400);
    expect(observe).toHaveBeenCalledWith(list.firstElementChild);
    expect(observe).toHaveBeenCalledWith(list);
    expect(observe).toHaveBeenCalledTimes(2);
    height = 1700;
    fireEvent.scroll(list);
    act(notify);
    expect(top).toBe(1700);
    top = height - viewport;
    viewport = 100;
    act(notify);
    expect(top).toBe(height);
    top = 100;
    fireEvent.scroll(list);
    height = 1800;
    act(notify);
    expect(top).toBe(100);
    viewport = 300;
    act(notify);
    expect(top).toBe(100);
    top = height - viewport;
    fireEvent.scroll(list);
    height = 2000;
    act(notify);
    expect(top).toBe(2000);
    expect(view.getByText('Unchanged').textContent).toBe('Unchanged');
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    height = 2500;
    act(notify);
    expect(top).toBe(2000);
    content.dispose();
  });
  it('disconnects replayed observers and ignores their stale callbacks in StrictMode', () => {
    const notifications: (() => void)[] = [];
    const disconnects: ReturnType<typeof vi.fn>[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          notifications.push(() =>
            callback([], this as unknown as ResizeObserver)
          );
          disconnects.push(this.disconnect);
        }
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      }
    );
    const content = createMessageContent();
    const view = render(
      <StrictMode>
        <MessageList rows={content.project(snap([msg('a', 'Text')]))} />
      </StrictMode>
    );
    const list = view.getByRole('region', { name: 'Conversation' });
    let top = 0;
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, get: () => 1000 },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value) => {
          top = value;
        },
      },
    });
    expect(notifications).toHaveLength(2);
    expect(disconnects[0]).toHaveBeenCalledTimes(1);
    act(notifications[0]);
    expect(top).toBe(0);
    act(notifications[1]);
    expect(top).toBe(1000);
    view.unmount();
    expect(disconnects[1]).toHaveBeenCalledTimes(1);
    content.dispose();
  });
  it('shows supplied citations only on default assistant rows and respects custom rendering', () => {
    const content = createMessageContent();
    const citations = [{ id: 'c', index: 1, title: 'Owned source' }] as const;
    const rows = content.project(
      snap(
        ['assistant', 'user', 'tool'].map((role) =>
          msg(role, 'Answer', { role: role as Message['role'], citations })
        )
      )
    );
    const view = render(<MessageList rows={rows} />);
    expect(view.getAllByRole('region', { name: 'Sources' })).toHaveLength(1);
    expect(view.getAllByText('Owned source')).toHaveLength(1);
    view.rerender(
      <MessageList rows={rows} renderMessage={(row) => <p>{row.id}</p>} />
    );
    expect(view.queryByRole('region', { name: 'Sources' })).toBeNull();
    content.dispose();
  });
  it('renders reasoning only for assistants and resets disclosure after removal', () => {
    const content = createMessageContent();
    const other = ['user', 'system', 'tool'].map((role) =>
      msg(role, role, {
        role: role as Message['role'],
        reasoning: `Hidden ${role}`,
      })
    );
    const assistant = msg('a', 'Answer', { reasoning: '**Why**' });
    const view = render(
      <MessageList rows={content.project(snap([...other, assistant]))} />
    );
    expect(view.getAllByRole('button', { name: 'Thinking…' })).toHaveLength(1);
    expect(view.getByRole('region', { name: 'Reasoning' }).textContent).toBe(
      'Why'
    );
    fireEvent.click(view.getByRole('button', { name: 'Thinking…' }));
    view.rerender(
      <MessageList
        rows={content.project(snap([...other, msg('a', 'Answer')]))}
      />
    );
    expect(view.queryByRole('button')).toBeNull();
    view.rerender(
      <MessageList rows={content.project(snap([...other, assistant]))} />
    );
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    content.dispose();
  });

  it('leaves reasoning presentation to a custom renderer', () => {
    const content = createMessageContent();
    const view = render(
      <MessageList
        rows={content.project(snap([msg('a', 'Answer', { reasoning: 'Why' })]))}
        renderMessage={(row) => <p>{row.message.content}</p>}
      />
    );
    expect(view.getByText('Answer')).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
    content.dispose();
  });

  it('renders Markdown for text roles, literal text for tool role and tool observations', () => {
    const rows = createMessageContent().project(
      snap(
        [
          msg('u', 'Hi **there**', { role: 'user' }),
          msg('a', '# Plan', { toolCallIds: ['c'] }),
          msg('t', '<b>raw</b>', { role: 'tool', toolCallId: 'c' }),
        ],
        [
          Object.freeze({
            id: 'c',
            name: 'lookup',
            args: { q: 1 },
            status: 'complete',
            result: 'ok',
          }),
        ] as AgentSnapshot['toolCalls']
      )
    );
    const view = render(<MessageList rows={rows} />);
    expect(view.getByRole('heading', { name: 'Plan' })).toBeTruthy();
    expect(view.container.querySelector('strong')?.textContent).toBe('there');
    expect(
      view.container.querySelector('.tp-chat-message--tool pre')?.textContent
    ).toBe('<b>raw</b>');
    expect(view.container.querySelector('b')).toBeNull();
    const obs = view.container.querySelectorAll('.tp-tool-activity');
    expect(obs).toHaveLength(1);
    expect(obs[0].textContent).toContain('lookup');
    expect(obs[0].textContent).toContain('"q": 1');
    expect(obs[0].textContent).toContain('ok');
  });

  it('shows error text for a failed tool call', () => {
    const rows = createMessageContent().project(
      snap([msg('a', 'x', { toolCallIds: ['c'] })], [
        Object.freeze({
          id: 'c',
          name: 'lookup',
          args: {},
          status: 'error',
          error: 'boom <i>bad</i>',
        }),
      ] as AgentSnapshot['toolCalls'])
    );
    const view = render(<MessageList rows={rows} />);
    expect(
      view.container.querySelector('.tp-tool-activity')!.textContent
    ).toContain('boom <i>bad</i>');
    expect(view.container.querySelector('i')).toBeNull();
    expect(
      view
        .getAllByRole('alert')
        .some((alert) => alert.closest('details') === null)
    ).toBe(true);
    expect(view.container.querySelector('details')!.open).toBe(false);
  });

  it('uses the default label and honours label and className', () => {
    const rows = createMessageContent().project(snap([]));
    const view = render(<MessageList rows={rows} />);
    expect(view.getByRole('region', { name: 'Conversation' })).toBeTruthy();
    view.rerender(<MessageList rows={rows} label="Chat" className="x" />);
    expect(
      view.getByRole('region', { name: 'Chat' }).classList.contains('x')
    ).toBe(true);
  });

  it('does not re-render unchanged rows when the tail streams', () => {
    const content = createMessageContent();
    const a = msg('a', 'stable');
    const renders: string[] = [];
    // Stable reference: memoization depends on it.
    type AuthoredRow = MessageRow & { readonly summary: string };
    const authored = new WeakMap<MessageRow, AuthoredRow>();
    const project = (messages: Message[]) =>
      content.project(snap(messages)).map((row) => {
        let decorated = authored.get(row);
        if (!decorated) {
          decorated = Object.freeze({ ...row, summary: `Summary ${row.id}` });
          authored.set(row, decorated);
        }
        return decorated;
      });
    const renderMessage = (row: AuthoredRow) => {
      renders.push(row.id);
      return (
        <p>
          {row.summary}: {row.message.content}
        </p>
      );
    };
    const view = render(
      <MessageList
        rows={project([a, msg('b', 'x')])}
        renderMessage={renderMessage}
      />
    );
    expect(renders.sort()).toEqual(['a', 'b']);
    renders.length = 0;
    view.rerender(
      <MessageList
        rows={project([a, msg('b', 'xy')])}
        renderMessage={renderMessage}
      />
    );
    expect(renders).toEqual(['b']);
    expect(view.getByText('Summary b: xy')).toBeTruthy();
  });

  it('follows new content only while pinned to the bottom', () => {
    const content = createMessageContent();
    const view = render(
      <MessageList rows={content.project(snap([msg('a', 'x')]))} />
    );
    const list = view.getByRole('region', { name: 'Conversation' });
    let scrollTop = 0;
    Object.defineProperty(list, 'scrollHeight', {
      configurable: true,
      get: () => 1000,
    });
    Object.defineProperty(list, 'clientHeight', {
      configurable: true,
      get: () => 200,
    });
    Object.defineProperty(list, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (v) => (scrollTop = v),
    });
    view.rerender(
      <MessageList
        rows={content.project(snap([msg('a', 'x'), msg('b', 'y')]))}
      />
    );
    expect(scrollTop).toBe(1000);
    scrollTop = 100;
    list.dispatchEvent(new Event('scroll'));
    view.rerender(
      <MessageList
        rows={content.project(
          snap([msg('a', 'x'), msg('b', 'y'), msg('c', 'z')])
        )}
      />
    );
    expect(scrollTop).toBe(100);
    scrollTop = 800;
    list.dispatchEvent(new Event('scroll'));
    view.rerender(
      <MessageList
        rows={content.project(
          snap([msg('a', 'x'), msg('b', 'y'), msg('c', 'z'), msg('d', 'w')])
        )}
      />
    );
    expect(scrollTop).toBe(1000);
  });
});
