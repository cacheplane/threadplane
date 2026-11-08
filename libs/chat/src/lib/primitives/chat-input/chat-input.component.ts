// libs/chat/src/lib/primitives/chat-input/chat-input.component.ts
import {
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
  ElementRef,
  ChangeDetectionStrategy,
  DestroyRef,
  inject,
} from '@angular/core';
import type { Agent } from '../../agent';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_INPUT_STYLES } from '../../styles/chat-input.styles';

/**
 * Submits a trimmed message to the agent.
 * Returns the trimmed string on dispatch, or `null` for empty or blocked input.
 */
export function submitMessage(
  agent: Agent,
  text: string,
): string | null {
  const trimmed = text.trim();
  if (!trimmed || agent.isInputBlocked?.()) return null;
  void agent.submit({ message: trimmed });
  return trimmed;
}

/** Provides an auto-resizing message composer that submits to an agent and can stop its current response. */
@Component({
  selector: 'chat-input',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_INPUT_STYLES],
  template: `
    <div class="chat-input__container">
      <ng-content select="[chatInputBanner]" />
      <ng-content select="[chatInputAttachments]" />
      <div class="chat-input__pill">
        <ng-content select="[chatInputLeading]" />
        <textarea
          #textareaEl
          class="chat-input__textarea"
          [value]="messageText()"
          (input)="onInput($event)"
          [placeholder]="placeholder()"
          (keydown.enter)="onKeydown($any($event))"
          (compositionstart)="composing.set(true)"
          (compositionend)="composing.set(false)"
          (focus)="focused.set(true)"
          (blur)="focused.set(false)"
          name="messageText"
          dir="auto"
          rows="1"
          aria-label="Type a message"
        ></textarea>
        <div class="chat-input__controls">
          <ng-content select="[chatInputModelSelect]" />
          <ng-content select="[chatInputTrailing]" />
          @if (isLoading() && canStop()) {
            <button
              type="button"
              class="chat-input__send chat-input__send--stop"
              (click)="onStop()"
              (focus)="onStopFocus($event)"
              (blur)="onStopBlur($event)"
              aria-label="Stop generating"
              title="Stop generating"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2"/>
              </svg>
            </button>
          } @else {
            <button
              type="button"
              class="chat-input__send"
              [disabled]="!canSubmit()"
              (click)="onSubmit()"
              aria-label="Send message"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="12" y1="19" x2="12" y2="5"/>
                <polyline points="5 12 12 5 19 12"/>
              </svg>
            </button>
          }
        </div>
      </div>
      <!-- Persistent live region: Enter during a running reply keeps the
           draft, and this says why nothing was sent. -->
      <div class="chat-input__hint" role="status">
        @if (showRunningHint()) {
          <span>A response is still running. Stop it to send now, or send when it finishes.</span>
        }
      </div>
      <ng-content select="[chatInputFooter]" />
    </div>
  `,
})
export class ChatInputComponent {
  readonly agent = input.required<Agent>();
  readonly submitOnEnter = input<boolean>(true);
  readonly placeholder = input<string>('');
  /** When true (default), shows a stop button while the agent is streaming. */
  readonly showStopButton = input<boolean>(true);
  readonly submitted = output<string>();
  readonly stopped = output<void>();
  readonly messageText = signal<string>('');
  readonly isLoading = computed(() => this.agent().isLoading());
  /** True while an IME composition (CJK input, accent, autocorrect) is active. */
  protected readonly composing = signal(false);
  readonly focused = signal(false);

  /** Submit is allowed only when not loading and there's non-whitespace text. */
  readonly canSubmit = computed(() => {
    if (this.isLoading() || this.agent().isInputBlocked?.()) return false;
    return this.messageText().trim().length > 0;
  });

  /** The stop button only appears when the consumer opted in AND we're loading. */
  readonly canStop = computed(() => this.showStopButton());

  private readonly textareaEl = viewChild<ElementRef<HTMLTextAreaElement>>('textareaEl');

  /**
   * True while the Stop control holds keyboard focus. Stop is swapped for Send
   * when the run ends — by the user or on its own — and removing the focused
   * button would drop focus to <body>; the composer is the logical
   * continuation. Pointer focus is left alone: moving it into the textarea
   * would raise a touch keyboard nobody asked for.
   */
  protected stopHadFocus = false;

  /** Enter was pressed with a draft while a reply was running; cleared when the run ends. */
  private readonly enterBlockedByRun = signal(false);
  protected readonly showRunningHint = computed(() => this.enterBlockedByRun() && this.isLoading());

