import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  completeDelivery,
  type AgentSession,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import { createA2uiActionMessage } from '@threadplane/content/a2ui';
import { createMessageContent } from '@threadplane/content/messages';
import { Chat, MessageList } from './index';

afterEach(cleanup);

const msg = (id: string, role: Message['role'], content: string): Message =>
  Object.freeze({ id, role, content, delivery: completeDelivery(id, 'success') }) as Message;
const snapshot = (messages: Message[]) =>
  Object.freeze({ status: 'idle', messages, toolCalls: [] }) as AgentSnapshot;
const project = (messages: Message[]) => createMessageContent().project(snapshot(messages));
const action = (fields: Record<string, unknown>) =>
  JSON.stringify({ version: 'v0.9', action: { surfaceId: 's', sourceComponentId: 'b', context: {}, ...fields } });
const bubble = (view: ReturnType<typeof render>) =>
  view.container.querySelector('.tp-chat-message--user');
// The message text alone, without the row's screen-reader role prefix.
const text = (view: ReturnType<typeof render>) =>
  view.container.querySelector('.tp-chat-message--user .tp-markdown')?.textContent;

describe('MessageList A2UI action labels', () => {
  it('leaves the serialized action in place when turned off', () => {
    const view = render(
      <MessageList
        a2uiActionLabels={false}
        rows={project([msg('u', 'user', action({ name: 'bookingSubmit', label: 'Search flights' }))])}
      />
    );
    expect(bubble(view)?.textContent).toContain('"bookingSubmit"');
    expect(view.container.querySelector('[data-a2ui-action]')).toBeNull();
  });

  it('shows the pressed control label in place of the JSON by default', () => {
    const view = render(
      <MessageList
        rows={project([msg('u', 'user', action({ name: 'bookingSubmit', label: 'Search flights' }))])}
      />
    );
    expect(text(view)).toBe('Search flights');
    expect(bubble(view)?.querySelector('.tp-markdown[data-a2ui-action] > p')).not.toBeNull();
  });

  it('labels the message the shared builder produces for a Button', () => {
    const message = createA2uiActionMessage(
      {
        surfaceId: 's',
        components: [
          { id: 'go', component: 'Button', child: 'go-text', action: { event: { name: 'bookingSubmit' } } },
          { id: 'go-text', component: 'Text', text: 'Search flights' },
        ],
        dataModel: {},
      } as never,
      'go',
      '2026-11-17T00:00:00.000Z'
    );
    const view = render(
      <MessageList rows={project([msg('u', 'user', JSON.stringify(message))])} />
    );
    expect(text(view)).toBe('Search flights');
  });

  it('puts the action name in plain words when no label was sent', () => {
    for (const [name, words] of [
      ['bookingSubmit', 'Booking submit'],
      ['addToCart', 'Add to cart'],
      ['refresh', 'Refresh'],
    ]) {
      const view = render(
        <MessageList rows={project([msg('u', 'user', action({ name, label: '' }))])} />
      );
      expect(text(view)).toBe(words);
      cleanup();
    }
  });

  it('leaves every other user message as written', () => {
    for (const content of [
      'Find me a flight',
      '{"city":"Paris"}',
      '{not json',
      '{"version":"v0.9"}',
      '{"version":"v0.9","action":{"label":"No name"}}',
      '{"version":1,"action":{"name":"go"}}',
      '[{"version":"v0.9","action":{"name":"go"}}]',
    ]) {
      const plain = render(<MessageList a2uiActionLabels={false} rows={project([msg('u', 'user', content)])} />);
      const expected = bubble(plain)?.innerHTML;
      cleanup();
      const view = render(<MessageList rows={project([msg('u', 'user', content)])} />);
      expect(bubble(view)?.innerHTML).toBe(expected);
      cleanup();
    }
  });

  it('never relabels an assistant message that quotes an action', () => {
    const content = action({ name: 'bookingSubmit', label: 'Search flights' });
    const view = render(<MessageList rows={project([msg('a', 'assistant', content)])} />);
    const row = view.container.querySelector('.tp-chat-message--assistant');
    expect(row?.textContent).toContain('"bookingSubmit"');
    expect(row?.querySelector('[data-a2ui-action]')).toBeNull();
  });

  it('renders the label as text, not markup', () => {
    const view = render(
      <MessageList
        rows={project([msg('u', 'user', action({ name: 'go', label: '**Bold** <img src=x onerror=alert(1)>' }))])}
      />
    );
    expect(text(view)).toBe('**Bold** <img src=x onerror=alert(1)>');
    expect(bubble(view)?.querySelector('img, strong')).toBeNull();
  });

  it('leaves a custom renderMessage in charge of the row', () => {
    const view = render(
      <MessageList
        renderMessage={(row) => <i data-custom>{row.message.content.length}</i>}
        rows={project([msg('u', 'user', action({ name: 'go', label: 'Go' }))])}
      />
    );
    expect(view.container.querySelector('[data-custom]')).not.toBeNull();
    expect(view.container.querySelector('[data-a2ui-action]')).toBeNull();
  });
});

describe('Chat A2UI action labels', () => {
  const session = (messages: Message[]): AgentSession => {
    const value = snapshot(messages);
    return {
      getSnapshot: () => value,
      subscribe: () => () => undefined,
      submit: async () => undefined,
      stop: async () => undefined,
    } as unknown as AgentSession;
  };
  const messages = [msg('u', 'user', action({ name: 'bookingSubmit', label: 'Search flights' }))];

  it('passes the choice through to its transcript', () => {
    const off = render(<Chat session={session(messages)} a2uiActionLabels={false} />);
    expect(bubble(off)?.textContent).toContain('"bookingSubmit"');
    cleanup();
    const on = render(<Chat session={session(messages)} />);
    expect(text(on)).toBe('Search flights');
  });
});
