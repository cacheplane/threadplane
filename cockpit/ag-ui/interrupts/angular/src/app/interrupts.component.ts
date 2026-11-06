import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { ChatComponent, ChatApprovalCardComponent, ChatWelcomeSuggestionComponent, type ChatApprovalAction } from '@threadplane/chat';
import { injectAgent } from '@threadplane/ag-ui';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { CurrencyPipe } from '@angular/common';

const WELCOME_SUGGESTIONS = [
  // label asserted by e2e (interrupts.spec.ts page.getByText) — do not change.
  {
    label: 'Refund a duplicate charge',
    value: 'Refund $47.50 to customer cus_a8x2k — they were charged twice for the same order.',
    description: 'Graph pauses at request_approval; approve or edit the amount in the modal.',
  },
  {
    label: 'Refund a chargeback',
    value: 'Refund $129.00 to customer cus_z19fp who opened a chargeback for unrecognized activity.',
    description: 'Chargeback path — same interrupt pattern with a different reason string.',
  },
] as const;

/**
 * Refund authorization cockpit example.
 *
 * The LangGraph backend acknowledges the refund draft, then pauses at
 * `request_approval` with a structured interrupt payload of the form
 * `{ kind: 'refund_approval', amount, customer_id, reason }`.
 *
 * The frontend uses `ChatApprovalCardComponent` to render the native-dialog
 * modal and emit a `ChatApprovalAction` ('approve' | 'edit' | 'cancel').
 * The handler maps each action to a structured resume payload back to the
 * graph.
 *
 * The agent is wired in `app.config.ts` via a `provideAgent(() => ...)` factory and
 * retrieved here with `injectAgent()`.
 */
@Component({
  selector: 'app-interrupts',
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
      title="AG-UI approvals"
      description="Draft a fictional refund, review its amount, and approve, edit or cancel it. No real payment is issued. The conversation continues after each completed decision."
    >
      <div main class="interrupts-shell">
      <chat placeholder="Ask a fictional refund request…" [welcomeDisabled]="true" [agent]="agent" class="interrupts-chat">
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

        <!-- #region approval-card -->
        <chat-approval-card
          [agent]="agent"
          matchKind="refund_approval"
          title="Refund approval required"
          [showEdit]="true"
          (action)="onAction($event)"
        >
          <ng-template #body let-payload>
            <div class="approval-body">
              <div class="approval-row">
                <span class="approval-label">Amount</span>
                <strong>{{ payload.amount | currency }}</strong>
              </div>
              <div class="approval-row">
                <span class="approval-label">Customer</span>
                <code class="approval-code">{{ payload.customer_id }}</code>
              </div>
              @if (payload.reason) {
                <div class="approval-reason">{{ payload.reason }}</div>
              }
              @if (editing()) {
                <div class="approval-edit">
                  <label class="approval-label">Edit amount</label>
                  <input
                    type="number"
                    step="0.01"
                    class="approval-input"
                    [value]="editAmount() ?? payload.amount"
                    (input)="editAmount.set(+($any($event.target).value))"
                  />
                  <button type="button" class="approval-save" (click)="submitEdit(payload)">Save</button>
                </div>
              }
            </div>
          </ng-template>
        </chat-approval-card>
        <!-- #endregion -->
      </div>
    </example-chat-layout>
  `,
  styles: [`
    .interrupts-shell {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .interrupts-chat {
      flex: 1 1 0%;
      min-width: 0;
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

    .approval-reason {
      margin-top: 4px;
      color: var(--tplane-chat-text-muted);
      font-style: italic;
    }

    .approval-edit {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 10px;
    }

    .approval-input {
      width: 120px;
      padding: 4px 8px;
      border: 1px solid var(--tplane-chat-separator);
      border-radius: var(--tplane-chat-radius-input);
      background: var(--tplane-chat-surface);
      color: var(--tplane-chat-text);
      font: inherit;
    }

    .approval-input:focus {
      outline: 2px solid var(--tplane-chat-primary);
      outline-offset: 2px;
    }

    .approval-save {
      padding: 4px 10px;
      border: 0;
      border-radius: var(--tplane-chat-radius-button);
      background: var(--tplane-chat-primary);
      color: var(--tplane-chat-on-primary);
      font: inherit;
      font-size: var(--tplane-chat-font-size-xs);
      cursor: pointer;
    }

    .approval-save:focus-visible {
      outline: 2px solid var(--tplane-chat-primary);
      outline-offset: 2px;
    }
  `],
})
export class InterruptsComponent {
  protected readonly suggestions = WELCOME_SUGGESTIONS;
  protected readonly editing = signal(false);
  protected readonly editAmount = signal<number | null>(null);

  protected readonly agent = injectAgent();

  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }

  // #region resume
  protected onAction(action: ChatApprovalAction): void {
    if (action === 'approve') {
      void this.agent.submit({ resume: { approved: true } });
      this.resetEdit();
    } else if (action === 'cancel') {
      void this.agent.submit({ resume: { approved: false } });
      this.resetEdit();
    } else if (action === 'edit') {
      this.editing.set(true);
    }
  }

  protected submitEdit(payload: { amount: number }): void {
    const next = this.editAmount() ?? payload.amount;
    void this.agent.submit({ resume: { approved: true, amount: next } });
    this.resetEdit();
  }

  private resetEdit(): void {
    this.editing.set(false);
    this.editAmount.set(null);
  }
  // #endregion
}
