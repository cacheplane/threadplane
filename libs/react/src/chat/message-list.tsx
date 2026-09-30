'use client';
import { memo, useEffect, useRef, type ReactNode } from 'react';
import type { MessageRow } from '@threadplane/content/messages';
import { Markdown } from '../markdown/markdown.js';
import { useIsomorphicLayoutEffect } from './internal/isomorphic-layout-effect.js';
import { ToolObservation } from './tool-observation.js';

export interface MessageListProps {
  readonly rows: readonly MessageRow[];
  /**
   * Replace the default row rendering. Must be referentially stable (define it
   * outside the component or wrap it in `useCallback`); a new function each
   * render defeats row memoization and re-renders every row.
   */
  readonly renderMessage?: (row: MessageRow) => ReactNode;
  readonly label?: string;
  readonly className?: string;
}

const PIN_THRESHOLD = 32;
const literal = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';

const Row = memo(function Row({
  row,
  renderMessage,
}: {
  readonly row: MessageRow;
  readonly renderMessage?: (row: MessageRow) => ReactNode;
}) {
  if (renderMessage) return <>{renderMessage(row)}</>;
  return (
    <article className={`tp-chat-message tp-chat-message--${row.role}`}>
      <p className="tp-chat-message__role">{row.role}</p>
      {row.role === 'tool' ? (
        <pre className="tp-chat-message__literal">{row.message.content}</pre>
      ) : (
        <Markdown snapshot={row.markdown} />
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
});

/** Transcript rows with memoized rendering and bottom-pinned scrolling. */
export function MessageList({
  rows,
  renderMessage,
  label = 'Conversation',
  className,
}: MessageListProps) {
  const container = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onScroll = () => {
      pinned.current =
        el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useIsomorphicLayoutEffect(() => {
    const el = container.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [rows]);
  return (
    <div
      ref={container}
      role="region"
      aria-label={label}
      className={['tp-chat-list', className].filter(Boolean).join(' ')}
    >
      {rows.map((row) => (
        <Row key={row.id} row={row} renderMessage={renderMessage} />
      ))}
    </div>
  );
}
