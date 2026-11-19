import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  completeDelivery,
  streamingDelivery,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import { createMessageContent } from '@threadplane/content/messages';
import { createRenderState } from '@threadplane/content/render-state';
import {
  MessageList,
  type MessageGenerativeUi,
  type MessageRenderEvent,
} from './index';

afterEach(cleanup);

const FORM = JSON.stringify({
  root: 'form',
  elements: {
    form: { type: 'Box', props: {}, children: ['guest', 'echo', 'book'] },
    guest: { type: 'Field', props: { label: 'Guest', value: { $bindState: '/guest' } } },
    echo: { type: 'Text', props: { text: { $state: '/guest' } } },
    book: {
      type: 'Button',
      props: { label: 'Book' },
      on: { press: { action: 'book', params: { guest: { $state: '/guest' } } } },
    },
  },
  state: { guest: 'Ada' },
});

const registry: NonNullable<MessageGenerativeUi['registry']> = {
  Box: (view) => <section>{view.children}</section>,
  Field: ({ props, bindings, set }) => (
    <input
      aria-label={String(props['label'])}
      value={String(props['value'] ?? '')}
      readOnly={set === undefined}
      onChange={(event) => {
        const path = bindings?.['value'];
        if (path) set?.(path, event.target.value);
      }}
    />
  ),
  Text: ({ props }) => <p data-view="echo">{String(props['text'] ?? '')}</p>,
  Button: ({ props, emit }) => (
    <button type="button" onClick={() => emit?.('press')}>
      {String(props['label'])}
    </button>
  ),
};

