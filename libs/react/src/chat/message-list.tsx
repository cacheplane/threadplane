'use client';
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { MessageRow } from '@threadplane/content/messages';
import type { AgentPlanStep } from '@threadplane/core';
import { Markdown } from '../markdown/markdown.js';
import { useIsomorphicLayoutEffect } from './internal/isomorphic-layout-effect.js';
import {
  ToolActivity,
  ToolActivityGroup,
  toolActivityPhase,
  type ToolActivityInfo,
  type ToolActivityOutcome,
} from './tool-activity.js';
import { resolveToolOutcome, withoutStaleRetry } from './tool-outcome.js';
import { Reasoning } from './reasoning.js';
import { Citations } from './citations.js';
import { ChatMessage, type ChatMessageRole } from './chat-message.js';
import {
  approvalRecordsByRow,
  renderApprovalRecords,
  type ApprovalRecordEntry,
} from './approval-card.js';

type RenderRow<TRow extends MessageRow> = [TRow] extends [never]
  ? MessageRow
  : TRow;

/** Each supplied row's final-row flag and immediately preceding projected row role. */
export interface MessageListRowContext {
  /** True exactly for the final supplied row, regardless of role. */
  readonly current: boolean;
  /** Role of rows[index - 1], or undefined for the first supplied row. */
  readonly prevRole?: ChatMessageRole;
}

function createRowContexts(
  current: boolean
): Readonly<Record<ChatMessageRole | 'first', MessageListRowContext>> {
  return {
    first: Object.freeze({ current, prevRole: undefined }),
    user: Object.freeze({ current, prevRole: 'user' }),
    assistant: Object.freeze({ current, prevRole: 'assistant' }),
    system: Object.freeze({ current, prevRole: 'system' }),
    tool: Object.freeze({ current, prevRole: 'tool' }),
  };
}

const CURRENT_ROW_CONTEXTS = createRowContexts(true);
const HISTORICAL_ROW_CONTEXTS = createRowContexts(false);

/** View-owned actions. Retained actions become inert when this list unmounts. */
export interface MessageListScrollControls {
  readonly pinned: boolean;
  readonly scrollToLatest: () => void;
  readonly focus: () => void;
}

/** Supplies projected transcript rows and an optional stable custom renderer to a scrolling list with memoized rows. */
export interface MessageListProps<TRow extends MessageRow = MessageRow> {
  readonly rows: readonly TRow[];
  /**
   * Replace the default row rendering. Must be referentially stable (define it
   * outside the component or wrap it in `useCallback`); a new function each
   * render defeats row memoization and re-renders every row.
   */
  readonly renderMessage?: (
    row: NoInfer<RenderRow<TRow>>,
    context: MessageListRowContext
  ) => ReactNode;
  readonly label?: string;
  readonly className?: string;
  /** Group built-in tool activity by default. False renders separate tools; custom renderers keep full ownership. */
  readonly groupRelatedTools?: boolean;
  /** Steps the agent declared (`snapshot.plan`); the current turn's running group lists the pending ones. */
  readonly plan?: readonly AgentPlanStep[];
  /** Stops the run; the current turn's running group offers it beside the elapsed time. */
  readonly onStop?: () => void;
  /**
   * The session is still working (`snapshot.status === 'running'`). A call still running after its
   * message completed, such as a browser client tool, then shows as running instead of unknown.
   */
  readonly running?: boolean;
  /** App-authored human labels from the tool name and the call's arguments, such as "Read Array.prototype.toSorted"; keep this function stable like renderMessage. */
  readonly toolLabel?: (name: string, args?: unknown) => string | undefined;
  /** App-authored confirmed result previews, or `status: 'failed'` to show a completed call as failed. Keep stable; custom renderMessage retains full ownership. */
  readonly toolOutcome?: (
    activity: ToolActivityInfo
  ) => ToolActivityOutcome | undefined;
  /** App-owned rich result or action for one tool call, rendered outside technical Details. Keep stable like renderMessage; custom renderMessage retains full ownership. */
  readonly renderToolResult?: (activity: ToolActivityInfo) => ReactNode;
  /**
   * Application-owned handler for a retry declared by `toolOutcome` on a failed call. The control is offered only while
   * nothing is running and no later call repeats the same tool and arguments. Without it no retry control renders. Keep stable.
   */
  readonly onToolRetry?: (activity: ToolActivityInfo) => void;
  /**
   * Answered approvals, each rendered as a one-line `ApprovalRecord` after the row its `afterId`
   * names, or after the last row when that row is absent. Records stay where the app put them while
   * the run continues below.
   */
  readonly approvalRecords?: readonly ApprovalRecordEntry[];
  /** Application-owned content after the rows, such as a pending approval, in the same scrollable transcript. */
  readonly children?: ReactNode;
  /** Render a sibling control; attach actions to explicit event handlers. */
  readonly renderScrollControl?: (
    controls: MessageListScrollControls
  ) => ReactNode;
}

