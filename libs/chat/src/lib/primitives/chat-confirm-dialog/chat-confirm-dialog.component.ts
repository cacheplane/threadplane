// libs/chat/src/lib/primitives/chat-confirm-dialog/chat-confirm-dialog.component.ts
import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_CONFIRM_DIALOG_STYLES } from '../../styles/chat-confirm-dialog.styles';

let confirmDialogInstanceCounter = 0;

/** Renders a configurable confirmation dialog and emits confirm or cancel actions. */
@Component({
  selector: 'chat-confirm-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_CONFIRM_DIALOG_STYLES],
  template: `
    @if (open()) {
      <button
        type="button"
        class="chat-confirm-dialog__scrim"
        aria-label="Cancel"
        (click)="cancelled.emit()"
      ></button>
      <div
        class="chat-confirm-dialog"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        [attr.aria-labelledby]="titleId"
        [attr.aria-describedby]="body() ? bodyId : null"
        (keydown)="onDialogKeydown($event)"
      >
        <h2 [id]="titleId" class="chat-confirm-dialog__title">{{ title() }}</h2>
        @if (body()) {
          <p [id]="bodyId" class="chat-confirm-dialog__body">{{ body() }}</p>
        }
        <div class="chat-confirm-dialog__actions">
          <button
            #cancelBtn
            type="button"
            class="chat-confirm-dialog__cancel"
            (click)="cancelled.emit()"
          >{{ cancelLabel() }}</button>
          <button
            type="button"
            class="chat-confirm-dialog__confirm"
            [class.chat-confirm-dialog__confirm--destructive]="tone() === 'destructive'"
            (click)="confirmed.emit()"
          >{{ confirmLabel() }}</button>
        </div>
      </div>
    }
  `,
})
export class ChatConfirmDialogComponent {
  readonly open = input<boolean>(false);
  readonly title = input<string>('Are you sure?');
  readonly body = input<string>('');
  readonly confirmLabel = input<string>('Confirm');
  readonly cancelLabel = input<string>('Cancel');
  readonly tone = input<'destructive' | 'normal'>('normal');

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  private readonly instanceId = ++confirmDialogInstanceCounter;
  protected readonly titleId = `chat-confirm-dialog__title-${this.instanceId}`;
  protected readonly bodyId = `chat-confirm-dialog__body-${this.instanceId}`;

  private readonly cancelBtn = viewChild<ElementRef<HTMLButtonElement>>('cancelBtn');

  constructor() {
    effect(() => {
      if (!this.open()) return;
      queueMicrotask(() => this.cancelBtn()?.nativeElement.focus());
    });
  }

  protected onDialogKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.cancelled.emit();
    }
  }
}
