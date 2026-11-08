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
    const observed = { ...application, getSnapshot: () => composed };
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
    const draft = view.getByRole('textbox', { name: 'Message' });
    draft.focus();
    view.rerender(
      <StrictMode>
        <App application={observed} />
      </StrictMode>
    );
    expect(document.activeElement).toBe(draft);
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