const PIN_THRESHOLD = 32;
declare const process:
  | { readonly env: { readonly NODE_ENV?: string } }
  | undefined;
/** A throwing app hook must not break the transcript; the call keeps its core phase. */
function safeOutcome(
  toolOutcome: (activity: ToolActivityInfo) => ToolActivityOutcome | undefined,
  activity: ToolActivityInfo
): ToolActivityOutcome | undefined {
  try {
    return toolOutcome(activity);
  } catch (error) {
    if (
      typeof process === 'undefined' ||
      process.env.NODE_ENV !== 'production'
    ) {
      console.error(
        'toolOutcome threw; the tool call keeps its core phase.',
        error
      );
    }
    return undefined;
  }
}
const NONE: ReadonlySet<string> = new Set();
/** Per-row retry staleness across the whole transcript: every call while work is active, else calls a later one repeats. */
function staleRetriesByRow(rows: readonly MessageRow[]): readonly string[] {
  const busy =
    rows.at(-1)?.message.delivery.phase === 'streaming' ||
    rows.some((row) =>
      row.toolCalls.some((call) => {
        const phase = toolActivityPhase(call.status, row.message.delivery);
        return phase === 'pending' || phase === 'running';
      })
    );
  if (busy) return rows.map((row) => (row.toolCalls.length ? '*' : ''));
  const key = (call: MessageRow['toolCalls'][number]) =>
    call.name + '\0' + literal(call.args);
  const last = new Map<string, string>();
  for (const row of rows)
    for (const call of row.toolCalls) last.set(key(call), call.id);
  return rows.map((row) =>
    row.toolCalls
      .filter((call) => last.get(key(call)) !== call.id)
      .map((call) => call.id)
      .join('\n')
  );
}
/**
 * Per row, the failed calls a later call is repeating right now: same tool and
 * arguments, still pending or running. Joined IDs keep the row memo stable.
 */
function retryingByRow(rows: readonly MessageRow[]): readonly string[] {
  const key = (call: MessageRow['toolCalls'][number]) =>
    call.name + '\0' + literal(call.args);
  const calls = rows.flatMap((row) =>
    row.toolCalls.map((call) => ({
      call,
      running: ['pending', 'running'].includes(
        toolActivityPhase(call.status, row.message.delivery)
      ),
    }))
  );
  const repeating = new Set<string>();
  calls.forEach(({ call }, i) => {
    if (
      call.status === 'error' || call.status === 'complete'
        ? calls
            .slice(i + 1)
            .some((later) => later.running && key(later.call) === key(call))
        : false
    )
      repeating.add(call.id);
  });
  return rows.map((row) =>
    row.toolCalls
      .filter((call) => repeating.has(call.id))
      .map((call) => call.id)
      .join('\n')
  );
}
/** "Retrying toSorted read" from a declared label such as "Retry toSorted read". */
function retryingText(label: string): string {
  const rest = /^retry\b\s*(.*)$/i.exec(label.trim())?.[1];
  return rest ? `Retrying ${rest}` : 'Retrying';
}
const literal = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';

