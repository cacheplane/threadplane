import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { ChatComponent, ChatApprovalCardComponent, ChatInterruptTemplateDirective, ChatWelcomeSuggestionComponent, type ChatApprovalAction } from '@threadplane/chat';
import { injectAgent } from '@threadplane/langgraph';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { CurrencyPipe } from '@angular/common';

const WELCOME_SUGGESTIONS = [
  // label asserted by e2e (interrupts.spec.ts page.getByText) — do not change.
  {
    label: 'Refund a duplicate charge',
    value: 'Refund $47.50 to customer cus_a8x2k — they were charged twice for the same order.',
    description: 'Graph pauses at request_approval; approve or edit the amount in the approval panel.',
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
 * The frontend uses `ChatApprovalCardComponent` to render an inline approval panel
 * at the end of the transcript and emit a `ChatApprovalAction` ('approve' | 'edit' | 'cancel').
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
    ChatInterruptTemplateDirective,
    ChatWelcomeSuggestionComponent,
    ExampleChatLayoutComponent,
    CurrencyPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .body { display: flex; flex-direction: column; gap: 6px; }
    .field { font-size: 13px; }
    .field__label { color: var(--ds-text-muted); margin-right: 6px; }
    .field__value { color: var(--ds-text-primary); }
    .reason { font-style: italic; color: var(--ds-text-muted); margin-top: 4px; font-size: 13px; }
    .edit-form { margin-top: 10px; display: flex; gap: 6px; align-items: center; }
    .edit-form__label { color: var(--ds-text-muted); font-size: 12px; }
    .control-input {
      background: var(--ds-surface-dim);
      border: 1px solid var(--ds-border);
      border-radius: var(--ds-radius-sm);
      color: var(--ds-text-primary);
      padding: 5px 8px;
      width: 120px;
      font-size: 13px;
    }
    .control-input:focus {
      outline: none;
      border-color: var(--ds-accent);
      box-shadow: 0 0 0 3px var(--ds-accent-glow);
    }
    .btn--primary {
      background: var(--ds-accent);
      color: #08243a;
      border: 0;
      border-radius: var(--ds-radius-sm);
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
  `,
  template: `
    <example-chat-layout
      title="LangGraph interrupts"
      description="Review a simulated refund, then approve, edit, or decline it. No real charge is issued."
    >
      <div main class="flex flex-col h-full">
      <chat placeholder="Describe a refund request…" [welcomeDisabled]="true" [agent]="agent" class="flex-1 min-w-0">
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
            <!-- #region approval-card -->
            <chat-approval-card
              [agent]="agent"
              matchKind="refund_approval"
              title="Refund approval required"
              approveLabel="Issue refund"
              cancelLabel="Don't refund"
              [showEdit]="true"
              (action)="onAction($event)"
            >
              <ng-template #body let-payload>
                <div class="body">
                  <div class="field"><span class="field__label">Amount</span><strong class="field__value">{{ payload.amount | currency }}</strong></div>
                  <div class="field"><span class="field__label">Customer</span><code>{{ payload.customer_id }}</code></div>
                  @if (payload.reason) {
                    <div class="reason">{{ payload.reason }}</div>
                  }
                  @if (editing()) {
                    <div class="edit-form">
                      <label class="edit-form__label">Edit amount</label>
                      <input type="number" step="0.01" [value]="editAmount() ?? payload.amount" (input)="editAmount.set(+($any($event.target).value))" class="control-input" />
                      <button type="button" (click)="submitEdit(payload)" class="btn--primary">Save</button>
                    </div>
                  }
                </div>
              </ng-template>
            </chat-approval-card>
            <!-- #endregion -->
          </ng-template>
        </chat>
      </div>
    </example-chat-layout>
  `,
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
