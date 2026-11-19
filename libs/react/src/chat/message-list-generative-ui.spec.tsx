import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  completeDelivery,
  streamingDelivery,
  type AgentSession,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import { createMessageContent } from '@threadplane/content/messages';
import {
  Chat,
  MessageList,
  type MessageA2uiContent,
  type MessageGenerativeUi,
} from './index';

afterEach(cleanup);

const SPEC = JSON.stringify({
  root: 'card',
  elements: {
    card: { type: 'Card', props: { title: 'Lyon trip' }, children: ['when', 'who'] },
    when: { type: 'Line', props: { text: '09:40' } },
    who: { type: 'Line', props: { text: { statePath: '/guest' } } },
  },
  state: { guest: 'Ada' },
});

const registry: NonNullable<MessageGenerativeUi['registry']> = {
  Card: (view) => (
    <section data-view="card" data-loading={String(view.loading)}>
      <h3>{String(view.props['title'])}</h3>
      {view.children}
    </section>
  ),
  Line: (view) => <p data-view="line">{String(view.props['text'])}</p>,
};
const specs: MessageGenerativeUi = { registry };

const assistant = (
  content: string,
  streaming = false,
  id = 'a'
): Message => ({
  id,
  role: 'assistant',
  content,
  delivery: streaming ? streamingDelivery('g') : completeDelivery('g', 'success'),
});
const snapshot = (messages: readonly Message[]): AgentSnapshot => ({
  status: 'idle',
  messages,
  toolCalls: [],
});
const rows = (...messages: Message[]) =>
  createMessageContent().project(snapshot(messages));
const surface = (container: HTMLElement) =>
  container.querySelector('.tp-chat-generative-ui');

