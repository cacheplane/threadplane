import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';

/** Explicit readonly presentation state, separate from execution/session ownership. */
export type ToolActivityPhase =
  | 'pending'
  | 'running'
  | 'complete'
  | 'error'
  | 'stopped'
  | 'waiting'
  | 'unknown';
/** Observed response delivery facts; a pause does not establish approval. */
export type ToolActivityDelivery =
  | { readonly phase: 'streaming' }
  | {
      readonly phase: 'complete';
      readonly outcome:
        | 'success'
        | 'error'
        | 'aborted'
        | 'interrupted'
        | 'paused';
    };
/** Display-only reconciliation. Completed tools retain their outcome after a later Stop. */
export function toolActivityPhase(
  phase: ToolActivityPhase | undefined,
  delivery?: ToolActivityDelivery
): ToolActivityPhase {
  if (phase !== 'pending' && phase !== 'running') return phase ?? 'unknown';
  if (delivery?.phase !== 'complete') return phase;
  return delivery.outcome === 'aborted'
    ? 'stopped'
    : delivery.outcome === 'paused'
    ? 'waiting'
    : delivery.outcome === 'success' && phase === 'pending'
    ? 'pending'
    : 'unknown';
}
/** Literal evidence and optional app-authored labels for a tool activity. */
export interface ToolActivityInfo {
  readonly id: string;
  readonly name: string;
  readonly label?: string;
  readonly phase?: ToolActivityPhase;
  readonly argumentsText?: string;
  readonly resultText?: string;
  readonly errorText?: string;
  readonly errorSummary?: string;
  readonly durationMs?: number;
}
const labels: Record<ToolActivityPhase, string> = {
  pending: 'Pending',
  running: 'Running',
  complete: 'Complete',
  error: 'Failed',
  stopped: 'Stopped',
  waiting: 'Waiting',
  unknown: 'Status unavailable',
};
const styles = `
:host { display:block; min-width:0; color:var(--tplane-chat-text); font:inherit; }
.tp-tool-activity__heading, summary { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; }
.tp-tool-activity__heading { font-weight:500; }
.tp-tool-activity__phase, .tp-tool-activity__duration { color:var(--tplane-chat-text-muted); font-size:12px; font-weight:400; }
summary { cursor:pointer; color:var(--tplane-chat-text-muted); padding:6px 0; list-style:revert; display:list-item; }
summary:focus-visible { outline:2px solid var(--tplane-chat-primary); outline-offset:3px; border-radius:4px; }
summary > span + span { margin-inline-start:12px; }
.tp-tool-activity__details { margin-block:4px 12px; font-size:12px; }
.tp-tool-activity-group__details { border:1px solid var(--tplane-chat-separator); border-radius:var(--tplane-chat-radius-card,8px); padding:0; margin-block:0 12px; }
.tp-tool-activity-group__details > summary { padding:8px 12px; color:var(--tplane-chat-text); }
.tp-tool-activity-group__details > summary > .tp-tool-activity__phase { float:inline-end; }
.tp-tool-activity-group__items { padding:12px; }
.tp-tool-activity-group__items chat-tool-activity + chat-tool-activity { margin-block-start:12px; }
dl { display:grid; grid-template-columns:auto minmax(0,1fr); gap:4px 12px; } dd { margin:0; overflow-wrap:anywhere; }
pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:280px; overflow:auto; font:12px/1.6 var(--tplane-chat-font-mono); margin:4px 0 12px; padding:8px; border-radius:6px; background:var(--tplane-chat-surface-alt); }
.tp-tool-activity__error { color:var(--tplane-chat-error,#b42318); font-size:13px; margin:8px 0; }
`;
/** Human-readable activity with literal Details and an always-mounted rich-result slot. */
@Component({
  selector: 'chat-tool-activity',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, styles],
  template: ` <section
    class="tp-tool-activity"
    [attr.data-phase]="phase()"
    [attr.data-tool-id]="activity().id"
  >
    <div class="tp-tool-activity__heading">
      <span>{{ activity().label ?? 'Tool activity' }}</span
      ><span class="tp-tool-activity__phase">{{ phaseLabel() }}</span
      >@if (duration() !== undefined) {
      <span class="tp-tool-activity__duration">{{ duration() }}ms</span> }
    </div>
    @if (phase() === 'error') {
    <p role="alert" class="tp-tool-activity__error">
      {{
        activity().errorSummary ??
          'This tool could not finish. Check Details before retrying.'
      }}
    </p>
    }
    <details class="tp-tool-activity__details">
      <summary>Details</summary>
      <dl>
        <dt>Tool</dt>
        <dd>
          <code>{{ activity().name }}</code>
        </dd>
        <dt>Call ID</dt>
        <dd>
          <code>{{ activity().id }}</code>
        </dd>
      </dl>
      @if (activity().argumentsText !== undefined) {
      <p>Arguments</p>
      <pre>{{ activity().argumentsText }}</pre>
      } @if (activity().resultText !== undefined) {
      <p>Result</p>
      <pre>{{ activity().resultText }}</pre>
      } @if (activity().errorText !== undefined) {
      <p>Error</p>
      <pre>{{ activity().errorText }}</pre>
      }
    </details>
    <ng-content />
  </section>`,
})
export class ChatToolActivityComponent {
  readonly activity = input.required<ToolActivityInfo>();
  readonly phase = computed(() => this.activity().phase ?? 'unknown');
  readonly phaseLabel = computed(() => labels[this.phase()]);
  readonly duration = computed(() => {
    const ms = this.activity().durationMs;
    return ms !== undefined && Number.isFinite(ms) && ms >= 0 ? ms : undefined;
  });
}
/** Opt-in group for related tools; does not group custom views or manage their lifecycle. */
@Component({
  selector: 'chat-tool-activity-group',
  standalone: true,
  imports: [ChatToolActivityComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, styles],
  template: ` <section
    class="tp-tool-activity-group"
    [attr.data-phase]="phase()"
  >
    @if (activities().length) {
    <details class="tp-tool-activity-group__details">
      <summary>
        <span>{{
          label() ??
            activities().length +
              (activities().length === 1
                ? ' tool activity'
                : ' tool activities')
        }}</span
        ><span class="tp-tool-activity__phase">{{ phaseLabel() }}</span>
      </summary>
      <div class="tp-tool-activity-group__items">
        @for (activity of activities(); track activity.id) {
        <chat-tool-activity [activity]="activity" /> }
      </div>
    </details>
    } @if (failed()) {
    <p role="alert" class="tp-tool-activity__error">
      Some tools could not finish. Check Details before retrying.
    </p>
    }
    <ng-content />
  </section>`,
})
export class ChatToolActivityGroupComponent {
  readonly activities = input.required<readonly ToolActivityInfo[]>();
  readonly label = input<string>();
  readonly failed = computed(() =>
    this.activities().some((item) => item.phase === 'error')
  );
  readonly phase = computed<ToolActivityPhase>(() =>
    this.failed()
      ? 'error'
      : this.activities().some((item) => item.phase === 'running')
      ? 'running'
      : this.activities().some((item) => item.phase === 'waiting')
      ? 'waiting'
      : this.activities().some((item) => item.phase === 'pending')
      ? 'pending'
      : this.activities().some((item) => item.phase === 'stopped')
      ? 'stopped'
      : this.activities().every((item) => item.phase === 'complete')
      ? 'complete'
      : 'unknown'
  );
  readonly phaseLabel = computed(() => labels[this.phase()]);
}
