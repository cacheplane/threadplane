import { Component, input, output } from '@angular/core';

// Application contract, not a Threadplane session method.
interface Decision {
  readonly token: string;
  readonly summary: string;
  readonly canRespond: boolean;
}

@Component({
  selector: 'app-approval',
  standalone: true,
  template: `
    <p>{{ decision().summary }}</p>
    <button [disabled]="!decision().canRespond"
      (click)="approve.emit(decision().token)">Approve</button>
    <button [disabled]="!decision().canRespond"
      (click)="decline.emit(decision().token)">Decline</button>
  `,
})
export class Approval {
  readonly decision = input.required<Decision>();
  readonly approve = output<string>();
  readonly decline = output<string>();
}
