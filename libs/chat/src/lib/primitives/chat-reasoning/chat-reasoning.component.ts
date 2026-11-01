// libs/chat/src/lib/primitives/chat-reasoning/chat-reasoning.component.ts
import {
  Component, ChangeDetectionStrategy,
  computed, effect, input, signal,
} from '@angular/core';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_REASONING_STYLES } from '../../styles/chat-reasoning.styles';
import type { MessageDelivery } from '../../agent';
import { ChatStreamingMdComponent, markdownDocument } from '../../streaming/streaming-markdown.component';
import { formatDuration } from '../../utils/format-duration';

/**
 * Renders an assistant's reasoning content as a compact pill that
 * expands to reveal the underlying text. Three visual states:
 *
 * - Streaming: pill shows "Thinking…" with a pulsing dot; auto-expanded
 *   so the user sees reasoning stream in real time.
 * - Idle, with durationMs known: pill shows `Thought for {duration}`;
 *   collapsed by default, expand on click.
 * - Idle, no duration: pill shows "Show reasoning"; collapsed by default.
 *
 * The body re-uses chat-streaming-md so reasoning content gets the same
 * markdown rendering pipeline as the visible response (lists, code,
 * step labels often appear in reasoning output).
 *
 * Internal state: a tristate "expanded" — null means follow auto state-
 * driven logic (force-expand while delivery is streaming, otherwise honor
 * defaultExpanded), boolean is a manual user choice that wins for the
 * lifetime of the instance.
 */
@Component({
  selector: 'chat-reasoning',
  standalone: true,
  imports: [ChatStreamingMdComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_REASONING_STYLES],
  host: {
    '[attr.data-has-content]': 'hasContent()',
    '[attr.data-expanded]': 'expandedStr()',
    '[attr.data-streaming]': 'isStreaming()',
  },
  template: `
    <button
      type="button"
      class="chat-reasoning__header"
      [attr.aria-expanded]="expanded()"
      (click)="toggle()"
    >
      <svg class="chat-reasoning__chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 2l4 4-4 4"/>
      </svg>
      @if (isStreaming()) {
        <span class="chat-reasoning__pulse" aria-hidden="true"></span>
      }
      <span class="chat-reasoning__label">{{ resolvedLabel() }}</span>
    </button>
    @if (expanded()) {
      <div class="chat-reasoning__body">
        <chat-streaming-md [document]="document()" />
      </div>
    }
  `,
})
export class ChatReasoningComponent {
  readonly content = input<string>('');
  readonly delivery = input.required<MessageDelivery>();
  readonly durationMs = input<number | undefined>(undefined);
  readonly label = input<string | undefined>(undefined);
  readonly defaultExpanded = input<boolean>(false);

  readonly hasContent = computed(() => (this.content() ?? '').length > 0);
  readonly isStreaming = computed(() => this.delivery().phase === 'streaming');
  readonly document = computed(() =>
    markdownDocument(this.content(), this.delivery(), ':reasoning')
  );

  /** null = follow auto logic (streaming → expanded, else defaultExpanded). */
  private readonly _expandedOverride = signal<boolean | null>(null);

  readonly expanded = computed(() => {
    const override = this._expandedOverride();
    if (override !== null) return override;
    if (this.isStreaming()) return true;
    return this.defaultExpanded();
  });

  readonly expandedStr = computed(() => String(this.expanded()));

  readonly resolvedLabel = computed(() => {
    const explicit = this.label();
    if (explicit) return explicit;
    if (this.isStreaming()) return 'Thinking…';
    const ms = this.durationMs();
    if (typeof ms === 'number') return `Thought for ${formatDuration(ms)}`;
    return 'Show reasoning';
  });

  constructor() {
    // Reset the manual override when streaming re-engages from idle (e.g.
    // follow-up turn that re-uses this instance) so the auto force-expand
    // logic takes over again. Spec §3.3 bullet 3.
    let prevStreaming = false;
    effect(() => {
      const streaming = this.isStreaming();
      if (!prevStreaming && streaming) {
        this._expandedOverride.set(null);
      }
      prevStreaming = streaming;
    });
  }

  toggle(): void {
    this._expandedOverride.set(!this.expanded());
  }
}
