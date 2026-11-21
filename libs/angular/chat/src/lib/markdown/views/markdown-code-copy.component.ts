// libs/angular/chat/src/lib/markdown/views/markdown-code-copy.component.ts
import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  DOCUMENT,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

/**
 * The code block's Copy button, for a replacement `'code-block'` view that draws its own `<pre>`.
 * Put it in the same `chat-md-code` element as that `<pre>`: the chat stylesheet places it at the
 * element's top-right corner and shows it on hover and focus.
 */
@Component({
  selector: 'chat-md-code-copy',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button
    type="button"
    class="chat-md-code__copy"
    [attr.aria-label]="label()"
    [title]="label()"
    [attr.data-copied]="copied() ? '' : null"
    (click)="copy()"
  ><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">@if (copied()) {<path d="M5 12.5l4.5 4.5L19 7.5" />} @else {<rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />}</svg></button>`,
})
export class MarkdownCodeCopyComponent {
  /** The text a click writes to the clipboard. */
  readonly text = input.required<string>();
  protected readonly copied = signal(false);
  protected readonly label = computed(() => (this.copied() ? 'Copied' : 'Copy code'));
  private readonly document = inject(DOCUMENT);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      clearTimeout(this.timer);
    });
  }

  protected async copy(): Promise<void> {
    if (!(await writeClipboard(this.document, this.text())) || this.destroyed) return;
    this.copied.set(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.copied.set(false), 2000);
  }
}

/** Writes text to the clipboard, falling back to a selection copy where the async API is absent or refuses. */
async function writeClipboard(document: Document, text: string): Promise<boolean> {
  const clipboard = document.defaultView?.navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Permissions, an insecure context or an unfocused document: try the selection copy.
    }
  }
  // Selecting the helper takes focus; hand it back so a keyboard user stays on the button.
  const focused = document.activeElement;
  const area = document.createElement('textarea');
  try {
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    return document.execCommand?.('copy') === true;
  } catch {
    return false;
  } finally {
    area.remove();
    if (focused instanceof HTMLElement && focused.isConnected) focused.focus();
  }
}
