'use client';

export interface ThreadListItem {
  readonly id: string;
  readonly title?: string;
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
}: ThreadListProps) {
  const list = (
    <ul
      className={`tp-thread-list${className ? ` ${className}` : ''}`}
      aria-label={label}
    >
      {threads.map((thread) => {
        const title = thread.title || thread.id;
        return (
          <li key={thread.id} className="tp-thread-list__item">
            <button
              type="button"
              className="tp-thread-list__button"
              title={title}
              aria-current={thread.id === activeThreadId ? 'true' : undefined}
              onClick={() => onSelect(thread.id)}
            >
              {title}
            </button>
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
