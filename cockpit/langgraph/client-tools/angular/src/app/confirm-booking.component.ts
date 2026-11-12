import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ClientToolViewProps } from '@threadplane/chat';
import { injectRenderHost } from '@threadplane/render';
import { confirmBookingSchema } from './schemas';

/**
 * The interactive component for the `confirm_booking` client tool (an `ask`).
 * The model fills `summary`; the user confirms or cancels; the chosen value is
 * announced via `injectRenderHost().result(...)` and becomes the tool result
 * that resumes the run.
 *
 * Once the ask resolves, the adapter writes the emitted `{ confirmed }` back
 * onto the local tool call, so this component re-renders with `confirmed` as a
 * prop (chat-tool-views spreads `{...args, ...result, status}` into it). When
 * `confirmed()` is defined we render a FROZEN line with no buttons; the live
 * interactive card only shows while `confirmed()` is still undefined.
 *
 * Input types for schema-derived props are anchored to `ClientToolViewProps<typeof
 * confirmBookingSchema>` — a schema change is a compile error here.
 */

/** Props this component receives from the `confirm_booking` schema. */
type ConfirmBookingProps = ClientToolViewProps<typeof confirmBookingSchema>;

@Component({
  selector: 'app-confirm-booking',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (confirmed() === undefined) {
      <div class="cb" [attr.data-phase]="clientTool()?.phase">
        <p class="cb__summary">{{ summary() }}</p>
        <div class="cb__actions">
          <button type="button" class="cb__btn cb__btn--primary" (click)="respond(true)">Confirm</button>
          <button type="button" class="cb__btn" (click)="respond(false)">Cancel</button>
        </div>
      </div>
    } @else if (confirmed() === true) {
      <div class="cb cb--resolved" [attr.data-phase]="clientTool()?.phase">
        <p class="cb__summary">Booking confirmed ✓</p>
      </div>
    } @else {
      <div class="cb cb--resolved" [attr.data-phase]="clientTool()?.phase">
        <p class="cb__summary">Booking cancelled</p>
      </div>
    }
  `,
  styles: [`
    .cb { border: 1px solid var(--ds-border, #e5e7eb); border-radius: 12px; padding: 16px; max-width: 360px; background: var(--ds-surface); color: var(--ds-text-primary); }
    .cb__summary { margin: 0 0 12px; }
    .cb--resolved .cb__summary { margin: 0; color: var(--ds-text-secondary); }
    .cb__actions { display: flex; gap: 8px; }
    .cb__btn { padding: 6px 14px; border-radius: 8px; border: 1px solid var(--ds-border, #e5e7eb); background: var(--ds-surface-dim); color: var(--ds-text-secondary); cursor: pointer; }
    .cb__btn--primary { background: var(--ds-accent, #64C3FD); color: #08243a; border-color: transparent; font-weight: 600; }
  `],
})
export class ConfirmBookingComponent {
  // Schema-derived input — type anchored to ConfirmBookingProps.
  readonly summary = input<ConfirmBookingProps['summary']>();
  /** Spread back onto props after the ask resolves (undefined while interactive). */
  readonly confirmed = input<boolean | undefined>(undefined);
  readonly clientTool = input<ConfirmBookingProps['clientTool']>();
  private readonly host = injectRenderHost();
  protected respond(confirmed: boolean): void {
    this.host.result({ confirmed });
  }
}
