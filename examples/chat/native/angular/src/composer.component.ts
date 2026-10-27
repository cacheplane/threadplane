import {
  ChangeDetectionStrategy,
  Component,
  Input,
  type OnChanges,
  type SimpleChanges,
} from '@angular/core';
import type { ApplicationSnapshot } from '../../shared/application';
import { submissionStatus } from '../../shared/submission-status';
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
        [disabled]="
          snapshot.selection.status !== 'ready' || snapshot.submission.active
        "
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
        {{ status(snapshot) }}
      </p>
    </form>
  `,
})
export class ComposerComponent implements OnChanges {
  @Input({ required: true }) application!: Application;
  @Input({ required: true }) snapshot!: ApplicationSnapshot;
  @Input({ required: true }) selectionId!: string | null;
  draft = '';
  readonly status = submissionStatus;
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
    if (
      this.draft.trim() &&
      this.application.canSubmit() &&
      this.application.submit(this.draft)
    )
      this.draft = '';
  }
}
