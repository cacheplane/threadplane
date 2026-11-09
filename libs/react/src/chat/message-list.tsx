'use client';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { MessageRow } from '@threadplane/content/messages';
import { Markdown } from '../markdown/markdown.js';
import { useIsomorphicLayoutEffect } from './internal/isomorphic-layout-effect.js';
import {
  ToolActivity,
  ToolActivityGroup,
  toolActivityPhase,
  type ToolActivityInfo,
  type ToolActivityOutcome,
} from './tool-activity.js';
import { Reasoning } from './reasoning.js';
import { Citations } from './citations.js';
import { ChatMessage, type ChatMessageRole } from './chat-message.js';

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
  /** App-authored human labels; keep this function stable like renderMessage. */
  readonly toolLabel?: (name: string) => string | undefined;
  /** App-authored confirmed result previews. Keep stable; custom renderMessage retains full ownership. */
  readonly toolOutcome?: (
    activity: ToolActivityInfo
  ) => ToolActivityOutcome | undefined;
  /** Application-owned content after the rows, such as a pending approval, in the same scrollable transcript. */
  readonly children?: ReactNode;
  /** Render a sibling control; attach actions to explicit event handlers. */
  readonly renderScrollControl?: (
    controls: MessageListScrollControls
  ) => ReactNode;
}

const PIN_THRESHOLD = 32;
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
}: {
  readonly row: TRow;
  readonly current: boolean;
  readonly prevRole?: ChatMessageRole;
  readonly renderMessage?: (
    row: TRow,
    context: MessageListRowContext
  ) => ReactNode;
  readonly groupRelatedTools?: boolean;
  readonly toolLabel?: (name: string) => string | undefined;
  readonly toolOutcome?: (
    activity: ToolActivityInfo
  ) => ToolActivityOutcome | undefined;
}) {
  if (renderMessage) {
    const contexts = current ? CURRENT_ROW_CONTEXTS : HISTORICAL_ROW_CONTEXTS;
    return <>{renderMessage(row, contexts[prevRole ?? 'first'])}</>;
  }
  const activities: ToolActivityInfo[] = row.toolCalls.map((call) => {
    const delivery = row.message.delivery;
    const phase = toolActivityPhase(call.status, delivery);
    const activity: ToolActivityInfo = {
      id: call.id,
      name: call.name,
      label: toolLabel?.(call.name),
      phase,
      argumentsText: literal(call.args),
      resultText: call.status === 'complete' ? literal(call.result) : undefined,
      errorText: call.status === 'error' ? call.error : undefined,
    };
    return { ...activity, outcome: toolOutcome?.(activity) };
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
              <ToolActivityGroup activities={activities} />
            ) : (
              activities.map((activity) => (
                <ToolActivity key={activity.id} activity={activity} />
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
  children,
  renderScrollControl,
}: MessageListProps<TRow>) {
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
  }, [rows, children]);
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
            <Row
              key={row.id}
              row={row}
              current={index === rows.length - 1}
              prevRole={rows[index - 1]?.role}
              renderMessage={renderMessage}
              groupRelatedTools={groupRelatedTools}
              toolLabel={toolLabel}
              toolOutcome={toolOutcome}
            />
          ))}
          {children}
        </div>
      </div>
      {renderScrollControl?.(controls)}
    </>
  );
}
