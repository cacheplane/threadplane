import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createRoot } from 'react-dom/client';
import { createSession } from '@threadplane/ag-ui';
import {
  ChatInput,
  ToolActivityGroup,
  MessageList,
  toolOutcomes,
  type ToolActivityInfo,
  type ChatInputHandle,
} from '@threadplane/react/chat';
import '@threadplane/react/chat/styles.css';
import './shell.css';
import { toolLabel, toolDecoders } from './tool-outcome';
const scenario =
  new URLSearchParams(location.search).get('scenario') ?? 'references';
// The application decodes its own tool schemas; only this scenario's backend can retry a read.
const toolOutcome = toolOutcomes(
  toolDecoders({ retryReads: scenario === 'partial-failure' })
);
function App() {
  const [session] = useState(() =>
    createSession({
      threadId: crypto.randomUUID(),
      url: `http://127.0.0.1:4809/ag-ui?participant=threadplane-react&scenario=${scenario}`,
    })
  );
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const busy = snapshot.status === 'running';
  const [decisionError, setDecisionError] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const decision = snapshot.decision;
  // Every observed call in transcript order, paired with its tool message.
  const activities: ToolActivityInfo[] = snapshot.transcript.flatMap(
    (message) =>
      message.role === 'assistant'
        ? (message.toolCalls ?? []).map((call) => {
            const result = snapshot.transcript.find(
              (message) =>
                message.role === 'tool' && message.toolCallId === call.id
            );
            const activity: ToolActivityInfo = {
              id: call.id,
              name: call.function.name,
              label: toolLabel(call.function.name),
              phase: result
                ? 'complete'
                : busy
                ? 'running'
                : decision?.kind === 'native' ||
                  snapshot.run?.outcome === 'paused'
                ? 'waiting'
                : snapshot.run?.outcome === 'aborted'
                ? 'stopped'
                : 'unknown',
              argumentsText: call.function.arguments,
              resultText:
                result && typeof result.content === 'string'
                  ? result.content
                  : undefined,
            };
            // A declared failed outcome turns the complete call into a failed row.
            return { ...activity, outcome: toolOutcome(activity) };
          })
        : []
  );
  const root = useRef<HTMLElement>(null);
  const composer = useRef<ChatInputHandle>(null);
  const disposed = useRef(false);
  const pendingFocus = useRef<
    { owned: boolean; cleanup: () => void } | undefined
  >(undefined);
  const [focusCommit, setFocusCommit] = useState(0);
  useLayoutEffect(() => {
    const focus = pendingFocus.current;
    if (!focus || !focusCommit) return;
    pendingFocus.current = undefined;
    focus.cleanup();
    const document = root.current?.ownerDocument;
    if (
      focus.owned &&
      !disposed.current &&
      root.current?.isConnected &&
      !session.getSnapshot().decision &&
      document?.activeElement === document?.body
    )
      composer.current?.focus();
  }, [focusCommit, session]);
  async function decide(approved: boolean) {
    if (decision?.kind !== 'native') return;
    const document = root.current?.ownerDocument;
    const approval = document?.activeElement?.closest('.benchmark-decision');
    const focus = {
      owned: !!approval && !!root.current?.contains(approval),
      cleanup: () => document?.removeEventListener('focusin', onFocus),
    };
    const onFocus = (event: FocusEvent) => {
      if (!approval?.contains(event.target as Node)) focus.owned = false;
    };
    document?.addEventListener('focusin', onFocus);
    pendingFocus.current?.cleanup();
    pendingFocus.current = focus;
    setDecisionError('');
    try {
      await session.resume(
        decision.id,
        decision.interrupts.map((interrupt) => ({
          interruptId: interrupt.id,
          status: 'resolved' as const,
          payload: approved,
        }))
      );
      if (!disposed.current) setFocusCommit((commit) => commit + 1);
    } catch (error) {
      focus.cleanup();
      if (pendingFocus.current === focus) pendingFocus.current = undefined;
      setDecisionError(String(error));
    }
  }
  useEffect(
    () => () => {
      disposed.current = true;
      pendingFocus.current?.cleanup();
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
            disposed.current = true;
            pendingFocus.current?.cleanup();
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
      <main
        ref={root}
        className={`benchmark-chat${
          ['partial-failure', 'long-mixed', 'native-approval'].includes(
            scenario
          )
            ? ''
            : ' benchmark-chat--default-activity'
        }`}
      >
        <div className="tp-chat">
          <MessageList rows={[]}>
            {snapshot.transcript
              .filter((message) => message.role !== 'tool')
              .map((message) => (
                <article
                  className={`tp-chat-message tp-chat-message--${message.role}`}
                  key={message.id}
                >
                  {message.role === 'assistant' &&
                    !!message.toolCalls?.length && (
                      <ToolActivityGroup
                        activities={activities.filter((activity) =>
                          message.toolCalls?.some(
                            (call) => call.id === activity.id
                          )
                        )}
                        context={activities}
                        onRetry={
                          busy
                            ? undefined
                            : () =>
                                void session.submit(
                                  'Retry the failed read explicitly.'
                                )
                        }
                      />
                    )}
                  <p className="benchmark-message-text">
                    {typeof message.content === 'string'
                      ? message.content
                      : JSON.stringify(message.content)}
                  </p>
                  {message.role === 'assistant' &&
                    typeof message.content === 'string' &&
                    message.content.trim() && (
                      <div
                        className="benchmark-message-actions"
                        role="toolbar"
                        aria-label="Message actions"
                      >
                        <button
                          aria-label={
                            copiedId === message.id
                              ? 'Copied'
                              : 'Copy to clipboard'
                          }
                          onClick={async () => {
                            await navigator.clipboard.writeText(
                              message.content as string
                            );
                            setCopiedId(message.id);
                          }}
                        >
                          {copiedId === message.id ? (
                            <span aria-hidden="true">✓</span>
                          ) : (
                            <svg
                              viewBox="0 0 24 24"
                              width="16"
                              height="16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <rect x="9" y="9" width="11" height="11" rx="2" />
                              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                            </svg>
                          )}
                        </button>
                      </div>
                    )}
                </article>
              ))}
            {decision?.kind === 'native' && (
              <section
                className="benchmark-decision"
                aria-label="Save approval"
              >
                <h2>Approve saving the comparison note?</h2>
                <p>The note is saved only after your approval.</p>
                <div>
                  <button
                    disabled={busy || !!decision.attempt}
                    onClick={() => void decide(true)}
                  >
                    Approve save
                  </button>
                  <button
                    disabled={busy || !!decision.attempt}
                    onClick={() => void decide(false)}
                  >
                    Deny save
                  </button>
                </div>
              </section>
            )}
            {decisionError && <p role="alert">{decisionError}</p>}
            {snapshot.status === 'error' && (
              <div className="benchmark-recovery" role="alert">
                <p>The benchmark run failed.</p>
              </div>
            )}
          </MessageList>
          <div className="benchmark-composer">
            <ChatInput
              ref={composer}
              busy={busy}
              disabled={!!decision}
              placeholder="Type a message..."
              onSubmit={(text) => {
                void session.submit(text);
              }}
              onStop={() => void session.stop()}
            />
          </div>
        </div>
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
