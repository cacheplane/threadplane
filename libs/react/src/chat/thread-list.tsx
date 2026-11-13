'use client';

import {
  useId,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
  type KeyboardEvent,
} from 'react';
import { ConfirmDialog } from './confirm-dialog.js';
import { OverflowMenu, type OverflowMenuItem } from './overflow-menu.js';
import { ThreadRenameForm } from './thread-rename-form.js';
import {
  neighborId,
  useOptimisticRows,
  useRowFocus,
  type RowActionResult,
} from './internal/optimistic-rows.js';

/** Conversation row metadata for title display, relative update time, and a pinned indicator. */
export interface ThreadListItem {
  readonly id: string;
  readonly title?: string;
  readonly updatedAt?: number;
  readonly pinned?: boolean;
}

/**
 * Conversation commands the application implements. Supplying a command adds
 * it to each row's built-in menu. The list shows the result at once and calls
 * the command; the application then updates `threads`. A rejected command puts
 * the row back as supplied.
 */
export interface ThreadActionAdapter {
  /** Called after the person confirms; the row is hidden while it runs. */
  readonly delete?: (threadId: string) => RowActionResult;
  /** Called with the trimmed, nonblank title; the row shows it while it runs. */
  readonly rename?: (threadId: string, title: string) => RowActionResult;
  /** Reversible, so it runs without confirmation; the row is hidden while it runs. */
  readonly archive?: (threadId: string) => RowActionResult;
  /** Offered in the archived mode; the row is hidden while it runs. */
  readonly unarchive?: (threadId: string) => RowActionResult;
  readonly pin?: (threadId: string) => RowActionResult;
  readonly unpin?: (threadId: string) => RowActionResult;
  /** Offered when `projects` is supplied; null removes the conversation from its project. */
  readonly moveToProject?: (
    threadId: string,
    projectId: string | null
  ) => RowActionResult;
  /** Places a pinned conversation before another pinned one, or last for null. */
  readonly reorderPinned?: (
    threadId: string,
    beforeId: string | null
  ) => RowActionResult;
}

interface MenuState {
  readonly id: string;
  readonly view: 'actions' | 'projects';
  readonly point: { readonly x: number; readonly y: number } | null;
  readonly returnTo: HTMLElement | null;
}

const NO_ORDER: ReadonlyMap<string, string | null> = new Map();
const NO_PROJECT = 'none';

