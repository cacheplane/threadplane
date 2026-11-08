import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createSession } from '@threadplane/ag-ui';
import { ChatInput, ToolActivityGroup, MessageList } from '@threadplane/react/chat';
import '@threadplane/react/chat/styles.css';
import './shell.css';
const scenario =
  new URLSearchParams(location.search).get('scenario') ?? 'references';
function App() {
  const [session] = useState(() =>
    createSession({
      threadId: crypto.randomUUID(),
      url: `http://127.0.0.1:4809/ag-ui?participant=threadplane-react&scenario=${scenario}`,
    })
  );
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const busy = snapshot.status === 'running';
  const toolLabel = (name: string) =>
    name === 'search_reference'
      ? 'Finding reference sources'
      : name === 'read_reference'
      ? 'Reading reference sources'
      : undefined;
  useEffect(
    () => () => {
      void session.dispose();
    },
    [session]
  );
  return (
    <>
      <header className="benchmark-header">
        <div>
          <h1>Tool conversation benchmark · React</h1>
          <p>Scripted agent · real local tools · {scenario} · installed SDK</p>
        </div>
        <button
          onClick={async () => {
            await session.dispose();
            await fetch('http://127.0.0.1:4809/reset/threadplane-react', {
              method: 'POST',
            });
            location.reload();
          }}
        >
          New conversation
        </button>
      </header>
      <main className="benchmark-chat">
        <div className="tp-chat">
          <MessageList rows={[]}>
            {snapshot.transcript
              .filter((message) => message.role !== 'tool')
              .map((message) => (
                <article
                  className={`tp-chat-message tp-chat-message--${message.role}`}
                  key={message.id}
                  style={{ marginBottom: 24 }}
                >
                  {message.role === 'assistant' &&
                    !!message.toolCalls?.length && (
                      <ToolActivityGroup
                        activities={message.toolCalls.map((call) => {
                          const result = snapshot.transcript.find(
                            (message) =>
                              message.role === 'tool' &&
                              message.toolCallId === call.id
                          );
                          return {
                            id: call.id,
                            name: call.function.name,
                            label: toolLabel(call.function.name),
                            phase: result
                              ? 'complete'
                              : busy
                              ? 'running'
                              : snapshot.run?.outcome === 'aborted'
                              ? 'stopped'
                              : 'unknown',
                            argumentsText: call.function.arguments,
                            resultText:
                              result && typeof result.content === 'string'
                                ? result.content
                                : undefined,
                          };
                        })}
                      />
                    )}
                  <p>
                    {typeof message.content === 'string'
                      ? message.content
                      : JSON.stringify(message.content)}
                  </p>
                </article>
              ))}
          </MessageList>
          {snapshot.status === 'error' && (
            <p role="alert">
              The benchmark run failed. Start a new conversation to retry.
            </p>
          )}
          <ChatInput
            busy={busy}
            onSubmit={(text) => {
              void session.submit(text);
            }}
            onStop={() => void session.stop()}
          />
        </div>
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
