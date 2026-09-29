import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ApplicationSnapshot } from '../../shared/application';
import type { Application } from './application.token';

@Component({
  selector: 'native-approval',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (snapshot().selection.status === 'ready') { @if (snapshot().decision; as
    decision) {
    <section class="approval" aria-labelledby="approval-title">
      <h2 id="approval-title">Approval request</h2>
      <p class="approval-reason">{{ decision.reason }}</p>
      <div class="approval-actions">
        <button
          type="button"
          [disabled]="!decision.canRespond"
          (click)="application().respond(decision.token, 'approve')"
        >
          Approve request
        </button>
        <button
          type="button"
          [disabled]="!decision.canRespond"
          (click)="application().respond(decision.token, 'decline')"
        >
          Decline request
        </button>
      </div>
    </section>
    } @else if (snapshot().runtime?.interrupts?.length) {
    <p role="status">
      This conversation is waiting for a response this example does not support.
    </p>
    } }
  `,
})
export class ApprovalComponent {
  readonly application = input.required<Application>();
  readonly snapshot = input.required<ApplicationSnapshot>();
}