function RowView<TRow extends MessageRow>({
  row,
  current,
  prevRole,
  renderMessage,
  groupRelatedTools,
  toolLabel,
  toolOutcome,
  renderToolResult,
  onToolRetry,
  staleRetries,
  retrying,
  plan,
  onStop,
  running,
}: {
  readonly row: TRow;
  readonly current: boolean;
  readonly prevRole?: ChatMessageRole;
  readonly renderMessage?: (
    row: TRow,
    context: MessageListRowContext
  ) => ReactNode;
  readonly groupRelatedTools?: boolean;
  readonly toolLabel?: (name: string, args?: unknown) => string | undefined;
  readonly toolOutcome?: (
    activity: ToolActivityInfo
  ) => ToolActivityOutcome | undefined;
  readonly renderToolResult?: (activity: ToolActivityInfo) => ReactNode;
  readonly onToolRetry?: (activity: ToolActivityInfo) => void;
  /** "*" while work is active, otherwise the row's superseded call IDs joined by newlines. A string keeps the memo stable. */
  readonly staleRetries?: string;
  /** Failed call IDs a later running call is repeating, joined by newlines. */
  readonly retrying?: string;
  readonly plan?: readonly AgentPlanStep[];
  readonly onStop?: () => void;
  /** True only for a row holding a running call while the session runs, so other rows keep their memo. */
  readonly running?: boolean;
}) {
  if (renderMessage) {
    const contexts = current ? CURRENT_ROW_CONTEXTS : HISTORICAL_ROW_CONTEXTS;
    return <>{renderMessage(row, contexts[prevRole ?? 'first'])}</>;
  }
  const stale = new Set(staleRetries ? staleRetries.split('\n') : []);
  const repeating = new Set(retrying ? retrying.split('\n') : []);
  // Read the declared label before a running retry withdraws it.
  const retryingLeads = new Map<string, string>();
  const activities: ToolActivityInfo[] = row.toolCalls.map((call) => {
    const delivery = row.message.delivery;
    const phase = toolActivityPhase(call.status, delivery, running);
    const activity: ToolActivityInfo = {
      id: call.id,
      name: call.name,
      label: toolLabel?.(call.name, call.args),
      phase,
      argumentsText: literal(call.args),
      resultText: call.status === 'complete' ? literal(call.result) : undefined,
      errorText: call.status === 'error' ? call.error : undefined,
    };
    const resolved = resolveToolOutcome(
      activity,
      toolOutcome ? safeOutcome(toolOutcome, activity) : undefined
    );
    if (
      repeating.has(call.id) &&
      resolved.outcome?.status === 'failed' &&
      resolved.outcome.retry?.label.trim()
    )
      retryingLeads.set(call.id, retryingText(resolved.outcome.retry.label));
    return staleRetries === '*' || stale.has(call.id)
      ? withoutStaleRetry(resolved, NONE)
      : resolved;
  });
  return (
    <ChatMessage
      role={row.role}
      prevRole={prevRole}
      current={current}
      streaming={row.message.delivery.phase === 'streaming'}
      beforeContent={
        row.role === 'assistant' &&
        row.reasoning && <Reasoning snapshot={row.reasoning} />
      }
      afterContent={
        <>
          {row.role === 'assistant' && (
            <Citations
              citations={row.message.citations ?? []}
              snapshot={row.markdown}
            />
          )}
          {row.role !== 'tool' &&
            (groupRelatedTools ? (
              <ToolActivityGroup
                activities={activities}
                renderResult={renderToolResult}
                onRetry={onToolRetry}
                retrying={retryingLeads.values().next().value}
                plan={plan}
                onStop={onStop}
              />
            ) : (
              activities.map((activity) => (
                <ToolActivity
                  key={activity.id}
                  activity={activity}
                  onRetry={onToolRetry}
                  retrying={retryingLeads.get(activity.id)}
                >
                  {renderToolResult?.(activity)}
                </ToolActivity>
              ))
            ))}
        </>
      }
    >
      {row.role === 'tool' ? (
        <pre className="tp-chat-message__literal">{row.message.content}</pre>
      ) : (
        <Markdown
          snapshot={row.markdown}
          citations={
            row.role === 'assistant' ? row.message.citations : undefined
          }
        />
      )}
    </ChatMessage>
  );
}

// memo erases generic component signatures; restore the unchanged row contract.
const Row = memo(RowView) as typeof RowView;