/** Supplies ordered conversations and controlled selection, with creation, row rendering, action, and context-menu hooks. */
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
  /** Replaces the complete row content; owner supplies controls and accessibility. */
  readonly renderItem?: (
    thread: ThreadListItem,
    isActive: boolean
  ) => ReactNode;
  /** Noninteractive phrasing content inside the row button. Original title/id labels remain. */
  readonly renderTitle?: (thread: ThreadListItem) => ReactNode;
  /** App-owned controls rendered beside the selection button. */
  readonly renderActions?: (thread: ThreadListItem) => ReactNode;
  /** Synchronous context request from the selection button; the owner claims input. */
  readonly onContextMenu?: (
    threadId: string,
    event: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>
  ) => void;
  /**
   * Adds a built-in menu to each row with the commands supplied here, inline
   * rename, and a confirmation before delete. Rows drawn by `renderItem` get
   * no menu.
   */
  readonly actions?: ThreadActionAdapter | null;
  /** Which commands the built-in menu offers: archived rows can be restored or deleted. */
  readonly mode?: 'active' | 'archived';
  /** Destinations for the built-in Move to project command. */
  readonly projects?:
    | readonly { readonly id: string; readonly name: string }[]
    | null;
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
  renderItem,
  renderTitle,
  renderActions,
  onContextMenu: ownerContextMenu,
  actions: adapter,
  mode = 'active',
  projects,
}: ThreadListProps) {
  const listId = useId();
  const keyboardContext = useRef<HTMLButtonElement | null>(null);
  const root = useRef<HTMLUListElement>(null);
  const optimistic = useOptimisticRows();
  const focusRow = useRowFocus(root, 'tp-thread-list__button');
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editing, setEditing] = useState<{
    readonly id: string;
    readonly value: string;
  } | null>(null);
  const [confirming, setConfirming] = useState<{
    readonly id: string;
    readonly returnTo: HTMLElement | null;
  } | null>(null);
  const [order, setOrder] = useState(NO_ORDER);
  const reference = validDate(now);

  let visible: readonly ThreadListItem[] = threads;
  if (optimistic.hidden.size > 0)
    visible = visible.filter((thread) => !optimistic.hidden.has(thread.id));
  if (order.size > 0) {
    const pinnedRows = visible.filter((thread) => thread.pinned === true);
    for (const [threadId, beforeId] of order) {
      const from = pinnedRows.findIndex((thread) => thread.id === threadId);
      if (from < 0) continue;
      const [moved] = pinnedRows.splice(from, 1);
      const to =
        beforeId === null
          ? -1
          : pinnedRows.findIndex((thread) => thread.id === beforeId);
      if (to < 0) pinnedRows.push(moved);
      else pinnedRows.splice(to, 0, moved);
    }
    visible = [
      ...pinnedRows,
      ...visible.filter((thread) => thread.pinned !== true),
    ];
  }

  const menuItems = (thread: ThreadListItem): OverflowMenuItem[] => {
    if (!adapter) return [];
    const items: OverflowMenuItem[] = [];
    if (mode === 'archived') {
      if (adapter.unarchive)
        items.push({ id: 'unarchive', label: 'Unarchive' });
    } else {
      const isPinned = thread.pinned === true;
      if (adapter.rename) items.push({ id: 'rename', label: 'Rename' });
      if (adapter.pin && !isPinned) items.push({ id: 'pin', label: 'Pin' });
      if (adapter.unpin && isPinned)
        items.push({ id: 'unpin', label: 'Unpin' });
      if (adapter.reorderPinned && isPinned) {
        const pinnedRows = visible.filter((row) => row.pinned === true);
        const at = pinnedRows.findIndex((row) => row.id === thread.id);
        if (at > 0) items.push({ id: 'move-up', label: 'Move up' });
        if (at >= 0 && at < pinnedRows.length - 1)
          items.push({ id: 'move-down', label: 'Move down' });
      }
      if (adapter.moveToProject && projects)
        items.push({ id: 'move', label: 'Move to project' });
      if (adapter.archive) items.push({ id: 'archive', label: 'Archive' });
    }
    if (adapter.delete)
      items.push({ id: 'delete', label: 'Delete', tone: 'destructive' });
    return items;
  };
  const projectItems: OverflowMenuItem[] = [
    { id: NO_PROJECT, label: 'No project' },
    ...(projects ?? []).map((project) => ({
      id: `project:${project.id}`,
      label: project.name || project.id,
    })),
  ];

  const hideRow = (id: string, run: () => RowActionResult) => {
    const next = neighborId(visible, id);
    if (next !== undefined) focusRow({ id: next, part: 'select' });
    void optimistic.hide(id, run);
  };
  const reorder = (id: string, beforeId: string | null) => {
    const run = adapter?.reorderPinned;
    if (!run) return;
    setOrder((current) => new Map(current).set(id, beforeId));
    void optimistic
      .settle(() => run(id, beforeId))
      .then(() =>
        setOrder((current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        })
      );
  };
  const choose = (
    thread: ThreadListItem,
    itemId: string,
    view: MenuState['view'],
    returnTo: HTMLElement | null
  ) => {
    if (!adapter) return;
    const id = thread.id;
    if (view === 'projects') {
      const projectId =
        itemId === NO_PROJECT ? null : itemId.slice('project:'.length);
      const run = adapter.moveToProject;
      if (run) void optimistic.settle(() => run(id, projectId));
      return;
    }
    const pinnedRows = visible.filter((row) => row.pinned === true);
    const at = pinnedRows.findIndex((row) => row.id === id);
    if (itemId === 'rename') setEditing({ id, value: thread.title ?? '' });
    else if (itemId === 'delete') setConfirming({ id, returnTo });
    else if (itemId === 'archive' && adapter.archive)
      hideRow(id, () => adapter.archive?.(id));
    else if (itemId === 'unarchive' && adapter.unarchive)
      hideRow(id, () => adapter.unarchive?.(id));
    else if (itemId === 'pin') void optimistic.settle(() => adapter.pin?.(id));
    else if (itemId === 'unpin')
      void optimistic.settle(() => adapter.unpin?.(id));
    else if (itemId === 'move')
      // The menu stays open and swaps to the destinations.
      setMenu({ id, view: 'projects', point: null, returnTo });
    else if (itemId === 'move-up' && at > 0) reorder(id, pinnedRows[at - 1].id);
    else if (itemId === 'move-down' && at >= 0 && at < pinnedRows.length - 1)
      reorder(id, pinnedRows[at + 2]?.id ?? null);
  };
  const closeEditor = (id: string) => {
    setEditing(null);
    focusRow({ id, part: 'menu' });
  };
  const builtInContextMenu: ThreadListProps['onContextMenu'] = (
    threadId,
    event
  ) => {
    event.preventDefault();
    setMenu({
      id: threadId,
      view: 'actions',
      point:
        event.type === 'contextmenu' && 'clientX' in event
          ? { x: event.clientX, y: event.clientY }
          : null,
      returnTo: event.currentTarget,
    });
  };
  const onContextMenu =
    ownerContextMenu ??
    (adapter && !renderItem && visible.some((row) => menuItems(row).length > 0)
      ? builtInContextMenu
      : undefined);

  const list = (
    <ul
      ref={root}
      className={`tp-thread-list${className ? ` ${className}` : ''}`}
      aria-label={label}
    >
      {visible.map((supplied, index) => {
        if (renderItem) {
          return (
            <li key={supplied.id} className="tp-thread-list__item">
              {renderItem(supplied, supplied.id === activeThreadId)}
            </li>
          );
        }
        const pendingTitle = optimistic.names.get(supplied.id);
        const thread =
          pendingTitle === undefined
            ? supplied
            : { ...supplied, title: pendingTitle };
        if (editing?.id === thread.id) {
          return (
            <li
              key={thread.id}
              data-row-id={thread.id}
              className="tp-thread-list__item tp-thread-list__item--editing"
            >
              <ThreadRenameForm
                value={editing.value}
                onValueChange={(value) => setEditing({ id: thread.id, value })}
                onCancel={() => closeEditor(thread.id)}
                onSubmit={() => {
                  const next = editing.value.trim();
                  const run = adapter?.rename;
                  closeEditor(thread.id);
                  if (next && run && next !== (thread.title ?? ''))
                    void optimistic.rename(thread.id, next, () =>
                      run(thread.id, next)
                    );
                }}
              />
            </li>
          );
        }
        const pinned = thread.pinned === true;
        const title = thread.title || thread.id;
        const content = renderTitle ? renderTitle(thread) : title;
        const ownerActions = renderActions?.(thread);
        const items = menuItems(thread);
        const menuOpen = menu?.id === thread.id;
        const builtIn = items.length > 0 && (
          <OverflowMenu
            label={`More actions for ${title}`}
            items={menuOpen && menu.view === 'projects' ? projectItems : items}
            open={menuOpen}
            anchorPoint={menuOpen ? menu.point : null}
            returnFocusTo={menuOpen ? menu.returnTo : null}
            onOpenChange={(open) =>
              setMenu((current) =>
                open
                  ? {
                      id: thread.id,
                      view: 'actions',
                      point: null,
                      returnTo: null,
                    }
                  : current?.id === thread.id
                  ? null
                  : current
              )
            }
            onSelect={(itemId) =>
              choose(
                thread,
                itemId,
                menuOpen ? menu.view : 'actions',
                (menuOpen ? menu.returnTo : null) ??
                  Array.from(root.current?.children ?? [])
                    .find(
                      (row) =>
                        (row as HTMLElement).dataset['rowId'] === thread.id
                    )
                    ?.querySelector<HTMLElement>(
                      '.tp-overflow-menu__trigger'
                    ) ??
                  null
              )
            }
          />
        );
        const actions =
          builtIn &&
          ownerActions !== null &&
          ownerActions !== false &&
          ownerActions !== undefined ? (
            <>
              {ownerActions}
              {builtIn}
            </>
          ) : (
            builtIn || ownerActions
          );
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
            data-row-id={thread.id}
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
              onPointerDown={
                onContextMenu
                  ? () => {
                      keyboardContext.current = null;
                    }
                  : undefined
              }
              onContextMenu={
                onContextMenu
                  ? (event) => {
                      if (event.defaultPrevented) return;
                      const duplicate =
                        keyboardContext.current === event.currentTarget &&
                        event.button === 0;
                      keyboardContext.current = null;
                      if (duplicate) {
                        event.preventDefault();
                        return;
                      }
                      onContextMenu(thread.id, event);
                    }
                  : undefined
              }
              onKeyDown={
                onContextMenu
                  ? (event) => {
                      if (
                        event.defaultPrevented ||
                        event.repeat ||
                        event.nativeEvent.isComposing ||
                        event.ctrlKey ||
                        event.metaKey ||
                        event.altKey
                      )
                        return;
                      if (
                        !(
                          (event.key === 'ContextMenu' && !event.shiftKey) ||
                          (event.key === 'F10' && event.shiftKey)
                        )
                      )
                        return;
                      const button = event.currentTarget;
                      onContextMenu(thread.id, event);
                      keyboardContext.current = event.defaultPrevented
                        ? button
                        : null;
                    }
                  : undefined
              }
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
  const view = onNewThread ? (
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
  if (!adapter?.delete || renderItem) return view;
  return (
    <>
      {view}
      <ConfirmDialog
        open={confirming !== null}
        title="Delete conversation?"
        body="This conversation will be permanently deleted."
        confirmLabel="Delete"
        tone="destructive"
        returnFocusTo={confirming?.returnTo}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const target = confirming;
          const run = adapter.delete;
          setConfirming(null);
          if (target && run) hideRow(target.id, () => run(target.id));
        }}
      />
    </>
  );
}
