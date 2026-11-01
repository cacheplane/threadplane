import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  ElementRef,
  HostListener,
  afterNextRender,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CHAT_DEBUG_TOKENS } from './chat-debug-tokens';
import { ensureChatDebugRootStyles } from './chat-debug-root-styles';
import type { DebugAgent, DebugAgentWithHistory } from './debug-agent';
import { TimelineInspectorComponent } from './inspectors/timeline-inspector.component';
import { StateInspectorComponent } from './inspectors/state-inspector.component';
import { createPersistence } from './persistence';

/** The screen edge used to dock the chat debug panel. */
export type DockPosition = 'right' | 'bottom' | 'left';

interface TabEntry {
  readonly id: string;
  readonly label: string;
  readonly kind: 'builtin-timeline' | 'builtin-state';
}

function hasHistory(
  agent: DebugAgent | DebugAgentWithHistory
): agent is DebugAgentWithHistory {
  return typeof (agent as DebugAgentWithHistory).history === 'function';
}

/** Provides a dockable agent state and checkpoint inspector with persisted panel preferences. */
@Component({
  selector: 'chat-debug',
  standalone: true,
  imports: [TimelineInspectorComponent, StateInspectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    CHAT_DEBUG_TOKENS,
    `
      :host {
        display: contents;
      }

      /* ── Status pill launcher ─────────────────────────────────────── */
      .launcher {
        position: fixed;
        top: 20px;
        right: 20px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: var(--tplane-chat-debug-radius-pill);
        background: var(--tplane-chat-debug-bg);
        border: 1px solid var(--tplane-chat-debug-border);
        color: var(--tplane-chat-debug-text);
        cursor: pointer;
        z-index: 990;
        box-shadow: var(--tplane-chat-debug-shadow-pill);
        transition: background 120ms ease, border-color 120ms ease;
        padding: 0;
      }
      .launcher:hover {
        background: var(--tplane-chat-debug-surface);
        border-color: var(--tplane-chat-debug-border-strong);
      }
      .launcher__dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--tplane-chat-debug-success);
        box-shadow: 0 0 8px
          color-mix(in srgb, var(--tplane-chat-debug-success) 60%, transparent);
      }
      .launcher__dot--streaming {
        background: var(--tplane-chat-debug-accent);
        box-shadow: 0 0 8px
          color-mix(in srgb, var(--tplane-chat-debug-accent) 70%, transparent);
        animation: chat-debug-pill-pulse 1.2s ease-in-out infinite;
      }
      @keyframes chat-debug-pill-pulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.6;
          transform: scale(0.85);
        }
      }

      /* ── Docked panel ─────────────────────────────────────────────── */
      .panel {
        position: fixed;
        background: var(--tplane-chat-debug-bg);
        color: var(--tplane-chat-debug-text);
        border: 1px solid var(--tplane-chat-debug-border);
        z-index: 991;
        display: flex;
        flex-direction: column;
        box-shadow: var(--tplane-chat-debug-shadow-panel);
        animation: chat-debug-panel-enter 120ms ease;
      }
      .panel--right {
        top: 0;
        right: var(--tplane-chat-sidebar-claim-right, 0);
        bottom: 0;
        width: var(--panel-size, 420px);
        border-right: 0;
        border-top-left-radius: var(--tplane-chat-debug-radius-panel);
        border-bottom-left-radius: var(--tplane-chat-debug-radius-panel);
        transform-origin: bottom right;
        transition: right 200ms ease-out;
      }
      .panel--left {
        top: 0;
        left: 0;
        bottom: 0;
        width: var(--panel-size, 420px);
        border-left: 0;
        border-top-right-radius: var(--tplane-chat-debug-radius-panel);
        border-bottom-right-radius: var(--tplane-chat-debug-radius-panel);
        transform-origin: bottom left;
      }
      .panel--bottom {
        left: 0;
        right: var(--tplane-chat-sidebar-claim-right, 0);
        bottom: 0;
        height: var(--panel-size, 40vh);
        border-bottom: 0;
        border-top-left-radius: var(--tplane-chat-debug-radius-panel);
        border-top-right-radius: var(--tplane-chat-debug-radius-panel);
        transform-origin: bottom right;
        transition: right 200ms ease-out;
      }
      /* Mobile breakpoint: when an edge-claimer occupies the right and
       the device is narrow, the bottom strip's effective width is
       ~zero. Explicitly hide it so it doesn't intercept pointer events
       on the sidebar drawer. The chat-debug launcher remains visible. */
      @media (max-width: 767px) {
        .panel--bottom {
          display: none;
        }
      }
      @keyframes chat-debug-panel-enter {
        from {
          opacity: 0;
          transform: scale(0.96);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      .panel__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--tplane-chat-debug-border);
        min-height: 44px;
        box-sizing: border-box;
      }
      .panel__title {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: var(--tplane-chat-debug-text);
      }
      .panel__actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .panel__dock-group {
        display: inline-flex;
        gap: 0;
        padding: 2px;
        background: var(--tplane-chat-debug-bg-deep);
        border: 1px solid var(--tplane-chat-debug-border);
        border-radius: 6px;
      }
      .panel__dock-btn {
        appearance: none;
        background: transparent;
        border: 0;
        border-radius: 4px;
        width: 24px;
        height: 22px;
        padding: 0;
        color: var(--tplane-chat-debug-text-subtle);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background 120ms ease, color 120ms ease;
      }
      .panel__dock-btn:hover {
        color: var(--tplane-chat-debug-text);
      }
      .panel__dock-btn.is-active {
        background: var(--tplane-chat-debug-border);
        color: var(--tplane-chat-debug-text);
      }
      .panel__dock-btn svg {
        display: block;
      }

      .panel__close {
        appearance: none;
        background: transparent;
        border: 0;
        border-radius: 6px;
        width: 26px;
        height: 26px;
        margin-left: 4px;
        color: var(--tplane-chat-debug-text-subtle);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background 120ms ease, color 120ms ease;
      }
      .panel__close:hover {
        background: var(--tplane-chat-debug-surface);
        color: var(--tplane-chat-debug-text);
      }

      .panel__controls {
        border-bottom: 1px solid var(--tplane-chat-debug-border);
        overflow-y: auto;
        max-height: 50%;
        background: var(--tplane-chat-debug-bg);
      }
      .panel__controls:empty {
        display: none;
      }

      .panel__tabs {
        display: flex;
        gap: 4px;
        border-bottom: 1px solid var(--tplane-chat-debug-border);
        padding: 0 12px;
        background: var(--tplane-chat-debug-bg);
      }
      .panel__tab {
        appearance: none;
        background: transparent;
        border: 0;
        border-bottom: 2px solid transparent;
        padding: 10px 8px;
        font: inherit;
        font-size: 13px;
        font-weight: 500;
        color: var(--tplane-chat-debug-text-muted);
        cursor: pointer;
        transition: color 120ms ease, border-color 120ms ease;
        margin-bottom: -1px;
      }
      .panel__tab:hover {
        color: var(--tplane-chat-debug-text);
      }
      .panel__tab.is-active {
        color: var(--tplane-chat-debug-text);
        border-bottom-color: var(--tplane-chat-debug-accent);
      }

      .panel__body {
        flex: 1;
        min-height: 0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        background: var(--tplane-chat-debug-bg);
      }
    `,
  ],
  template: `
    @if (!open() && launcher() === 'floating') {
    <button
      type="button"
      class="launcher"
      title="Open chat devtools"
      aria-label="Open chat devtools"
      [attr.aria-pressed]="false"
      (click)="setOpen(true)"
    >
      <span
        class="launcher__dot"
        [class.launcher__dot--streaming]="isStreaming()"
        aria-hidden="true"
      ></span>
    </button>
    } @else if (open() && agent(); as currentAgent) {
    <div
      class="panel"
      [class.panel--right]="dockState() === 'right'"
      [class.panel--bottom]="dockState() === 'bottom'"
      [class.panel--left]="dockState() === 'left'"
      role="region"
      aria-label="Chat devtools"
    >
      <div class="panel__header">
        <h3 class="panel__title">Chat Devtools</h3>
        <div class="panel__actions">
          <div
            class="panel__dock-group"
            role="group"
            aria-label="Dock position"
          >
            <button
              type="button"
              class="panel__dock-btn"
              [class.is-active]="dockState() === 'left'"
              (click)="setDock('left')"
              aria-label="Dock left"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="1.5" y="2.5" width="11" height="9" rx="1.2" />
                <line x1="5.5" y1="2.5" x2="5.5" y2="11.5" />
              </svg>
            </button>
            <button
              type="button"
              class="panel__dock-btn"
              [class.is-active]="dockState() === 'bottom'"
              (click)="setDock('bottom')"
              aria-label="Dock bottom"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="1.5" y="2.5" width="11" height="9" rx="1.2" />
                <line x1="1.5" y1="8.5" x2="12.5" y2="8.5" />
              </svg>
            </button>
            <button
              type="button"
              class="panel__dock-btn"
              [class.is-active]="dockState() === 'right'"
              (click)="setDock('right')"
              aria-label="Dock right"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="1.5" y="2.5" width="11" height="9" rx="1.2" />
                <line x1="8.5" y1="2.5" x2="8.5" y2="11.5" />
              </svg>
            </button>
          </div>
          <button
            type="button"
            class="panel__close"
            (click)="setOpen(false)"
            aria-label="Close"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="3" y1="3" x2="11" y2="11" />
              <line x1="11" y1="3" x2="3" y2="11" />
            </svg>
          </button>
        </div>
      </div>

      @if (tabs().length > 1) {
      <div class="panel__tabs" role="tablist">
        @for (tab of tabs(); track tab.id) {
        <button
          type="button"
          role="tab"
          class="panel__tab"
          [class.is-active]="tab.id === activeTabId()"
          [attr.aria-selected]="tab.id === activeTabId()"
          (click)="setActiveTab(tab.id)"
        >
          {{ tab.label }}
        </button>
        }
      </div>
      }

      <div class="panel__body">
        @switch (activeTab()?.kind) { @case ('builtin-timeline') { @if
        (historyAgent(); as history) {
        <chat-debug-timeline-inspector
          [agent]="history"
          (replayRequested)="replayRequested.emit($event)"
          (forkRequested)="forkRequested.emit($event)"
        />
        } } @case ('builtin-state') {
        <chat-debug-state-tab [agent]="currentAgent" />
        } }
      </div>
    </div>
    }
  `,
})
export class ChatDebugComponent {
  readonly agent = input<DebugAgent | DebugAgentWithHistory | null>(null);
  readonly dock = input<DockPosition>('right');
  readonly defaultOpen = input<boolean>(false);
  readonly launcher = input<'floating' | 'none'>('floating');
  readonly storageKey = input<string>('chat-debug');

