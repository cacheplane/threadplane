'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AgentSession, AgentSnapshot } from '@threadplane/core';
import type { MessageContent } from '@threadplane/content/messages';
import { useAgent } from '../use-agent.js';
import {
  ChatInput,
  type ChatInputHandle,
  type ChatInputProps,
} from './chat-input.js';
import {
  useClientToolCalls,
  usePendingClientToolCalls,
  type ChatClientTools,
} from './client-tools.js';
import { ChatError } from './error.js';
import { useMessageContent } from './internal/use-message-content.js';
import {
  ChatLifecycleContext,
  createChatLifecycleStore,
  type ChatLifecycle,
} from './lifecycle.js';
import {
  MessageList,
  repeatsToolFailure,
  type MessageListProps,
} from './message-list.js';
import { ScrollBubble } from './scroll-bubble.js';
import { sessionSubagents } from './session-subagents.js';
import { Select, type SelectOption } from './select.js';
import { ThreadList, type ThreadListItem } from './thread-list.js';

/** Supplies an app-owned agent session, optional transcript projector, and message/composer presentation options. */
export interface ChatProps
  extends Pick<
    ChatInputProps,
    | 'label'
    | 'placeholder'
    | 'hint'
    | 'submitOnEnter'
    | 'disabled'
    | 'runningHint'
  > {
  /** App-owned session. Chat observes and dispatches; it never disposes it. */
  readonly session: AgentSession;
  /** App-owned projection; reused across remounts and never disposed by Chat. */
  readonly content?: MessageContent;
  /** Must be referentially stable; see `MessageListProps.renderMessage`. */
  readonly renderMessage?: MessageListProps['renderMessage'];
  readonly className?: string;
  readonly groupRelatedTools?: MessageListProps['groupRelatedTools'];
  /** Generative UI dispatcher tools whose rows stay hidden; see `MessageListProps.genuiToolNames`. Keep stable. */
  readonly genuiToolNames?: MessageListProps['genuiToolNames'];
  readonly toolLabel?: MessageListProps['toolLabel'];
  /** App-authored confirmed result previews, or `status: 'failed'` to show a completed call as failed; execution and business confirmation remain app-owned. */
  readonly toolOutcome?: MessageListProps['toolOutcome'];
  /** App-owned rich result or action per tool call; execution and retry intent remain app-owned. Keep stable. */
  /** App-owned presentation for one tool call; see `MessageListProps.renderToolCall`. Keep stable. */
  readonly renderToolCall?: MessageListProps['renderToolCall'];
  readonly renderToolResult?: MessageListProps['renderToolResult'];
  /**
   * Interactive client tools from `createClientTools`. While one of its calls waits for the person,
   * its view is drawn below the message's tool calls and the call keeps its row; the answer
   * becomes the tool result, the view goes, and focus moves to the next view still waiting, or to
   * the composer when none is. The app passes `clientTools.tools` to the session; Chat never runs a tool. Off unless set.
   */
  readonly clientTools?: ChatClientTools;
  /**
   * Child agents shown as subagent cards in place of the tool calls that started them. Keep stable.
   * Left unset, Chat shows the child agents the session reports in `snapshot.subagents`. Pass a list,
   * which may be empty, to show that instead.
   */
  readonly subagents?: MessageListProps['subagents'];
  /** Application-owned handler for a retry declared by `toolOutcome`; Chat never re-runs a call. Keep stable. */
  readonly onToolRetry?: MessageListProps['onToolRetry'];
  /** Explicit application-owned retry intent; Chat never replays a submission. */
  readonly onRetry?: () => void;
  /**
   * App-owned content in a bar above the transcript, such as a title and
   * actions. It steps aside while the `welcome` greeting shows. Off unless set.
   */
  readonly header?: ReactNode;
  /**
   * Conversations listed in a sidebar beside the chat, on viewports at least
   * 768px wide. Passing the prop, even as an empty array, wraps the chat in a
   * `tp-chat-shell` row; the sidebar appears once there are conversations.
   * For row actions, projects or a collapsible sidebar, compose `ChatSidenav`
   * instead.
   */
  readonly threads?: readonly ThreadListItem[];
  /** The conversation marked as current in the `threads` sidebar. */
  readonly activeThreadId?: string | null;
  /** Called with the chosen conversation's ID; the app switches sessions. */
  readonly onThreadSelect?: (threadId: string) => void;
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
  /** Built-in Copy and rating under finished assistant messages; see `MessageListProps.messageActions`. Keep stable. */
  readonly messageActions?: MessageListProps['messageActions'];
  /** Typesets math in message text; see `MessageListProps.math`. Keep stable. */
  readonly math?: MessageListProps['math'];
  /** Generated UI rendered from assistant messages in the transcript; see `MessageListProps.generativeUi`. Keep stable. Off unless set. */
  readonly generativeUi?: MessageListProps['generativeUi'];
  /** Replaces how chosen Markdown node types render; see `MessageListProps.markdownComponents`. Define it outside render. */
  readonly markdownComponents?: MessageListProps['markdownComponents'];
  /** Replaces an assistant message's reasoning and tool-call area; see `MessageListProps.renderMessageActivity`. Keep stable. */
  readonly renderMessageActivity?: MessageListProps['renderMessageActivity'];
  /** One reasoning disclosure per multi-step turn; see `MessageListProps.mergeReasoning`. Defaults to true. */
  readonly mergeReasoning?: MessageListProps['mergeReasoning'];
  /** Shows an A2UI action sent as a user message by its label; see `MessageListProps.a2uiActionLabels`. Defaults to true. */
  readonly a2uiActionLabels?: MessageListProps['a2uiActionLabels'];
  /**
   * The waiting indicator in the transcript; see `MessageListProps.typingIndicator`. Pass
   * `{ announce: false }` when the app already announces progress, such as a status in
   * `inputFooter`, so the run is not read twice.
   */
  readonly typingIndicator?: MessageListProps['typingIndicator'];
  /**
   * Replaces the typing indicator between a submit and the run's first
   * assistant message, which can be long when the first model call is slow.
   * It receives the current run's messages (those after the last user message)
   * and renders in a polite status region after the last message. Once an
   * assistant message arrives it leaves, and the message's own reasoning and
   * tool area takes over. Define it outside render or keep it stable.
   */
  readonly renderRunActivity?: (context: ChatRunActivityContext) => ReactNode;
  /** App-owned content before the draft; see `ChatInputProps.leading`. */
  readonly inputLeading?: ChatInputProps['leading'];
  /** App-owned controls before Stop and Send; see `ChatInputProps.trailing`. */
  readonly inputTrailing?: ChatInputProps['trailing'];
  /** App-owned content below the composer; see `ChatInputProps.footer`. */
  readonly inputFooter?: ChatInputProps['footer'];
  /**
   * A model picker in the composer, before `inputTrailing`. The app owns the
   * value: `onValueChange` reports a choice and nothing is sent to the session,
   * so pass the chosen model to your backend yourself. Hidden while `options`
   * is empty. Off unless set.
   */
  readonly modelPicker?: ChatModelPicker;
  /**
   * A greeting shown while the conversation is empty: a centred title above the
   * composer and optional suggestions below it. `true` uses the default title;
   * an object replaces the title (null omits it) and adds `suggestions`, such as
   * `WelcomeSuggestion` buttons the application handles. It leaves when the
   * first message, a run, an error or a pending approval appears, and the
   * composer keeps its draft and focus through that change. Off unless set.
   */
  readonly welcome?:
    | boolean
    | { readonly title?: ReactNode; readonly suggestions?: ReactNode };
  /**
   * Says how a run ended. After a stopped run, "Response stopped" stands at the
   * end of the transcript where the reply would have been, until the next run.
   * A polite status region also reads "Response stopped." or "Response
   * complete." when a run ends; a run that ends in an error or a pending
   * `approval` is left to those to announce. Off unless set.
   */
  readonly runStatus?: boolean;
  /**
   * Called with the chat's lifecycle each time one of its values changes,
   * starting with `componentReady` after mount. Content rendered inside the
   * chat reads the same values with `useChatLifecycle`.
   */
  readonly onLifecycleChange?: (lifecycle: ChatLifecycle) => void;
}

