// libs/chat/src/lib/primitives/chat-status-panel/chat-status-panel.component.ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';

/** Meaning of a status panel: a failure, something waiting on the person, a confirmed write, or plain information. */
export type ChatStatusPanelTone = 'danger' | 'warning' | 'success' | 'neutral';

const styles = `
:host {
  --tp-status-tone: var(--tplane-chat-text-muted, GrayText);
  display:flex; flex-direction:column; align-items:flex-start; gap:8px; margin:8px 0; padding:8px 12px;
  border:1px solid color-mix(in srgb, var(--tp-status-tone) 40%, transparent);
  border-radius:var(--tplane-chat-radius-card, 8px);
  background:color-mix(in srgb, var(--tp-status-tone) 8%, transparent);
  color:var(--tplane-chat-text); font-size:13px; overflow-wrap:anywhere;
}
:host([data-tone='danger']) { --tp-status-tone: var(--tplane-chat-error-text, #b91c1c); }
:host([data-tone='warning']) { --tp-status-tone: var(--tplane-chat-warning-text, #b45309); }
:host([data-tone='success']) { --tp-status-tone: var(--tplane-chat-success-text, #15803d); }
.tp-status-panel__lead { margin:0; color:var(--tp-status-tone); font-weight:500; }
.tp-status-panel__actions { display:flex; flex-wrap:wrap; gap:8px; }
.tp-status-panel__actions:empty { display:none; }
@media (forced-colors:active) { :host { border-color:CanvasText; } }
`;

/** Shared look for text and buttons a component projects into a status panel from its own template. */
export const STATUS_PANEL_CONTENT_STYLES = `
.tp-status-panel > p { margin:0; }
.tp-tool-activity__error.tp-status-panel > p { color:var(--tplane-chat-error-text, #b91c1c); font-weight:500; }
.tp-tool-activity__retry {
  min-height:32px; padding:4px 12px; border:1px solid var(--tplane-chat-border, currentColor);
  border-radius:var(--tplane-chat-radius-sm, 6px); background:var(--tplane-chat-surface, transparent);
  color:var(--tplane-chat-text); font:inherit; cursor:pointer;
}
.tp-tool-activity__retry:focus-visible { outline:2px solid var(--tplane-chat-primary, currentColor); outline-offset:2px; }
@media (pointer:coarse) { .tp-tool-activity__retry { min-height:44px; } }
`;

/**
 * The one container for a failed call, a run error, an approval or a receipt.
 * A lead sentence, projected detail, then actions marked `chatStatusPanelActions`.
 * Displays only; it runs nothing. Set `role="alert"` on it for failures only.
 *
 * ```html
 * <chat-status-panel tone="success" lead="Saved.">
 *   <p>Note #4821 in Comparisons.</p>
 *   <button chatStatusPanelActions type="button" (click)="open()">Open note</button>
 * </chat-status-panel>
 * ```
 */
@Component({
  selector: 'chat-status-panel, [chatStatusPanel]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, styles],
  host: { class: 'tp-status-panel', '[attr.data-tone]': 'tone()' },
  template: `@if (lead()) {<p class="tp-status-panel__lead">{{ lead() }}</p>}<ng-content /><div class="tp-status-panel__actions"><ng-content select="[chatStatusPanelActions]" /></div>`,
})
export class ChatStatusPanelComponent {
  /** Defaults to `neutral`. The lead sentence carries the meaning; colour only reinforces it. */
  readonly tone = input<ChatStatusPanelTone>('neutral');
  /** Short statement ending in a period, such as "Saved." */
  readonly lead = input<string>();
}
