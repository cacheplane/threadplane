// libs/chat/src/lib/primitives/chat-thread-list/chat-thread-list.component.ts
import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  computed,
  contentChild,
  input,
  output,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_THREAD_LIST_STYLES } from '../../styles/chat-thread-list.styles';
import {
  ChatOverflowMenuComponent,
  type OverflowMenuItem,
} from '../chat-overflow-menu/chat-overflow-menu.component';
import { ChatConfirmDialogComponent } from '../chat-confirm-dialog/chat-confirm-dialog.component';
import type { Project } from '../chat-project-list/chat-project-list.component';

/** A conversation list entry with optional title, timestamp, lifecycle, pin, and project metadata. */
export type Thread = {
  id: string;
  /** Optional human-friendly label. Falls back to a slice of the id. */
  title?: string;
  /** Optional epoch-ms timestamp used by the default item template to
   *  render a relative-time line ("just now" / "5 min ago"). When absent
   *  the default template omits the second line. */
  updatedAt?: number;
  /** Optional lifecycle status. Undefined treated as 'active'. The framework
   *  does NOT auto-filter by this field — consumers pre-filter into separate
   *  `threads` and `archivedThreads` inputs on chat-sidenav. The field is
   *  typed documentation of intent. */
  status?: 'active' | 'archived';
  /** Optional flag indicating the thread is pinned (sticky-top). The framework
   *  renders a pin icon when true but does NOT sort — the consumer pre-sorts
   *  pinned threads to the top of the `threads` input. */
  pinned?: boolean;
  /** Optional project association. Consumers pre-filter threads by project
   *  before passing to the sidenav. Null/undefined means no project. */
  projectId?: string | null;
  [key: string]: unknown;
};

/**
 * Per-thread row-action adapter. Consumer-provided. The framework calls
 * these methods after user confirmation (delete) or commit (rename) and
 * manages optimistic UI + rollback on rejection.
 *
 * Consumers MUST refresh their `threads` signal on success — the framework
 * clears optimistic overrides in a `finally` block, so a successful adapter
 * call that leaves the input list unchanged would re-render the row.
 */
export interface ThreadActionAdapter {
  delete?(threadId: string): Promise<void>;
  rename?(threadId: string, newTitle: string): Promise<void>;
  /** Archive a thread (reversible). No confirmation dialog — framework calls
   *  this immediately on click. */
  archive?(threadId: string): Promise<void>;
  /** Restore an archived thread to the active list. */
  unarchive?(threadId: string): Promise<void>;
  /** Mark the thread as pinned. */
  pin?(threadId: string): Promise<void>;
  /** Unpin a previously pinned thread. */
  unpin?(threadId: string): Promise<void>;
  /** Move thread to a project (or pass null to remove from any project).
   *  Optimistically hides the row from the current project's visible list;
   *  consumer is expected to refresh the threads input. */
  moveToProject?(threadId: string, projectId: string | null): Promise<void>;
  /** Reorder a pinned thread. `beforeId` is the id of the pinned thread it
   *  should be placed before, or null to move to the end of the pinned list.
   *  Framework optimistically reorders the visible list and awaits this
   *  method; rejection rolls back. */
  reorderPinned?(threadId: string, beforeId: string | null): Promise<void>;
}

