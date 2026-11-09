import { StrictMode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createReactApplication } from './application';
import { applicationFixture } from './application-fixture';
import { App } from './app';
import { createMarkdown } from '@threadplane/content/markdown';
import { streamingDelivery } from '@threadplane/core';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('composes native rich content once inside ChatMessage with consumer-owned copy controls', async () => {
  const fixture = applicationFixture();
  const application = createReactApplication(fixture.options);
  const reasoning = createMarkdown({
    generation: 'reasoning',
    phase: 'complete',
    content: 'Why',
  });
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    get: () => ({ writeText }),
  });
  try {
    application.start();
    await waitFor(() =>
      expect(application.getSnapshot().selection.status).toBe('ready')
    );
    const snapshot = application.getSnapshot();
    const composed = {
      ...snapshot,
      messages: snapshot.messages.map((row) => ({
        ...row,
        reasoning: reasoning.getSnapshot(),
        message: {
          ...row.message,
          citations: [{ id: 'source', index: 1, title: 'Source' }],
        },
      })),
    };
    const streaming = {
      ...composed,
      messages: composed.messages.map((row) => ({
        ...row,
        message: {
          ...row.message,
          delivery: streamingDelivery(row.message.delivery.generation),
        },
      })),
    };
    let presented: typeof composed = streaming;
    const observed = { ...application, getSnapshot: () => presented };
    const before = { ...fixture.counters };
    const view = render(
      <StrictMode>
        <App application={observed} />
      </StrictMode>
    );
    const article = view.getByRole('article', { name: 'assistant message' });
    expect(article.classList.contains('message-assistant')).toBe(true);
    const body = article.querySelector('.tp-chat-message__body');
    expect(body?.getAttribute('dir')).toBe('auto');
    expect(article.getAttribute('data-current')).toBe('true');
    expect(article.getAttribute('data-streaming')).toBe('true');
    expect(body?.querySelectorAll('.tp-chat-message__caret')).toHaveLength(1);
    expect(body?.lastElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(article.querySelectorAll('.tp-chat-message__speaker')).toHaveLength(
      1
    );
    expect(
      article.querySelector('.tp-chat-message__speaker')?.textContent
    ).toBe('Assistant:');
    expect(article.querySelector('h3.role-label')).toBeNull();
    expect(within(body as HTMLElement).getAllByText('Answer')).toHaveLength(1);
    expect(
      body?.querySelectorAll('.trip-summary,.tp-reasoning,.tp-citations')
    ).toHaveLength(0);
    const thinking = article.querySelector('.tp-reasoning');
    const sources = within(article).getByRole('region', { name: 'Sources' });
    const trip = article.querySelector('.trip-summary');
    expect(thinking?.parentElement).toBe(article);
    expect(thinking?.nextElementSibling).toBe(body);
    expect(body?.nextElementSibling).toBe(sources);
    expect(sources.parentElement).toBe(article);
    expect(trip?.parentElement).toBe(article);
    expect(sources.nextElementSibling).toBe(trip);
    const button = within(article).getByRole('button', { name: 'Copy answer' });
    expect(button.closest('.tp-chat-message__controls')?.parentElement).toBe(
      article
    );
    expect(article.lastElementChild?.className).toBe(
      'tp-chat-message__controls'
    );
    expect(body?.contains(button)).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    const last = streaming.messages[streaming.messages.length - 1];
    for (const role of ['user', 'system', 'tool'] as const) {
      presented = {
        ...streaming,
        messages: [
          ...streaming.messages,
          {
            ...last,
            id: `final-${role}`,
            role,
            message: { ...last.message, id: `final-${role}`, role },
          },
        ],
      };
      view.rerender(
        <StrictMode>
          <App application={observed} />
        </StrictMode>
      );
      expect(article.getAttribute('data-current')).toBe('false');
      expect(article.getAttribute('data-streaming')).toBe('true');
      const final = view.getByRole('article', { name: `${role} message` });
      expect(final.getAttribute('data-current')).toBe('true');
      expect(final.getAttribute('data-streaming')).toBe('true');
      expect(
        view.container.querySelectorAll('.tp-chat-message__caret')
      ).toHaveLength(0);
      expect(within(article).getByRole('button', { name: 'Copy answer' })).toBe(
        button
      );
    }
    presented = streaming;
    view.rerender(
      <StrictMode>
        <App application={observed} />
      </StrictMode>
    );
    expect(article.getAttribute('data-current')).toBe('true');
    expect(body?.querySelectorAll('.tp-chat-message__caret')).toHaveLength(1);
    const draft = view.getByRole('textbox', { name: 'Message' });
    draft.focus();
    presented = composed;
    view.rerender(
      <StrictMode>
        <App application={observed} />
      </StrictMode>
    );
    expect(document.activeElement).toBe(draft);
    expect(article.getAttribute('data-streaming')).toBe('false');
    expect(body?.querySelectorAll('.tp-chat-message__caret')).toHaveLength(0);
    expect(view.getByRole('article', { name: 'assistant message' })).toBe(
      article
    );
    expect(thinking?.nextElementSibling).toBe(body);
    expect(body?.nextElementSibling).toBe(sources);
    expect(sources.nextElementSibling).toBe(trip);
    expect(article.lastElementChild?.className).toBe(
      'tp-chat-message__controls'
    );
    fireEvent.click(button);
    await act(async () => undefined);
    expect(writeText.mock.calls).toEqual([['Answer']]);
    expect(within(article).getByRole('status').textContent).toBe(
      'Answer copied.'
    );
    expect(fixture.counters.commands).toBe(before.commands);
    view.unmount();
    expect(fixture.counters.disposals).toBe(before.disposals);
  } finally {
    application.dispose();
    reasoning.dispose();
  }
});
