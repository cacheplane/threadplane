import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ChatApprovalCardComponent, type ChatApprovalAction, type ClientToolViewProps } from '@threadplane/chat';
import { injectAgent } from '@threadplane/ag-ui';
import { injectRenderHost } from '@threadplane/render';
import { confirmBookingSchema } from './schemas';

/**
 * The interactive component for the `confirm_booking` client tool (an `ask`).
 * The model fills `summary`; the person answers in the library's inline approval
 * panel, and the chosen value is announced via `injectRenderHost().result(...)`
 * and becomes the tool result that resumes the run.
 *
 * `chat-approval-card` takes the ask as its `request`, so the booking reads like
 * every other approval: named actions, focus on the first one, the composer hint
 * while it waits, and the one-line "Approved: Booking" record once answered.
 *
 * Once the ask resolves, the adapter writes the emitted `{ confirmed }` back
 * onto the local tool call, so this component re-renders with `confirmed` as a
 * prop. The request then clears and the panel gives way to the record.
 *
 * Input types for schema-derived props are anchored to `ClientToolViewProps<typeof
 * confirmBookingSchema>` — a schema change is a compile error here.
 */

/** Props this component receives from the `confirm_booking` schema. */
type ConfirmBookingProps = ClientToolViewProps<typeof confirmBookingSchema>;

@Component({
  selector: 'app-confirm-booking',
  standalone: true,
  imports: [ChatApprovalCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <chat-approval-card
      [agent]="agent"
      [request]="request()"
      title="Confirm this fictional booking?"
      approveLabel="Confirm booking"
      cancelLabel="Don't book"
      recordLabel="Booking"
      (action)="respond($event)"
    >
      <ng-template #body let-booking>
        <p class="cb__summary">{{ booking.summary }}</p>
      </ng-template>
    </chat-approval-card>
  `,
  styles: [`.cb__summary { margin: 0; }`],
})
export class ConfirmBookingComponent {
  // Schema-derived input — type anchored to ConfirmBookingProps.
  readonly summary = input<ConfirmBookingProps['summary']>();
  /** Spread back onto props after the ask resolves (undefined while interactive). */
  readonly confirmed = input<boolean | undefined>(undefined);
  readonly clientTool = input<ConfirmBookingProps['clientTool']>();
  protected readonly agent = injectAgent();
  private readonly host = injectRenderHost();
  /** The pending ask; undefined once the person answered or the call stopped. */
  protected readonly request = computed(() => {
    const waiting = this.confirmed() === undefined && (this.clientTool()?.phase ?? 'running') === 'running';
    return waiting ? { summary: this.summary() ?? '' } : undefined;
  });
  protected respond(action: ChatApprovalAction): void {
    if (action === 'edit') return;
    this.host.result({ confirmed: action === 'approve' });
  }
}
