// libs/chat/src/lib/compositions/chat-sidenav/chat-sidenav.component.ts
import {
  Component,
  ChangeDetectionStrategy,
  ComponentRef,
  DestroyRef,
  effect,
  Injector,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
  ViewContainerRef,
  type OutputRefSubscription,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent } from 'rxjs';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_SIDENAV_STYLES } from '../../styles/chat-sidenav.styles';
import {
  ChatThreadListComponent,
  type Thread,
  type ThreadActionAdapter,
} from '../../primitives/chat-thread-list/chat-thread-list.component';
import {
  ChatProjectListComponent,
  type Project,
  type ProjectActionAdapter,
} from '../../primitives/chat-project-list/chat-project-list.component';
import type { Agent, AgentWithHistory } from '../../agent';
import { CHAT_DEBUG_INCLUDED } from './chat-debug-gate';

/** Display modes for the conversation sidebar, including a dismissible drawer. */
export type ChatSidenavMode = 'expanded' | 'collapsed' | 'drawer';
type ChatDebugDock = 'right' | 'bottom' | 'left';

interface ChatDebugInstance {
  setOpen(value: boolean): void;
  setDock?(dock: ChatDebugDock): void;
  openChange?: {
    subscribe(callback: (open: boolean) => void): OutputRefSubscription;
  };
  dockChange?: {
    subscribe(callback: (dock: ChatDebugDock) => void): OutputRefSubscription;
  };
}

/**
 * The conversation sidebar: thread list, projects, search, and the new-chat
 * action. Pair it with a runtime's thread store (e.g. `LangGraphThreadsAdapter`)
 * and a {@link ThreadActionAdapter} for the per-row rename/delete/archive menu.
 *
 * **This component renders the sidebar only — it is not a layout wrapper.** Its
 * `<ng-content>` slots are all named (`sidenavHeader`, `sidenavPrimary`,
 * `sidenavSections`, `sidenavFooterLeft`, `sidenavFooterRight`,
 * `sidenavAccount`) and target regions *inside* the sidebar. There is no default
 * slot, so a `<chat>` placed between the tags is silently dropped. Render the
 * chat as a sibling and lay the two out yourself:
 *
 * @example
 * ```html
 * <chat-sidenav
 *   [threads]="threads.threads()"
 *   [activeThreadId]="activeThread()"
 *   [actions]="threadActions"
 *   [agent]="agent"
 *   (newChat)="activeThread.set(null)"
 *   (threadSelected)="activeThread.set($event)"
 * />
 * <main class="chat-pane">
 *   <chat [agent]="agent" />
 * </main>
 * ```
 * ```css
 * :host { display: flex; height: 100dvh; }
 * .chat-pane { flex: 1; min-width: 0; }
 * ```
 */
