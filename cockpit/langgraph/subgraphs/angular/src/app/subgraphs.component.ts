import { Component, ChangeDetectionStrategy, computed } from '@angular/core';
import { ChatComponent, ChatWelcomeSuggestionComponent } from '@threadplane/chat';
import { injectAgent } from '@threadplane/angular';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { SUBGRAPHS_AGENT } from './agent-ref';

const WELCOME_SUGGESTIONS = [
  // Labels asserted by e2e (subgraphs.spec.ts page.getByText) — do not change
  // without updating the spec and the aimock fixtures together.
  {
    label: 'Ask something that needs research',
    value: 'How does LangGraph checkpointing work?',
    description: 'Orchestrator routes into the research subgraph, then answers from its brief.',
  },
  {
    label: 'Ask something that does not',
    value: 'Hi there — what can you do?',
    description: 'Orchestrator skips the subgraph entirely and answers directly.',
  },
] as const;

/**
 * Subgraph composition cockpit example.
 *
 * The LangGraph backend is a parent graph with a compiled child graph added as
 * a plain node. The parent's `orchestrate` node classifies each turn and a
 * conditional edge decides whether execution enters the child at all.
 *
 * **The sidebar shows the boundary twice, from two angles.**
 *
 * `agent.state()` reads the parent graph's own state: `research_topic` and
 * `research_brief` are the only two keys the parent shares with the child,
 * so watching them is watching the state boundary itself.
 *
 * `agent.subagents()` shows the child as a *stream*: every namespaced child
 * run appears in that list — a plain subgraph node named by its node (here
 * `research`), a tool-dispatched child also carrying its `toolCallId` (see
 * the Chat Subagents capability for that shape). The child's tokens live on
 * its stream and never merge into the transcript;
 * `transcriptNodeNames: ['answer']` additionally keeps the *top-level*
 * router node's output out of the chat.
 */
@Component({
  selector: 'app-subgraphs',
  standalone: true,
  imports: [ChatComponent, ChatWelcomeSuggestionComponent, ExampleChatLayoutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      --st-nested: #2ea567;
      --st-direct: #e0a850;
    }
    .panel {
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .cap {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--ds-text-muted);
      margin: 0;
    }
    .route {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 13px;
      color: var(--ds-text-primary);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      flex-shrink: 0;
      background: var(--ds-text-muted);
    }
    .dot--nested { background: var(--st-nested); }
    .dot--direct { background: var(--st-direct); }
    .hint {
      font-size: 12px;
      font-style: italic;
      color: var(--ds-text-muted);
      margin: 0;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .topic {
      font-family: var(--ds-font-mono);
      font-size: 12px;
      color: var(--ds-text-primary);
      word-break: break-word;
    }
    .brief {
      font-size: 12px;
      line-height: 1.5;
      color: var(--ds-text-primary);
      white-space: pre-wrap;
      word-break: break-word;
      margin: 0;
    }
  `,
  template: `
    <example-chat-layout
      title="LangGraph subgraphs"
      description="A factual question enters a research child graph. A greeting answers directly. The child receives a topic, not the parent conversation."
    >
      <button headerActions type="button" [disabled]="agent.status() === 'running'"
        (click)="newConversation(conversation)">New conversation</button>
      <chat placeholder="Ask a factual question or say hello…" #conversation [welcomeDisabled]="true" main [agent]="agent" class="flex-1 min-w-0">
        <p chatFooterStatus role="status" class="example-submission-status">{{ agent.status() === 'running' ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
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

      <div sidebar class="panel" data-testid="subgraph-panel">
        <div class="field">
          <h3 class="cap">Route</h3>
          @if (delegated()) {
            <p class="route" data-testid="route">
              <span class="dot dot--nested"></span>Nested — research subgraph ran
            </p>
          } @else {
            <p class="route" data-testid="route">
              <span class="dot dot--direct"></span>Direct — subgraph skipped
            </p>
          }
        </div>

        @if (delegated()) {
          <div class="field">
            <h3 class="cap">Topic sent to child</h3>
            <code class="topic" data-testid="research-topic">{{ topic() }}</code>
          </div>

          <div class="field">
            <h3 class="cap">Brief returned by child</h3>
            @if (brief()) {
              <p class="brief" data-testid="research-brief">{{ brief() }}</p>
            } @else {
              <p class="hint">Running…</p>
            }
          </div>
          <p class="hint">
            The child graph's state has no <code>messages</code> key, so this brief
            never entered the transcript.
          </p>

          <div class="field">
            <h3 class="cap">Child streams</h3>
            @for (child of childStreams(); track child.id) {
              <p class="route" data-testid="child-stream">
                <span class="dot"
                      [class.dot--nested]="child.status === 'complete'"
                      [class.dot--direct]="child.status === 'running'"></span>
                {{ child.name }} — {{ child.status }}
              </p>
            } @empty {
              <p class="hint">No child stream yet.</p>
            }
          </div>
        } @else {
          <p class="hint">
            The orchestrator answered without entering the child graph. Ask a
            factual question to route through it.
          </p>
        }
      </div>
    </example-chat-layout>
  `,
})
export class SubgraphsComponent {
  protected newConversation(conversation: ChatComponent): void {
    if (this.agent.status() === 'running') return;
    this.agent.switchThread(null);
    conversation.clearDraft();
  }

  protected readonly suggestions = WELCOME_SUGGESTIONS;

  // #region agent
  /**
   * Typed agent — `agent.state()` is a signal of `SubgraphsState`, the parent
   * graph's live state as LangGraph streams `values` events. It is undefined
   * until the graph reports a state.
   */
  protected readonly agent = injectAgent(SUBGRAPHS_AGENT);

  /** The topic the parent handed to the child graph this turn, if any. */
  protected readonly topic = computed(() => this.agent.state()?.research_topic ?? '');

  /** The brief the child graph handed back. */
  protected readonly brief = computed(() => this.agent.state()?.research_brief ?? '');

  /**
   * A non-empty topic is exactly what the parent's conditional edge routes on,
   * so it doubles as the UI's "did we nest?" signal.
   */
  protected readonly delegated = computed(() => this.topic().length > 0);
  // #endregion

  // #region child-streams
  /**
   * The same child, seen as a stream. Plain subgraph children appear in
   * `subagents()` with an `id` made from their namespace; `name` is the node
   * name and `status` settles with the run.
   */
  protected readonly childStreams = computed(() =>
    this.agent.subagents().map((child) => ({
      id: child.id,
      name: child.name,
      status: child.status,
    })),
  );
  // #endregion

  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }
}
