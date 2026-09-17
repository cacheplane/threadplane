// libs/chat/src/lib/primitives/chat-error/chat-error.component.ts
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import type { Agent } from '../../agent';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_ERROR_STYLES } from '../../styles/chat-error.styles';

/**
 * Coerce an unknown error value into a human-readable message string — reads
 * `.message` from `Error`s, returns strings as-is, and `String()`-casts the
 * rest. Useful when rendering an agent's `error` outside the built-in
 * `chat-error` component.
 *
 * @param error Any caught/agent error value.
 * @returns The message text, or `null` when `error` is nullish.
 * @example
 * ```ts
 * const msg = extractErrorMessage(agent.error());
 * ```
 */
export function extractErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

@Component({
  selector: 'chat-error',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_ERROR_STYLES],
  template: `
    @if (agent().error(); as err) {
      <div class="chat-error" role="alert">
        <svg class="chat-error__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span class="chat-error__msg">{{ err.message }}</span>
        @if (err.detail) {
          <span class="chat-error__detail">{{ err.detail }}</span>
        }
        @if (err.recovery === 'check') {
          @if (agent().checkStatus) {
            <button type="button" class="chat-error__check" (click)="agent().checkStatus!()">Check status</button>
          }
        } @else if (err.retryable) {
          <button type="button" class="chat-error__retry" (click)="agent().retry()">Retry</button>
        }
      </div>
    }
  `,
})
export class ChatErrorComponent {
  readonly agent = input.required<Agent>();
}
