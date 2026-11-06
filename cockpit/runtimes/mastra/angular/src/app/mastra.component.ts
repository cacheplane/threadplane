import { Component, ChangeDetectionStrategy, computed } from '@angular/core';
import { ChatComponent, ChatApprovalCardComponent, ChatWelcomeSuggestionComponent, type ChatApprovalAction } from '@threadplane/chat';
import { injectAgent } from '@threadplane/ag-ui';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { CurrencyPipe } from '@angular/common';

const WELCOME_SUGGESTIONS = [
  // labels asserted by e2e (mastra.spec.ts) — do not change.
  {
    label: 'Start a packing list',
    value: "Start a packing list titled 'Yosemite Weekend' with a tent (1) and two sleeping bags.",
    description: 'Working memory streams into shared state (STATE_SNAPSHOT + real STATE_DELTA patches).',
  },
  {
    label: 'Check trail conditions',
    value: 'What are the conditions at Yosemite Valley right now?',
    description: 'Backend tool call (check_conditions), streamed tool events + result.',
  },
  {
    label: 'Reserve the campsite',
    value: 'Please reserve the North Pines campsite for 2 nights.',
    description: 'reserve_campsite suspends the run for human approval, then resumes.',
  },
] as const;

interface PackingItem {
  name?: string;
  qty?: number;
}

interface PackingList {
  title?: string;
  items?: PackingItem[];
}

/**
 * Camping trip planner — Mastra (TypeScript) backend, Lane B of the
 * runtime-portability matrix.
 *
 * The whole point of this example: this component is the same kind of UI
 * code every other AG-UI example uses — `provideAgent` + `injectAgent()`
 * from `@threadplane/ag-ui`, the `@threadplane/chat` primitives — while the
 * backend is a genuinely non-LangGraph, non-Python runtime: Mastra agents
 * served over plain AG-UI SSE by the hand-written Node service
 * `deployments/ag-ui-mastra` (upstream ships no HTTP endpoint of its own).
 *
 * Runtime-specific wire facts, all measured in the 2026-08-31 spike:
 * - Shared state is Mastra WORKING MEMORY: the bridge emits STATE_SNAPSHOT
 *   plus real JSON-Patch STATE_DELTA events while the agent updates the
 *   packing list.
 * - A suspended tool (`reserve_campsite`) surfaces BOTH interrupt
 *   conventions: CUSTOM `on_interrupt` (payload carrying toolCallId + runId)
 *   and the protocol-standard RUN_FINISHED interrupt outcome. The session
 *   retains the Mastra payload alongside the native batch. The explicit
 *   `mastra-command` transport in app.config.ts ensures
 *   `submit({ resume })` goes out as
 *   `forwardedProps.command = { resume, interruptEvent: { toolCallId, runId } }`
 *   — exactly what the Mastra bridge requires to resume the suspended run.
 * - Sub-agent delegation (weather_forecaster) reaches the wire as a
 *   `agent-<key>` tool call; the Node service's subagent emitter turns it
 *   into SUBAGENT_* + attributed TEXT_MESSAGE_* frames, so the standard
 *   chat-subagent-card renders with zero code in this component
 *   (docs/wire-capture-subagents.md).
 */
