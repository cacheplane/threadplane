import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
import { Component, inject, signal } from '@angular/core';
import { ChatComponent, ChatThreadSidebarComponent } from '@threadplane/chat';
import { injectAgent, provideAgent, LangGraphThreadsAdapter } from '@threadplane/langgraph';
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
 * backed by the real LangGraph SDK. Passes the shared
 * LangGraphThreadsAdapter's `directory` from `@threadplane/langgraph` to
 * the connected `<chat-thread-sidebar>`, which lists, renames, pins,
 * reorders, archives, deletes and files threads into projects (project names
 * live in the LangGraph Store). Reads `metadata.title` written by this cap's
 * `generate_title` graph node (spec
 * 2026-05-19-llm-generated-labels-design.md, converged on `title`
 * after the original `thread_title` choice). See app.config.ts for
 * the LANGGRAPH_THREADS_CONFIG provider.
 */
@Component({
  selector: 'app-threads',
  standalone: true,
  imports: [ChatComponent, ChatThreadSidebarComponent, ExampleChatLayoutComponent],
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
      description="Conversations are listed from the LangGraph server. Use each row menu to rename, pin, reorder, archive, delete or move a conversation into a project; project names are kept in the LangGraph Store. Select a project to list only its conversations. Titles are optional."
    >
      <button headerActions type="button" [disabled]="agent.isLoading()"
        (click)="!agent.isLoading() &amp;&amp; onNewThread(conversation)">New conversation</button>
      <chat placeholder="Write a message…" #conversation [welcomeDisabled]="true" main [agent]="agent" class="flex-1 min-w-0">
        <p chatInputFooter class="example-composer-help">Enter to send. Shift+Enter adds a new line.</p>
        <p chatFooterStatus role="status" class="example-submission-status">{{ agent.isLoading() ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
      </chat>
      <!-- The sidebar refreshes on mount and after each run of [agent];
           its row menus write through the directory. -->
      <chat-thread-sidebar sidebar class="panel"
        [directory]="threadsSvc.directory"
        [agent]="agent"
        [activeThreadId]="activeThreadId()"
        [selectedProjectId]="selectedProjectId()"
        (threadSelected)="onThreadSelected($event)"
        (newChat)="!agent.isLoading() &amp;&amp; onNewThread(conversation)"
        (projectSelected)="onProjectSelected($event)"
        (activeThreadRemoved)="onActiveThreadRemoved(conversation)" />
    </example-chat-layout>
    <!-- #endregion -->
  `,
  styles: [`
    .panel {
      padding: 1rem;
      background: var(--tplane-chat-bg);
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

  /** The project whose conversations the sidebar lists; `null` lists all. */
  protected readonly selectedProjectId = signal<string | null>(null);

  /** Selecting the selected project again lists every conversation. */
  protected onProjectSelected(projectId: string | null): void {
    this.selectedProjectId.update((current) =>
      current === projectId ? null : projectId,
    );
  }

  // #region thread-actions
  /** Row commands go through `threadsSvc.directory`; the sidebar reports
   *  when the active thread was deleted so the surface returns to a new chat. */
  protected onActiveThreadRemoved(conversation?: ChatComponent): void {
    this.agent.switchThread(null);
    this.activeThreadId.set(null);
    conversation?.clearDraft();
  }
  // #endregion

  // #region refresh-on-run-end
  // No manual refresh: <chat-thread-sidebar> refreshes the directory on
  // mount and whenever [agent] leaves the running state, which is when the
  // graph's generate_title node has written metadata.title.
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