describe('MessageList generativeUi', () => {
  it('keeps a spec message as text unless generativeUi is set', () => {
    const view = render(<MessageList rows={rows(assistant(SPEC))} />);
    expect(surface(view.container)).toBeNull();
    expect(view.container.querySelector('[data-view]')).toBeNull();
    expect(view.container.textContent).toContain('"root"');
  });

  it('renders a finished spec message as its tree in place of the text', () => {
    const view = render(
      <MessageList rows={rows(assistant(SPEC))} generativeUi={specs} />
    );
    const host = surface(view.container) as HTMLElement;
    expect(host.getAttribute('data-kind')).toBe('spec');
    expect(host.getAttribute('data-streaming')).toBe('false');
    expect(host.closest('.tp-chat-message__body')).not.toBeNull();
    expect(host.querySelector('h3')?.textContent).toBe('Lyon trip');
    // A `{ statePath }` prop reads the spec's own state.
    expect(
      [...host.querySelectorAll('[data-view="line"]')].map((p) => p.textContent)
    ).toEqual(['09:40', 'Ada']);
    expect(host.querySelector('[data-view="card"]')?.getAttribute('data-loading')).toBe('false');
    expect(view.container.textContent).not.toContain('"root"');
    expect(view.queryByRole('status')).toBeNull();
  });

  it('renders on the server', () => {
    const html = renderToString(
      <MessageList rows={rows(assistant(SPEC))} generativeUi={specs} />
    );
    expect(html).toContain('Lyon trip');
    expect(html).not.toContain('&quot;root&quot;');
  });

  it('shows the skeleton while a spec streams, then its elements as each one finishes', () => {
    const content = createMessageContent();
    const at = (length: number, streaming = true) =>
      content.project(snapshot([assistant(SPEC.slice(0, length), streaming)]));
    const view = render(<MessageList rows={at(1)} generativeUi={specs} />);
    const status = view.getByRole('status');
    expect(status.className).toBe('tp-genui-skeleton');
    expect(status.textContent).toBe('Building UI…');
    expect(status.parentElement?.getAttribute('data-kind')).toBe('skeleton');
    expect(view.container.textContent).not.toContain('{');

    // The root key is known but its element is still open.
    view.rerender(
      <MessageList rows={at(SPEC.indexOf('Lyon'))} generativeUi={specs} />
    );
    expect(view.getByRole('status').textContent).toBe('Building UI…');
    expect(view.container.querySelector('[data-view]')).toBeNull();

    // The card has finished; its first child is still streaming.
    view.rerender(
      <MessageList rows={at(SPEC.indexOf('09:4'))} generativeUi={specs} />
    );
    expect(view.queryByRole('status')).toBeNull();
    const card = view.container.querySelector('[data-view="card"]') as HTMLElement;
    expect(card.getAttribute('data-loading')).toBe('true');
    expect(surface(view.container)?.getAttribute('data-streaming')).toBe('true');
    expect(card.querySelectorAll('[data-view="line"]')).toHaveLength(0);

    view.rerender(
      <MessageList rows={at(SPEC.indexOf(',"who":{'))} generativeUi={specs} />
    );
    expect(
      view.container.querySelector('[data-view="card"]')
    ).toBe(card);
    expect(
      [...card.querySelectorAll('[data-view="line"]')].map((p) => p.textContent)
    ).toEqual(['09:40']);

    view.rerender(
      <MessageList rows={at(SPEC.length, false)} generativeUi={specs} />
    );
    expect(view.container.querySelector('[data-view="card"]')).toBe(card);
    expect(card.getAttribute('data-loading')).toBe('false');
    expect(card.querySelectorAll('[data-view="line"]')).toHaveLength(2);
  });

  it('uses skeletonLabel for the placeholder', () => {
    const view = render(
      <MessageList
        rows={rows(assistant('{"root"', true))}
        generativeUi={{ registry, skeletonLabel: 'Drawing the itinerary' }}
      />
    );
    expect(view.getByRole('status').textContent).toBe('Drawing the itinerary');
  });

  it('keeps finished JSON that is not a spec, and other roles, as text', () => {
    const user: Message = {
      id: 'u',
      role: 'user',
      content: SPEC,
      delivery: completeDelivery('u', 'success'),
    };
    const view = render(
      <MessageList
        rows={rows(user, assistant('{"answer": 42}'), assistant('Plain', false, 'b'))}
        generativeUi={specs}
      />
    );
    expect(surface(view.container)).toBeNull();
    expect(view.container.textContent).toContain('"answer": 42');
    expect(view.container.textContent).toContain('Plain');
  });

  it('offers built-in message actions for text, not for a surface', () => {
    const view = render(
      <MessageList
        rows={rows(assistant(SPEC), assistant('Booked.', false, 'b'))}
        generativeUi={specs}
        messageActions
      />
    );
    expect(view.getAllByRole('button', { name: 'Copy' })).toHaveLength(1);
    cleanup();
    const withText = render(
      <MessageList rows={rows(assistant(SPEC))} messageActions />
    );
    expect(withText.getAllByRole('button', { name: 'Copy' })).toHaveLength(1);
  });

  it('falls back to the text when a view throws, without losing the transcript', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const attempts = { count: 0 };
    const broken: MessageGenerativeUi = {
      registry: {
        ...registry,
        Card: () => {
          attempts.count += 1;
          throw new Error('view failed');
        },
      },
    };
    const view = render(
      <MessageList
        rows={rows(assistant('Before', false, 'b'), assistant(SPEC))}
        generativeUi={broken}
      />
    );
    expect(attempts.count).toBeGreaterThan(0);
    expect(view.container.textContent).toContain('Before');
    expect(view.container.textContent).toContain('"root"');
    expect(surface(view.container)).toBeNull();
    error.mockRestore();
  });

  it('leaves a custom renderMessage in charge', () => {
    const view = render(
      <MessageList
        rows={rows(assistant(SPEC))}
        generativeUi={specs}
        renderMessage={(row) => <p>custom {row.id}</p>}
      />
    );
    expect(view.container.textContent).toBe('custom a');
  });

  describe('progressive', () => {
    const progressive: MessageGenerativeUi = { registry, progressive: true };
    const streamed = () => {
      const content = createMessageContent();
      return (text: string, length: number, streaming = true) =>
        content.project(snapshot([assistant(text.slice(0, length), streaming)]));
    };

    it('renders an element before it finishes, its string props growing in place', () => {
      const at = streamed();
      // The element type is still open: nothing to render yet.
      const view = render(
        <MessageList
          rows={at(SPEC, SPEC.indexOf('Card') + 2)}
          generativeUi={progressive}
        />
      );
      expect(view.getByRole('status').textContent).toBe('Building UI…');

      view.rerender(
        <MessageList
          rows={at(SPEC, SPEC.indexOf('Lyon') + 2)}
          generativeUi={progressive}
        />
      );
      expect(view.queryByRole('status')).toBeNull();
      const card = view.container.querySelector('[data-view="card"]') as HTMLElement;
      expect(card.querySelector('h3')?.textContent).toBe('Ly');
      expect(card.getAttribute('data-loading')).toBe('true');

      view.rerender(
        <MessageList
          rows={at(SPEC, SPEC.indexOf('Lyon') + 9)}
          generativeUi={progressive}
        />
      );
      expect(view.container.querySelector('[data-view="card"]')).toBe(card);
      expect(card.querySelector('h3')?.textContent).toBe('Lyon trip');

      // A child appears while its own JSON is still open.
      view.rerender(
        <MessageList
          rows={at(SPEC, SPEC.indexOf('09:4') + 2)}
          generativeUi={progressive}
        />
      );
      expect(view.container.querySelector('[data-view="card"]')).toBe(card);
      expect(
        [...card.querySelectorAll('[data-view="line"]')].map((p) => p.textContent)
      ).toEqual(['09']);
    });

    it('waits for a child ID to finish before rendering it', () => {
      const at = streamed();
      const view = render(
        <MessageList
          rows={at(SPEC, SPEC.indexOf('"when"') + 3)}
          generativeUi={progressive}
        />
      );
      const card = view.container.querySelector('[data-view="card"]') as HTMLElement;
      expect(card).not.toBeNull();
      expect(card.querySelectorAll('[data-view="line"]')).toHaveLength(0);
    });

    it('seeds state path by path as each value finishes', () => {
      const STATEFUL = JSON.stringify({
        root: 'card',
        elements: {
          card: { type: 'Card', props: { title: 'Trip' }, children: ['who', 'where'] },
          who: { type: 'Line', props: { text: { statePath: '/guest' } } },
          where: { type: 'Line', props: { text: { $state: '/city' } } },
        },
        state: { guest: 'Ada', city: 'Lyon' },
      });
      const at = streamed();
      const lines = (container: HTMLElement) =>
        [...container.querySelectorAll('[data-view="line"]')].map((p) => p.textContent);
      const view = render(
        <MessageList
          rows={at(STATEFUL, STATEFUL.indexOf('"city"') + 9)}
          generativeUi={progressive}
        />
      );
      expect(lines(view.container)).toEqual(['Ada', 'undefined']);
      view.rerender(
        <MessageList rows={at(STATEFUL, STATEFUL.length, false)} generativeUi={progressive} />
      );
      expect(lines(view.container)).toEqual(['Ada', 'Lyon']);
    });

    it('renders a finished spec exactly as the default does', () => {
      const plain = render(
        <MessageList rows={rows(assistant(SPEC))} generativeUi={specs} />
      ).container.innerHTML;
      cleanup();
      const at = streamed();
      const view = render(
        <MessageList rows={at(SPEC, SPEC.length / 2)} generativeUi={progressive} />
      );
      view.rerender(
        <MessageList rows={at(SPEC, SPEC.length, false)} generativeUi={progressive} />
      );
      expect(view.container.innerHTML).toBe(plain);
    });
  });

  describe('renderA2ui', () => {
    const A2UI = '---a2ui_JSON---\n{"version":"v0.9","createSurface":{"surfaceId":"trip"}}\n';
    const calls: MessageA2uiContent[] = [];
    const a2ui: MessageGenerativeUi = {
      renderA2ui: (content) => {
        calls.push(content);
        return content.source.includes('createSurface') ? (
          <section>surface for {content.messageId}</section>
        ) : (
          content.skeleton
        );
      },
    };

    it('keeps A2UI content as text unless renderA2ui is set', () => {
      const view = render(
        <MessageList rows={rows(assistant(A2UI))} generativeUi={specs} />
      );
      expect(surface(view.container)).toBeNull();
      expect(view.container.textContent).toContain('createSurface');
    });

    it('hands the content after the marker to the application', () => {
      calls.length = 0;
      const content = createMessageContent();
      const at = (length: number, streaming = true) =>
        content.project(snapshot([assistant(A2UI.slice(0, length), streaming)]));
      // Half a marker is neither text nor a surface yet.
      const view = render(<MessageList rows={at(5)} generativeUi={a2ui} />);
      expect(calls).toHaveLength(0);
      expect(view.container.querySelector('.tp-chat-message__body')?.textContent).toBe('');

      view.rerender(<MessageList rows={at(20)} generativeUi={a2ui} />);
      expect(calls.at(-1)).toMatchObject({
        messageId: 'a',
        source: '\n{"ve',
        streaming: true,
      });
      expect(view.getByRole('status').textContent).toBe('Building UI…');
      expect(surface(view.container)?.getAttribute('data-kind')).toBe('a2ui');

      view.rerender(<MessageList rows={at(A2UI.length, false)} generativeUi={a2ui} />);
      expect(calls.at(-1)).toMatchObject({
        source: A2UI.slice('---a2ui_JSON---'.length),
        streaming: false,
      });
      expect(view.queryByRole('status')).toBeNull();
      expect(surface(view.container)?.textContent).toBe('surface for a');
      expect(view.container.textContent).not.toContain('a2ui_JSON');
    });

    it('shows a finished lone marker prefix as the text it is', () => {
      const view = render(
        <MessageList rows={rows(assistant('---a2'))} generativeUi={a2ui} />
      );
      expect(view.container.textContent).toContain('a2');
      expect(surface(view.container)).toBeNull();
    });
  });
});

describe('Chat generativeUi', () => {
  function session(messages: readonly Message[]): AgentSession {
    const current = snapshot(messages);
    return {
      getSnapshot: () => current,
      subscribe: () => () => undefined,
      submit: async () => undefined,
      stop: async () => undefined,
    } as unknown as AgentSession;
  }

  it('passes generativeUi to its transcript and is off without it', () => {
    const view = render(
      <Chat session={session([assistant(SPEC)])} generativeUi={specs} />
    );
    expect(surface(view.container)?.querySelector('h3')?.textContent).toBe('Lyon trip');
    cleanup();
    const plain = render(<Chat session={session([assistant(SPEC)])} />);
    expect(surface(plain.container)).toBeNull();
    expect(plain.container.textContent).toContain('"root"');
  });
});
