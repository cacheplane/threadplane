import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  TemplateRef,
  computed,
  contentChild,
  effect,
  afterNextRender,
  Injector,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { Agent } from '../../agent';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { ChatStatusPanelComponent } from '../../primitives/chat-status-panel/chat-status-panel.component';
import { CHAT_APPROVAL_RECORDS } from './approval-records';

/** Actions emitted by the approval dialog for the host to handle. */
export type ChatApprovalAction = 'approve' | 'edit' | 'cancel';
/** `dialog` opens a modal; `inline` renders a status panel where the card is placed, such as a `chatInterruptTemplate`. */
export type ChatApprovalPresentation = 'dialog' | 'inline';

/** Displays an approval for a matching agent interrupt, as a modal dialog or an inline panel, and emits approve, edit, or cancel actions. */
@Component({
  selector: 'chat-approval-card',
  standalone: true,
  imports: [NgTemplateOutlet, ChatStatusPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    CHAT_HOST_TOKENS,
    `
    :host { display: contents; }
    dialog.chat-approval-card {
      width: 440px;
      max-width: calc(100vw - 32px);
      /* Center in the viewport. The UA stylesheet sets margin:auto on open
         modal dialogs, but our reset properties below shadow it. Re-assert. */
      margin: auto;
      padding: 0;
      border: 0;
      border-radius: var(--tplane-chat-radius-card);
      background: var(--tplane-chat-surface);
      color: var(--tplane-chat-text);
      box-shadow: var(--tplane-chat-elevation-float);
    }
    dialog.chat-approval-card::backdrop {
      background: var(--tplane-chat-scrim);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    .chat-approval-card__header {
      padding: 14px 16px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid var(--tplane-chat-separator);
    }
    .chat-approval-card__header h4 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--tplane-chat-text);
    }
    .chat-approval-card__header svg {
      color: var(--tplane-chat-warning-text);
      width: 16px;
      height: 16px;
      flex: 0 0 16px;
    }
    .chat-approval-card__body {
      padding: 14px 16px;
      font-size: var(--tplane-chat-font-size-sm, 13px);
      color: var(--tplane-chat-text);
    }
    .chat-approval-card__actions {
      padding: 8px 16px 14px;
      display: flex;
      gap: 6px;
      justify-content: flex-end;
      align-items: center;
    }
    .btn {
      border: 0;
      padding: 6px 14px;
      border-radius: var(--tplane-chat-radius-button);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: transform var(--tplane-chat-motion-duration-slow) var(--tplane-chat-motion-ease), opacity var(--tplane-chat-motion-duration-slow) var(--tplane-chat-motion-ease);
    }
    .btn:hover { transform: scale(1.03); }
    .btn-primary { background: var(--tplane-chat-primary); color: var(--tplane-chat-on-primary); }
    .btn-secondary { background: transparent; color: var(--tplane-chat-text); border: 1px solid var(--tplane-chat-separator); }
    .btn-text {
      background: transparent;
      color: var(--tplane-chat-text-muted);
      padding: 6px 10px;
    }
    .btn-text:hover { color: var(--tplane-chat-text); }
    .btn:focus-visible { outline: 2px solid var(--tplane-chat-focus-ring); outline-offset: 2px; }
    .btn-danger { background: var(--tplane-chat-destructive); color: var(--tplane-chat-on-destructive); }
    .chat-approval-card--inline { margin: 8px 0 16px; }
    .chat-approval-card__request { margin: 0; color: var(--tplane-chat-text); }
    .chat-approval-card--inline .btn { min-height: 32px; font-size: 13px; }
    @media (pointer: coarse) { .chat-approval-card--inline .btn { min-height: 44px; } }
    @media (forced-colors: active) { .btn-primary, .btn-danger { border: 1px solid ButtonText; } }
    `,
  ],
  template: `
    @if (presentation() === 'inline') {
      @if (payload(); as p) {
        <div
          chatStatusPanel
          class="chat-approval-card chat-approval-card--inline"
          [tone]="destructive() ? 'danger' : 'warning'"
          [lead]="lead()"
        >
          <p class="chat-approval-card__request">{{ title() }}</p>
          @if (bodyTemplate(); as tpl) {
            <ng-container *ngTemplateOutlet="tpl; context: { $implicit: p }"></ng-container>
          }
          <button #firstAction chatStatusPanelActions type="button" class="btn" [class.btn-primary]="!destructive()" [class.btn-danger]="destructive()" (click)="emit('approve')">{{ approveLabel() }}</button>
          @if (showEdit()) {
            <button chatStatusPanelActions type="button" class="btn btn-secondary" (click)="emit('edit')">Edit</button>
          }
          <button chatStatusPanelActions type="button" class="btn btn-secondary" (click)="emit('cancel')">{{ cancelLabel() }}</button>
        </div>
      }
    }
    <!-- Always rendered so the dialog exists from creation; it only opens in dialog presentation. -->
    <dialog #dialogEl class="chat-approval-card" (close)="onDialogClose()" (cancel)="onCancelEvent($event)">
      <div class="chat-approval-card__header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <h4>{{ title() }}</h4>
      </div>
      <div class="chat-approval-card__body">
        @if (bodyTemplate(); as tpl) {
          @if (payload(); as p) {
            <ng-container *ngTemplateOutlet="tpl; context: { $implicit: p }"></ng-container>
          }
        }
      </div>
      <div class="chat-approval-card__actions">
        <button type="button" class="btn btn-text" (click)="emit('cancel')">{{ cancelLabel() }}</button>
        @if (showEdit()) {
          <button type="button" class="btn btn-secondary" (click)="emit('edit')">Edit</button>
        }
        <button type="button" class="btn" [class.btn-primary]="!destructive()" [class.btn-danger]="destructive()" (click)="emit('approve')">{{ approveLabel() }}</button>
      </div>
    </dialog>
  `,
})
export class ChatApprovalCardComponent {
  readonly agent = input.required<Agent>();
  readonly matchKind = input<string | undefined>(undefined);
  readonly title = input<string>('Approval required');
  readonly showEdit = input<boolean>(false);
  /** `inline` (default) renders a status panel in place; put the card in a `chatInterruptTemplate` so it sits at the end of the transcript. `dialog` opens a modal instead. */
  readonly presentation = input<ChatApprovalPresentation>('inline');
  /** Marks an action that cannot be undone: danger tint, the lead "This can't be undone." and a danger primary button. Name the exact effect in `approveLabel`, such as "Delete 12 drafts". */
  readonly destructive = input<boolean>(false);
  /** Primary button text. Name the action, such as "Save note". */
  readonly approveLabel = input<string>('Approve');
  /** Secondary button text. Name the alternative, such as "Don't save". */
  readonly cancelLabel = input<string>('Cancel');
  /**
   * Inline only: what the one-line record names once the approval is answered,
   * as in "Approved: Save note". Defaults to `approveLabel` when the app named
   * the action; otherwise the record reads just "Approved" or "Declined".
   */
  readonly recordLabel = input<string | undefined>(undefined);

