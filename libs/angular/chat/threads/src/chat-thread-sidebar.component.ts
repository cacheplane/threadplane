// libs/angular/chat/threads/src/chat-thread-sidebar.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  TemplateRef,
  computed,
  contentChild,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { outputFromObservable } from '@angular/core/rxjs-interop';
import { Subject } from 'rxjs';
import { ɵCHAT_HOST_TOKENS as CHAT_HOST_TOKENS } from '@threadplane/angular/chat/shared';
import {
  ChatThreadListComponent,
  type Thread,
  type ThreadActionAdapter,
  type ThreadRowAction,
} from './chat-thread-list.component';
import {
  ChatProjectListComponent,
  type Project,
  type ProjectActionAdapter,
} from './chat-project-list.component';
import type { Agent } from '@threadplane/angular';
import type { AgentStatus } from '@threadplane/core';
import type {
  ProjectEntry,
  ThreadDirectory,
  ThreadDirectorySnapshot,
  ThreadEntry,
} from '@threadplane/core';
import { ɵinjectChatRootStyles as injectChatRuntime } from '@threadplane/angular/chat/shared';

/**
 * Built-in sidebar features. Each defaults to on when the directory supports
 * it; `false` turns it off even when the directory could perform it.
 */
export interface ThreadSidebarFeatures {
  /** The Projects section, project commands and Move to project. */
  readonly projects?: boolean;
  /** The Archived section and Archive and Unarchive. */
  readonly archive?: boolean;
  readonly pin?: boolean;
  readonly reorder?: boolean;
  readonly rename?: boolean;
  readonly remove?: boolean;
}

/** Template context for a row drawn by `ng-template[chatThreadRow]`. */
export interface ChatThreadRowTemplateContext {
  /** The conversation (`let-thread`). */
  $implicit: Thread;
  /** Whether it is the active conversation (`let-isActive="isActive"`). */
  isActive: boolean;
}

/**
 * Replaces each conversation row of `<chat-thread-sidebar>`. Rows drawn by
 * this template get no row menu, so they offer no built-in commands and no
 * `extraActions`.
 *
 * ```html
 * <chat-thread-sidebar [directory]="threads.directory">
 *   <ng-template chatThreadRow let-thread let-isActive="isActive">
 *     <my-row [thread]="thread" [active]="isActive" />
 *   </ng-template>
 * </chat-thread-sidebar>
 * ```
 */
@Directive({
  selector: 'ng-template[chatThreadRow]',
  standalone: true,
})
export class ChatThreadRowTemplateDirective {
  readonly templateRef =
    inject<TemplateRef<ChatThreadRowTemplateContext>>(TemplateRef);

  static ngTemplateContextGuard(
    _directive: ChatThreadRowTemplateDirective,
    context: unknown
  ): context is ChatThreadRowTemplateContext {
    return true;
  }
}

type ThreadSidebarLabelKey =
  | 'newChat'
  | 'projects'
  | 'recent'
  | 'archived'
  | 'archivedEmpty'
  | 'loadError'
  | 'retry'
  | 'empty';

const DEFAULT_LABELS: Record<ThreadSidebarLabelKey, string> = {
  newChat: 'New chat',
  projects: 'Projects',
  recent: 'Recent',
  archived: 'Archived',
  archivedEmpty: 'No archived conversations.',
  loadError: 'Could not load conversations.',
  retry: 'Retry',
  empty: 'No conversations yet.',
};

const ignore = () => undefined;

// The list primitives take the open `Thread`/`Project` shapes and only read
// them, so the directory's frozen entries are passed through unchanged.
const asThreads = (entries: readonly ThreadEntry[]): Thread[] =>
  entries as unknown as Thread[];
const asProjects = (entries: readonly ProjectEntry[]): Project[] =>
  entries as unknown as Project[];

