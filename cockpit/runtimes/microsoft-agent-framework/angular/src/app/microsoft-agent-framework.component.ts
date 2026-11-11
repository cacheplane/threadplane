import { Component, ChangeDetectionStrategy, computed } from '@angular/core';
import { ChatComponent, ChatApprovalCardComponent, ChatInterruptTemplateDirective, ChatWelcomeSuggestionComponent, type ChatApprovalAction } from '@threadplane/chat';
import { injectAgent } from '@threadplane/ag-ui';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { CurrencyPipe } from '@angular/common';

const WELCOME_SUGGESTIONS = [
  // label asserted by e2e (microsoft-agent-framework.spec.ts) — do not change.
  {
    label: 'File a team dinner expense',
    value: 'File a $220 team dinner expense from Blue Finch Bistro for the platform team offsite (6 attendees).',
    description: 'Policy lookup, then submit_expense pauses for human approval.',
  },
  {
    label: 'File a monitor purchase',
    value: 'File a $340 equipment expense from Pixel Peak Displays for a 27-inch monitor.',
    description: 'Same interrupt pattern with the equipment policy.',
  },
] as const;

interface ExpenseDraft {
  vendor?: string;
  category?: string;
  amount_usd?: number;
  memo?: string;
}

/**
 * Expense approval cockpit example — Microsoft Agent Framework backend.
 *
 * The whole point of this example: this component is byte-for-byte the same
 * kind of UI code every LangGraph-backed AG-UI example uses — `provideAgent`
 * + `injectAgent()` from `@threadplane/ag-ui`, the `@threadplane/chat`
 * primitives — while the backend is a genuinely non-LangGraph runtime
 * (agent-framework behind the agent-framework-ag-ui bridge).
 *
 * Interrupts arrive as the protocol-standard
 * `RUN_FINISHED.outcome = { type: 'interrupt', interrupts: [...] }` (not the
 * LangGraph bridge's CUSTOM `on_interrupt`), and `submit({ resume })` goes
 * out as the protocol-standard top-level `resume` entry array.
 *
 * Shared state streams predictively: while the model is still emitting the
 * `submit_expense` tool-call arguments, the backend's predict_state_config
 * mirrors the `expense` argument into frontend state (STATE_SNAPSHOT /
 * STATE_DELTA), rendered in the side panel.
 */
@Component({
  selector: 'app-microsoft-agent-framework',
  standalone: true,
  imports: [
    ChatComponent,
    ChatApprovalCardComponent,
    ChatInterruptTemplateDirective,
    ChatWelcomeSuggestionComponent,
    ExampleChatLayoutComponent,
    CurrencyPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <example-chat-layout
      title="Microsoft Agent Framework expenses"
      description="Review a fictional expense, then approve or decline it. No real expense is submitted."
    >
      <div main class="maf-shell">
      <chat placeholder="Ask about a fictional expense…" [welcomeDisabled]="true" [agent]="agent" class="maf-chat">
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
          <!-- The approval sits at the end of the transcript, inline. -->
          <ng-template chatInterruptTemplate>
            <chat-approval-card
              [agent]="agent"
              title="Expense approval required"
              (action)="onAction($event)"
            >
              <ng-template #body>
                <div class="approval-body">
                  @if (approvalExpense(); as e) {
                    <div class="approval-row">
                      <span class="approval-label">Amount</span>
                      <strong>{{ e.amount_usd | currency }}</strong>
                    </div>
                    <div class="approval-row">
                      <span class="approval-label">Vendor</span>
                      <strong>{{ e.vendor }}</strong>
                    </div>
                    <div class="approval-row">
                      <span class="approval-label">Category</span>
                      <code class="approval-code">{{ e.category }}</code>
                    </div>
                    @if (e.memo) {
                      <div class="approval-memo">{{ e.memo }}</div>
                    }
                  } @else {
                    <p>The agent requests approval for <code class="approval-code">{{ approvalToolName() }}</code>.</p>
                  }
                </div>
              </ng-template>
            </chat-approval-card>
          </ng-template>
        </chat>
        <!-- #region shared-state-panel -->
        <aside class="state-panel" data-testid="expense-state">
          <h2 class="state-title">Shared state — expense</h2>
          @if (expense(); as e) {
            <dl class="state-grid">
              <dt>Vendor</dt><dd>{{ e.vendor }}</dd>
              <dt>Category</dt><dd>{{ e.category }}</dd>
              <dt>Amount</dt><dd>{{ e.amount_usd | currency }}</dd>
              <dt>Memo</dt><dd>{{ e.memo }}</dd>
            </dl>
          } @else {
            <p class="state-empty">No expense drafted yet — it streams here while the agent fills in submit_expense.</p>
          }
        </aside>
        <!-- #endregion -->

      </div>
    </example-chat-layout>
  `,
  styles: [`
    .maf-shell {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 280px;
      gap: 16px;
      height: 100%;
    }

    .maf-chat {
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

    .state-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px 12px;
      margin: 0;
    }

    .state-grid dt {
      color: var(--tplane-chat-text-muted);
      font-size: var(--tplane-chat-font-size-xs);
    }

    .state-grid dd {
      margin: 0;
      font-size: var(--tplane-chat-font-size-sm);
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

    .approval-memo {
      margin-top: 4px;
      color: var(--tplane-chat-text-muted);
      font-style: italic;
    }

    @media (max-width: 720px) {
      .maf-shell {
        grid-template-columns: minmax(0, 1fr);
      }

      .state-panel {
        display: none;
      }
    }
  `],
})
export class MicrosoftAgentFrameworkComponent {
  protected readonly suggestions = WELCOME_SUGGESTIONS;

  protected readonly agent = injectAgent();

  // #region expense-state
  /** Shared state streamed from the backend (STATE_SNAPSHOT / STATE_DELTA). */
  protected readonly expense = computed(() => {
    // Example apps compile lib source with strict:false — cast at the read site.
    const state = this.agent.state() as { expense?: ExpenseDraft } | undefined;
    const e = state?.expense;
    return e && e.vendor !== undefined ? e : undefined;
  });
  // #endregion

  // #region approval-wiring
  /**
   * The pending approval request from the protocol-standard interrupt
   * outcome. The reducer stores it as `{ interrupts: [...], runId }`; each
   * entry's `metadata.agent_framework.function_call` carries the tool name
   * and parsed arguments.
   */
  private readonly approvalCall = computed(() => {
    const value = this.agent.interrupt?.()?.value as { interrupts?: unknown[] } | undefined;
    const first = value?.interrupts?.[0] as
      | { metadata?: { agent_framework?: { function_call?: { name?: string; arguments?: unknown } } } }
      | undefined;
    return first?.metadata?.agent_framework?.function_call;
  });

  protected readonly approvalToolName = computed(() => this.approvalCall()?.name ?? 'a tool call');

  protected readonly approvalExpense = computed(() => {
    const args = this.approvalCall()?.arguments as { expense?: ExpenseDraft } | undefined;
    return args?.expense;
  });

  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }

  protected onAction(action: ChatApprovalAction): void {
    if (action === 'approve') {
      void this.agent.submit({ resume: { approved: true } });
    } else if (action === 'cancel') {
      void this.agent.submit({ resume: { approved: false } });
    }
  }
  // #endregion
}
