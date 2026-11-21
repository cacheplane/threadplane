import { Component, computed, signal } from '@angular/core';
import { ChatComponent } from '@threadplane/chat';
import { injectAgent } from '@threadplane/angular';
import {
  selectBranch,
  type LangGraphBranchTree,
  type LangGraphCheckpoint,
  type LangGraphSession,
} from '@threadplane/langgraph';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';

/**
 * TimeTravelComponent demonstrates selecting and forking from past checkpoints.
 *
 * Layout: chat panel (flex-1) + checkpoint timeline sidebar (w-72).
 *
 * Key integration points:
 * - `historyState: true` on the session (app.config.ts) -- keeps checkpoints
 * - `agent.checkpoints()` -- the saved checkpoints, oldest first
 * - `agent.branchTree()` -- the checkpoints arranged by parent, with each
 *   checkpoint's `path`: the fork choices that lead to it
 * - `agent.setBranch(path.join('>'))` -- select the branch a checkpoint is on
 * - `agent.branch()` + `selectBranch(tree, branch)` -- the selected branch and
 *   the checkpoints on it, which the timeline marks
 * - `agent.submit(input, { run: { checkpointId } })` -- run from a past checkpoint
 */
@Component({
  selector: 'app-time-travel',
  standalone: true,
  imports: [ChatComponent, ExampleChatLayoutComponent],
  styles: `
    .panel {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      height: 100%;
      background: var(--ds-surface, #1c1c1c);
      color: var(--ds-text-primary, #f5f5f5);
    }
    .head {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--ds-border, #2d2d2d);
    }
    .cap {
      margin: 0;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--ds-text-muted, #a0a0a0);
    }
    .sub {
      margin: 4px 0 0;
      font-size: 12px;
      color: var(--ds-text-muted, #a0a0a0);
    }
    .list {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 0.5rem 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .empty {
      padding: 1.5rem 0;
      font-size: 13px;
      font-style: italic;
      text-align: center;
      color: var(--ds-text-muted, #a0a0a0);
    }
    .row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 6px 10px;
      border: 1px solid var(--ds-border, #2d2d2d);
      border-radius: var(--ds-radius-md, 10px);
      background: var(--ds-surface, #1c1c1c);
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .row:hover {
      background: var(--ds-surface-tinted, rgba(255, 255, 255, 0.04));
    }
    .row--active {
      background: var(--ds-accent-surface, rgba(100, 195, 253, 0.08));
      border-color: var(--ds-accent-border, rgba(100, 195, 253, 0.25));
    }
    .badge {
      flex-shrink: 0;
      width: 24px;
      height: 24px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      background: var(--ds-surface-tinted, rgba(255, 255, 255, 0.06));
      color: var(--ds-text-muted, #a0a0a0);
    }
    .row--off-branch {
      opacity: 0.45;
    }
    .badge--active {
      background: var(--ds-accent, #64c3fd);
      color: #08243a;
    }
    .info {
      flex: 1;
      min-width: 0;
    }
    .label {
      margin: 0;
      font-size: 12px;
      font-weight: 500;
      color: var(--ds-text-primary, #f5f5f5);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .id {
      margin: 2px 0 0;
      font-family: var(--ds-font-mono, ui-monospace, monospace);
      font-size: 11px;
      color: var(--ds-text-muted, #a0a0a0);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .actions {
      flex-shrink: 0;
      display: flex;
      gap: 4px;
    }
    .btn {
      padding: 4px 8px;
      font-size: 11px;
      border-radius: var(--ds-radius-sm, 6px);
      border: 1px solid var(--ds-border, #2d2d2d);
      background: var(--ds-surface-dim, #0a0a0a);
      color: var(--ds-text-secondary, #c8c8c8);
      cursor: pointer;
      transition: border-color 0.15s ease, color 0.15s ease;
    }
    .btn:hover {
      border-color: var(--ds-accent-border, rgba(100, 195, 253, 0.25));
      color: var(--ds-accent, #64c3fd);
    }
  `,
  template: `
    <example-chat-layout
      title="LangGraph time travel"
      description="Load saved checkpoints, select a completed source, then fork with your message. Send continues the conversation shown above."
    >
      <!-- Chat panel -->
      <chat placeholder="Write a message to send or fork…" [welcomeDisabled]="true" main [agent]="agent" class="block flex-1">
        <p chatFooterStatus role="status" class="example-submission-status">{{ agent.status() === 'running' ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
      </chat>

      <!-- #region timeline -->
      <!-- Checkpoint timeline sidebar -->
      <div sidebar class="panel">
        <div class="head">
          <h2 class="cap">Timeline</h2>
          <p class="sub">{{ checkpoints().length }} checkpoint(s)</p>
          <p class="sub" data-testid="selected-branch">Branch: {{ agent.branch() || 'latest' }}</p>
        </div>

        <div class="list">
          @if (checkpoints().length === 0) {
            <p class="empty">No checkpoints yet. Send a message to begin.</p>
          }

          @for (state of checkpoints(); track state.id ?? $index; let i = $index) {
            <div
              class="row"
              [class.row--active]="state.id === selectedCheckpointId()"
              [class.row--off-branch]="!onSelectedBranch(state)"
              [attr.data-on-branch]="onSelectedBranch(state)"
            >
              <!-- Numbered badge -->
              <span
                class="badge"
                [class.badge--active]="state.id === selectedCheckpointId()"
              >
                {{ i + 1 }}
              </span>

              <!-- Checkpoint info -->
              <div class="info">
                <p class="label">{{ checkpointLabel(state, i) }}</p>
                @if (state.id) {
                  <p class="id">{{ state.id }}</p>
                }
              </div>

              <!-- Action buttons -->
              <div class="actions">
                <button
                  class="btn"
                  title="Select this checkpoint as the active branch"
                  (click)="select(state)"
                >
                  Select
                </button>
                <button
                  class="btn"
                  title="Fork from this checkpoint"
                  (click)="fork(state)"
                >
                  Fork
                </button>
              </div>
            </div>
          }
        </div>
      </div>
      <!-- #endregion -->
    </example-chat-layout>
  `,
})
export class TimeTravelComponent {
  // #region history
  protected readonly agent = injectAgent<LangGraphSession>();