/** What `renderRunActivity` receives while a run has no assistant message yet. */
export interface ChatRunActivityContext {
  /** The current run's messages: every message after the last user message. */
  readonly messages: AgentSnapshot['messages'];
}

/** The options, controlled value and labels of the composer's model picker. */
export interface ChatModelPicker {
  readonly options: readonly SelectOption[];
  /** The chosen option's value; one that matches no option shows `placeholder`. */
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /** Names the list for assistive technology. Defaults to "Model". */
  readonly label?: string;
  /** Shown while no option matches `value`. Defaults to "Choose a model". */
  readonly placeholder?: string;
  readonly disabled?: boolean;
}

const ignore = () => undefined;

/** Holds the open state so the app controls only the value. */
function ModelPicker({
  options,
  value,
  onValueChange,
  label = 'Model',
  placeholder = 'Choose a model',
  disabled,
}: ChatModelPicker) {
  const [open, setOpen] = useState(false);
  return (
    <Select
      className="tp-chat__model-picker"
      options={options}
      value={value}
      onValueChange={(next) => onValueChange(next)}
      open={open}
      onOpenChange={setOpen}
      label={label}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}

/** Transcript, error and composer wired to an app-owned `AgentSession`. */
export function Chat({
  session,
  content,
  renderMessage,
  className,
  groupRelatedTools,
  genuiToolNames,
  toolLabel,
  toolOutcome,
  renderToolCall,
  renderToolResult,
  clientTools,
  subagents,
  onToolRetry,
  onRetry,
  header,
  threads,
  activeThreadId,
  onThreadSelect = ignore,
  inputBanner,
  inputAttachments,
  inputLeading,
  inputTrailing,
  inputFooter,
  modelPicker,
  approval,
  approvalRecords,
  messageActions,
  math,
  generativeUi,
  markdownComponents,
  mergeReasoning,
  a2uiActionLabels,
  renderMessageActivity,
  typingIndicator,
  renderRunActivity,
  welcome,
  runStatus = false,
  onLifecycleChange,
  ...input
}: ChatProps) {
  const snapshot = useAgent(session);
  const lifecycleChanged = useRef(onLifecycleChange);
  lifecycleChanged.current = onLifecycleChange;
  const [lifecycle] = useState(() =>
    createChatLifecycleStore((next) => lifecycleChanged.current?.(next))
  );
  // Another session is another conversation: its counts start again.
  useEffect(() => {
    lifecycle.set({
      componentReady: true,
      messageCount: 0,
      inputSubmittedAt: null,
    });
  }, [lifecycle, session]);
  // A session that can regenerate gets the built-in action, unless the app
  // handles it itself. Built-in actions stay off until `messageActions` is set.
  const actions = useMemo(() => {
    if (!messageActions || !session.regenerate) return messageActions;
    if (messageActions !== true && messageActions.onRegenerate)
      return messageActions;
    return {
      ...(messageActions === true ? {} : messageActions),
      onRegenerate: (messageId: string) => {
        session.regenerate?.(messageId).catch(ignore);
      },
    };
  }, [messageActions, session]);
  // Stable so the current transcript row keeps its memo while work runs.
  const tracksStop = useRef(runStatus);
  tracksStop.current = runStatus;
  const [stopped, setStopped] = useState<StoppedTurn | null>(null);
  const [announcement, setAnnouncement] = useState<{
    readonly session: AgentSession;
    readonly text: string;
  } | null>(null);
  const stop = useCallback(() => {
    if (tracksStop.current) {
      // The prompt identifies the turn: message ids can change when history reloads after a stop.
      const users = session
        .getSnapshot()
        .messages.filter((message) => message.role === 'user');
      const prompt = users[users.length - 1];
      setStopped(
        prompt
          ? { session, userCount: users.length, prompt: prompt.content }
          : null
      );
    }
    session.stop().catch(ignore);
  }, [session]);
  // Answering removes the approval and its focused button; continue in the
  // composer. An app that disables the composer while the answered run goes on
  // gets focus there as soon as it is enabled again.
  const composer = useRef<ChatInputHandle>(null);
  const pending =
    approval !== undefined && approval !== null && approval !== false;
  const disabled = input.disabled ?? false;
  // An answered client tool leaves the transcript the same way.
  const renderPrompt = useClientToolCalls(clientTools);
  const waiting = usePendingClientToolCalls(clientTools).length;
  const asked = waiting > 0;
  const awaited = pending || asked;
  const hadApproval = useRef(awaited);
  const focusOwed = useRef(false);
  useEffect(() => {
    if (hadApproval.current && !awaited) focusOwed.current = true;
    if (awaited) focusOwed.current = false;
    hadApproval.current = awaited;
    if (focusOwed.current && !disabled) {
      focusOwed.current = false;
      composer.current?.focus();
    }
  }, [awaited, disabled]);
  // One of several asks ended and took its focused control with it: continue in
  // the next one still waiting, unless focus already sits somewhere else.
  const root = useRef<HTMLDivElement>(null);
  const hadWaiting = useRef(waiting);
  useEffect(() => {
    const fewer = waiting > 0 && waiting < hadWaiting.current;
    hadWaiting.current = waiting;
    if (!fewer) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    root.current
      ?.querySelector<HTMLElement>(
        '[data-tool-prompt] :is(button, input, select, textarea, a[href], [tabindex]):not(:disabled, [tabindex="-1"])'
      )
      ?.focus();
  }, [waiting]);
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
  const greeting =
    welcome !== undefined &&
    welcome !== false &&
    rows.length === 0 &&
    snapshot.status !== 'running' &&
    !error &&
    !pending
      ? welcome === true
        ? {}
        : welcome
      : null;
  const running = snapshot.status === 'running';
  // A run the composer did not start still means a message was sent.
  useEffect(() => {
    if (running) lifecycle.set({ firstMessageSent: true });
  }, [lifecycle, running]);
  const showStopped =
    runStatus && !running && endedStopped(snapshot, session, stopped);
  // A new run clears the stopped turn and the last announcement, so a repeat is read again.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!runStatus) {
      wasRunning.current = false;
      return;
    }
    if (running) {
      if (wasRunning.current) return;
      wasRunning.current = true;
      setStopped(null);
      setAnnouncement(null);
      return;
    }
    if (!wasRunning.current) return;
    wasRunning.current = false;
    if (error || pending) return;
    setAnnouncement({
      session,
      text: showStopped ? 'Response stopped.' : 'Response complete.',
    });
  }, [runStatus, running, error, pending, showStopped, session]);
  const suggestions = greeting?.suggestions;
  // Choosing a suggestion removes the button that had focus; continue in the composer.
  const greeted = greeting !== null;
  const suggestionFocus = useRef(false);
  useEffect(() => {
    if (greeted || !suggestionFocus.current) return;
    suggestionFocus.current = false;
    composer.current?.focus();
  }, [greeted]);
  // The session's own child agents, unless the app supplies the cards.
  const children = subagents === undefined ? snapshot.subagents : undefined;
  const reported = useMemo(
    () =>
      children?.length
        ? sessionSubagents(children, { toolLabel, toolOutcome })
        : undefined,
    [children, toolLabel, toolOutcome]
  );
  // The run's messages keep their identity while only later snapshots change.
  const messages = snapshot.messages;
  const runMessages = useMemo(() => {
    let from = messages.length;
    while (from > 0 && messages[from - 1].role !== 'user') from--;
    return messages.slice(from);
  }, [messages]);
  const runActivity =
    renderRunActivity &&
    snapshot.status === 'running' &&
    !runMessages.some((message) => message.role === 'assistant')
      ? renderRunActivity({ messages: runMessages })
      : null;
  const chat = (
    <div
      ref={root}
      className={['tp-chat', greeting && 'tp-chat--welcome', className]
        .filter(Boolean)
        .join(' ')}
    >
      {greeting || header == null || header === false ? null : (
        <div className="tp-chat__header">{header}</div>
      )}
      {/* The composer below keeps its place and key, so it is never remounted. */}
      {greeting === null || greeting.title === null ? null : (
        <div className="tp-chat__welcome-title">
          {greeting.title === undefined ? (
            <h2>How can I help?</h2>
          ) : (
            greeting.title
          )}
        </div>
      )}
      <MessageList
        rows={rows}
        renderMessage={renderMessage}
        groupRelatedTools={groupRelatedTools}
        genuiToolNames={genuiToolNames}
        toolLabel={toolLabel}
        toolOutcome={toolOutcome}
        renderToolCall={renderToolCall}
        renderToolCallPrompt={renderPrompt}
        renderToolResult={renderToolResult}
        subagents={subagents ?? reported}
        // A session child may name no tool call, as a LangGraph child graph does not.
        placeUnanchoredSubagents={subagents === undefined}
        onToolRetry={onToolRetry}
        plan={snapshot.plan}
        onStop={snapshot.status === 'running' ? stop : undefined}
        running={snapshot.status === 'running'}
        approvalRecords={approvalRecords}
        messageActions={actions}
        math={math}
        generativeUi={generativeUi}
        markdownComponents={markdownComponents}
        mergeReasoning={mergeReasoning}
        a2uiActionLabels={a2uiActionLabels}
        renderMessageActivity={renderMessageActivity}
        typingIndicator={runActivity === null ? typingIndicator : false}
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
        {runActivity === null ? null : (
          <div
            className="tp-chat__run-activity"
            role="status"
            aria-atomic="false"
          >
            {runActivity}
          </div>
        )}
        {pending ? approval : null}
        {showStopped ? (
          <p className="tp-chat__stopped">
            <svg
              viewBox="0 0 24 24"
              width="12"
              height="12"
              aria-hidden="true"
              focusable="false"
            >
              <rect
                x="6"
                y="6"
                width="12"
                height="12"
                rx="2"
                fill="currentColor"
              />
            </svg>
            Response stopped
          </p>
        ) : null}
      </MessageList>
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
      {runStatus ? (
        <div className="tp-chat-sr-only" role="status">
          {announcement?.session === session ? announcement.text : ''}
        </div>
      ) : null}
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
        trailing={
          modelPicker && modelPicker.options.length > 0 ? (
            <>
              <ModelPicker {...modelPicker} />
              {inputTrailing}
            </>
          ) : (
            inputTrailing
          )
        }
        footer={inputFooter}
        busy={snapshot.status === 'running'}
        onSubmit={(text) => {
          lifecycle.set({
            firstMessageSent: true,
            messageCount: lifecycle.getSnapshot().messageCount + 1,
            inputSubmittedAt: Date.now(),
          });
          session.submit(text.trim()).catch(ignore);
        }}
        onStop={stop}
      />
      {suggestions === undefined ||
      suggestions === null ||
      suggestions === false ? null : (
        <div
          className="tp-chat__welcome-suggestions"
          onFocus={() => {
            suggestionFocus.current = true;
          }}
          onBlur={(event) => {
            // Focus that moves elsewhere on purpose is no longer ours to return.
            if (event.relatedTarget !== null) suggestionFocus.current = false;
          }}
        >
          {suggestions}
        </div>
      )}
    </div>
  );
  // The prop's presence, not its length, decides the wrapper, so a list that loads later never remounts the chat.
  if (threads === undefined) {
    return (
      <ChatLifecycleContext.Provider value={lifecycle}>
        {chat}
      </ChatLifecycleContext.Provider>
    );
  }
  return (
    <ChatLifecycleContext.Provider value={lifecycle}>
      <div className="tp-chat-shell">
        {threads.length > 0 ? (
          <aside className="tp-chat tp-chat-shell__sidebar">
            <ThreadList
              threads={threads}
              activeThreadId={activeThreadId}
              onSelect={onThreadSelect}
            />
          </aside>
        ) : null}
        {chat}
      </div>
    </ChatLifecycleContext.Provider>
  );
}