@Component({
  selector: 'chat-sidenav',
  standalone: true,
  imports: [ChatThreadListComponent, ChatProjectListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-mode]': 'mode()',
    '[attr.data-open]': 'open() ? "true" : "false"',
  },
  styles: [CHAT_HOST_TOKENS, CHAT_SIDENAV_STYLES],
  template: `
    <nav
      class="chat-sidenav"
      aria-label="Sidebar navigation"
      tabindex="-1"
      (keydown.escape)="onEscape()"
    >
      <div class="chat-sidenav__header">
        <ng-content select="[sidenavHeader]" />
      </div>

      <div class="chat-sidenav__topbar">
        <button
          type="button"
          class="chat-sidenav__action chat-sidenav__action--new"
          (click)="newChat.emit()"
          aria-label="New chat"
          title="New chat"
        >
          <svg
            class="chat-sidenav__action-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span class="chat-sidenav__action-label">New chat</span>
        </button>
        @if (mode() === 'drawer') {
        <button
          type="button"
          class="chat-sidenav__action chat-sidenav__action--close"
          (click)="openChange.emit(false)"
          aria-label="Close conversations"
          title="Close conversations"
        >
          <svg
            class="chat-sidenav__action-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          <span class="chat-sidenav__action-label">Close</span>
        </button>
        }
      </div>

      <div class="chat-sidenav__actions">
        <button
          type="button"
          class="chat-sidenav__action chat-sidenav__action--search"
          (click)="searchOpened.emit()"
          aria-label="Search conversations"
          title="Search conversations (⌘K)"
        >
          <svg
            class="chat-sidenav__action-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span class="chat-sidenav__action-label">Search</span>
        </button>
      </div>

      <div class="chat-sidenav__primary">
        <ng-content select="[sidenavPrimary]" />
      </div>

      @if (projects() !== null) {
      <div class="chat-sidenav__projects">
        <div class="chat-sidenav__threads-heading">Projects</div>
        <chat-project-list
          [projects]="projects()!"
          [activeProjectId]="selectedProjectId()"
          [showNewProjectButton]="!!projectActions()?.create"
          [actions]="projectActions()"
          (projectSelected)="projectSelected.emit($event)"
          (newProjectRequested)="newProjectRequested.emit()"
        />
      </div>
      } @if (threads() !== null) {
      <div class="chat-sidenav__threads">
        <div class="chat-sidenav__threads-heading">Recent</div>
        <chat-thread-list
          [threads]="threads()!"
          [activeThreadId]="activeThreadId() ?? ''"
          [actions]="actions()"
          [projects]="projects()"
          (threadSelected)="threadSelected.emit($event)"
        />
      </div>
      } @if (archivedThreads() !== null) {
      <div
        class="chat-sidenav__archived"
        [attr.data-open]="archivedOpen() ? 'true' : 'false'"
      >
        <button
          type="button"
          class="chat-sidenav__archived-heading"
          [attr.aria-expanded]="archivedOpen() ? 'true' : 'false'"
          aria-controls="chat-sidenav__archived-list"
          (click)="archivedOpen.set(!archivedOpen())"
        >
          <svg
            class="chat-sidenav__archived-chevron"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="9 6 15 12 9 18" />
          </svg>
          <span>Archived</span>
        </button>
        @if (archivedOpen()) {
        <div id="chat-sidenav__archived-list">
          @if (archivedThreads()!.length === 0) {
          <div class="chat-sidenav__archived-empty">
            No archived conversations.
          </div>
          } @else {
          <chat-thread-list
            mode="archived"
            [threads]="archivedThreads()!"
            [activeThreadId]="activeThreadId() ?? ''"
            [actions]="actions()"
            [projects]="projects()"
            (threadSelected)="threadSelected.emit($event)"
          />
          }
        </div>
        }
      </div>
      }

      <div class="chat-sidenav__sections">
        <ng-content select="[sidenavSections]" />
      </div>

      <div class="chat-sidenav__footer">
        <div class="chat-sidenav__footer-left">
          @if (showDebugButton()) {
          <button
            type="button"
            class="chat-sidenav__debug"
            aria-label="Open chat devtools"
            title="Open chat devtools"
            (click)="openDebug($event)"
          >
            <span
              class="chat-sidenav__debug-dot"
              [class.chat-sidenav__debug-dot--streaming]="isDebugStreaming()"
              aria-hidden="true"
            ></span>
            @if (mode() !== 'collapsed') {
            <span class="chat-sidenav__debug-label">Devtools</span>
            }
          </button>
          }
          <ng-content select="[sidenavFooterLeft]" />
        </div>
        <div class="chat-sidenav__footer-right">
          <ng-content select="[sidenavFooterRight]" />
          @if (mode() !== 'drawer') {
          <button
            type="button"
            class="chat-sidenav__toggle"
            (click)="onCollapseToggle()"
            [attr.aria-label]="
              mode() === 'collapsed' ? 'Expand sidenav' : 'Collapse sidenav'
            "
            [attr.title]="
              (mode() === 'collapsed' ? 'Expand sidenav' : 'Collapse sidenav') +
              ' (⌘B)'
            "
          >
            @if (mode() === 'collapsed') {
            <svg
              class="chat-sidenav__action-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="9 6 15 12 9 18" />
            </svg>
            } @else {
            <svg
              class="chat-sidenav__action-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="15 6 9 12 15 18" />
            </svg>
            }
          </button>
          }
        </div>
        <!-- Legacy slot kept for back-compat — see chat-sidenav.styles.ts for visibility rules -->
        <div class="chat-sidenav__account">
          <ng-content select="[sidenavAccount]" />
        </div>
      </div>
    </nav>
    <ng-container #debugHost />
  `,
})
export class ChatSidenavComponent {
  readonly mode = input<ChatSidenavMode>('expanded');
  readonly open = input<boolean>(false);
  readonly threads = input<Thread[] | null>(null);
  readonly activeThreadId = input<string | null>(null);
  readonly actions = input<ThreadActionAdapter | null>(null);
  readonly archivedThreads = input<Thread[] | null>(null);
  readonly projects = input<Project[] | null>(null);
  readonly selectedProjectId = input<string | null>(null);
  readonly projectActions = input<ProjectActionAdapter | null>(null);
  readonly agent = input<Agent | AgentWithHistory | null>(null);
  readonly debug = input<boolean>(true);

  readonly newChat = output<void>();
  readonly threadSelected = output<string>();
  readonly searchOpened = output<void>();
  readonly openChange = output<boolean>();
  readonly modeChange = output<ChatSidenavMode>();
  readonly projectSelected = output<string>();
  readonly newProjectRequested = output<void>();

