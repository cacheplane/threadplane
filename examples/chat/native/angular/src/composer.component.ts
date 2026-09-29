import {
  ChangeDetectionStrategy,
  Component,
  Input,
  type OnChanges,
  type SimpleChanges,
} from '@angular/core';
import type { CompleteOutcome } from '@threadplane/core';
import type { ApplicationSnapshot } from '../../shared/application';
import type { Application } from './application.token';

@Component({
  selector: 'native-composer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="composer" (submit)="submit($event)">
      <label for="message">Message</label>
      <textarea
        id="message"
        [value]="draft"
        [disabled]="!application.canSubmit()"
        rows="3"
        placeholder="Write a message…"
        aria-describedby="composer-help"
        (input)="edit($event)"
        (keydown)="keydown($event)"
      ></textarea>
      <div class="composer-actions">
        <p id="composer-help" class="muted">
          Ctrl or ⌘ + Enter to send. Enter adds a line.
        </p>
        @if (snapshot.submission.active) {
        <button type="button" (click)="application.stop()">Stop</button>
        }
        <button
          class="primary"
          type="submit"
          [disabled]="!application.canSubmit() || !draft.trim()"
        >
          Send
        </button>
      </div>
      <p class="submission-status" role="status">
        {{
          snapshot.submission.active
            ? 'Response in progress…'
            : snapshot.submission.outcome
            ? outcomes[snapshot.submission.outcome]
            : ''
        }}
      </p>
    </form>
  `,
})
export class ComposerComponent implements OnChanges {
  @Input({ required: true }) application!: Application;
  @Input({ required: true }) snapshot!: ApplicationSnapshot;
  @Input({ required: true }) selectionId!: string | null;
  draft = '';
  readonly outcomes: Record<CompleteOutcome, string> = {
    success: 'Response complete.',
    error: 'The response failed. You can send another message.',
    aborted: 'Response stopped locally. The server may still be running.',
    interrupted: 'Response interrupted before completion.',
    paused: 'Response paused. This example cannot resume it.',
  };
  ngOnChanges(changes: SimpleChanges) {
    // Refresh and runtime notifications do not change this primitive input.
    if (changes['selectionId']) this.draft = '';
  }
  edit(event: Event) {
    this.draft = (event.target as HTMLTextAreaElement).value;
  }
  submit(event: Event) {
    event.preventDefault();
    this.send();
  }
  keydown(event: KeyboardEvent) {
    if (
      event.key === 'Enter' &&
      (event.ctrlKey || event.metaKey) &&
      !event.isComposing
    ) {
      event.preventDefault();
      this.send();
    }
  }
  private send() {
    if (this.application.submit(this.draft)) this.draft = '';
  }
}