@Component({
  selector: 'app-mastra',
  standalone: true,
  imports: [
    ChatComponent,
    ChatApprovalCardComponent,
    ChatWelcomeSuggestionComponent,
    ExampleChatLayoutComponent,
    CurrencyPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <example-chat-layout
      title="Mastra reservations"
      description="Review a fictional campsite reservation, then approve or decline it. No real reservation is made."
    >
      <div main class="mastra-shell">
      <chat placeholder="Ask for a fictional campsite reservation…" [welcomeDisabled]="true" [agent]="agent" class="mastra-chat">
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

        <!-- #region shared-state-panel -->
        <aside class="state-panel" data-testid="packing-state">
          <h2 class="state-title">Shared state — packing list</h2>
          @if (packingList(); as list) {
            <h3 class="list-title">{{ list.title }}</h3>
            <ul class="list-items">
              @for (item of list.items ?? []; track item.name) {
                <li>
                  <span class="item-name">{{ item.name }}</span>
                  <span class="item-qty">×{{ item.qty }}</span>
                </li>
              }
            </ul>
          } @else {
            <p class="state-empty">No list yet — Mastra working memory streams here as STATE_SNAPSHOT + STATE_DELTA patches.</p>
          }
        </aside>
        <!-- #endregion -->

        <!-- #region approval-card -->
        <chat-approval-card
          [agent]="agent"
          title="Reservation approval required"
          (action)="onAction($event)"
        >
          <ng-template #body>
            <div class="approval-body">
              @if (suspendPayload(); as s) {
                <div class="approval-row">
                  <span class="approval-label">Campsite</span>
                  <strong>{{ s.site }}</strong>
                </div>
                <div class="approval-row">
                  <span class="approval-label">Nights</span>
                  <strong>{{ s.nights }}</strong>
                </div>
                <div class="approval-row">
                  <span class="approval-label">Total</span>
                  <strong>{{ s.total_usd | currency }}</strong>
                </div>
              } @else {
                <p>The agent requests approval for <code class="approval-code">{{ approvalToolName() }}</code>.</p>
              }
            </div>
          </ng-template>
        </chat-approval-card>
        <!-- #endregion -->
      </div>
    </example-chat-layout>
  `,
  styles: [`
    .mastra-shell {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 280px;
      gap: 16px;
      height: 100%;
    }

    .mastra-chat {
      min-width: 0;
      height: 100%;
    }

    .state-panel {
      border-left: 1px solid var(--tplane-chat-separator);
      padding: 16px;
      overflow-y: auto;
    }

    .state-title {
      margin: 0 0 12px;
      font-size: var(--tplane-chat-font-size-sm);
      color: var(--tplane-chat-text-muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .list-title {
      margin: 0 0 8px;
      font-size: var(--tplane-chat-font-size-md);
    }

    .list-items {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .list-items li {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      font-size: var(--tplane-chat-font-size-sm);
    }

    .item-qty {
      color: var(--tplane-chat-text-muted);
      font-family: var(--tplane-chat-font-mono);
      font-size: var(--tplane-chat-font-size-xs);
    }

    .state-empty {
      color: var(--tplane-chat-text-muted);
      font-size: var(--tplane-chat-font-size-xs);
      font-style: italic;
    }

    .approval-body {
      display: flex;
      flex-direction: column;
      gap: 6px;
      color: var(--tplane-chat-text);
    }

    .approval-row {
      display: flex;
      align-items: baseline;
      gap: 6px;
    }

    .approval-label {
      color: var(--tplane-chat-text-muted);
      font-size: var(--tplane-chat-font-size-xs);
    }

    .approval-code {
      color: var(--tplane-chat-text);
      font-family: var(--tplane-chat-font-mono);
    }

    @media (max-width: 720px) {
      .mastra-shell {
        grid-template-columns: minmax(0, 1fr);
      }

      .state-panel {
        display: none;
      }
    }
  `],
})
export class MastraComponent {
  protected readonly suggestions = WELCOME_SUGGESTIONS;

  protected readonly agent = injectAgent();

  // #region packing-list-state
  /** Mastra working memory, bridged into AG-UI shared state. */
  protected readonly packingList = computed(() => {
    // Example apps compile lib source with strict:false — cast at the read site.
    const state = this.agent.state() as { packing_list?: PackingList } | undefined;
    const list = state?.packing_list;
    return list && list.title ? list : undefined;
  });
  // #endregion

  // #region approval-actions
  /**
   * The pending Mastra suspend. The session retains the parsed CUSTOM
   * `on_interrupt` payload: `{ type: 'mastra_suspend', toolCallId, toolName,
   * suspendPayload, args, resumeSchema, runId }` alongside the native
   * RUN_FINISHED outcome that follows it on the wire.
   */
  private readonly suspendValue = computed(() => {
    return this.agent.interruptSession().legacy?.value as
      | { toolName?: string; suspendPayload?: { site?: string; nights?: number; total_usd?: number } }
      | undefined;
  });

  protected readonly approvalToolName = computed(() => this.suspendValue()?.toolName ?? 'a tool call');

  protected readonly suspendPayload = computed(() => this.suspendValue()?.suspendPayload);

  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }

  protected onAction(action: ChatApprovalAction): void {
    if (action === 'approve') {
      // The adapter turns this into forwardedProps.command
      // { resume: { approved: true }, interruptEvent: { toolCallId, runId } }.
      void this.agent.submit({ resume: { approved: true } });
    } else if (action === 'cancel') {
      void this.agent.submit({ resume: { approved: false } });
    }
  }
  // #endregion
}