/**
 * The entries in `projectId`, or all of them when no project is selected or
 * the selected project is not in `projects` (deleted, or the Store is
 * unavailable), so a stale selection never hides every conversation.
 */
function inProject(
  entries: readonly ThreadEntry[],
  projectId: string | null,
  projects: ThreadDirectorySnapshot['projects']
): readonly ThreadEntry[] {
  return typeof projectId === 'string' &&
    projects?.some((project) => project.id === projectId)
    ? entries.filter((entry) => entry.projectId === projectId)
    : entries;
}
let sidebarInstanceCounter = 0;

const CHAT_THREAD_SIDEBAR_STYLES = `
  :host {
    display: flex;
    flex-direction: column;
    gap: var(--tplane-chat-space-3);
    min-width: 0;
  }
  :host([aria-busy="true"]) .chat-thread-sidebar__section {
    opacity: 0.6;
  }
  .chat-thread-sidebar__error {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--tplane-chat-space-2);
    padding: 8px 12px;
    background: var(--tplane-chat-error-bg);
    border: 1px solid var(--tplane-chat-error-border);
    border-radius: var(--tplane-chat-radius-card);
    color: var(--tplane-chat-error-text);
    font-size: var(--tplane-chat-font-size-sm);
  }
  .chat-thread-sidebar__error-message {
    flex: 1;
    min-width: 0;
    margin: 0;
  }
  .chat-thread-sidebar__retry {
    flex-shrink: 0;
    padding: 2px 10px;
    background: transparent;
    border: 1px solid var(--tplane-chat-error-border);
    border-radius: var(--tplane-chat-radius-card);
    color: var(--tplane-chat-error-text);
    font: inherit;
    cursor: pointer;
  }
  .chat-thread-sidebar__new {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: 0;
    border-radius: var(--tplane-chat-radius-card);
    color: var(--tplane-chat-text);
    font: inherit;
    cursor: pointer;
  }
  .chat-thread-sidebar__new:hover,
  .chat-thread-sidebar__archived-toggle:hover {
    background: var(--tplane-chat-surface-alt);
  }
  .chat-thread-sidebar__new:focus-visible,
  .chat-thread-sidebar__retry:focus-visible,
  .chat-thread-sidebar__archived-toggle:focus-visible {
    outline: 2px solid var(--tplane-chat-focus-ring);
    outline-offset: 2px;
  }
  .chat-thread-sidebar__icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
  .chat-thread-sidebar__section {
    min-width: 0;
  }
  .chat-thread-sidebar__heading {
    margin: 0;
    padding: 8px 12px 4px;
    font-size: var(--tplane-chat-font-size-xs);
    font-weight: inherit;
    color: var(--tplane-chat-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .chat-thread-sidebar__archived-heading {
    margin: 0;
    font-size: inherit;
    font-weight: inherit;
  }
  .chat-thread-sidebar__archived-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: 0;
    border-radius: var(--tplane-chat-radius-card);
    color: var(--tplane-chat-text);
    font: inherit;
    cursor: pointer;
  }
  .chat-thread-sidebar__chevron {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    transition: transform var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease);
  }
  .chat-thread-sidebar__section[data-open="true"] .chat-thread-sidebar__chevron {
    transform: rotate(90deg);
  }
  .chat-thread-sidebar__empty {
    margin: 0;
    padding: 8px 12px;
    color: var(--tplane-chat-text-muted);
    font-size: var(--tplane-chat-font-size-sm);
  }
`;

