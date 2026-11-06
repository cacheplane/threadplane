import {
  ChangeDetectionStrategy,
  Component,
  Input,
  ViewChild,
  type AfterViewInit,
  type ElementRef,
  type OnChanges,
  type OnDestroy,
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
      <label for="message" class="composer-label">Message</label>
      <div class="composer-pill">
        <textarea
          #messageInput
          id="message"
          [value]="draft"
          [disabled]="
            snapshot.selection.status !== 'ready' || snapshot.submission.active
          "
          rows="1"
          placeholder="Write a message…"
          aria-describedby="composer-help"
          (input)="edit($event)"
          (keydown)="keydown($event)"
        ></textarea>
        <div class="composer-actions">
          @if (snapshot.submission.active) {
          <button
            class="composer-stop"
            type="button"
            aria-label="Stop"
            title="Stop"
            (click)="application.stop()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect
                x="6"
                y="6"
                width="12"
                height="12"
                rx="2"
                fill="currentColor"
              />
            </svg>
          </button>
          }
          <button
            type="submit"
            aria-label="Send"
            title="Send"
            [disabled]="!application.canSubmit() || !draft.trim()"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 19V5m-7 7 7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
      <p id="composer-help" class="composer-help">
        Ctrl or ⌘ + Enter to send. Enter adds a line.
      </p>
      <p class="submission-status" role="status">
        {{ status(snapshot) }}
      </p>
    </form>
  `,
})
export class ComposerComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input({ required: true }) application!: Application;
  @Input({ required: true }) snapshot!: ApplicationSnapshot;
  @Input({ required: true }) selectionId!: string | null;
  draft = '';
  readonly status = submissionStatus;
  @ViewChild('messageInput', { static: true })
  private messageInput?: ElementRef<HTMLTextAreaElement>;
  private resizeObserver?: ResizeObserver;
  private resizeFrame?: number;

  ngAfterViewInit() {
    const textarea = this.messageInput?.nativeElement;
    if (!textarea) return;
    this.resizeTextarea();
    let dimensions = '';
    this.resizeObserver = new ResizeObserver(() => {
      const style = getComputedStyle(textarea);
      const next = `${textarea.clientWidth}:${style.fontSize}:${style.lineHeight}:${style.fontFamily}`;
      if (next === dimensions) return;
      dimensions = next;
      if (this.resizeFrame !== undefined)
        cancelAnimationFrame(this.resizeFrame);
      // Resize outside observer delivery to avoid a height feedback loop.
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = undefined;
        this.resizeTextarea();
      });
    });
    this.resizeObserver.observe(textarea);
    window.addEventListener('resize', this.resizeTextarea);
  }
  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    if (this.resizeFrame !== undefined) cancelAnimationFrame(this.resizeFrame);
    window.removeEventListener('resize', this.resizeTextarea);
  }
  private readonly resizeTextarea = () => {
    const textarea = this.messageInput?.nativeElement;
    if (!textarea) return;
    const cap = Math.min(window.innerHeight * 0.4, 320);
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(
      24,
      Math.min(textarea.scrollHeight, cap)
    )}px`;
    textarea.style.overflowY = textarea.scrollHeight > cap ? 'auto' : 'hidden';
  };
  private clearDraft() {
    this.draft = '';
    const textarea = this.messageInput?.nativeElement;
    if (textarea) textarea.value = '';
    this.resizeTextarea();
  }
  ngOnChanges(changes: SimpleChanges) {
    // Refresh and runtime notifications do not change this primitive input.
    if (changes['selectionId']) this.clearDraft();
  }
  edit(event: Event) {
    this.draft = (event.target as HTMLTextAreaElement).value;
    this.resizeTextarea();
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
      this.clearDraft();
  }
}