const assistant = (content: string, id = 'a', streaming = false): Message => ({
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
const echoes = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-view="echo"]')].map((p) => p.textContent);

describe('MessageList generativeUi interaction', () => {
  it('keeps a spec read-only with a registry alone', () => {
    const view = render(
      <MessageList rows={rows(assistant(FORM))} generativeUi={{ registry }} />
    );
    const field = view.getByRole('textbox', { name: 'Guest' }) as HTMLInputElement;
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe('Ada');
    // Nothing runs, and nothing throws, when a view emits without handlers.
    fireEvent.click(view.getByRole('button', { name: 'Book' }));
    expect(echoes(view.container)).toEqual(['Ada']);
  });

  it('runs the action a spec names and reports it with the message id', () => {
    const book = vi.fn((_params: object) => 'booked');
    const events: MessageRenderEvent[] = [];
    const view = render(
      <MessageList
        rows={rows(assistant(FORM, 'm1'))}
        generativeUi={{
          registry,
          handlers: { book },
          onRenderEvent: (event) => {
            if (event.event.type !== 'lifecycle') events.push(event);
          },
        }}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Book' }));
    expect(book).toHaveBeenCalledWith({ guest: 'Ada' });
    expect(events).toEqual([
      {
        messageId: 'm1',
        event: {
          type: 'handler',
          action: 'book',
          params: { guest: 'Ada' },
          result: 'booked',
        },
      },
    ]);
  });

  it('lets each message edit state of its own, seeded from its spec', () => {
    const book = vi.fn();
    const events: MessageRenderEvent[] = [];
    const options: MessageGenerativeUi = {
      registry,
      handlers: { book },
      onRenderEvent: (event) => {
        if (event.event.type !== 'lifecycle') events.push(event);
      },
    };
    const view = render(
      <MessageList
        rows={rows(assistant(FORM, 'm1'), assistant(FORM, 'm2'))}
        generativeUi={options}
      />
    );
    const [first, second] = view.getAllByRole('textbox', {
      name: 'Guest',
    }) as HTMLInputElement[];
    expect(first.readOnly).toBe(false);
    fireEvent.change(first, { target: { value: 'Grace' } });
    expect(echoes(view.container)).toEqual(['Grace', 'Ada']);
    expect(second.value).toBe('Ada');
    expect(events).toEqual([
      {
        messageId: 'm1',
        event: {
          type: 'stateChange',
          path: '/guest',
          value: 'Grace',
          snapshot: { guest: 'Grace' },
        },
      },
    ]);
    // The edit survives a re-render of the transcript and reaches the action.
    view.rerender(
      <MessageList
        rows={rows(assistant(FORM, 'm1'), assistant(FORM, 'm2'))}
        generativeUi={options}
      />
    );
    expect(echoes(view.container)).toEqual(['Grace', 'Ada']);
    fireEvent.click(view.getAllByRole('button', { name: 'Book' })[0]);
    expect(book).toHaveBeenCalledWith({ guest: 'Grace' });
  });

  it('is writable with onRenderEvent alone', () => {
    const view = render(
      <MessageList
        rows={rows(assistant(FORM))}
        generativeUi={{ registry, onRenderEvent: () => undefined }}
      />
    );
    fireEvent.change(view.getByRole('textbox', { name: 'Guest' }), {
      target: { value: 'Lin' },
    });
    expect(echoes(view.container)).toEqual(['Lin']);
  });

  it('reads and writes one shared store in place of each spec state', () => {
    const store = createRenderState({ guest: 'Zed' });
    const view = render(
      <MessageList
        rows={rows(assistant(FORM, 'm1'), assistant(FORM, 'm2'))}
        generativeUi={{ registry, store }}
      />
    );
    expect(echoes(view.container)).toEqual(['Zed', 'Zed']);
    fireEvent.change(view.getAllByRole('textbox', { name: 'Guest' })[1], {
      target: { value: 'Kay' },
    });
    expect(store.get('/guest')).toBe('Kay');
    expect(echoes(view.container)).toEqual(['Kay', 'Kay']);
  });

  it('seeds a streaming spec once its state has arrived', () => {
    const content = createMessageContent();
    const at = (length: number, streaming = true) =>
      content.project(snapshot([assistant(FORM.slice(0, length), 'a', streaming)]));
    const options: MessageGenerativeUi = { registry, handlers: {} };
    const view = render(
      <MessageList rows={at(FORM.indexOf(',"state"'))} generativeUi={options} />
    );
    expect(echoes(view.container)).toEqual(['']);
    view.rerender(<MessageList rows={at(FORM.length, false)} generativeUi={options} />);
    expect(echoes(view.container)).toEqual(['Ada']);
    fireEvent.change(view.getByRole('textbox', { name: 'Guest' }), {
      target: { value: 'Grace' },
    });
    expect(echoes(view.container)).toEqual(['Grace']);
  });

  describe('progressive', () => {
    const streamed = (text: string) => {
      const content = createMessageContent();
      return (length: number, streaming = true) =>
        content.project(snapshot([assistant(text.slice(0, length), 'a', streaming)]));
    };

    it('runs no action from an element whose JSON is still open', () => {
      const book = vi.fn();
      const options: MessageGenerativeUi = {
        registry,
        handlers: { book },
        progressive: true,
      };
      const at = streamed(FORM);
      // The button and its label are here; its `on` binding is half written.
      const view = render(
        <MessageList rows={at(FORM.indexOf('"params"'))} generativeUi={options} />
      );
      fireEvent.click(view.getByRole('button', { name: 'Book' }));
      // The binding has finished, but the element has not.
      const closed = FORM.indexOf('}}}}', FORM.indexOf('"params"')) + 4;
      view.rerender(<MessageList rows={at(closed)} generativeUi={options} />);
      fireEvent.click(view.getByRole('button', { name: 'Book' }));
      expect(book).not.toHaveBeenCalled();

      view.rerender(<MessageList rows={at(closed + 1)} generativeUi={options} />);
      fireEvent.click(view.getByRole('button', { name: 'Book' }));
      expect(book).toHaveBeenCalledTimes(1);
    });

    it('seeds its own state path by path and keeps an edit made between seeds', () => {
      const NOTED = JSON.stringify({
        root: 'form',
        elements: {
          form: { type: 'Box', props: {}, children: ['guest', 'echo', 'note'] },
          guest: { type: 'Field', props: { label: 'Guest', value: { $bindState: '/guest' } } },
          echo: { type: 'Text', props: { text: { $state: '/guest' } } },
          note: { type: 'Text', props: { text: { $state: '/note' } } },
        },
        state: { guest: 'Ada', note: 'Window seat' },
      });
      const events: MessageRenderEvent[] = [];
      const options: MessageGenerativeUi = {
        registry,
        progressive: true,
        onRenderEvent: (event) => {
          if (event.event.type !== 'lifecycle') events.push(event);
        },
      };
      const at = streamed(NOTED);
      const view = render(
        <MessageList rows={at(NOTED.indexOf('"note":"') + 9)} generativeUi={options} />
      );
      expect(echoes(view.container)).toEqual(['Ada', '']);
      fireEvent.change(view.getByRole('textbox', { name: 'Guest' }), {
        target: { value: 'Grace' },
      });
      view.rerender(<MessageList rows={at(NOTED.length, false)} generativeUi={options} />);
      expect(echoes(view.container)).toEqual(['Grace', 'Window seat']);
      // Seeding is not reported as a state write; the edit is.
      expect(events.map(({ event }) => event.type)).toEqual(['stateChange']);
    });
  });
});
