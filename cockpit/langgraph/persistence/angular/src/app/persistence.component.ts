import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
import { Component, signal } from '@angular/core';
import { ChatComponent, ChatWelcomeSuggestionComponent } from '@threadplane/chat';
import { injectAgent, provideAgent } from '@threadplane/langgraph';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';

const WELCOME_SUGGESTIONS = [
  {
    label: 'Start a saved thread',
    value: 'Help me draft a project brief I can revisit.',
    description: 'Each reply gets a thread ID; click the sidebar to switch between conversations.',
  },
] as const;

interface Thread {
  id: string;
  label: string;
}

// #region thread-state
// Per-instance thread bookkeeping shared between the component-scoped
// provideAgent() config (which owns the onThreadId callback) and the
// component itself. Module scope is safe here: each demo app bootstraps a
// single PersistenceComponent instance.
const threadsState = signal<Thread[]>([]);
const activeThreadIdState = signal<string | null>(null);
let threadCounter = 0;
// #endregion

/**
 * PersistenceComponent demonstrates thread persistence with `injectAgent()`.
 *
 * Layout: a full-height flex row with the `<chat>` area (flex-1) on the left
 * and a fixed-width thread-picker sidebar on the right.
 *
 * Key integration points:
 * - `onThreadId` callback captures new thread IDs for the sidebar list
 * - `switchThread(id)` resumes a previous conversation
 * - `newThread()` starts a fresh conversation
 */
@Component({
  selector: 'app-persistence',
  standalone: true,
  imports: [ChatComponent, ChatWelcomeSuggestionComponent, ExampleChatLayoutComponent],
  // #region agent-provider
  // Scoped agent: the onThreadId callback tracks new thread ids into the
  // module-scoped signals the sidebar reads. Provided at the component (Option
  // B) because the config is genuinely per-instance.
  providers: [
    provideAgent(() => {
      const connection = injectCockpitRuntimeConnection();
      if (connection.adapter !== 'langgraph') {
        throw new Error('incompatible runtime');
      }
      return {
        apiUrl: connection.apiUrl,
        assistantId: connection.assistantId,
        clientOptions: connection.clientOptions,
        onThreadId: (id: string) => {
          activeThreadIdState.set(id);

          // Only add if not already tracked
          const existing = threadsState();
          if (!existing.some((t) => t.id === id)) {
            threadCounter++;
            threadsState.set([
              ...existing,
              { id, label: `Thread ${threadCounter}` },
            ]);
          }
        },
      };
    }),
  ],
  // #endregion
  styles: `
    .sidebar {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--ds-surface, #1c1c1c);
      color: var(--ds-text-primary, #f5f5f5);
    }
    .cap {
      padding: 0.625rem 0.75rem;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--ds-text-muted, #a0a0a0);
      border-bottom: 1px solid var(--ds-border, #2d2d2d);
    }
    .thread-list {
      flex: 1;
      overflow-y: auto;
    }
    .thread {
      display: block;
      width: 100%;
      padding: 0.5rem 0.75rem;
      font-size: 13px;
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      border: 0;
      background: transparent;
      color: var(--ds-text-primary, #f5f5f5);
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .thread:hover {
      background: var(--ds-surface-tinted, rgba(255, 255, 255, 0.04));
    }
    .thread--active {
      font-weight: 600;
      background: var(--ds-accent-surface, rgba(100, 195, 253, 0.08));
    }
    .thread--active:hover {
      background: var(--ds-accent-surface, rgba(100, 195, 253, 0.08));
    }
    .footer {
      padding: 0.5rem;
      border-top: 1px solid var(--ds-border, #2d2d2d);
    }
    .btn--primary {
      width: 100%;
      padding: 6px 12px;
      font-size: 13px;
      font-weight: 600;
      border: 0;
      border-radius: var(--ds-radius-sm, 6px);
      background: var(--ds-accent, #64c3fd);
      color: var(--ds-text-inverted, #08243a);
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .btn--primary:hover {
      background: var(--ds-accent-hover, #8dd4ff);
    }
  `,
  template: `
    <example-chat-layout sidebarWidth="14rem">
      <chat main [agent]="agent" class="block flex-1 min-w-0">
        <div chatWelcomeSuggestions>
          @for (s of suggestions; track s.value) {
            <chat-welcome-suggestion
              [label]="s.label"
              [value]="s.value"
              [description]="s.description"
              (selected)="send($event)"
            />
          }
        </div>
      </chat>

      <!-- #region thread-sidebar -->
      <div sidebar class="sidebar">
        <div class="cap">Threads</div>

        <div class="thread-list">
          @for (thread of threads(); track thread.id) {
            <button
              type="button"
              class="thread"
              [class.thread--active]="thread.id === activeThreadId()"
              (click)="switchThread(thread.id)"
            >
              {{ thread.label }}
            </button>
          }
        </div>

        <div class="footer">
          <button type="button" class="btn--primary" (click)="newThread()">+ New Thread</button>
        </div>
      </div>
      <!-- #endregion -->
    </example-chat-layout>
  `,
})
export class PersistenceComponent {
  protected readonly threads = threadsState;
  protected readonly activeThreadId = activeThreadIdState;
  protected readonly suggestions = WELCOME_SUGGESTIONS;

  // #region thread-actions
  /**
   * The streaming resource with thread persistence.
   *
   * The `onThreadId` callback (wired at the component-scoped provideAgent in
   * the decorator) fires when a new thread is created, tracking thread IDs for
   * the sidebar picker.
   */
  protected readonly agent = injectAgent();

  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }

  /** Switch to an existing thread by ID. */
  switchThread(id: string): void {
    this.activeThreadId.set(id);
    this.agent.switchThread(id);
  }

  /** Start a brand-new thread. */
  newThread(): void {
    this.activeThreadId.set(null);
    this.agent.switchThread(null);
  }
  // #endregion
}