  readonly replayRequested = output<string>();
  readonly forkRequested = output<string>();
  readonly openChange = output<boolean>();
  readonly dockChange = output<DockPosition>();

  protected readonly open = signal<boolean>(false);
  protected readonly dockState = signal<DockPosition>('right');
  /** Set to `true` the first time the user explicitly clicks a dock button.
   *  Auto-dock detection becomes a no-op after this flips. Not persisted —
   *  fresh session = fresh chance for the smart default. */
  private readonly userDockOverride = signal<boolean>(false);
  protected readonly activeTabId = signal<string>('timeline');
  protected readonly historyAgent = computed(() => {
    const agent = this.agent();
    return agent && hasHistory(agent) ? agent : null;
  });
  private readonly hydrated = signal(false);

  /** Reads `agent.status()` reactively for the launcher dot. */
  protected readonly isStreaming = computed(() => {
    const status = this.agent()?.status?.();
    return status === 'running';
  });

  protected readonly tabs = computed((): TabEntry[] => {
    if (!this.agent()) return [];
    return [
      ...(this.historyAgent()
        ? [
            {
              id: 'timeline',
              label: 'Timeline',
              kind: 'builtin-timeline',
            } satisfies TabEntry,
          ]
        : []),
      { id: 'state', label: 'State', kind: 'builtin-state' },
    ];
  });

