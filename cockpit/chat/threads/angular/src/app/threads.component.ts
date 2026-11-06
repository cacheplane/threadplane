import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
import { Component, inject, signal } from '@angular/core';
import {
  ChatComponent,
  ChatThreadListComponent,
  type ThreadActionAdapter,
} from '@threadplane/chat';
import { injectAgent, provideAgent, LangGraphThreadsAdapter, refreshOnRunEnd } from '@threadplane/langgraph';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';

// #region active-thread-signal
// Writable signal the agent watches — assigning to it switches the active
// thread without forcing a full agent rebuild. Shared between the
// component-scoped provideAgent() config (threadId + onThreadId) and the
// component. Module scope is safe: each demo app bootstraps one
// ThreadsComponent instance.
export const activeThreadIdState = signal<string | null>(null);
// #endregion

/**
 * ThreadsComponent demonstrates multi-thread conversation management
 * backed by the real LangGraph SDK. Consumes the shared
 * LangGraphThreadsAdapter from `@threadplane/langgraph` — same service the
 * canonical demo uses. Reads `metadata.title` written by this cap's
 * `generate_title` graph node (spec
 * 2026-05-19-llm-generated-labels-design.md, converged on `title`
 * after the original `thread_title` choice). See app.config.ts for
 * the LANGGRAPH_THREADS_CONFIG provider.
 */
@Component({
  selector: 'app-threads',
  standalone: true,
  imports: [ChatComponent, ChatThreadListComponent, ExampleChatLayoutComponent],
  // #region agent-provider
  // Scoped agent (Option B): threadId + onThreadId are per-instance, so the
  // agent is provided at the component rather than in app.config.ts.
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
        threadId: activeThreadIdState,
        // When the agent auto-creates a thread on first submit, the
        // adapter calls back with its id; mirror that into our signal so
        // the sidenav highlights it immediately.
        onThreadId: (id: string) => activeThreadIdState.set(id),
      };
    }),
  ],
  // #endregion
  template: `
    <!-- #region chat-and-sidebar -->
    <example-chat-layout sidebarPosition="right" sidebarWidth="18rem"
      title="Chat threads"
      description="Switch between conversations created on this page. The list and drafts last while this page stays open; saved history is checked before continuing. Titles are optional."
    >
      <button headerActions type="button" [disabled]="agent.isLoading()"
        (click)="!agent.isLoading() &amp;&amp; onNewThread(conversation)">New conversation</button>
      <chat placeholder="Write a message…" #conversation [welcomeDisabled]="true" main [agent]="agent" class="flex-1 min-w-0">
        <p chatInputFooter class="example-composer-help">Enter to send. Shift+Enter adds a new line.</p>
        <p chatFooterStatus role="status" class="example-submission-status">{{ agent.isLoading() ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
      </chat>
      <div sidebar class="panel">
        <div class="panel-header">
          <h3 class="cap">Threads</h3>
          <button type="button"
                  class="action-button"
                  (click)="onNewThread()">+ New</button>
        </div>
        <chat-thread-list
          [threads]="threadsSvc.threads()"
          [activeThreadId]="activeThreadId() ?? ''"
          [actions]="threadActions"
          (threadSelected)="onThreadSelected($event)" />
        <!-- The Unarchive action is only built for a list in archived
             mode, so archiving is a round trip only when a second list
             renders the archived threads. -->
        @if (threadsSvc.archivedThreads().length) {
          <h3 class="cap">Archived</h3>
          <chat-thread-list
            [threads]="threadsSvc.archivedThreads()"
            [activeThreadId]="activeThreadId() ?? ''"
            [actions]="threadActions"
            [mode]="'archived'"
            (threadSelected)="onThreadSelected($event)" />
        }
      </div>
    </example-chat-layout>
    <!-- #endregion -->
  `,
  styles: [`
    .panel {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
      background: var(--tplane-chat-bg);
      color: var(--tplane-chat-text);
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }

    .cap {
      margin: 0;
      color: var(--tplane-chat-text-muted);
      font-size: var(--tplane-chat-font-size-xs);
      font-weight: 700;
      letter-spacing: 0.12em;
      line-height: var(--tplane-chat-line-height-tight);
      text-transform: uppercase;
    }

    .action-button {
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--tplane-chat-text-muted);
      cursor: pointer;
      font: inherit;
      font-size: var(--tplane-chat-font-size-xs);
      line-height: var(--tplane-chat-line-height-tight);
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .action-button:hover {
      color: var(--tplane-chat-text);
    }
  `],
})
export class ThreadsComponent {
  protected readonly threadsSvc = inject(LangGraphThreadsAdapter);

  /** Writable signal the agent watches — assigning to it switches the
   *  active thread without forcing a full agent rebuild. */
  protected readonly activeThreadId = activeThreadIdState;

  protected readonly agent = injectAgent();

  // #region thread-actions
  /** Action adapter: framework calls these on rename / delete / archive
   *  after confirmation. Adapter handles SDK round-trip + refresh. */
  protected readonly threadActions: ThreadActionAdapter = {
    delete: async (id) => {
      await this.threadsSvc.delete(id);
      if (this.activeThreadId() === id) this.activeThreadId.set(null);
    },
    rename: (id, title) => this.threadsSvc.rename(id, title),
    archive: async (id) => {
      await this.threadsSvc.archive(id);
      if (this.activeThreadId() === id) this.activeThreadId.set(null);
    },
    unarchive: (id) => this.threadsSvc.unarchive(id),
  };
  // #endregion

  // #region refresh-on-run-end
  constructor() {
    // Initial fetch.
    void this.threadsSvc.refresh();

    // Re-fetch when an agent run completes. The graph's generate_title
    // node writes metadata.title on the first turn; refreshing
    // on the running→idle transition surfaces it in the sidenav
    // without a manual reload.
    refreshOnRunEnd(this.agent, () => this.threadsSvc.refresh());
  }
  // #endregion

  // #region switch-and-create
  protected onThreadSelected(threadId: string): void {
    // switchThread is the LangGraph adapter's canonical thread-switch API
    // (resets derived state + reloads server messages for the new thread).
    this.agent.switchThread(threadId);
    this.activeThreadId.set(threadId);
  }

  protected async onNewThread(conversation?: ChatComponent): Promise<void> {
    const id = await this.threadsSvc.create();
    if (id) {
      this.agent.switchThread(id);
      this.activeThreadId.set(id);
      conversation?.clearDraft();
    }
  }
  // #endregion
}