/**
 * A conversation sidebar connected to a {@link ThreadDirectory}: New chat,
 * Projects, Recent and Archived with the row commands the directory supports.
 * It refreshes on mount and, given an `agent`, after each run. Place it in
 * the `sidenavSections` slot of `<chat-sidenav>` or use it on its own.
 *
 * The directory is app-owned: the sidebar subscribes to it and releases that
 * subscription on destroy, but never calls `dispose()`.
 *
 * `newChat` replaces the default New chat: with no listener, New chat calls
 * `directory.create()` and emits `threadSelected` with the new id. Without a
 * listener or a `create` command, the button is omitted. `activeThreadRemoved`
 * fires after the conversation that was active is deleted.
 *
 * Content: `[chatThreadSidebarBefore]` and `[chatThreadSidebarAfter]` place
 * app sections around the built-in ones, and `ng-template[chatThreadRow]`
 * replaces each conversation row.
 *
 * @example
 * ```html
 * <chat-thread-sidebar
 *   [directory]="threads.directory"
 *   [agent]="agent"
 *   [activeThreadId]="threadId()"
 *   (threadSelected)="threadId.set($event)"
 *   (activeThreadRemoved)="threadId.set(null)"
 * />
 * ```
 */
@Component({
  selector: 'chat-thread-sidebar',
  standalone: true,
  imports: [ChatThreadListComponent, ChatProjectListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.aria-busy]': 'loading() ? "true" : null',
  },
  styles: [CHAT_HOST_TOKENS, CHAT_THREAD_SIDEBAR_STYLES],
  template: `
    <ng-content select="[chatThreadSidebarBefore]" />
    @if (failed()) {
    <div role="alert" class="chat-thread-sidebar__error">
      <p class="chat-thread-sidebar__error-message">{{ label('loadError') }}</p>
      <button
        type="button"
        class="chat-thread-sidebar__retry"
        (click)="retry()"
      >
        {{ label('retry') }}
      </button>
    </div>
    } @if (showNewChat()) {
    <button
      type="button"
      class="chat-thread-sidebar__new"
      (click)="startNewChat()"
    >
      <svg
        class="chat-thread-sidebar__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
      {{ label('newChat') }}
    </button>
    } @if (projects(); as projectList) {
    <section
      class="chat-thread-sidebar__section"
      [attr.aria-labelledby]="ids.projects"
    >
      <h2 [id]="ids.projects" class="chat-thread-sidebar__heading">
        {{ label('projects') }}
      </h2>
      <chat-project-list
        [projects]="projectList"
        [activeProjectId]="selectedProjectId()"
        [showNewProjectButton]="!!projectActions()?.create"
        [actions]="projectActions()"
        (projectSelected)="projectSelected.emit($event)"
      />
    </section>
    }
    <section
      class="chat-thread-sidebar__section"
      [attr.aria-labelledby]="ids.recent"
    >
      <h2 [id]="ids.recent" class="chat-thread-sidebar__heading">
        {{ label('recent') }}
      </h2>
      @if (threads().length === 0 && showEmpty()) {
      <p class="chat-thread-sidebar__empty">{{ label('empty') }}</p>
      } @else {
      <chat-thread-list
        [threads]="threads()"
        [activeThreadId]="activeThreadId() ?? ''"
        [actions]="rowTemplate() ? null : threadActions()"
        [projects]="projects()"
        [extraActions]="rowTemplate() ? null : extraActions()"
        [itemTemplate]="rowTemplate()?.templateRef ?? null"
        (threadSelected)="threadSelected.emit($event)"
    />
      }
    </section>
    @if (showArchive()) {
    <section
      class="chat-thread-sidebar__section chat-thread-sidebar__archived"
      [attr.data-open]="archivedOpen() ? 'true' : 'false'"
    >
      <h2 class="chat-thread-sidebar__archived-heading">
        <button
          type="button"
          class="chat-thread-sidebar__archived-toggle"
          [attr.aria-expanded]="archivedOpen() ? 'true' : 'false'"
          [attr.aria-controls]="ids.archived"
          (click)="archivedOpen.set(!archivedOpen())"
        >
          <svg
            class="chat-thread-sidebar__chevron"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
          {{ label('archived') }}
        </button>
      </h2>
      <div [id]="ids.archived" [hidden]="!archivedOpen()">
        @if (archivedOpen()) { @if (archivedThreads().length === 0) {
        <p class="chat-thread-sidebar__empty">{{ label('archivedEmpty') }}</p>
        } @else {
        <chat-thread-list
          mode="archived"
          [threads]="archivedThreads()"
          [activeThreadId]="activeThreadId() ?? ''"
          [actions]="rowTemplate() ? null : threadActions()"
          [projects]="projects()"
          [extraActions]="rowTemplate() ? null : extraActions()"
          [itemTemplate]="rowTemplate()?.templateRef ?? null"
          (threadSelected)="threadSelected.emit($event)"
      />
        } }
      </div>
    </section>
    }
    <ng-content select="[chatThreadSidebarAfter]" />
  `,
})
export class ChatThreadSidebarComponent {
  protected readonly chatRuntime = injectChatRuntime();
  /** App-owned; the sidebar never disposes it. */
  readonly directory = input.required<ThreadDirectory>();
  /** Refreshes the directory each time a run ends. */
  readonly agent = input<Agent | null>(null);
  readonly activeThreadId = input<string | null>(null);
  /**
   * When a project id, Recent and Archived list only that project's threads;
   * `null` lists every thread.
   */
  readonly selectedProjectId = input<string | null>(null);
  readonly features = input<ThreadSidebarFeatures | null>(null);
  /** App commands appended to each conversation row menu. */
  readonly extraActions = input<readonly ThreadRowAction[] | null>(null);
  readonly labels = input<Partial<Record<ThreadSidebarLabelKey, string>> | null>(
    null
  );

