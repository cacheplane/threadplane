import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import {
  activityProgress,
  confirmedOutcomes,
  outcomeSources,
  resolveToolOutcome,
  type ToolActivityOutcome,
} from './tool-outcome';
import { activitySummary, failureSummaries } from './activity-summary';
import { ACTIVITY_SUMMARY_STYLES } from './activity-summary-styles';
export type { ToolActivityOutcome, ToolActivitySource } from './tool-outcome';

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
  /** App-authored preview shown after explicit completion, outside technical Details. */
  readonly outcome?: ToolActivityOutcome;
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
.tp-tool-activity-group__details { padding:0; margin-block:0 12px; min-inline-size:0; }
.tp-tool-activity-group__details > summary { display:flex; flex-wrap:nowrap; align-items:center; gap:8px; min-height:32px; min-inline-size:0; padding:4px 0; color:var(--tplane-chat-text); list-style:none; }
.tp-tool-activity-group__details > summary::-webkit-details-marker { display:none; }
.tp-tool-activity-group__details > summary::before { content:''; width:6px; height:6px; flex:none; border-inline-end:1.5px solid currentColor; border-bottom:1.5px solid currentColor; transform:rotate(-45deg); margin-inline-end:2px; }
.tp-tool-activity-group__details[open] > summary::before { transform:rotate(45deg); }
.tp-tool-activity-group__details > summary > span + span { margin-inline-start:0; }
.tp-tool-activity-group__items { padding:12px; }
.tp-tool-activity-group__items chat-tool-activity + chat-tool-activity { margin-block-start:12px; }
dl { display:grid; grid-template-columns:auto minmax(0,1fr); gap:4px 12px; } dd { margin:0; overflow-wrap:anywhere; }
pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:280px; overflow:auto; font:12px/1.6 var(--tplane-chat-font-mono); margin:4px 0 12px; padding:8px; border-radius:6px; background:var(--tplane-chat-surface-alt); }
.tp-tool-activity__error { color:var(--tplane-chat-error,#b42318); font-size:13px; margin:8px 0; }
.tp-tool-outcomes { margin-block:8px 16px; overflow-wrap:anywhere; }
.tp-tool-outcomes p { margin:4px 0; }
.tp-tool-outcomes ul { display:flex; flex-wrap:wrap; gap:8px 16px; padding:0; list-style:none; margin:8px 0; }
.tp-tool-outcomes a { color:var(--tplane-chat-primary); text-decoration:underline; text-underline-offset:3px; }
.tp-tool-outcomes a:focus-visible { outline:2px solid currentColor; outline-offset:3px; }
`;
/** @internal Readonly confirmed previews shared by default rows and grouped presentation. */
@Component({
  selector: 'chat-tool-outcomes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, styles],
  template: `@if (outcomes().length || sources().length) {
    <div class="tp-tool-outcomes">
      @for (outcome of outcomes().slice(0, 3); track outcome.text) {
      <p>{{ outcome.text }}</p>
      } @if (outcomes().length > 3) {
      <details>
        <summary>More results ({{ outcomes().length - 3 }})</summary>
        @for (outcome of outcomes().slice(3); track outcome.text) {
        <p>{{ outcome.text }}</p>
        }
      </details>
      } @if (sources().length) {
      <ul aria-label="Tool sources">
        @for (source of sources().slice(0, 3); track source.url) {
        <li>
          <a [href]="source.url" target="_blank" rel="noopener noreferrer">{{
            source.title
          }}</a>
        </li>
        }
      </ul>
      } @if (sources().length > 3) {
      <details>
        <summary>More sources ({{ sources().length - 3 }})</summary>
        <ul aria-label="More tool sources">
          @for (source of sources().slice(3); track source.url) {
          <li>
            <a [href]="source.url" target="_blank" rel="noopener noreferrer">{{
              source.title
            }}</a>
          </li>
          }
        </ul>
      </details>
      }
    </div>
    }`,
})
export class ChatToolOutcomesComponent {
  readonly activities = input.required<readonly ToolActivityInfo[]>();
  readonly outcomes = computed(() => confirmedOutcomes(this.activities()));
  readonly sources = computed(() => outcomeSources(this.activities()));
}
/** Human-readable activity with literal Details and an always-mounted rich-result slot. */
@Component({
  selector: 'chat-tool-activity',
  standalone: true,
  imports: [ChatToolOutcomesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, styles],
  template: ` <section
    class="tp-tool-activity"
    [attr.data-phase]="phase()"
    [attr.data-tool-id]="resolved().id"
  >
    <div class="tp-tool-activity__heading">
      <span>{{ resolved().label ?? 'Tool activity' }}</span
      ><span class="tp-tool-activity__phase">{{ phaseLabel() }}</span
      >@if (duration() !== undefined) {
      <span class="tp-tool-activity__duration">{{ duration() }}ms</span> }
    </div>
    @if (phase() === 'error') {
    <p role="alert" class="tp-tool-activity__error">
      {{
        resolved().errorSummary ??
          'This tool could not finish. Check Details before retrying.'
      }}
    </p>
    }
    <details class="tp-tool-activity__details">
      <summary>Details</summary>
      <dl>
        <dt>Tool</dt>
        <dd>
          <code>{{ resolved().name }}</code>
        </dd>
        <dt>Call ID</dt>
        <dd>
          <code>{{ resolved().id }}</code>
        </dd>
      </dl>
      @if (resolved().argumentsText !== undefined) {
      <p>Arguments</p>
      <pre>{{ resolved().argumentsText }}</pre>
      } @if (resolved().resultText !== undefined) {
      <p>Result</p>
      <pre>{{ resolved().resultText }}</pre>
      } @if (resolved().errorText !== undefined) {
      <p>Error</p>
      <pre>{{ resolved().errorText }}</pre>
      }
    </details>
    <chat-tool-outcomes [activities]="[resolved()]" />
    <ng-content />
  </section>`,
})
export class ChatToolActivityComponent {
  readonly activity = input.required<ToolActivityInfo>();
  /** Direct primitive use gets the same failed-outcome display as projected rows. */
  protected readonly resolved = computed(() => {
    const activity = this.activity();
    return resolveToolOutcome(activity, activity.outcome);
  });
  readonly phase = computed(() => this.resolved().phase ?? 'unknown');
  readonly phaseLabel = computed(() => labels[this.phase()]);
  readonly duration = computed(() => {
    const ms = this.resolved().durationMs;
    return ms !== undefined && Number.isFinite(ms) && ms >= 0 ? ms : undefined;
  });
}
/** Opt-in group for related tools; does not group custom views or manage their lifecycle. */
@Component({
  selector: 'chat-tool-activity-group',
  standalone: true,
  imports: [ChatToolActivityComponent, ChatToolOutcomesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, styles, ACTIVITY_SUMMARY_STYLES],
  template: ` <section
    class="tp-tool-activity-group"
    [attr.data-phase]="phase()"
    [attr.data-active]="summary().active"
  >
    @if (resolved().length) {
    <details class="tp-tool-activity-group__details">
      <summary>
        <span
          class="tp-tool-activity__label"
          [attr.data-active]="summary().active"
          >{{ summary().label }}</span
        >
        @if (summary().cue) {<span class="tp-tool-activity__cue">{{
          summary().cue
        }}</span
        >}
      </summary>
      <div class="tp-tool-activity-group__items">
        @for (activity of resolved(); track activity.id) {
        <chat-tool-activity [activity]="withoutOutcome(activity)" /> }
      </div>
    </details>
    <p
      role="status"
      aria-live="polite"
      aria-atomic="true"
      class="tp-tool-activity__status"
    >
      {{ summary().status }}
    </p>
    <chat-tool-outcomes [activities]="resolved()" />
    } @if (failed()) {
    <div role="alert" class="tp-tool-activity__error">
      @for (text of failureSummaries(); track text) {
      <p>{{ text }}</p>
      } @empty {
      <p>Some tools could not finish. Check Details before retrying.</p>
      }
    </div>
    }
    <ng-content />
  </section>`,
})
export class ChatToolActivityGroupComponent {
  protected withoutOutcome(activity: ToolActivityInfo): ToolActivityInfo {
    return { ...activity, outcome: undefined };
  }
  readonly activities = input.required<readonly ToolActivityInfo[]>();
  /** Resolved once so the label, cue, live region and rows agree on each phase. */
  protected readonly resolved = computed(() =>
    this.activities().map((activity) =>
      resolveToolOutcome(activity, activity.outcome)
    )
  );
  readonly label = input<string>();
  readonly progress = computed(() => activityProgress(this.resolved()));
  readonly summary = computed(() =>
    activitySummary(this.resolved(), this.label())
  );
  readonly failed = computed(() =>
    this.resolved().some((item) => item.phase === 'error')
  );
  readonly failureSummaries = computed(() =>
    failureSummaries(this.resolved())
  );
  readonly phase = computed(() => this.summary().phase);
  readonly phaseLabel = computed(() => labels[this.phase()]);
}
