import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  completeDelivery,
  type AgentSession,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import { createMessageContent } from '@threadplane/content/messages';
import type {
  MarkdownComponentProps,
  MarkdownComponents,
} from '../markdown/index.js';
import { MarkdownComponentsProvider } from '../markdown/index.js';
import { Chat, MessageList } from './index';

afterEach(cleanup);

const messages = [
  Object.freeze({
    id: 'u',
    role: 'user',
    content: '```\nasked\n```',
    delivery: completeDelivery('u', 'success'),
  }),
  Object.freeze({
    id: 'a',
    role: 'assistant',
    content: 'Here:\n\n```ts\nconst a = 1;\n```',
    delivery: completeDelivery('a', 'success'),
  }),
] as unknown as Message[];
const snapshot = Object.freeze({
  status: 'idle',
  messages,
  toolCalls: [],
}) as AgentSnapshot;
function Highlighted({ node }: MarkdownComponentProps<'code-block'>) {
  return <figure>{node.text}</figure>;
}
const components: MarkdownComponents = { 'code-block': Highlighted };
const figures = (view: ReturnType<typeof render>) =>
  Array.from(view.container.querySelectorAll('figure'), (n) => n.textContent);
const session = {
  getSnapshot: () => snapshot,
  subscribe: () => () => undefined,
  submit: async () => 'success',
  stop: async () => undefined,
  dispose: async () => undefined,
} as unknown as AgentSession;

describe('Markdown components in the transcript', () => {
  it('MessageList replaces the chosen node in message text only when given components', () => {
    const rows = createMessageContent().project(snapshot);
    const view = render(<MessageList rows={rows} />);
    expect(figures(view)).toEqual([]);
    expect(view.getAllByRole('button', { name: 'Copy code' })).toHaveLength(2);
    view.rerender(<MessageList rows={rows} markdownComponents={components} />);
    expect(figures(view)).toEqual(['asked', 'const a = 1;']);
  });

  it('Chat passes components to its transcript and picks up a provider', () => {
    const view = render(<Chat session={session} />);
    expect(figures(view)).toEqual([]);
    view.rerender(<Chat session={session} markdownComponents={components} />);
    expect(figures(view)).toEqual(['asked', 'const a = 1;']);
    view.rerender(
      <MarkdownComponentsProvider components={components}>
        <Chat session={session} />
      </MarkdownComponentsProvider>
    );
    expect(figures(view)).toEqual(['asked', 'const a = 1;']);
  });
});
