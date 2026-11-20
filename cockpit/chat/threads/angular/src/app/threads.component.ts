import { injectCockpitRuntimeConnection } from '@threadplane/cockpit-telemetry';
import { Component, computed, signal } from '@angular/core';
import { ChatComponent, ChatThreadSidebarComponent } from '@threadplane/chat';
import { injectAgent, injectThreadDirectory, provideAgent } from '@threadplane/angular';
import { createSession, type LangGraphSession } from '@threadplane/langgraph';
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
 * backed by the real LangGraph SDK. Passes the injected thread directory's
 * `directory` (`injectThreadDirectory()` from `@threadplane/angular`, built
 * by `createLangGraphThreadDirectory` from `@threadplane/langgraph`) to
 * the connected `<chat-thread-sidebar>`, which lists, renames, pins,
 * reorders, archives, deletes and files threads into projects (project names
 * live in the LangGraph Store). Reads `metadata.title` written by this cap's
 * `generate_title` graph node (spec
 * 2026-05-19-llm-generated-labels-design.md, converged on `title`
 * after the original `thread_title` choice). See app.config.ts for
 * the provideThreadDirectory() provider.
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
        // One session per thread: the agent asks for a new one on each
        // thread switch and hands it the thread to open.
        createSession: (context) =>
          createSession({
            apiUrl: connection.apiUrl,
            assistantId: connection.assistantId,
            clientOptions: connection.clientOptions,
            threadId: context.threadId,
            onThreadId: context.onThreadId,
            onOperationFailure: context.reportOperationFailure,
            developmentRuntime: context.developmentRuntime,
            throttle: 16,
          }),
        threadId: activeThreadIdState,
        // When a session creates its thread on first submit, the agent
        // calls back with its id; mirror that into our signal so the
        // sidenav highlights it immediately.
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
      <button headerActions type="button" [disabled]="isLoading()"
        (click)="!isLoading() &amp;&amp; onNewThread(conversation)">New conversation</button>
      <chat placeholder="Write a message…" #conversation [welcomeDisabled]="true" main [agent]="agent" class="flex-1 min-w-0">
        <p chatInputFooter class="example-composer-help">Enter to send. Shift+Enter adds a new line.</p>
        <p chatFooterStatus role="status" class="example-submission-status">{{ isLoading() ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
      </chat>
      <!-- The sidebar refreshes on mount and after each run of [agent];
           its row menus write through the directory. -->
      <chat-thread-sidebar sidebar class="panel"
        [directory]="threads.directory"
        [agent]="agent"
        [activeThreadId]="activeThreadId()"
        [selectedProjectId]="selectedProjectId()"
        (threadSelected)="onThreadSelected($event)"
        (newChat)="!isLoading() &amp;&amp; onNewThread(conversation)"
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
  protected readonly threads = injectThreadDirectory();

  /** Writable signal the agent watches — assigning to it switches the
   *  active thread without forcing a full agent rebuild. */
  protected readonly activeThreadId = activeThreadIdState;

  protected readonly agent = injectAgent<LangGraphSession>();
  /** True while a run streams: the agent has no separate loading flag. */
  protected readonly isLoading = computed(() => this.agent.status() === 'running');

  /** The project whose conversations the sidebar lists; `null` lists all. */
  protected readonly selectedProjectId = signal<string | null>(null);

  /** Selecting the selected project again lists every conversation. */
  protected onProjectSelected(projectId: string | null): void {
    this.selectedProjectId.update((current) =>
      current === projectId ? null : projectId,
    );
  }

  // #region thread-actions
  /** Row commands go through `threads.directory`; the sidebar reports
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
    // switchThread is the agent's thread-switch API: it replaces the session
    // underneath and loads the selected thread's saved messages.
    this.agent.switchThread(threadId);
    this.activeThreadId.set(threadId);
  }

  protected async onNewThread(conversation?: ChatComponent): Promise<void> {
    // `create` is optional on the neutral directory contract; the LangGraph
    // directory provides it.
    const id = await this.threads.create?.();
    if (id) {
      this.agent.switchThread(id);
      this.activeThreadId.set(id);
      conversation?.clearDraft();
    }
  }
  // #endregion
}