/** Lists selectable conversations with custom templates and optional thread management actions. */
@Component({
  selector: 'chat-thread-list',
  standalone: true,
  imports: [NgTemplateOutlet, ChatOverflowMenuComponent, ChatConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_THREAD_LIST_STYLES],
  template: `
    @if (showNewThreadButton()) {
      <button type="button" class="chat-thread-list__new" (click)="newThreadRequested.emit()">+ New thread</button>
    }
    <ul class="chat-thread-list">
      @for (thread of visibleThreads(); track thread.id) {
        <li
          class="chat-thread-list__item-wrap"
          [attr.draggable]="thread.pinned && actions()?.reorderPinned ? 'true' : null"
          [attr.data-dragging]="draggingThreadId() === thread.id ? 'true' : null"
          [attr.data-drop-position]="dropPositionFor(thread.id)"
          (dragstart)="onDragStart($event, thread.id)"
          (dragover)="onDragOver($event, thread.id)"
          (dragleave)="onDragLeave($event, thread.id)"
          (drop)="onDrop($event, thread.id)"
          (dragend)="onDragEnd()"
          (contextmenu)="onRowContextMenu(thread.id, $event)"
        >
          @if (templateRef()) {
            <ng-container
              [ngTemplateOutlet]="templateRef()!"
              [ngTemplateOutletContext]="{ $implicit: thread, isActive: thread.id === activeThreadId() }"
            />
          } @else if (editingThreadId() === thread.id) {
            <input
              #editInput
              class="chat-thread-list__edit"
              type="text"
              [value]="editingValue()"
              (input)="onEditInput($event)"
              (keydown.enter)="commitRename(thread.id)"
              (keydown.escape)="cancelRename()"
              (blur)="cancelRename()"
              aria-label="Rename conversation"
            />
          } @else {
            <button
              type="button"
              class="chat-thread-list__item"
              [attr.title]="threadLabel(thread)"
              [attr.data-active]="thread.id === activeThreadId() ? 'true' : null"
              [attr.aria-current]="thread.id === activeThreadId() ? 'true' : null"
              (click)="selectThread(thread.id)"
            >
              <span class="chat-thread-list__initial" aria-hidden="true">{{ initialOf(threadLabel(thread)) }}</span>
              <span class="chat-thread-list__item-title">
                @if (thread.pinned) {
                  <span class="chat-thread-list__pin-slot" aria-hidden="true">
                    <svg class="chat-thread-list__item-pin" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
                    </svg>
                    @if (actions()?.reorderPinned) {
                      <span class="chat-thread-list__grip">⋮⋮</span>
                    }
                  </span>
                }
                {{ threadLabel(thread) }}
              </span>
              @if (thread.updatedAt !== undefined) {
                <span class="chat-thread-list__item-time">{{ relativeTime(thread.updatedAt) }}</span>
              }
            </button>

            @if (showKebab()) {
              <button
                #kebab
                type="button"
                class="chat-thread-list__kebab"
                aria-label="More actions"
                aria-haspopup="menu"
                [attr.aria-expanded]="menuOpenForId() === thread.id ? 'true' : 'false'"
                (click)="openMenu(thread.id, kebab)"
              >⋯</button>
            }
          }
        </li>
      }
    </ul>

    <chat-overflow-menu
      [open]="menuOpenForId() !== null"
      [items]="currentMenuItems()"
      [anchor]="menuAnchor()"
      [anchorPos]="menuAnchorPos()"
      (itemSelected)="onMenuAction($event)"
      (closed)="menuOpenForId.set(null)"
    />

    <chat-overflow-menu
      [open]="moveMenuOpenForId() !== null"
      [items]="moveMenuItems()"
      [anchor]="menuAnchor()"
      [anchorPos]="menuAnchorPos()"
      (itemSelected)="onMoveMenuAction($event)"
      (closed)="moveMenuOpenForId.set(null)"
    />

    <chat-confirm-dialog
      [open]="confirmDeleteId() !== null"
      title="Delete conversation?"
      body="This conversation will be permanently deleted."
      confirmLabel="Delete"
      tone="destructive"
      (confirmed)="performDelete()"
      (cancelled)="confirmDeleteId.set(null)"
    />
  `,
})
export class ChatThreadListComponent {
  readonly threads = input.required<Thread[]>();
  readonly activeThreadId = input<string>('');
  readonly showNewThreadButton = input<boolean>(false);
  readonly actions = input<ThreadActionAdapter | null>(null);
  readonly mode = input<'active' | 'archived'>('active');
  readonly projects = input<Project[] | null>(null);

  readonly threadSelected = output<string>();
  readonly newThreadRequested = output<void>();

  readonly templateRef = contentChild(TemplateRef);

  protected readonly editingThreadId = signal<string | null>(null);
  protected readonly editingValue = signal<string>('');
  protected readonly menuOpenForId = signal<string | null>(null);
  protected readonly menuAnchor = signal<HTMLElement | null>(null);
  /** Cursor-anchored position when the menu was opened via right-click.
   *  Mutually exclusive with `menuAnchor` — set one, null the other. */
  protected readonly menuAnchorPos = signal<{ x: number; y: number } | null>(null);
  protected readonly confirmDeleteId = signal<string | null>(null);

  protected readonly moveMenuOpenForId = signal<string | null>(null);

  protected readonly moveMenuItems = computed<OverflowMenuItem[]>(() => {
    if (!this.moveMenuOpenForId()) return [];
    const list: OverflowMenuItem[] = [{ id: '__none__', label: 'No project' }];
    for (const p of this.projects() ?? []) {
      list.push({ id: p.id, label: p.name });
    }
    return list;
  });

  /** Ids hidden from the rendered list during pending delete, archive, or
   *  unarchive. The framework doesn't distinguish — all three actions hide
   *  the row from the current list until the adapter promise settles. */
  private readonly pendingHidden = signal<ReadonlySet<string>>(new Set());
  private readonly pendingRenames = signal<ReadonlyMap<string, string>>(new Map());