interface StoppedTurn {
  readonly session: AgentSession;
  readonly userCount: number;
  readonly prompt: string;
}

/** True when the latest turn ended because it was stopped, by the person here or by the adapter. */
function endedStopped(
  snapshot: ReturnType<AgentSession['getSnapshot']>,
  session: AgentSession,
  stopped: StoppedTurn | null
): boolean {
  const messages = snapshot.messages;
  const last = messages[messages.length - 1];
  const delivery = last?.role === 'assistant' ? last.delivery : undefined;
  if (delivery?.phase === 'complete' && delivery.outcome === 'aborted') {
    return true;
  }
  // A reply that completed after the stop, or another conversation, is not a stopped turn.
  if (
    !stopped ||
    stopped.session !== session ||
    (delivery?.phase === 'complete' && delivery.outcome === 'success')
  ) {
    return false;
  }
  const users = messages.filter((message) => message.role === 'user');
  const prompt = users[users.length - 1];
  return (
    users.length === stopped.userCount &&
    prompt !== undefined &&
    prompt.content === stopped.prompt
  );
}

const keys = new WeakMap<object, number>();
let nextKey = 0;
function sessionKey(session: object): number {
  let key = keys.get(session);
  if (key === undefined) keys.set(session, (key = ++nextKey));
  return key;
}
