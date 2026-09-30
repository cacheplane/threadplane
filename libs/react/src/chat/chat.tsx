'use client';
import type { ReactNode } from 'react';
import type { AgentSession } from '@threadplane/core';
import type { MessageContent, MessageRow } from '@threadplane/content/messages';
import { useAgent } from '../use-agent.js';
import { ChatInput, type ChatInputProps } from './chat-input.js';
import { useMessageContent } from './internal/use-message-content.js';
import { MessageList } from './message-list.js';

export interface ChatProps
  extends Pick<
    ChatInputProps,
    'label' | 'placeholder' | 'hint' | 'submitOnEnter'
  > {
  /** App-owned session. Chat observes and dispatches; it never disposes it. */
  readonly session: AgentSession;
  /** App-owned projection; reused across remounts and never disposed by Chat. */
  readonly content?: MessageContent;
  /** Must be referentially stable; see `MessageListProps.renderMessage`. */
  readonly renderMessage?: (row: MessageRow) => ReactNode;
  readonly className?: string;
}

const ignore = () => undefined;

/** Transcript, error and composer wired to an app-owned `AgentSession`. */
export function Chat({
  session,
  content,
  renderMessage,
  className,
  ...input
}: ChatProps) {
  const snapshot = useAgent(session);
  const rows = useMessageContent(snapshot, session, content);
  return (
    <div className={['tp-chat', className].filter(Boolean).join(' ')}>
      <MessageList rows={rows} renderMessage={renderMessage} />
      {snapshot.error && (
        <p role="alert" className="tp-chat__error">
          {snapshot.error.message}
        </p>
      )}
      <ChatInput
        key={sessionKey(session)}
        {...input}
        busy={snapshot.status === 'running'}
        onSubmit={(text) => {
          session.submit(text.trim()).catch(ignore);
        }}
        onStop={() => {
          session.stop().catch(ignore);
        }}
      />
    </div>
  );
}

const keys = new WeakMap<object, number>();
let nextKey = 0;
function sessionKey(session: object): number {
  let key = keys.get(session);
  if (key === undefined) keys.set(session, (key = ++nextKey));
  return key;
}
