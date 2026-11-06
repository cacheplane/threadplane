import { Component, computed, signal } from '@angular/core';
import {
  ChatComponent,
  ChatInterruptPanelComponent,
  ChatWelcomeSuggestionComponent,
} from '@threadplane/chat';
import type { InterruptAction } from '@threadplane/chat';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { injectAgent } from '@threadplane/langgraph';

/** One entry of the `files` map `StateBackend` keeps on the graph state. */
interface WorkspaceFile {
  path: string;
  directory: string;
  name: string;
  contents: string;
  /** True while a write to this path is waiting on human approval. */
  pending: boolean;
}

const SUGGESTIONS = [
  // value matches cockpit/deep-agents/filesystem/angular/e2e/da-filesystem.spec.ts PROMPT.
  {
    label: 'Runway note for KASE',
    value:
      'Work up a runway suitability note for KASE. Save your raw lookups to /notes/kase-data.md, then write the finished note to /reports/kase-runway.md.',
    description: 'Notes are written straight through; the report pauses for your approval.',
  },
] as const;

/**
 * FilesystemComponent renders the agent's workspace, not a log of its actions.
 *
 * `StateBackend` puts every file the agent writes on the graph state under
 * `files`, keyed by absolute path, so the panel is a projection of the live
 * workspace rather than a replay of `write_file` tool calls. The distinction
 * matters: an edit that rewrites an existing file shows up as one changed file
 * here, and as two entries in a call log.
 *
 * A `FilesystemPermission` in `interrupt` mode covers `/reports/**`, so a write
 * there pauses the run. The pending path is read off the interrupt payload and
 * shown in the tree as a ghost row before it exists, which is the whole reason
 * to render the tree and the approval together.
 *
 * `deepagents` resumes on `{ decisions: [{ type: 'approve' | 'reject' }] }`. A
 * bare string or list is a server-side TypeError.
 */
@Component({
  selector: 'app-filesystem',
  standalone: true,
  imports: [
    ChatComponent,
    ChatInterruptPanelComponent,
    ChatWelcomeSuggestionComponent,
    ExampleChatLayoutComponent,
  ],
  template: `
    <example-chat-layout sidebarWidth="18rem"
      title="A workspace for the flight ahead."
      description="Build a runway note using fixed aviation lookup data. Read actual files and review proposed report changes before they run."
    >
      <chat placeholder="Ask for a runway note…" [welcomeDisabled]="true" main [agent]="agent" class="flex-1 min-w-0">
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
      <!-- #region workspace-panel -->
      <div sidebar class="panel">
        <h3 class="cap">Workspace</h3>
        @if (files().length === 0) {
          <p class="empty">No files yet</p>
        }
        @for (group of tree(); track group.directory) {
          <div class="dir" data-testid="file-dir">
            <span class="dir__name">{{ group.directory }}</span>
            @for (file of group.files; track file.path) {
              <button
                type="button"
                class="file"
                data-testid="file-row"
                [attr.data-path]="file.path"
                [attr.data-pending]="file.pending ? 'true' : null"
                [class.file--selected]="selectedPath() === file.path"
                (click)="select(file.path)"
              >
                <span class="file__name">{{ file.name }}</span>
                @if (file.pending) {
                  <span class="file__badge">awaiting approval</span>
                }
              </button>
            }
          </div>
        }
        @if (selectedFile(); as file) {
          <div class="preview" data-testid="file-preview">
            <span class="cap">{{ file.path }}</span>
            <pre class="preview__body">{{ file.contents }}</pre>
          </div>
        }
        <h3 class="cap">Approval</h3>
        <chat-interrupt-panel [agent]="agent" (action)="onInterruptAction($event)" />
      </div>
      <!-- #endregion -->
    </example-chat-layout>
  `,
  styles: [
    `
      .panel {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
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

      .empty {
        margin: 0;
        color: var(--tplane-chat-text-muted);
        font-size: var(--tplane-chat-font-size-sm);
        font-style: italic;
      }

      .dir {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }

      .dir__name {
        color: var(--tplane-chat-text-muted);
        font-family: var(--tplane-chat-font-mono);
        font-size: var(--tplane-chat-font-size-xs);
      }

      .file {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        margin-left: 0.75rem;
        padding: 0.25rem 0.5rem;
        border: 0;
        border-radius: var(--tplane-chat-radius-card);
        background: var(--tplane-chat-surface-alt);
        color: var(--tplane-chat-text);
        cursor: pointer;
        font-family: var(--tplane-chat-font-mono);
        font-size: var(--tplane-chat-font-size-xs);
        text-align: left;
      }

      .file--selected {
        outline: 1px solid var(--tplane-chat-primary);
      }

      .file[data-pending='true'] {
        opacity: 0.65;
        font-style: italic;
      }

      .file__badge {
        color: var(--tplane-chat-text-muted);
        font-family: var(--tplane-chat-font-family);
        font-style: normal;
      }

      .preview__body {
        max-height: 14rem;
        margin: 0.25rem 0 0;
        overflow: auto;
        padding: 0.5rem;
        border-radius: var(--tplane-chat-radius-card);
        background: var(--tplane-chat-surface-alt);
        font-family: var(--tplane-chat-font-mono);
        font-size: var(--tplane-chat-font-size-xs);
        white-space: pre-wrap;
      }
    `,
  ],
})
export class FilesystemComponent {
  protected readonly agent = injectAgent();