  /** Pending reorder overrides for pinned threads. Each entry: "move this id
   *  to before that id (or to end if null)". Cleared in `finally` after the
   *  adapter call settles. */
  private readonly pendingOrder = signal<ReadonlyMap<string, string | null>>(new Map());

  /** Id of the thread currently being dragged via HTML5 drag-and-drop. */
  protected readonly draggingThreadId = signal<string | null>(null);

  /** Drop target during a drag: which row, and whether the indicator shows
   *  on the top edge ('before') or bottom edge ('after'). */
  protected readonly dropTarget = signal<{ threadId: string; position: 'before' | 'after' } | null>(null);

  protected readonly visibleThreads = computed<Thread[]>(() => {
    const hidden = this.pendingHidden();
    const renames = this.pendingRenames();
    const pending = this.pendingOrder();

    let result = this.threads()
      .filter((t) => !hidden.has(t.id))
      .map((t) => (renames.has(t.id) ? ({ ...t, title: renames.get(t.id) }) : t));

    if (pending.size > 0) {
      const pinned = result.filter((t) => t.pinned === true);
      const unpinned = result.filter((t) => t.pinned !== true);
      for (const [threadId, beforeId] of pending) {
        const idx = pinned.findIndex((t) => t.id === threadId);
        if (idx < 0) continue;
        const [moved] = pinned.splice(idx, 1);
        if (beforeId === null) {
          pinned.push(moved);
        } else {
          const beforeIdx = pinned.findIndex((t) => t.id === beforeId);
          if (beforeIdx < 0) pinned.push(moved);
          else pinned.splice(beforeIdx, 0, moved);
        }
      }
      result = [...pinned, ...unpinned];
    }
    return result;
  });

  protected readonly currentMenuItems = computed<OverflowMenuItem[]>(() => {
    const id = this.menuOpenForId();
    if (!id) return [];
    const a = this.actions();
    if (!a) return [];
    const items: OverflowMenuItem[] = [];
    if (this.mode() === 'active') {
      const thread = this.threads().find((t) => t.id === id);
      const isPinned = thread?.pinned === true;
      if (a.rename) items.push({ id: 'rename', label: 'Rename' });
      if (a.pin && !isPinned) items.push({ id: 'pin', label: 'Pin' });
      if (a.unpin && isPinned) items.push({ id: 'unpin', label: 'Unpin' });

      if (isPinned && a.reorderPinned) {
        const pinned = this.threads().filter((t) => t.pinned === true);
        const pinnedIdx = pinned.findIndex((t) => t.id === id);
        if (pinnedIdx > 0) items.push({ id: 'move-up', label: 'Move up' });
        if (pinnedIdx >= 0 && pinnedIdx < pinned.length - 1) items.push({ id: 'move-down', label: 'Move down' });
      }

      if (a.moveToProject && this.projects() !== null) {
        items.push({ id: 'move', label: 'Move to project' });
      }
      if (a.archive) items.push({ id: 'archive', label: 'Archive' });
      if (a.delete) items.push({ id: 'delete', label: 'Delete', tone: 'destructive' });
    } else {
      if (a.unarchive) items.push({ id: 'unarchive', label: 'Unarchive' });
      if (a.delete) items.push({ id: 'delete', label: 'Delete', tone: 'destructive' });
    }
    return items;
  });

  private readonly editInput = viewChild<ElementRef<HTMLInputElement>>('editInput');

  selectThread(threadId: string): void {
    this.threadSelected.emit(threadId);
  }

  protected threadLabel(thread: Thread): string {
    const title = thread['title'];
    if (typeof title === 'string' && title.length > 0) return title;
    return thread.id;
  }