  readonly threadSelected = output<string>();
  private readonly newChatRequests = new Subject<void>();
  /** Replaces the default New chat, which creates a thread and selects it. */
  readonly newChat = outputFromObservable(this.newChatRequests);
  /** Emits `null` after the selected project is removed; otherwise the app decides what clears a project. */
  readonly projectSelected = output<string | null>();
  /** Emits after the conversation that was active when the delete was confirmed is removed. */
  readonly activeThreadRemoved = output<void>();

  protected readonly rowTemplate = contentChild(ChatThreadRowTemplateDirective);
  protected readonly archivedOpen = signal(false);
  protected readonly ids = (() => {
    const id = `chat-thread-sidebar-${++sidebarInstanceCounter}`;
    return {
      projects: `${id}-projects`,
      recent: `${id}-recent`,
      archived: `${id}-archived`,
    };
  })();

  /** Bumped by directory notifications so `snapshot` re-reads. */
  private readonly version = signal(0);
  protected readonly snapshot = computed<ThreadDirectorySnapshot>(() => {
    this.version();
    return this.directory().getSnapshot();
  });

  /** The directory whose mount refresh has settled. Until then an empty
   *  list means "not loaded yet", so the empty label waits for it. */
  private readonly settled = signal<ThreadDirectory | null>(null);
  protected readonly loading = computed(
    () =>
      this.snapshot().status === 'loading' ||
      this.settled() !== this.directory()
  );
  protected readonly failed = computed(
    () => this.snapshot().status === 'error'
  );
  protected readonly showEmpty = computed(
    () => !this.loading() && !this.failed()
  );
  protected readonly showArchive = computed(() => this.on('archive'));
  private readonly showProjects = computed(
    () => this.on('projects') && this.snapshot().projects !== undefined
  );

  protected readonly threads = computed(() =>
    asThreads(inProject(
      this.snapshot().threads,
      this.selectedProjectId(),
      this.snapshot().projects
    ))
  );
  protected readonly archivedThreads = computed(() =>
    asThreads(inProject(
      this.snapshot().archived,
      this.selectedProjectId(),
      this.snapshot().projects
    ))
  );
  protected readonly projects = computed<Project[] | null>(() => {
    if (!this.showProjects()) return null;
    return asProjects(this.snapshot().projects ?? []);
  });

