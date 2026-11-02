// libs/chat/src/lib/primitives/chat-trace/chat-trace.component.ts
import { Component, ChangeDetectionStrategy, input, signal, effect, computed } from '@angular/core';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_TRACE_STYLES } from '../../styles/chat-trace.styles';

/** The visual execution state used by a collapsible chat trace. */
export type TraceState = 'pending' | 'running' | 'done' | 'error';

/** Provides a collapsible trace section that expands automatically for running or error states. */
@Component({
  selector: 'chat-trace',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_TRACE_STYLES],
  host: {
    '[attr.data-state]': 'state()',
    '[attr.data-expanded]': 'expandedStr()',
  },
  template: `
    <button
      type="button"
      class="chat-trace__header"
      [attr.aria-expanded]="expanded()"
      (click)="toggle()"
    >
      <svg class="chat-trace__chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 2l4 4-4 4"/>
      </svg>
      <span class="chat-trace__label">
        <ng-content select="[traceIcon]" />
        <ng-content select="[traceLabel]" />
      </span>
      <ng-content select="[traceMeta]" />
    </button>
    @if (expanded()) {
      <div class="chat-trace__content"><ng-content /></div>
    }
  `,
})
export class ChatTraceComponent {
  readonly state = input<TraceState>('pending');
  /** When state is not 'running' or 'error', honors this input as the default expansion. */
  readonly defaultExpanded = input<boolean>(false);

  /** null = follow auto state-driven logic; non-null = manual override (user click). */
  private readonly _expandedOverride = signal<boolean | null>(null);

  readonly expanded = computed(() => {
    const override = this._expandedOverride();
    if (override !== null) return override;
    const s = this.state();
    if (s === 'running' || s === 'error') return true;
    return this.defaultExpanded();
  });

  readonly expandedStr = computed(() => String(this.expanded()));

  constructor() {
    let prevState: TraceState | undefined;
    effect(() => {
      const s = this.state();
      // Re-entering running/error from a terminal state: clear manual override
      // so auto-expand kicks in. (Not on done → done, not on user-toggled state.)
      if ((s === 'running' || s === 'error') && prevState && prevState !== s) {
        this._expandedOverride.set(null);
      }
      prevState = s;
    });
  }

  toggle(): void {
    this._expandedOverride.set(!this.expanded());
  }
}
