import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  completeDelivery,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import {
  createMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';
import {
  ChatMessage,
  MessageList,
  type ChatMessageRole,
  type MessageListRowContext,
} from '@threadplane/react/chat';
import '@threadplane/react/chat/styles.css';

const roles = ['assistant', 'user', 'system', 'tool'] as const;
const owner = createMessageContent();
const messages: Message[] = roles.flatMap((role) => [
  {
    id: `preceding-${role}`,
    role,
    content: role,
    delivery: completeDelivery('spacing', 'success'),
  },
  {
    id: `following-${role}`,
    role: 'user',
    content: `After ${role}`,
    delivery: completeDelivery('spacing', 'success'),
  },
]);
const projected = owner.project({
  status: 'idle',
  messages,
  toolCalls: [],
} as unknown as AgentSnapshot);
// Projection owns Markdown state; the page owns and explicitly disposes it.
const renderWrapped = (row: MessageRow, context: MessageListRowContext) => (
  <div data-spacing-wrapper={row.id}>
    <ChatMessage
      role={row.role}
      prevRole={context.prevRole}
      current={context.current}
      streaming={row.message.delivery.phase === 'streaming'}
      label={row.id}
    >
      {row.message.content}
    </ChatMessage>
  </div>
);

function MessageSpacingFixture() {
  const [disposed, setDisposed] = useState(false);
  return (
    <main>
      <h1>Installed message spacing</h1>
      <button
        onClick={() => {
          owner.dispose();
          setDisposed(true);
        }}
      >
        Dispose spacing owner
      </button>
      <output data-testid="spacing-owner">
        {disposed ? 'disposed' : 'active'}
      </output>
      {!disposed &&
        (['ltr', 'rtl'] as const).map((direction) => (
          <section
            key={direction}
            dir={direction}
            aria-label={`Spacing ${direction}`}
          >
            <MessageList
              label={`Wrapped ${direction}`}
              rows={projected}
              renderMessage={renderWrapped}
            />
            <MessageList
              label={`First ${direction}`}
              rows={[projected[1]]}
              renderMessage={renderWrapped}
            />
            <MessageList
              label={`Default ${direction}`}
              rows={projected.slice(0, 2)}
            />
            <div aria-label={`Fallback ${direction}`}>
              <ChatMessage role="assistant">Physical assistant</ChatMessage>
              <ChatMessage role="user" label="Missing context">
                Fallback user
              </ChatMessage>
            </div>
            {roles.map((prevRole: ChatMessageRole) => (
              <div key={prevRole}>
                <ChatMessage role="assistant">
                  Conflicting physical assistant
                </ChatMessage>
                <ChatMessage
                  role="user"
                  prevRole={prevRole}
                  label={`Explicit ${prevRole}`}
                >
                  Explicit user
                </ChatMessage>
              </div>
            ))}
          </section>
        ))}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<MessageSpacingFixture />);