  protected relativeTime(epochMs: number): string {
    const delta = Date.now() - epochMs;
    if (delta < 60_000) return 'just now';
    if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} min ago`;
    if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} hr ago`;
    return `${Math.floor(delta / 86_400_000)} day ago`;
  }

  protected showKebab(): boolean {
    const a = this.actions();
    if (!a) return false;
    if (this.mode() === 'active') {
      return Boolean(
        a.rename || a.pin || a.unpin || a.archive || a.delete ||
        a.reorderPinned ||
        (a.moveToProject && this.projects() !== null)
      );
    }
    return Boolean(a.unarchive || a.delete);
  }

  protected openMenu(threadId: string, anchor: HTMLElement): void {
    this.menuAnchor.set(anchor);
    this.menuAnchorPos.set(null);
    this.menuOpenForId.set(threadId);
  }

  /** Right-click on a row opens the same overflow menu anchored at the
   *  cursor. Always prevents the native context menu — including when the
   *  adapter exposes no row actions (in which case we open nothing rather
   *  than confusing the user with the OS menu on what looks like a custom
   *  list). */
  protected onRowContextMenu(threadId: string, event: MouseEvent): void {
    event.preventDefault();
    if (!this.showKebab()) return;
    if (this.editingThreadId() !== null) return;
    this.menuAnchor.set(null);
    this.menuAnchorPos.set({ x: event.clientX, y: event.clientY });
    this.menuOpenForId.set(threadId);
  }

  /** First grapheme of a title rendered as an uppercase initial for the
   *  collapsed sidenav. Falls back to "?" for empty/whitespace titles. */
  protected initialOf(title: string): string {
    const trimmed = (title ?? '').trim();
    if (!trimmed) return '?';
    const first = Array.from(trimmed)[0];
    return first.toUpperCase ? first.toUpperCase() : first;
  }

  protected onMenuAction(id: string): void {
    const threadId = this.menuOpenForId();
    this.menuOpenForId.set(null);
    if (!threadId) return;

    if (id === 'rename') {
      const t = this.threads().find((x) => x.id === threadId);
      this.editingValue.set(typeof t?.title === 'string' ? t.title : '');
      this.editingThreadId.set(threadId);
      queueMicrotask(() => this.editInput()?.nativeElement.focus());
    } else if (id === 'delete') {
      this.confirmDeleteId.set(threadId);
    } else if (id === 'archive') {
      void this.performArchive(threadId);
    } else if (id === 'unarchive') {
      void this.performUnarchive(threadId);
    } else if (id === 'pin') {
      void this.performPin(threadId);
    } else if (id === 'unpin') {
      void this.performUnpin(threadId);
    } else if (id === 'move') {
      this.moveMenuOpenForId.set(threadId);
    } else if (id === 'move-up') {
      void this.performMoveUp(threadId);
    } else if (id === 'move-down') {
      void this.performMoveDown(threadId);
    }
  }

  protected async performPin(threadId: string): Promise<void> {
    const a = this.actions();
    if (!a?.pin) return;
    try { await a.pin(threadId); } catch { /* visual state remains until next successful refresh */ }
  }

  protected async performUnpin(threadId: string): Promise<void> {
    const a = this.actions();
    if (!a?.unpin) return;
    try { await a.unpin(threadId); } catch { /* visual state remains until next successful refresh */ }
  }

  protected onEditInput(e: Event): void {
    this.editingValue.set((e.target as HTMLInputElement).value);
  }

  protected cancelRename(): void {
    this.editingThreadId.set(null);
  }

  protected async commitRename(threadId: string): Promise<void> {
    const newTitle = this.editingValue().trim();
    this.editingThreadId.set(null);
    if (!newTitle) return;
    const a = this.actions();
    if (!a?.rename) return;

    this.pendingRenames.update((m) => {
      const n = new Map(m);
      n.set(threadId, newTitle);
      return n;
    });
    try {
      await a.rename(threadId, newTitle);
    } catch {
      // Rollback happens via the finally clear below.
    } finally {
      this.pendingRenames.update((m) => {
        const n = new Map(m);
        n.delete(threadId);
        return n;
      });
    }
  }

  protected async performDelete(): Promise<void> {
    const threadId = this.confirmDeleteId();
    this.confirmDeleteId.set(null);
    if (!threadId) return;
    const a = this.actions();
    if (!a?.delete) return;

    this.pendingHidden.update((s) => new Set([...s, threadId]));
    try {
      await a.delete(threadId);
    } catch {
      // Rollback: clear override below so the row reappears.
    } finally {
      this.pendingHidden.update((s) => {
        const n = new Set(s);
        n.delete(threadId);
        return n;
      });
    }
  }

  protected async performArchive(threadId: string): Promise<void> {
    const a = this.actions();
    if (!a?.archive) return;
    this.pendingHidden.update((s) => new Set([...s, threadId]));
    try {
      await a.archive(threadId);
    } catch {
      // Rollback: clear override below so the row reappears.
    } finally {
      this.pendingHidden.update((s) => {
        const n = new Set(s);
        n.delete(threadId);
        return n;
      });
    }
  }

  protected onMoveMenuAction(itemId: string): void {
    const threadId = this.moveMenuOpenForId();
    this.moveMenuOpenForId.set(null);
    if (!threadId) return;
    const projectId = itemId === '__none__' ? null : itemId;
    void this.performMoveToProject(threadId, projectId);
  }

  protected async performMoveToProject(threadId: string, projectId: string | null): Promise<void> {
    const a = this.actions();
    if (!a?.moveToProject) return;
    this.pendingHidden.update((s) => new Set([...s, threadId]));
    try {
      await a.moveToProject(threadId, projectId);
    } catch {
      /* rollback via finally */
    } finally {
      this.pendingHidden.update((s) => {
        const n = new Set(s);
        n.delete(threadId);
        return n;
      });
    }
  }

  protected async performReorderPinned(threadId: string, beforeId: string | null): Promise<void> {
    const a = this.actions();
    if (!a?.reorderPinned) return;
    this.pendingOrder.update((m) => {
      const n = new Map(m);
      n.set(threadId, beforeId);
      return n;
    });
    try {
      await a.reorderPinned(threadId, beforeId);
    } catch {
      /* rollback via finally */
    } finally {
      this.pendingOrder.update((m) => {
        const n = new Map(m);
        n.delete(threadId);
        return n;
      });
    }
  }

  protected async performMoveUp(threadId: string): Promise<void> {
    const pinned = this.threads().filter((t) => t.pinned === true);
    const idx = pinned.findIndex((t) => t.id === threadId);
    if (idx <= 0) return;
    const beforeId = pinned[idx - 1].id;
    await this.performReorderPinned(threadId, beforeId);
  }

  protected async performMoveDown(threadId: string): Promise<void> {
    const pinned = this.threads().filter((t) => t.pinned === true);
    const idx = pinned.findIndex((t) => t.id === threadId);
    if (idx < 0 || idx >= pinned.length - 1) return;
    const beforeId = idx + 2 < pinned.length ? pinned[idx + 2].id : null;
    await this.performReorderPinned(threadId, beforeId);
  }

  protected onDragStart(e: DragEvent, threadId: string): void {
    const dt = e.dataTransfer;
    if (!dt) return;
    dt.setData('text/plain', threadId);
    dt.effectAllowed = 'move';
    this.draggingThreadId.set(threadId);
  }

  protected onDragOver(e: DragEvent, threadId: string): void {
    const dragging = this.draggingThreadId();
    if (!dragging || dragging === threadId) return;
    const target = this.threads().find((t) => t.id === threadId);
    if (target?.pinned !== true) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const position: 'before' | 'after' = offsetY < rect.height / 2 ? 'before' : 'after';
    const cur = this.dropTarget();
    if (!cur || cur.threadId !== threadId || cur.position !== position) {
      this.dropTarget.set({ threadId, position });
    }
  }

  protected onDragLeave(_e: DragEvent, threadId: string): void {
    if (this.dropTarget()?.threadId === threadId) {
      this.dropTarget.set(null);
    }
  }

  protected onDrop(e: DragEvent, targetThreadId: string): void {
    e.preventDefault();
    const dragId = e.dataTransfer?.getData('text/plain') ?? this.draggingThreadId();
    const target = this.dropTarget();
    this.draggingThreadId.set(null);
    this.dropTarget.set(null);
    if (!dragId || dragId === targetThreadId || !target) return;

    const pinned = this.threads().filter((t) => t.pinned === true);
    const targetIdx = pinned.findIndex((t) => t.id === targetThreadId);
    if (targetIdx < 0) return;
    let beforeId: string | null;
    if (target.position === 'before') {
      beforeId = targetThreadId;
    } else {
      const filteredPinned = pinned.filter((t) => t.id !== dragId);
      const filteredTargetIdx = filteredPinned.findIndex((t) => t.id === targetThreadId);
      beforeId = filteredTargetIdx + 1 < filteredPinned.length
        ? filteredPinned[filteredTargetIdx + 1].id
        : null;
    }
    void this.performReorderPinned(dragId, beforeId);
  }

  protected onDragEnd(): void {
    this.draggingThreadId.set(null);
    this.dropTarget.set(null);
  }

  protected dropPositionFor(threadId: string): 'before' | 'after' | null {
    const t = this.dropTarget();
    return t?.threadId === threadId ? t.position : null;
  }

  protected async performUnarchive(threadId: string): Promise<void> {
    const a = this.actions();
    if (!a?.unarchive) return;
    this.pendingHidden.update((s) => new Set([...s, threadId]));
    try {
      await a.unarchive(threadId);
    } catch {
      // Rollback: clear override below so the row reappears.
    } finally {
      this.pendingHidden.update((s) => {
        const n = new Set(s);
        n.delete(threadId);
        return n;
      });
    }
  }
}
