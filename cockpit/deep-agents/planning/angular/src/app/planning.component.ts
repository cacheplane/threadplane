import { Component, computed } from '@angular/core';
import { ChatComponent, ChatWelcomeSuggestionComponent } from '@threadplane/chat';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { injectAgent } from '@threadplane/langgraph';

// #region todo-shape
/**
 * One entry of the `todos` list written by the `write_todos` tool.
 *
 * `deepagents` 0.7.11 emits exactly two fields. There is no identifier and no
 * separate present-tense label, so the panel tracks rows by index.
 */
interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

const TODO_STATUSES: ReadonlyArray<Todo['status']> = ['pending', 'in_progress', 'completed'];
// #endregion

const SUGGESTIONS = [
  // value matches cockpit/deep-agents/planning/angular/e2e/da-planning.spec.ts PROMPT.
  {
    label: 'Dispatch brief: KSFO to KASE',
    value:
      'Plan a dispatch brief for a flight from KSFO to KASE: check field elevation, runway length, and weather at both ends, then tell me if there is anything the crew should know.',
    description: 'The agent writes a todo list first, then works it one step at a time.',
  },
] as const;

/**
 * PlanningComponent renders the todo list `TodoListMiddleware` keeps on the
 * graph state.
 *
 * The agent's `write_todos` tool replaces the whole list on every call, and the
 * graph streams each replacement as a `values` update. `injectAgent().value()`
 * exposes that state, so the panel is a pure projection of `todos` — no local
 * copy, no reconciliation. Watching it during a run is the point of this
 * capability: rows move from pending to in progress to completed, and the agent
 * revises the list mid-run when a lookup turns up something the first plan
 * missed.
 */
@Component({
  selector: 'app-planning',
  standalone: true,
  imports: [ChatComponent, ChatWelcomeSuggestionComponent, ExampleChatLayoutComponent],
  template: `
    <example-chat-layout sidebarWidth="18rem"
      title="A plan for the flight ahead."
      description="Build a dispatch brief using fixed aviation lookup data. Watch the assistant build and revise its plan alongside the conversation."
    >
      <button headerActions type="button" [disabled]="agent.isLoading()"
        (click)="newConversation(conversation)">New conversation</button>
      <chat placeholder="Ask for a dispatch brief…" #conversation [welcomeDisabled]="true" main [agent]="agent" class="flex-1 min-w-0">
        <p chatInputFooter class="example-composer-help">Enter to send. Shift+Enter adds a new line.</p>
        <p chatFooterStatus role="status" class="example-submission-status">{{ agent.isLoading() ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
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
      <!-- #region plan-panel -->
      <div sidebar class="panel">
        <h3 class="cap">Plan</h3>
        @if (todos().length === 0) {
          <p class="empty">No plan yet</p>
        } @else {
          <p class="progress" data-testid="todo-progress">
            {{ completedCount() }} of {{ todos().length }} complete
          </p>
        }
        @for (todo of todos(); track $index) {
          <div class="todo" data-testid="todo-row" [attr.data-status]="todo.status">
            <span class="todo__icon">
              @switch (todo.status) {
                @case ('completed') {
                  <span class="todo__icon--done">&#10003;</span>
                }
                @case ('in_progress') {
                  <span class="todo__icon--active">&#9696;</span>
                }
                @default {
                  <span>&#9675;</span>
                }
              }
            </span>
            <span class="todo__text">{{ todo.content }}</span>
          </div>
        }
      </div>
      <!-- #endregion -->
    </example-chat-layout>
  `,
  styles: [
    `
      .panel {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 1rem;
        background: var(--tplane-chat-bg);
        color: var(--tplane-chat-text);
      }

      .cap {
        margin: 0;
        color: var(--tplane-chat-text-muted);
        font-size: var(--tplane-chat-font-size-xs);
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .empty,
      .progress {
        margin: 0;
        color: var(--tplane-chat-text-muted);
        font-size: var(--tplane-chat-font-size-xs);
      }

      .empty {
        font-style: italic;
      }

      .todo {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
        padding: 0.375rem 0.5rem;
        border-radius: var(--tplane-chat-radius-card);
        background: var(--tplane-chat-surface-alt);
        font-size: var(--tplane-chat-font-size-sm);
      }

      .todo__icon {
        flex: 0 0 auto;
        margin-top: 0.125rem;
        color: var(--tplane-chat-separator);
        font-size: 1rem;
        line-height: 1;
      }

      .todo__icon--done {
        color: var(--tplane-chat-success);
      }

      .todo__icon--active {
        display: inline-block;
        color: var(--tplane-chat-text-muted);
        animation: spin 1s linear infinite;
      }

      .todo[data-status='completed'] .todo__text {
        color: var(--tplane-chat-text-muted);
        text-decoration: line-through;
      }

      .todo__text {
        color: var(--tplane-chat-text);
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class PlanningComponent {
  protected newConversation(conversation: ChatComponent): void {
    if (this.agent.isLoading()) return;
    this.agent.switchThread(null);
    conversation.clearDraft();
  }

  protected readonly agent = injectAgent();

  protected readonly suggestions = SUGGESTIONS;

  // #region todos-signal
  /** Live projection of `state.todos`, normalized against unknown statuses. */
  protected readonly todos = computed<Todo[]>(() => {
    const todos = (this.agent.value() as Record<string, unknown> | undefined)?.['todos'];
    if (!Array.isArray(todos)) return [];
    return todos.map((todo) => {
      const entry = todo as Record<string, unknown>;
      const status = entry['status'] as Todo['status'];
      return {
        content: String(entry['content'] ?? ''),
        status: TODO_STATUSES.includes(status) ? status : 'pending',
      };
    });
  });

  protected readonly completedCount = computed(
    () => this.todos().filter((todo) => todo.status === 'completed').length,
  );
  // #endregion

  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }
}
