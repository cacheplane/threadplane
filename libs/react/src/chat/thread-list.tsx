'use client';

import { useId, type ReactNode } from 'react';

export interface ThreadListItem {
  readonly id: string;
  readonly title?: string;
  readonly updatedAt?: number;
  readonly pinned?: boolean;
}

export interface ThreadListProps {
  readonly threads: readonly ThreadListItem[];
  readonly onSelect: (threadId: string) => void;
  readonly activeThreadId?: string | null;
  readonly label?: string;
  readonly className?: string;
  readonly onNewThread?: () => void;
  readonly newThreadDisabled?: boolean;
  readonly newThreadLabel?: string;
  readonly now?: number;
  /** Noninteractive phrasing content inside the row button. Original title/id labels remain. */
  readonly renderTitle?: (thread: ThreadListItem) => ReactNode;
  /** App-owned controls rendered beside the selection button. */
  readonly renderActions?: (thread: ThreadListItem) => ReactNode;
}

function validDate(value: number | undefined): Date | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function relativeTime(age: number): string {
  if (age < 60000) return 'just now';
  if (age < 3600000) return `${Math.floor(age / 60000)} min ago`;
  if (age < 86400000) return `${Math.floor(age / 3600000)} hr ago`;
  const days = Math.floor(age / 86400000);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** A controlled view of the supplied conversation order and selection. */
export function ThreadList({
  threads,
  onSelect,
  activeThreadId,
  label = 'Conversations',
  className,
  onNewThread,
  newThreadDisabled = false,
  newThreadLabel = '+ New thread',
  now = Date.now(),
  renderTitle,
  renderActions,
}: ThreadListProps) {
  const listId = useId();
  const reference = validDate(now);
  const list = (
    <ul
      className={`tp-thread-list${className ? ` ${className}` : ''}`}
      aria-label={label}
    >
      {threads.map((thread, index) => {
        const pinned = thread.pinned === true;
        const title = thread.title || thread.id;
        const content = renderTitle ? renderTitle(thread) : title;
        const actions = renderActions?.(thread);
        const hasActions =
          actions !== null && actions !== false && actions !== undefined;
        const updated = validDate(thread.updatedAt);
        const time =
          reference && updated && thread.updatedAt !== undefined
            ? relativeTime(now - thread.updatedAt)
            : undefined;
        const rowId = `${listId}-${index}`;
        return (
          <li
            key={thread.id}
            className={`tp-thread-list__item${
              hasActions ? ' tp-thread-list__item--actions' : ''
            }`}
          >
            <button
              type="button"
              className="tp-thread-list__button"
              title={title}
              aria-label={renderTitle || pinned ? title : undefined}
              aria-labelledby={
                time && !renderTitle && !pinned ? `${rowId}-title` : undefined
              }
              aria-describedby={
                pinned
                  ? `${rowId}-pinned${time ? ` ${rowId}-time` : ''}`
                  : time
                  ? `${rowId}-time`
                  : undefined
              }
              aria-current={thread.id === activeThreadId ? 'true' : undefined}
              onClick={() => onSelect(thread.id)}
            >
              {pinned && (
                <svg
                  className="tp-thread-list__pin"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                </svg>
              )}
              {time && updated ? (
                <>
                  <span id={`${rowId}-title`}>{content}</span>
                  <time
                    id={`${rowId}-time`}
                    className="tp-thread-list__time"
                    dateTime={updated.toISOString()}
                  >
                    {time}
                  </time>
                </>
              ) : (
                content
              )}
              {pinned && (
                <span id={`${rowId}-pinned`} className="tp-thread-list__status">
                  Pinned conversation
                </span>
              )}
            </button>
            {hasActions && (
              <div className="tp-thread-list__actions">{actions}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
  return onNewThread ? (
    <div className="tp-thread-list__container">
      <button
        type="button"
        className="tp-thread-list__new"
        onClick={() => onNewThread()}
        disabled={newThreadDisabled}
      >
        {newThreadLabel}
      </button>
      {list}
    </div>
  ) : (
    list
  );
}
