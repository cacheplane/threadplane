'use client';
import { memo, useEffect, useRef, type ReactNode } from 'react';
import type { MessageRow } from '@threadplane/content/messages';
import { Markdown } from '../markdown/markdown.js';
import { useIsomorphicLayoutEffect } from './internal/isomorphic-layout-effect.js';
import { ToolObservation } from './tool-observation.js';
import { Reasoning } from './reasoning.js';
import { Citations } from './citations.js';

type RenderRow<TRow extends MessageRow> = [TRow] extends [never]
  ? MessageRow
  : TRow;

/** Supplies projected transcript rows and an optional stable custom renderer to a scrolling list with memoized rows. */
export interface MessageListProps<TRow extends MessageRow = MessageRow> {
  readonly rows: readonly TRow[];
  /**
   * Replace the default row rendering. Must be referentially stable (define it
   * outside the component or wrap it in `useCallback`); a new function each
   * render defeats row memoization and re-renders every row.
   */
  readonly renderMessage?: (row: NoInfer<RenderRow<TRow>>) => ReactNode;
  readonly label?: string;
  readonly className?: string;
  /** Application-owned content after the rows, such as a pending approval, in the same scrollable transcript. */
  readonly children?: ReactNode;
}

const PIN_THRESHOLD = 32;
const literal = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';

function RowView<TRow extends MessageRow>({
  row,
  renderMessage,
}: {
  readonly row: TRow;
  readonly renderMessage?: (row: TRow) => ReactNode;
}) {
  if (renderMessage) return <>{renderMessage(row)}</>;
  return (
    <article className={`tp-chat-message tp-chat-message--${row.role}`}>
      <p className="tp-chat-message__role">{row.role}</p>
      {row.role === 'assistant' && row.reasoning && (
        <Reasoning snapshot={row.reasoning} />
      )}
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
      {row.role === 'assistant' && (
        <Citations
          citations={row.message.citations ?? []}
          snapshot={row.markdown}
        />
      )}
      {row.role !== 'tool' &&
        row.toolCalls.map((call) => (
          <ToolObservation
            key={call.id}
            name={call.name}
            argumentsText={literal(call.args)}
            resultText={
              call.status === 'complete'
                ? literal(call.result)
                : call.status === 'error'
                ? call.error
                : undefined
            }
          />
        ))}
    </article>
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
  children,
}: MessageListProps<TRow>) {
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastScrollTop = useRef(0);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onScroll = () => {
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      if (el.scrollTop < Math.min(lastScrollTop.current, max) - 1) pinned.current = false;
      else if (max - el.scrollTop <= PIN_THRESHOLD) pinned.current = true;
      lastScrollTop.current = el.scrollTop;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
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
    <div
      ref={container}
      role="region"
      tabIndex={0}
      aria-label={label}
      className={['tp-chat-list', className].filter(Boolean).join(' ')}
    >
      <div ref={content}>
        {rows.map((row) => (
          <Row key={row.id} row={row} renderMessage={renderMessage} />
        ))}
        {children}
      </div>
    </div>
  );
}
