import {
  Component,
  computed,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import type { Agent } from '../../agent';
import type { AgentInterrupt } from '../../agent/agent-interrupt';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';

/** Review actions emitted by the interrupt panel for the host to handle. */
export type InterruptAction = 'accept' | 'edit' | 'respond' | 'ignore';

/**
 * Retrieves the current interrupt value from an Agent, or undefined when
 * the runtime does not expose interrupts.
 * Exported for unit testing without DOM rendering.
 */
export function getInterruptFromAgent(agent: Agent): AgentInterrupt | undefined {
  return agent.interrupt?.();
}

/**
 * Extracts a human-readable reason from an interrupt value. When the value
 * is an object with a string `reason` field, returns that directly. Falls
 * back to a JSON dump so consumers always see something rather than nothing.
 * Exported for unit testing.
 */
export function interruptReasonText(interrupt: AgentInterrupt | undefined): string {
  if (!interrupt) return '';
  const v = interrupt.value as { reason?: unknown } | undefined;
  if (v && typeof v === 'object' && typeof (v as { reason?: unknown }).reason === 'string') {
    return (v as { reason: string }).reason;
  }
  if (typeof v === 'string') return v;
  return JSON.stringify(v ?? '', null, 2);
}

/** Displays the agent’s current interrupt reason and emits accept, edit, respond, or ignore actions. */
@Component({
  selector: 'chat-interrupt-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    CHAT_HOST_TOKENS,
    `
    .chat-interrupt-panel {
      background: var(--tplane-chat-surface);
      color: var(--tplane-chat-text);
      border: 1px solid var(--tplane-chat-separator);
      border-radius: var(--tplane-chat-radius-card);
      padding: 14px 16px;
      font-size: var(--tplane-chat-font-size-sm);
    }
    .chat-interrupt-panel__eyebrow {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--tplane-chat-warning-text);
      margin: 0 0 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .chat-interrupt-panel__dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--tplane-chat-warning-text);
      flex: 0 0 6px;
    }
    .chat-interrupt-panel__body {
      margin: 0 0 12px;
      color: var(--tplane-chat-text);
      white-space: pre-wrap;
    }
    .chat-interrupt-panel__actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }
    .btn {
      border: 0;
      padding: 6px 14px;
      border-radius: var(--tplane-chat-radius-button);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: transform 200ms ease, opacity 200ms ease;
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
    `,
  ],
  template: `
    @if (interrupt()) {
      <div role="alert" class="chat-interrupt-panel">
        <p class="chat-interrupt-panel__eyebrow">
          <span class="chat-interrupt-panel__dot" aria-hidden="true"></span>
          Agent paused — review needed
        </p>
        <p class="chat-interrupt-panel__body">{{ interruptReason() }}</p>
        <div class="chat-interrupt-panel__actions">
          <button type="button" class="btn btn-primary" (click)="action.emit('accept')">Accept</button>
          <button type="button" class="btn btn-secondary" (click)="action.emit('edit')">Edit</button>
          <button type="button" class="btn btn-secondary" (click)="action.emit('respond')">Respond</button>
          <button type="button" class="btn btn-text" (click)="action.emit('ignore')">Ignore</button>
        </div>
      </div>
    }
  `,
})
export class ChatInterruptPanelComponent {
  readonly agent = input.required<Agent>();

  readonly action = output<InterruptAction>();

  readonly interrupt = computed(() => getInterruptFromAgent(this.agent()));

  readonly interruptReason = computed(() => interruptReasonText(this.interrupt()));
}
