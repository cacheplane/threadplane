import { Component, ChangeDetectionStrategy, computed } from '@angular/core';
import { ChatComponent, ChatApprovalCardComponent, ChatWelcomeSuggestionComponent, type ChatApprovalAction } from '@threadplane/chat';
import { injectAgent } from '@threadplane/ag-ui';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';

const WELCOME_SUGGESTIONS = [
  // label asserted by e2e (aws-strands.spec.ts) — do not change.
  {
    label: 'Book the Q3 roadmap review',
    value: 'Book a Q3 roadmap review meeting with the platform team on Tuesday.',
    description: 'Availability lookup, then book_meeting pauses for human approval.',
  },
  {
    label: 'Book a design critique',
    value: 'Book a design critique with the web team on Thursday.',
    description: 'Same interrupt pattern on a different day.',
  },
] as const;

interface Availability {
  day?: string;
  slots?: string[];
}

interface Booking {
  topic?: string;
  slot?: string;
  status?: string;
}

/**
 * Meeting scheduler cockpit example — AWS Strands backend.
 *
 * The whole point of this example: this component is byte-for-byte the same
 * kind of UI code every LangGraph-backed AG-UI example uses — `provideAgent`
 * + `injectAgent()` from `@threadplane/ag-ui`, the `@threadplane/chat`
 * primitives — while the backend is a genuinely non-LangGraph runtime
 * (a Strands agent behind the ag-ui-strands bridge).
 *
 * Interrupts arrive as the protocol-standard
 * `RUN_FINISHED.outcome = { type: 'interrupt', interrupts: [...] }` (not the
 * LangGraph bridge's CUSTOM `on_interrupt`), and `submit({ resume })` goes
 * out as the protocol-standard top-level `resume` entry array keyed by
 * `interruptId`.
 *
 * Shared state is SNAPSHOT-only — the Strands bridge never emits
 * STATE_DELTA. The backend opts specific tools into outbound state via
 * per-tool ToolBehavior hooks, each of which emits a complete
 * STATE_SNAPSHOT ({ availability, booking }), rendered in the side panel.
 */
@Component({
  selector: 'app-aws-strands',
  standalone: true,
  imports: [
    ChatComponent,
    ChatApprovalCardComponent,
    ChatWelcomeSuggestionComponent,
    ExampleChatLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <example-chat-layout
      title="AWS Strands meetings"
      description="Review a fictional meeting, then approve or decline it. No real meeting is booked."
    >
      <div main class="strands-shell">
      <chat placeholder="Ask about a fictional meeting…" [welcomeDisabled]="true" [agent]="agent" class="strands-chat">
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

        <aside class="state-panel" data-testid="schedule-state">
          <h2 class="state-title">Shared state — schedule</h2>
          @if (availability(); as a) {
            <section class="state-section">
              <h3 class="state-heading">Availability — {{ a.day }}</h3>
              <ul class="slot-list">
                @for (slot of a.slots; track slot) {
                  <li class="slot">{{ slot }}</li>
                }
              </ul>
            </section>
          }
          @if (booking(); as b) {
            <section class="state-section" data-testid="booking-state">
              <h3 class="state-heading">Booking — {{ b.status }}</h3>
              <dl class="state-grid">
                <dt>Topic</dt><dd>{{ b.topic }}</dd>
                <dt>Slot</dt><dd>{{ b.slot }}</dd>
              </dl>
            </section>
          }
          @if (!availability() && !booking()) {
            <p class="state-empty">Nothing scheduled yet — availability and the pending booking snapshot here.</p>
          }
        </aside>

        <!-- region approval-card -->
        <chat-approval-card
          [agent]="agent"
          title="Booking approval required"
          (action)="onAction($event)"
        >
          <ng-template #body>
            <div class="approval-body">
              @if (approvalBooking(); as b) {
                <div class="approval-row">
                  <span class="approval-label">Topic</span>
                  <strong>{{ b.topic }}</strong>
                </div>
                <div class="approval-row">
                  <span class="approval-label">Slot</span>
                  <strong>{{ b.slot }}</strong>
                </div>
              } @else {
                <p>The agent requests approval for <code class="approval-code">{{ approvalToolName() }}</code>.</p>
              }
            </div>
          </ng-template>
        </chat-approval-card>
        <!-- endregion -->
      </div>
    </example-chat-layout>
  `,
  styles: [`
    .strands-shell {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 280px;
      gap: 16px;
      height: 100%;
    }

    .strands-chat {
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

    .state-section {
      margin-bottom: 16px;
    }

    .state-heading {
      margin: 0 0 6px;
      font-size: var(--tplane-chat-font-size-sm);
      font-weight: 600;
    }

    .slot-list {
      margin: 0;
      padding-left: 18px;
      font-size: var(--tplane-chat-font-size-sm);
    }

    .slot {
      margin: 2px 0;
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

    @media (max-width: 720px) {
      .strands-shell {
        grid-template-columns: minmax(0, 1fr);
      }

      .state-panel {
        display: none;
      }
    }
  `],
})
export class AwsStrandsComponent {
  protected readonly suggestions = WELCOME_SUGGESTIONS;

  protected readonly agent = injectAgent();

  // region shared-state
  /** Shared state snapshotted from the backend (STATE_SNAPSHOT only). */
  private readonly sharedState = computed(() => {
    // Example apps compile lib source with strict:false — cast at the read site.
    return this.agent.state() as { availability?: Availability; booking?: Booking } | undefined;
  });

  protected readonly availability = computed(() => {
    const a = this.sharedState()?.availability;
    return a && a.day !== undefined ? a : undefined;
  });

  protected readonly booking = computed(() => {
    const b = this.sharedState()?.booking;
    return b && b.topic !== undefined ? b : undefined;
  });
  // endregion

  // region approval-wiring
  /**
   * The pending approval request from the protocol-standard interrupt
   * outcome. The reducer stores it as `{ interrupts: [...], runId }`; each
   * Strands entry carries the tool name under `reason` and the tool's
   * interrupt payload under `metadata.reason`.
   */
  private readonly approvalEntry = computed(() => {
    const value = this.agent.interrupt?.()?.value as { interrupts?: unknown[] } | undefined;
    return value?.interrupts?.[0] as
      | { reason?: string; metadata?: { reason?: { topic?: string; slot?: string } } }
      | undefined;
  });

  protected readonly approvalToolName = computed(() => this.approvalEntry()?.reason ?? 'a tool call');

  protected readonly approvalBooking = computed(() => {
    const pending = this.approvalEntry()?.metadata?.reason;
    return pending?.topic !== undefined ? pending : this.booking();
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
  // endregion
}
