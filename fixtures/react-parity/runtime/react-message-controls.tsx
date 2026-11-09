import { createContext, useContext, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  completeDelivery,
  streamingDelivery,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import {
  createMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';
import {
  ChatMessage,
  MessageActions,
  MessageList,
  type MessageListRowContext,
} from '@threadplane/react/chat';
import '@threadplane/react/chat/styles.css';

const owner = createMessageContent();
const ActionContext = createContext<(id: string) => void>(() => undefined);
function Actions({ id }: { id: string }) {
  const select = useContext(ActionContext);
  return (
    <MessageActions
      label={`Actions ${id}`}
      actions={[
        { id: 'first', label: `Act ${id}`, onSelect: () => select(id) },
        { id: 'second', label: `Again ${id}`, onSelect: () => select(id) },
      ]}
    />
  );
}
// A stable renderer lets MessageList retain rows while its current/prevRole
// primitives change. The page owns projection, local commands and feedback.
const renderMessage = (row: MessageRow, context: MessageListRowContext) => (
  <>
    <button type="button">Before {row.id}</button>
    <ChatMessage
      role={row.role}
      label={row.id}
      current={context.current}
      prevRole={context.prevRole}
      streaming={row.message.delivery.phase === 'streaming'}
      controls={<Actions id={row.id} />}
    >
      {row.message.content}
    </ChatMessage>
  </>
);
const initialMessages: Message[] = [
  ['historical', 'assistant'],
  ['user', 'user'],
  ['system', 'system'],
  ['tool', 'tool'],
  ['current', 'assistant'],
].map(([id, role]) => ({
  id,
  role: role as Message['role'],
  content: `Content ${id}`,
  delivery: completeDelivery('controls', 'success'),
}));

function MessageControlsFixture() {
  const [messages, setMessages] = useState(initialMessages);
  const [calls, setCalls] = useState<Record<string, number>>({});
  const [disposed, setDisposed] = useState(false);
  const [direction, setDirection] = useState<'ltr' | 'rtl'>('ltr');
  const rows = useMemo(
    () =>
      disposed
        ? []
        : owner.project({
            status: 'idle',
            messages,
            toolCalls: [],
          } as unknown as AgentSnapshot),
    [messages, disposed]
  );
  return (
    <main dir={direction}>
      <h1>Installed message controls</h1>
      <nav aria-label="Fixture commands">
        <button
          onClick={() =>
            setMessages((previous) => [
              ...previous,
              {
                id: 'appended',
                role: 'user',
                content: 'Appended user',
                delivery: completeDelivery('controls', 'success'),
              },
            ])
          }
        >
          Append user
        </button>
        <button
          onClick={() =>
            setMessages((previous) =>
              previous.filter((message) => message.id !== 'appended')
            )
          }
        >
          Remove user
        </button>
        <button
          onClick={() =>
            setMessages((previous) => [
              ...previous.filter((message) => message.id !== 'historical'),
              previous.find((message) => message.id === 'historical')!,
            ])
          }
        >
          Move historical last
        </button>
        <button
          onClick={() =>
            setMessages((previous) =>
              initialMessages.map(
                (initial) =>
                  previous.find((message) => message.id === initial.id)!
              )
            )
          }
        >
          Restore order
        </button>
        <button
          onClick={() =>
            setMessages((previous) =>
              previous.map((message) =>
                message.role === 'assistant'
                  ? {
                      ...message,
                      delivery:
                        message.delivery.phase === 'streaming'
                          ? completeDelivery('controls', 'success')
                          : streamingDelivery('controls'),
                    }
                  : message
              )
            )
          }
        >
          Toggle streaming
        </button>
        <button
          onClick={() =>
            setDirection((previous) => (previous === 'ltr' ? 'rtl' : 'ltr'))
          }
        >
          Toggle direction
        </button>
        <button
          onClick={() => {
            owner.dispose();
            setDisposed(true);
          }}
        >
          Dispose controls owner
        </button>
      </nav>
      <output data-testid="controls-owner">
        {disposed ? 'disposed' : 'active'}
      </output>
      <output data-testid="action-counts">{JSON.stringify(calls)}</output>
      <ActionContext.Provider
        value={(id) =>
          setCalls((previous) => ({
            ...previous,
            [id]: (previous[id] ?? 0) + 1,
          }))
        }
      >
        {!disposed && (
          <>
            <MessageList
              label="Controls transcript"
              rows={rows}
              renderMessage={renderMessage}
            />
            <ChatMessage role="assistant" label="Nested host">
              <div
                className="tp-chat-message__controls"
                data-testid="nested-controls"
              >
                <Actions id="nested" />
              </div>
            </ChatMessage>
            <Actions id="standalone" />
          </>
        )}
      </ActionContext.Provider>
      <button type="button">After transcript</button>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<MessageControlsFixture />);