  protected readonly suggestions = SUGGESTIONS;

  private readonly manualSelection = signal<string | null>(null);

  // #region pending-path
  /**
   * The path a pending `write_file` approval would create.
   *
   * The interrupt payload is `{ action_requests: [{ name, args }] }`; the path
   * lives on `args.file_path`.
   */
  protected readonly pendingPath = computed<string | null>(() => {
    for (const interrupt of this.agent.langGraphInterrupts() ?? []) {
      const value = (interrupt as { value?: unknown }).value as
        | { action_requests?: Array<{ name?: string; args?: Record<string, unknown> }> }
        | undefined;
      for (const request of value?.action_requests ?? []) {
        const path = request.args?.['file_path'];
        if (typeof path === 'string') return path;
      }
    }
    return null;
  });
  // #endregion

  // #region files
  /** Live projection of `state.files`, plus a ghost row for a pending write. */
  protected readonly files = computed<WorkspaceFile[]>(() => {
    const raw = (this.agent.value() as Record<string, unknown> | undefined)?.['files'];
    const entries = new Map<string, string>();
    if (raw && typeof raw === 'object') {
      for (const [path, contents] of Object.entries(raw as Record<string, unknown>)) {
        entries.set(path, typeof contents === 'string' ? contents : JSON.stringify(contents));
      }
    }
    const pending = this.pendingPath();
    if (pending && !entries.has(pending)) entries.set(pending, '');

    return [...entries.entries()]
      .map(([path, contents]) => {
        const slash = path.lastIndexOf('/');
        return {
          path,
          directory: slash > 0 ? path.slice(0, slash) : '/',
          name: path.slice(slash + 1),
          contents,
          pending: path === pending,
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  });
  // #endregion

  // #region tree
  /** Files grouped by directory, so the panel reads as a tree. */
  protected readonly tree = computed(() => {
    const groups = new Map<string, WorkspaceFile[]>();
    for (const file of this.files()) {
      const bucket = groups.get(file.directory) ?? [];
      bucket.push(file);
      groups.set(file.directory, bucket);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([directory, files]) => ({ directory, files }));
  });
  // #endregion

  /** The clicked file, defaulting to the most recently written one. */
  protected readonly selectedPath = computed<string | null>(() => {
    const manual = this.manualSelection();
    const files = this.files();
    if (manual && files.some((file) => file.path === manual)) return manual;
    const settled = files.filter((file) => !file.pending);
    return settled.at(-1)?.path ?? files.at(0)?.path ?? null;
  });

  protected readonly selectedFile = computed<WorkspaceFile | null>(() => {
    const path = this.selectedPath();
    return this.files().find((file) => file.path === path) ?? null;
  });

  protected select(path: string): void {
    this.manualSelection.set(path);
  }

  // #region resume
  protected onInterruptAction(action: InterruptAction): void {
    if (action === 'accept') {
      void this.agent.submit({ resume: { decisions: [{ type: 'approve' }] } });
    } else if (action === 'ignore') {
      void this.agent.submit({ resume: { decisions: [{ type: 'reject' }] } });
    }
    // 'edit' and 'respond' would need the tool args echoed back; out of scope here.
  }
  // #endregion

  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }
}