  /** Selection survives new checkpoints being prepended to the history. */
  protected readonly selectedCheckpointId = signal<string | null>(null);

  /**
   * Checkpoint history derived from the agent, newest first as the timeline
   * lists it. `checkpoints()` is oldest first, and absent until a history page
   * has been read: the session reads one after every run.
   */
  protected readonly checkpoints = computed((): LangGraphCheckpoint[] =>
    [...(this.agent.checkpoints() ?? [])].reverse(),
  );
  // #endregion

  /** Display label for a checkpoint entry. */
  protected checkpointLabel(
    state: LangGraphCheckpoint,
    index: number,
  ): string {
    if (state.id) {
      return `Checkpoint ${index + 1}`;
    }
    return `State ${index + 1}`;
  }

  // #region branch
  /**
   * The ids of the checkpoints on the selected branch. `selectBranch` follows
   * the fork choices in `agent.branch()` and, at a fork the branch does not
   * name, the newest continuation; with no branch selected that is the
   * thread's latest path.
   */
  private readonly selectedBranchIds = computed((): ReadonlySet<string> => {
    const tree = this.agent.branchTree();
    if (!tree) return new Set();
    const ids = new Set<string>();
    for (const checkpoint of selectBranch(tree, this.agent.branch() ?? '')) {
      if (checkpoint.id) ids.add(checkpoint.id);
    }
    return ids;
  });

  /** Whether the timeline row's checkpoint is on the selected branch. */
  protected onSelectedBranch(state: LangGraphCheckpoint): boolean {
    return state.id !== undefined && this.selectedBranchIds().has(state.id);
  }

  /**
   * Select the branch a checkpoint is on.
   *
   * A branch is not a checkpoint id: it is the fork choices that lead to a
   * checkpoint, joined with `>`, which the branch tree gives as the node's
   * `path`. `setBranch()` publishes it as `agent.branch()`, and the timeline
   * marks the checkpoints on it. It is a view selection: it starts no run and
   * the transcript does not change. Send still continues the conversation
   * shown; Fork starts a run from a checkpoint.
   */
  protected select(state: LangGraphCheckpoint): void {
    if (!state.id) return;
    this.selectedCheckpointId.set(state.id);
    const tree = this.agent.branchTree();
    const path = tree ? branchPathOf(tree, state.id) : undefined;
    void this.agent.setBranch((path ?? []).join('>'));
  }

  /**
   * Start a new run from the given checkpoint.
   *
   * Passing `run.checkpointId` to `submit()` resumes the thread at that point
   * rather than at its tip, so the new run hangs off the chosen checkpoint
   * and the original path stays intact. Per-run LangGraph settings are
   * grouped under `run`.
   */
  protected fork(state: LangGraphCheckpoint): void {
    const checkpointId = state.id;
    if (!checkpointId) return;
    this.selectedCheckpointId.set(checkpointId);
    void this.agent.submit(
      { message: 'Try a different approach from here.' },
      { run: { checkpointId } },
    );
  }
  // #endregion
}

/** The fork choices that lead to a checkpoint, or undefined when it is not in the tree. */
function branchPathOf(
  tree: LangGraphBranchTree,
  checkpointId: string,
): readonly string[] | undefined {
  for (const item of tree.items) {
    if (item.type === 'node') {
      if (item.value.id === checkpointId) return item.path;
      continue;
    }
    for (const alternative of item.items) {
      const path = branchPathOf(alternative, checkpointId);
      if (path) return path;
    }
  }
  return undefined;
}