/** Transcript rows with memoized rendering and bottom-pinned scrolling. */
export function MessageList<TRow extends MessageRow = MessageRow>({
  rows,
  renderMessage,
  label = 'Conversation',
  className,
  groupRelatedTools = true,
  toolLabel,
  toolOutcome,
  renderToolResult,
  onToolRetry,
  plan,
  onStop,
  running = false,
  approvalRecords,
  children,
  renderScrollControl,
}: MessageListProps<TRow>) {
  const recordsAfter = useMemo(
    () =>
      approvalRecordsByRow(
        approvalRecords,
        rows.map((row) => row.id)
      ),
    [approvalRecords, rows]
  );
  const staleRetries = useMemo(
    () => (onToolRetry ? staleRetriesByRow(rows) : undefined),
    [onToolRetry, rows]
  );
  const retrying = useMemo(
    () => (toolOutcome ? retryingByRow(rows) : undefined),
    [toolOutcome, rows]
  );
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [isPinned, setIsPinned] = useState(true);
  const active = useRef(false);
  const lastScrollTop = useRef(0);
  const setPinned = useCallback((value: boolean) => {
    if (pinned.current !== value) {
      pinned.current = value;
      setIsPinned(value);
    }
  }, []);
  const scrollToLatest = useCallback(() => {
    const el = container.current;
    if (!active.current || !el) return;
    setPinned(true);
    el.scrollTop = el.scrollHeight;
    lastScrollTop.current = el.scrollTop;
  }, [setPinned]);
  const focus = useCallback(() => {
    if (active.current) container.current?.focus({ preventScroll: true });
  }, []);
  const controls = useMemo<MessageListScrollControls>(
    () => ({ pinned: isPinned, scrollToLatest, focus }),
    [isPinned, scrollToLatest, focus]
  );
  useIsomorphicLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let listening = true;
    const onScroll = () => {
      if (!listening || !active.current) return;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      if (el.scrollTop < Math.min(lastScrollTop.current, max) - 1)
        setPinned(false);
      else if (max - el.scrollTop <= PIN_THRESHOLD) setPinned(true);
      lastScrollTop.current = el.scrollTop;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      listening = false;
      el.removeEventListener('scroll', onScroll);
    };
  }, [setPinned]);
  useIsomorphicLayoutEffect(() => {
    const el = container.current;
    const body = content.current;
    if (!el || !body || typeof ResizeObserver === 'undefined') return;
    let active = true;
    const observer = new ResizeObserver(() => {
      if (active && pinned.current) {
        el.scrollTop = el.scrollHeight;
        lastScrollTop.current = el.scrollTop;
      }
    });
    observer.observe(body);
    observer.observe(el);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, []);
  useIsomorphicLayoutEffect(() => {
    const el = container.current;
    if (el && pinned.current) {
      el.scrollTop = el.scrollHeight;
      lastScrollTop.current = el.scrollTop;
    }
  }, [rows, children, approvalRecords]);
  return (
    <>
      <div
        ref={container}
        role="region"
        tabIndex={0}
        aria-label={label}
        className={['tp-chat-list', className].filter(Boolean).join(' ')}
      >
        <div ref={content}>
          {rows.map((row, index) => (
            <Fragment key={row.id}>
              <Row
                row={row}
                current={index === rows.length - 1}
                prevRole={rows[index - 1]?.role}
                renderMessage={renderMessage}
                groupRelatedTools={groupRelatedTools}
                toolLabel={toolLabel}
                toolOutcome={toolOutcome}
                renderToolResult={renderToolResult}
                onToolRetry={onToolRetry}
                staleRetries={staleRetries?.[index]}
                retrying={retrying?.[index]}
                plan={index === rows.length - 1 ? plan : undefined}
                onStop={index === rows.length - 1 ? onStop : undefined}
                running={
                  running &&
                  row.toolCalls.some((call) => call.status === 'running')
                }
              />
              {renderApprovalRecords(recordsAfter, row.id)}
            </Fragment>
          ))}
          {renderApprovalRecords(recordsAfter, undefined)}
          {children}
        </div>
      </div>
      {renderScrollControl?.(controls)}
    </>
  );
}