  protected readonly archivedOpen = signal<boolean>(false);
  protected readonly showDebugButton = computed(
    () => CHAT_DEBUG_INCLUDED && this.debug() && this.agent() !== null
  );
  protected readonly isDebugStreaming = computed(
    () => this.agent()?.status?.() === 'running'
  );

  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly debugHost = viewChild('debugHost', {
    read: ViewContainerRef,
  });
  private debugRef: ComponentRef<ChatDebugInstance> | null = null;
  private debugOutputSubscriptions: OutputRefSubscription[] = [];
  private currentDebugDock: ChatDebugDock = 'right';

  constructor() {
    this.destroyRef.onDestroy(() => this.destroyDebug());

    effect(() => {
      const showDebug = this.showDebugButton();
      const agent = this.agent();
      if (!showDebug || !agent) {
        this.destroyDebug();
        return;
      }
      this.debugRef?.setInput('agent', agent);
    });

    fromEvent<KeyboardEvent>(window, 'keydown')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((e) => {
        if (!(e.metaKey || e.ctrlKey)) return;
        const key = e.key.toLowerCase();
        if (key !== 'k' && key !== 'b') return;
        const t = e.target as HTMLElement | null;
        if (t) {
          const tag = t.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable)
            return;
        }
        if (key === 'k') {
          e.preventDefault();
          this.searchOpened.emit();
          return;
        }
        // Cmd/Ctrl+B: toggle expanded ↔ collapsed (no-op in drawer mode).
        if (this.mode() === 'drawer') return;
        e.preventDefault();
        this.modeChange.emit(
          this.mode() === 'collapsed' ? 'expanded' : 'collapsed'
        );
      });
  }

  protected openDebug(event: MouseEvent): void {
    event.stopPropagation();
    void this.ensureDebugPanel();
  }

  protected onEscape(): void {
    if (this.mode() === 'drawer' && this.open()) {
      this.openChange.emit(false);
    }
  }

  protected onCollapseToggle(): void {
    const m = this.mode();
    if (m === 'drawer') return;
    this.modeChange.emit(m === 'collapsed' ? 'expanded' : 'collapsed');
  }

  private async ensureDebugPanel(): Promise<void> {
    if (!CHAT_DEBUG_INCLUDED) {
      return;
    }
    if (!this.showDebugButton()) {
      this.destroyDebug();
      return;
    }
    const host = this.debugHost();
    const agent = this.agent();
    if (!host || !agent) return;

    if (!this.debugRef) {
      const { ChatDebugComponent } = await import('@threadplane/chat/debug');
      if (!this.showDebugButton()) return;
      this.debugRef = host.createComponent(ChatDebugComponent, {
        injector: this.injector,
      });
      this.debugRef.setInput('launcher', 'none');
      this.debugRef.setInput('storageKey', 'chat-sidenav-debug');
      const initialDock = this.defaultDebugDock();
      this.debugRef.setInput('dock', initialDock);
      const openSub = this.debugRef.instance.openChange?.subscribe((open) => {
        if (open) {
          this.setDebugEdgeClaim(this.currentDebugDock);
        } else {
          this.clearDebugEdgeClaim();
        }
      });
      const dockSub = this.debugRef.instance.dockChange?.subscribe((dock) => {
        this.currentDebugDock = dock;
        this.setDebugEdgeClaim(dock);
      });
      this.debugOutputSubscriptions = [
        openSub,
        dockSub,
      ].filter((sub): sub is OutputRefSubscription => !!sub);
      this.currentDebugDock = initialDock;
      this.setDebugEdgeClaim(initialDock);
    }

    this.debugRef.setInput('agent', agent);
    this.debugRef.instance.setOpen(true);
    this.debugRef.changeDetectorRef.detectChanges();
    if (this.currentDebugDock === 'bottom') {
      this.debugRef.instance.setDock?.('bottom');
      this.debugRef.changeDetectorRef.detectChanges();
    }
    this.setDebugEdgeClaim(this.currentDebugDock);
  }

  private destroyDebug(): void {
    for (const subscription of this.debugOutputSubscriptions) {
      subscription.unsubscribe();
    }
    this.debugOutputSubscriptions = [];
    this.debugRef?.destroy();
    this.debugRef = null;
    this.clearDebugEdgeClaim();
  }

  private defaultDebugDock(): ChatDebugDock {
    if (typeof document === 'undefined') return 'right';
    return document.querySelector('chat-sidebar') ? 'bottom' : 'right';
  }

  private setDebugEdgeClaim(dock: ChatDebugDock): void {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset['threadplaneChatDebug'] = dock;
  }

  private clearDebugEdgeClaim(): void {
    if (typeof document === 'undefined') return;
    delete document.documentElement.dataset['threadplaneChatDebug'];
  }
}