  readonly action = output<ChatApprovalAction>();

  protected readonly lead = computed(() =>
    this.destructive() ? "This can't be undone." : 'Waiting for your approval.'
  );

  protected readonly bodyTemplate = contentChild<TemplateRef<unknown>>('body');
  private readonly dialogRef = viewChild<ElementRef<HTMLDialogElement>>('dialogEl');
  private readonly firstAction = viewChild<ElementRef<HTMLButtonElement>>('firstAction');
  private readonly injector = inject(Injector);
  private readonly records = inject(CHAT_APPROVAL_RECORDS, { optional: true });

  private readonly interrupt = computed(() => this.agent().interrupt?.());

  protected readonly payload = computed(() => {
    const i = this.interrupt();
    if (!i) return undefined;
    const v = i.value as { kind?: unknown } | undefined;
    const want = this.matchKind();
    if (want !== undefined) {
      if (!v || typeof v !== 'object' || (v as { kind?: unknown }).kind !== want) {
        return undefined;
      }
    }
    return v;
  });

  constructor() {
    // Inline: move focus to the first action once, when an approval appears.
    let focusedFor: unknown;
    effect(() => {
      const p = this.payload();
      if (this.presentation() !== 'inline' || !p) {
        focusedFor = undefined;
        return;
      }
      if (focusedFor === p) return;
      focusedFor = p;
      afterNextRender(() => this.firstAction()?.nativeElement.focus(), { injector: this.injector });
    });
    effect(() => {
      if (this.presentation() !== 'dialog') return;
      const p = this.payload();
      const dialog = this.dialogRef()?.nativeElement;
      if (!dialog) return;
      if (p && !dialog.open) {
        dialog.showModal();
      } else if (!p && dialog.open) {
        dialog.close();
      }
    });
  }

  protected emit(action: ChatApprovalAction): void {
    if (action !== 'edit') this.record(action === 'approve' ? 'approved' : 'declined');
    this.action.emit(action);
    // 'approve' and 'cancel' are terminal — they resolve the interrupt, so the
    // dialog closes. 'edit' is non-terminal: the caller reveals an inline
    // editor in the body slot and submits the resume itself, so we leave the
    // dialog open.
    if (action !== 'edit') {
      this.closeDialog();
    }
  }

  protected onCancelEvent(ev: Event): void {
    // Native dialog's cancel event fires on Escape. Treat as cancel.
    ev.preventDefault();
    this.action.emit('cancel');
    this.closeDialog();
  }

  /** Inline answers leave a one-line record after the message they followed. */
  private record(verdict: 'approved' | 'declined'): void {
    if (!this.records || this.presentation() !== 'inline' || !this.payload()) return;
    const approve = this.approveLabel();
    const label = this.recordLabel() ?? (approve === 'Approve' ? '' : approve);
    const messages = this.agent().messages();
    let afterMessageId: string | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        afterMessageId = messages[i].id;
        break;
      }
    }
    this.records.add({ verdict, label, afterMessageId });
  }

  private closeDialog(): void {
    const dialog = this.dialogRef()?.nativeElement;
    if (!dialog) return;
    if (dialog.open) dialog.close();
  }

  protected onDialogClose(): void {
    // Native close — no-op; emit happens in emit() / onCancelEvent.
  }
}
