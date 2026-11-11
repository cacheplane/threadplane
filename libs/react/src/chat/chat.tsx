'use client';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { AgentSession } from '@threadplane/core';
import type { MessageContent } from '@threadplane/content/messages';
import { useAgent } from '../use-agent.js';
import {
  ChatInput,
  type ChatInputHandle,
  type ChatInputProps,
} from './chat-input.js';
import { ChatError } from './error.js';
import { useMessageContent } from './internal/use-message-content.js';
import {
  MessageList,
  repeatsToolFailure,
  type MessageListProps,
} from './message-list.js';
import { isTyping, TypingIndicator } from './typing-indicator.js';
import { ScrollBubble } from './scroll-bubble.js';

/** Supplies an app-owned agent session, optional transcript projector, and message/composer presentation options. */
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
  readonly renderMessage?: MessageListProps['renderMessage'];
  readonly className?: string;
  readonly groupRelatedTools?: MessageListProps['groupRelatedTools'];
  readonly toolLabel?: MessageListProps['toolLabel'];
  /** App-authored confirmed result previews, or `status: 'failed'` to show a completed call as failed; execution and business confirmation remain app-owned. */
  readonly toolOutcome?: MessageListProps['toolOutcome'];
  /** App-owned rich result or action per tool call; execution and retry intent remain app-owned. Keep stable. */
  /** App-owned presentation for one tool call; see `MessageListProps.renderToolCall`. Keep stable. */
  readonly renderToolCall?: MessageListProps['renderToolCall'];
  readonly renderToolResult?: MessageListProps['renderToolResult'];
  /** Child agents shown as subagent cards in place of the tool calls that started them. Keep stable. */
  readonly subagents?: MessageListProps['subagents'];
  /** Application-owned handler for a retry declared by `toolOutcome`; Chat never re-runs a call. Keep stable. */
  readonly onToolRetry?: MessageListProps['onToolRetry'];
  /** Explicit application-owned retry intent; Chat never replays a submission. */
  readonly onRetry?: () => void;
  /** App-owned notice above the composer; see `ChatInputProps.banner`. */
  readonly inputBanner?: ChatInputProps['banner'];
  /** App-owned content above the input surface; see `ChatInputProps.attachments`. */
  readonly inputAttachments?: ChatInputProps['attachments'];
  /**
   * A pending approval, such as an `ApprovalCard`, shown at the end of the transcript. While it is
   * set, the composer reads "Answer the approval to continue"; once it clears, focus returns to the
   * composer. The app decides when it is pending and what answering does.
   */
  readonly approval?: ReactNode;
  /** Answered approvals as one-line records in the transcript; see `MessageListProps.approvalRecords`. */
  readonly approvalRecords?: MessageListProps['approvalRecords'];
  /** App-owned content before the draft; see `ChatInputProps.leading`. */
  readonly inputLeading?: ChatInputProps['leading'];
  /** App-owned controls before Stop and Send; see `ChatInputProps.trailing`. */
  readonly inputTrailing?: ChatInputProps['trailing'];
  /** App-owned content below the composer; see `ChatInputProps.footer`. */
  readonly inputFooter?: ChatInputProps['footer'];
}

const ignore = () => undefined;

/** Transcript, error and composer wired to an app-owned `AgentSession`. */
export function Chat({
  session,
  content,
  renderMessage,
  className,
  groupRelatedTools,
  toolLabel,
  toolOutcome,
  renderToolCall,
  renderToolResult,
  subagents,
  onToolRetry,
  onRetry,
  inputBanner,
  inputAttachments,
  inputLeading,
  inputTrailing,
  inputFooter,
  approval,
  approvalRecords,
  ...input
}: ChatProps) {
  const snapshot = useAgent(session);
  // Stable so the current transcript row keeps its memo while work runs.
  const stop = useCallback(() => {
    session.stop().catch(ignore);
  }, [session]);
  // Answering removes the approval and its focused button; continue in the composer.
  const composer = useRef<ChatInputHandle>(null);
  const pending =
    approval !== undefined && approval !== null && approval !== false;
  const hadApproval = useRef(pending);
  useEffect(() => {
    if (hadApproval.current && !pending) composer.current?.focus();
    hadApproval.current = pending;
  }, [pending]);
  const rows = useMessageContent(snapshot, session, content);
  // A failed call already shows these words, and the notice would add no action or detail of its own.
  // A custom renderMessage owns that display, so the notice stays whenever one is in use.
  const error = snapshot.error;
  const repeated =
    !!error &&
    !renderMessage &&
    !error.detail &&
    error.recovery !== 'check' &&
    !(
      onRetry &&
      error.retryable &&
      (error.recovery === 'retry' || error.recovery === undefined)
    ) &&
    repeatsToolFailure(error.message, rows, toolOutcome);
  return (
    <div className={['tp-chat', className].filter(Boolean).join(' ')}>
      <MessageList
        rows={rows}
        renderMessage={renderMessage}
        groupRelatedTools={groupRelatedTools}
        toolLabel={toolLabel}
        toolOutcome={toolOutcome}
        renderToolCall={renderToolCall}
        renderToolResult={renderToolResult}
        subagents={subagents}
        onToolRetry={onToolRetry}
        plan={snapshot.plan}
        onStop={snapshot.status === 'running' ? stop : undefined}
        approvalRecords={approvalRecords}
        renderScrollControl={(controls) =>
          controls.pinned ? null : (
            <ScrollBubble
              mode={snapshot.status === 'running' ? 'streaming' : 'idle'}
              onClick={() => {
                controls.scrollToLatest();
                controls.focus();
              }}
            />
          )
        }
      >
        {pending ? approval : null}
      </MessageList>
      <TypingIndicator active={isTyping(snapshot)} />
      <ChatError
        error={repeated ? undefined : snapshot.error}
        className="tp-chat__error"
        onRetry={
          onRetry &&
          (() => {
            if (session.getSnapshot().error === snapshot.error) onRetry();
          })
        }
        onCheckStatus={
          session.checkStatus &&
          (() => {
            const checkStatus = session.checkStatus;
            if (checkStatus && session.getSnapshot().error === snapshot.error) {
              checkStatus.call(session).catch(ignore);
            }
          })
        }
      />
      <ChatInput
        ref={composer}
        key={sessionKey(session)}
        {...input}
        banner={inputBanner}
        attachments={inputAttachments}
        placeholder={
          pending ? 'Answer the approval to continue' : input.placeholder
        }
        leading={inputLeading}
        trailing={inputTrailing}
        footer={inputFooter}
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
