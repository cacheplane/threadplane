import { useId } from 'react';
import type { ThreadListItem } from '@threadplane/react/chat';

function relativeTime(age: number): string {
  if (age < 60000) return 'just now';
  if (age < 3600000) return `${Math.floor(age / 60000)} min ago`;
  if (age < 86400000) return `${Math.floor(age / 3600000)} hr ago`;
  const days = Math.floor(age / 86400000);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** Application-owned selection-only row for the retained compact rail. */
export function CompactThreadRow({
  thread,
  active,
  onSelect,
}: {
  readonly thread: ThreadListItem;
  readonly active: boolean;
  readonly onSelect: (id: string) => void;
}) {
  const id = useId();
  const title = thread.title || thread.id;
  const pinned = thread.pinned === true;
  const now = Date.now();
  const updated =
    typeof thread.updatedAt === 'number' && Number.isFinite(thread.updatedAt)
      ? new Date(thread.updatedAt)
      : undefined;
  const time =
    updated && Number.isFinite(updated.getTime()) && Number.isFinite(now)
      ? relativeTime(now - updated.getTime())
      : undefined;
  return (
    <button
      type="button"
      className="tp-thread-list__button native-compact-thread"
      title={title}
      aria-label={title}
      aria-current={active ? 'true' : undefined}
      aria-describedby={
        pinned
          ? `${id}-pin${time ? ` ${id}-time` : ''}`
          : time
          ? `${id}-time`
          : undefined
      }
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
      <span aria-hidden="true">
        {Array.from(title.trim())[0]?.toUpperCase() || '?'}
      </span>
      {pinned && (
        <span id={`${id}-pin`} className="tp-thread-list__status">
          Pinned conversation
        </span>
      )}
      {time && updated && (
        <time
          id={`${id}-time`}
          className="tp-thread-list__time"
          dateTime={updated.toISOString()}
        >
          {time}
        </time>
      )}
    </button>
  );
}