  protected readonly threadActions = computed<ThreadActionAdapter>(() => {
    const directory = this.directory();
    const {
      rename,
      remove,
      setArchived,
      setPinned,
      reorderPinned,
      setProject,
    } = directory;
    const showArchive = this.showArchive();
    const showProjects = this.showProjects();
    return {
      rename:
        rename && this.on('rename')
          ? (id, title) => rename.call(directory, id, title)
          : undefined,
      delete:
        remove && this.on('remove')
          ? async (id) => {
              const wasActive = id === untracked(this.activeThreadId);
              await remove.call(directory, id);
              if (wasActive && !this.destroyed) this.activeThreadRemoved.emit();
            }
          : undefined,
      archive:
        setArchived && showArchive
          ? (id) => setArchived.call(directory, id, true)
          : undefined,
      unarchive:
        setArchived && showArchive
          ? (id) => setArchived.call(directory, id, false)
          : undefined,
      pin:
        setPinned && this.on('pin')
          ? (id) => setPinned.call(directory, id, true)
          : undefined,
      unpin:
        setPinned && this.on('pin')
          ? (id) => setPinned.call(directory, id, false)
          : undefined,
      reorderPinned:
        reorderPinned && this.on('reorder')
          ? (id, beforeId) => reorderPinned.call(directory, id, beforeId)
          : undefined,
      moveToProject:
        setProject && showProjects
          ? (id, projectId) => setProject.call(directory, id, projectId)
          : undefined,
    };
  });

  protected readonly projectActions = computed<ProjectActionAdapter | null>(
    () => {
      if (!this.showProjects()) return null;
      const directory = this.directory();
      const { createProject, renameProject, removeProject } = directory;
      return {
        create: createProject
          ? (name) => createProject.call(directory, name)
          : undefined,
        rename: renameProject
          ? (id, name) => renameProject.call(directory, id, name)
          : undefined,
        delete: removeProject
          ? async (id) => {
              const wasSelected = id === untracked(this.selectedProjectId);
              await removeProject.call(directory, id);
              if (wasSelected && !this.destroyed) this.projectSelected.emit(null);
            }
          : undefined,
      };
    }
  );

  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));

    effect((onCleanup) => {
      const directory = this.directory();
      untracked(() => {
        const unsubscribe = directory.subscribe(() =>
          this.version.update((v) => v + 1)
        );
        // Catch a change published before this subscription.
        this.version.update((v) => v + 1);
        const controller = new AbortController();
        directory
          .refresh({ signal: controller.signal })
          .catch(ignore)
          .then(() => {
            if (!controller.signal.aborted) this.settled.set(directory);
          });
        onCleanup(() => {
          unsubscribe();
          controller.abort();
        });
      });
    });

    // Refresh when a run ends: a transition out of 'running' on the same agent.
    let lastAgent: Agent | null = null;
    let lastStatus: AgentStatus | undefined;
    effect(() => {
      const agent = this.agent();
      const status = agent?.status();
      if (agent === lastAgent && lastStatus === 'running' && status !== 'running') {
        untracked(() => this.refresh());
      }
      lastAgent = agent;
      lastStatus = status;
    });
  }

  protected label(key: ThreadSidebarLabelKey): string {
    return this.labels()?.[key] ?? DEFAULT_LABELS[key];
  }

  protected showNewChat(): boolean {
    return this.newChatRequests.observed || !!this.directory().create;
  }

  protected startNewChat(): void {
    if (this.newChatRequests.observed) {
      this.newChatRequests.next();
      return;
    }
    const directory = this.directory();
    if (!directory.create) return;
    directory
      .create()
      .then(({ id }) => {
        if (!this.destroyed) this.threadSelected.emit(id);
      })
      .catch(ignore);
  }

  protected retry(): void {
    this.refresh();
  }

  private refresh(): void {
    this.directory().refresh().catch(ignore);
  }

  private on(feature: keyof ThreadSidebarFeatures): boolean {
    return this.features()?.[feature] !== false;
  }
}