  /**
   * Auto-resize the textarea to fit its content as the user types or pastes
   * multi-line text. Caps at min(40vh, 320px); beyond that the textarea
   * scrolls. Without this, multi-line input is hidden behind the rows="1"
   * fixed height (caught by live browser smoke).
   */
  constructor() {
    effect(() => {
      const text = this.messageText();
      const el = this.textareaEl()?.nativeElement;
      if (!el) return;
      this.resizeTextarea();
      void text;
    });

    const destroyRef = inject(DestroyRef);
    if (typeof window !== 'undefined') {
      const viewport = window.visualViewport;
      let frame: number | undefined;
      const resize = () => this.resizeTextarea();
      const scheduleResize = () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          frame = undefined;
          resize();
        });
      };
      window.addEventListener('resize', resize);
      viewport?.addEventListener('resize', scheduleResize);
      destroyRef.onDestroy(() => {
        window.removeEventListener('resize', resize);
        viewport?.removeEventListener('resize', scheduleResize);
        if (frame !== undefined) cancelAnimationFrame(frame);
      });
    }

    effect(() => {
      if (!this.isLoading()) this.enterBlockedByRun.set(false);
    });

    effect(() => {
      if (this.isLoading() || !this.stopHadFocus) return;
      this.stopHadFocus = false;
      requestAnimationFrame(() => {
        const active = this.textareaEl()?.nativeElement.ownerDocument.activeElement;
        if (!active || active === active.ownerDocument.body) this.focusTextarea();
      });
    });
  }

  private resizeTextarea(): void {
    const el = this.textareaEl()?.nativeElement;
    if (!el) return;
    const view = el.ownerDocument.defaultView;
    const viewport = view?.visualViewport;
    const height = viewport?.scale === 1 ? viewport.height : (view?.innerHeight ?? 600);
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, height * 0.4, 320)}px`;
    // Respect smaller layout caps, and keep a focused end caret in view when
    // the keyboard reduces the rendered box without another keystroke.
    el.style.overflowY = el.scrollHeight > el.clientHeight ? 'auto' : 'hidden';
    if (el.ownerDocument.activeElement === el && el.selectionStart === el.value.length) {
      el.scrollTop = el.scrollHeight;
    }
  }

  focusTextarea(): void {
    this.textareaEl()?.nativeElement.focus();
  }

  onSubmit(): void {
    // Enter reaches here even while Send is disabled; a running reply keeps
    // the draft in place instead of starting a second, concurrent run.
    if (!this.canSubmit()) {
      if (this.isLoading() && this.messageText().trim()) this.enterBlockedByRun.set(true);
      return;
    }
    const submitted = submitMessage(this.agent(), this.messageText());
    if (submitted !== null) {
      this.submitted.emit(submitted);
      this.clearDraft();
      requestAnimationFrame(() => this.textareaEl()?.nativeElement.focus());
    }
  }

  /** Clears the local draft after a successful submit or application-owned reset. */
  clearDraft(): void {
    this.messageText.set('');
    this.enterBlockedByRun.set(false);
    const element = this.textareaEl()?.nativeElement;
    if (element) element.value = '';
  }

  /** Sync the textarea's value into the signal on user input. A direct
   *  [value]/(input) pair is used instead of ngModel: NgModel does not
   *  reliably write a programmatic clear back to the view under zoneless
   *  + OnPush, leaving sent text visible in the composer (audit F1). */
  protected onInput(event: Event): void {
    this.messageText.set((event.target as HTMLTextAreaElement).value);
  }

  protected onStopFocus(event: FocusEvent): void {
    try {
      this.stopHadFocus = (event.target as Element).matches(':focus-visible');
    } catch {
      this.stopHadFocus = false;
    }
  }

  /**
   * Focus that moved elsewhere in the page ends the hand-off; removal of the
   * button does not. Browsers may dispatch blur during removal, while the
   * button is still connected, so the removal check waits one task.
   */
  protected onStopBlur(event: FocusEvent): void {
    if (event.relatedTarget) { this.stopHadFocus = false; return; }
    const button = event.target as Node;
    setTimeout(() => { if (button.isConnected) this.stopHadFocus = false; }, 0);
  }

  /** Abort the current streaming response (if the adapter supports it). */
  onStop(): void {
    const a = this.agent() as unknown as { stop?: () => void | Promise<void> };
    if (typeof a.stop === 'function') {
      void a.stop();
    }
    this.stopped.emit();
  }

  onKeydown(event: KeyboardEvent): void {
    if (!this.submitOnEnter() || event.shiftKey) return;
    // Don't submit while an IME composition is in progress (CJK input,
    // dead-key accents, autocorrect popups). The composition's terminating
    // Enter must reach the textarea so the candidate is committed; submitting
    // here would discard the user's in-progress character.
    if (this.composing() || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    this.onSubmit();
  }
}
