// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated consumer copies this internal example layout.
import { ExampleFooter, ExampleLayout } from '../../../../shared/react-example';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ChatInput,
  MessageList,
  type ChatInputHandle,
} from '@threadplane/react/chat';
import type { A2uiApplication } from './application';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Same-layout private presentation source in installed consumers.
import { A2uiSurface } from '../../../../../libs/cockpit-a2ui-react/src/index';

function humanText(content: string) {
  try {
    const value = JSON.parse(content);
    if (value.version === 'v0.9') {
      const labels: Record<string, string> = {
        bookingSubmit: 'Search flights',
        flightSelect: 'Select demonstration flight',
        modifySearch: 'Modify search',
      };
      if (Object.hasOwn(labels, value.action?.name))
        return labels[value.action.name];
    }
  } catch {
    /* Ordinary human text. */
  }
  return content;
}
function SavedText({ content }: { readonly content: string }) {
  const at = content.indexOf('---a2ui_JSON---');
  return at < 0 ? (
    <p className="a2ui-prose">{content}</p>
  ) : (
    <>
      {content.slice(0, at).trim() && (
        <p className="a2ui-prose">{content.slice(0, at).trim()}</p>
      )}
      <details className="a2ui-wire">
        <summary>Response details</summary>
        <pre>{content.slice(at)}</pre>
      </details>
    </>
  );
}
/** Main owns the application. React only observes it and borrows its commands. */
export function A2uiDemo({
  application,
  onReady,
}: {
  readonly application: A2uiApplication;
  readonly onReady: () => void;
}) {
  const snapshot = useSyncExternalStore(
    application.subscribe,
    application.getSnapshot
  );
  const [draft, setDraft] = useState('');
  const composer = useRef<ChatInputHandle>(null);
  useEffect(onReady, [onReady]);
  const status = snapshot.busy
    ? snapshot.activity === 'replacing'
      ? 'Starting a new conversation…'
      : 'Waiting for the confirmed preview…'
    : snapshot.error
    ? 'Start a new conversation to continue.'
    : snapshot.messages.length
    ? 'Preview confirmed.'
    : 'Ready.';
  return (
    <ExampleLayout className="a2ui-demo">
      <header>
        <div>
          <h1>Plan a flight</h1>
        </div>
        <button
          type="button"
          onClick={() => {
            setDraft('');
            void application.newConversation().catch(() => undefined);
          }}
        >
          New conversation
        </button>
      </header>
      <p>
        Flight preview: request a flight form, edit your details, and select a
        demonstration flight. This preview makes no booking or payment.
      </p>
      {snapshot.messages.length === 0 && (
        <button
          className="a2ui-suggestion"
          type="button"
          disabled={snapshot.busy || !snapshot.canSubmit}
          onClick={() => {
            setDraft('I want to fly LAX to JFK');
            composer.current?.focus();
          }}
        >
          Try a flight request
        </button>
      )}
      <MessageList
        rows={[]}
        label="Conversation"
        className="a2ui-conversation"
        key={`messages:${snapshot.viewGeneration}`}
      >
        {!snapshot.messages.length && (
          <p className="a2ui-empty">
            Your confirmed flight previews will appear here.
          </p>
        )}
        {snapshot.messages.map((message) => {
          const surface = snapshot.surfaces.find(
            (s) => s.messageId === message.id
          );
          return (
            <article
              key={message.id}
              className={`tp-chat-message tp-chat-message--${message.role} a2ui-message a2ui-message--${message.role}`}
              aria-label={message.role === 'user' ? 'You' : 'Assistant'}
            >
              <p className="tp-chat-message__role a2ui-message-role">
                {message.role === 'user' ? 'You' : 'Assistant'}
              </p>
              {surface ? (
                <A2uiSurface
                  surface={surface}
                  active={
                    snapshot.activeSurface === surface.id &&
                    !snapshot.busy &&
                    snapshot.canSubmit
                  }
                />
              ) : message.role === 'user' ? (
                <p className="a2ui-prose">{humanText(message.content)}</p>
              ) : (
                <SavedText content={message.content} />
              )}
            </article>
          );
        })}
      </MessageList>
      {snapshot.error && snapshot.native && (
        <details className="a2ui-wire">
          <summary>Unconfirmed response details</summary>
          <pre>
            {JSON.stringify(snapshot.native.transcript, null, 2).slice(
              0,
              100000
            )}
          </pre>
        </details>
      )}
      <ExampleFooter>
        {snapshot.error && <p role="alert">{snapshot.error}</p>}
        <ChatInput
          ref={composer}
          key={snapshot.viewGeneration}
          label="Message"
          value={draft}
          onValueChange={setDraft}
          placeholder="Ask for a flight form…"
          hint="Enter to send. Shift+Enter adds a new line."
          busy={snapshot.busy}
          disabled={!snapshot.canSubmit && !snapshot.busy}
          onStop={
            snapshot.busy
              ? () => {
                  void application.stop().catch(() => undefined);
                }
              : undefined
          }
          onSubmit={(text) => {
            const state = application.getSnapshot();
            if (state.busy || !state.canSubmit) return false;
            // ChatInput clears this admitted draft synchronously, independently of settlement.
            void application.submit(text).catch(() => undefined);
            return true;
          }}
        />
        <p role="status">{status}</p>
      </ExampleFooter>
    </ExampleLayout>
  );
}