  protected readonly activeTab = computed(() =>
    this.tabs().find((t) => t.id === this.activeTabId())
  );

  private readonly hostEl: ElementRef<HTMLElement> = inject(ElementRef);

  constructor() {
    // Inject chat lib root CSS custom properties so the theme-attribute
    // mappings + edge-claim primitive are in the document, even when
    // chat-debug is mounted without a sibling chat composition.
    ensureChatDebugRootStyles();

    effect(() => {
      const tabs = this.tabs();
      if (tabs.length === 0) return;
      if (tabs.some((tab) => tab.id === this.activeTabId())) return;
      this.activeTabId.set(tabs[0].id);
    });

    // Restore once after Angular has assigned bound input values. Doing this
    // synchronously in the constructor reads input defaults, then immediately
    // writes those defaults to storage and masks a consumer-provided
    // defaultOpen=true on first load.
    afterNextRender(() => {
      const restore = createPersistence(this.storageKey());
      const persistedOpen = restore.read<boolean>('open');
      if (!this.open()) {
        this.open.set(persistedOpen ?? this.defaultOpen());
      }
      const persistedDock = restore.read<DockPosition>('dock');
      this.dockState.set(persistedDock ?? this.dock());
      const persistedTab = restore.read<string>('tab');
      if (persistedTab) this.activeTabId.set(persistedTab);
      this.hydrated.set(true);
    });

    // Write-through effect — reads each writable signal so subsequent
    // changes trigger a fresh run that writes them all to storage.
    effect(() => {
      if (!this.hydrated()) return;
      const p = createPersistence(this.storageKey());
      p.write('open', this.open());
      p.write('dock', this.dockState());
      p.write('tab', this.activeTabId());
    });

    // Publish the dock the panel currently occupies. Peer panels
    // (e.g. chat-sidebar) read --tplane-chat-occupy-{right,bottom,left}
    // to avoid overlap.
    effect(() => {
      if (typeof document === 'undefined') return;
      const html = document.documentElement;
      if (this.open()) {
        html.dataset['threadplaneChatDebug'] = this.dockState();
      } else {
        delete html.dataset['threadplaneChatDebug'];
      }
    });

    // Auto-dock: when the panel transitions from closed → open AND a
    // sibling <chat-sidebar> exists on the page AND the user hasn't
    // overridden the dock this session, prefer bottom-dock so the two
    // panels coexist without stacking on the right edge.
    effect(() => {
      const isOpen = this.open();
      if (!isOpen) return;
      if (this.userDockOverride()) return;
      if (typeof document === 'undefined') return;
      if (!document.querySelector('chat-sidebar')) return;
      this.dockState.set('bottom');
    });
  }

  setOpen(value: boolean): void {
    this.open.set(value);
    this.openChange.emit(value);
  }

  setDock(next: DockPosition): void {
    this.userDockOverride.set(true);
    this.dockState.set(next);
    this.dockChange.emit(next);
  }

  setActiveTab(id: string): void {
    this.activeTabId.set(id);
  }

  @HostListener('document:keydown.escape')
  protected onEsc(): void {
    if (this.open()) this.setOpen(false);
  }

  /**
   * Click-outside dismiss. When the panel is open, any click whose
   * composed path doesn't include our host element closes the panel.
   */
  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;
    const path = event.composedPath();
    if (path.includes(this.hostEl.nativeElement)) return;
    this.setOpen(false);
  }
}
