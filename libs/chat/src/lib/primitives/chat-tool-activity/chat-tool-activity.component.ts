import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { AgentPlanStep } from '../../agent/agent-plan';
import {
  ChatStatusPanelComponent,
  STATUS_PANEL_CONTENT_STYLES,
} from '../chat-status-panel/chat-status-panel.component';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import {
  activityFailures,
  activityProgress,
  confirmedOutcomes,
  outcomeSources,
  receiptOutcomes,
  resolveToolOutcome,
  type ToolActivityOutcome,
} from './tool-outcome';
import { activitySummary, formatElapsed, workingLabel } from './activity-summary';
import { ACTIVITY_SUMMARY_STYLES } from './activity-summary-styles';
export type {
  ToolActivityOutcome,
  ToolActivityRetry,
  ToolActivitySource,
  ToolOutcomeCall,
  ToolOutcomeDecoder,
} from './tool-outcome';

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
[data-phase='error'] .tp-tool-activity__phase { color:var(--tplane-chat-error-text); }
.tp-tool-activity__heading > .tp-tool-activity__label { white-space:normal; }
[data-phase='complete'] .tp-tool-activity__heading > .tp-tool-activity__label::before { content:'✓' / ''; margin-inline-end:6px; color:var(--tplane-chat-success); }
[data-phase='pending'] .tp-tool-activity__heading > .tp-tool-activity__label { color:var(--tplane-chat-text-muted); }
summary { cursor:pointer; color:var(--tplane-chat-text-muted); padding:6px 0; list-style:revert; display:list-item; }
summary:focus-visible { outline:2px solid var(--tplane-chat-focus-ring); outline-offset:3px; border-radius:var(--tplane-chat-radius-sm); }
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
/* Progress view: elapsed time and Stop sit on the summary's line while work runs. */
.tp-tool-activity-group[data-active='true'] { position:relative; }
.tp-tool-activity-group[data-active='true'] > .tp-tool-activity-group__details > summary { padding-inline-end:8rem; }
.tp-tool-activity-group__progress { position:absolute; inset-block-start:0; inset-inline-end:0; display:flex; align-items:center; gap:8px; min-height:40px; }
.tp-tool-activity-group__elapsed { color:var(--tplane-chat-text-muted); font-size:12px; font-variant-numeric:tabular-nums; }
.tp-tool-activity-group__stop { min-height:28px; padding:2px 10px; border:1px solid var(--tplane-chat-border); border-radius:var(--tplane-chat-radius-sm); background:var(--tplane-chat-surface); color:var(--tplane-chat-text); font:inherit; font-size:12px; cursor:pointer; }
.tp-tool-activity-group__stop:focus-visible { outline:2px solid var(--tplane-chat-focus-ring); outline-offset:2px; }
@media (pointer: coarse) { .tp-tool-activity-group__stop { min-height:44px; } }
.tp-tool-activity-group__plan-step { margin:12px 0 0; font-weight:500; color:var(--tplane-chat-text-muted); }
dl { display:grid; grid-template-columns:auto minmax(0,1fr); gap:4px 12px; } dd { margin:0; overflow-wrap:anywhere; }
pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:280px; overflow:auto; font:12px/1.6 var(--tplane-chat-font-mono); margin:4px 0 12px; padding:8px; border-radius:var(--tplane-chat-radius-card); background:var(--tplane-chat-surface-alt); }
.tp-tool-activity__error { color:var(--tplane-chat-error-text); font-size:13px; margin:8px 0; }
.tp-tool-activity__retrying { display:block; margin:8px 0 0; font-size:13px; font-weight:500; color:var(--tplane-chat-text); }
@media (forced-colors:active) { .tp-tool-activity__error { border:1px solid CanvasText; } }
.tp-tool-outcomes { margin-block:8px 16px; overflow-wrap:anywhere; }
.tp-tool-outcomes p { margin:4px 0; }
.tp-tool-outcomes ul { display:flex; flex-wrap:wrap; gap:8px 16px; padding:0; list-style:none; margin:8px 0; }
.tp-tool-outcomes a { color:var(--tplane-chat-primary); text-decoration:underline; text-underline-offset:3px; }
.tp-tool-outcomes a:focus-visible { outline:2px solid var(--tplane-chat-focus-ring); outline-offset:3px; }
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
  /** An expanded group shows each call's sources under its row and keeps only the result text below the group. */
  readonly show = input<'all' | 'outcomes' | 'sources'>('all');
  readonly outcomes = computed(() => (this.show() === 'sources' ? [] : confirmedOutcomes(this.activities())));
  readonly sources = computed(() => (this.show() === 'outcomes' ? [] : outcomeSources(this.activities())));
}
/** @internal Confirmed-write receipts shared by default rows and grouped presentation. */
@Component({
  selector: 'chat-tool-receipts',
  standalone: true,
  imports: [ChatStatusPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [STATUS_PANEL_CONTENT_STYLES],
  template: `@for (receipt of receipts(); track receipt.id) {
    <div chatStatusPanel tone="success" [lead]="receipt.lead" class="tp-tool-activity__receipt"><p>{{ receipt.text }}</p></div>
    }`,
})
export class ChatToolReceiptsComponent {
  readonly activities = input.required<readonly ToolActivityInfo[]>();
  readonly receipts = computed(() => receiptOutcomes(this.activities()));
}
/** Human-readable activity with literal Details and an always-mounted rich-result slot. */
@Component({
  selector: 'chat-tool-activity',
  standalone: true,
  imports: [ChatToolOutcomesComponent, ChatToolReceiptsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, styles, ACTIVITY_SUMMARY_STYLES, STATUS_PANEL_CONTENT_STYLES],
  template: ` <section
    class="tp-tool-activity"
    [attr.data-phase]="phase()"
    [attr.data-tool-id]="resolved().id"
  >
    <div class="tp-tool-activity__heading">
      <span
        [class.tp-tool-activity__label]="grouped()"
        [attr.data-active]="grouped() ? phase() === 'running' : null"
        >{{ resolved().label ?? 'Tool activity' }}</span
      ><span class="tp-tool-activity__phase">{{ phaseLabel() }}</span
      >@if (duration() !== undefined) {
      <span class="tp-tool-activity__duration">{{ duration() }}ms</span> }
    </div>
    @if (phase() === 'error' && !grouped()) {
    @if (retrying(); as retryingText) {
    <p class="tp-tool-activity__label tp-tool-activity__retrying" data-active="true">{{ retryingText }}</p>
    }
    <p role="alert" class="tp-tool-activity__error">
      {{
        resolved().errorSummary ??
          'This tool could not finish. Check Details before retrying.'
      }}
    </p>
    } @if (retry(); as retry) {
    <button type="button" class="tp-tool-activity__retry" (click)="toolRetry.emit(retry.activity)">{{ retry.label }}</button>
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
    <chat-tool-receipts [activities]="[resolved()]" />
    <ng-content />
  </section>`,
})
export class ChatToolActivityComponent {
  readonly activity = input.required<ToolActivityInfo>();
  /** Set when an enclosing group shows the failure in its own panel; the row then names the failure only by its status word. */
  readonly grouped = input(false);
  /** Set by `chat-tool-calls` while a later call repeats this failed one: "Retrying toSorted read". */
  readonly retrying = input<string | undefined>(undefined);
  /** Direct primitive use gets the same failed-outcome display as projected rows. */
  protected readonly resolved = computed(() => {
    const activity = this.activity();
    return resolveToolOutcome(activity, activity.outcome);
  });
  readonly phase = computed(() => this.resolved().phase ?? 'unknown');
  readonly phaseLabel = computed(() => labels[this.phase()]);
  /** Emits the failed activity when its declared retry is activated. The application owns what a retry does. */
  readonly toolRetry = output<ToolActivityInfo>();
  protected readonly retry = computed(
    () => activityFailures([this.resolved()])[0]?.retry
  );
  readonly duration = computed(() => {
    const ms = this.resolved().durationMs;
    return ms !== undefined && Number.isFinite(ms) && ms >= 0 ? ms : undefined;
  });
}
/** Opt-in group for related tools; does not group custom views or manage their lifecycle. */
@Component({
  selector: 'chat-tool-activity-group',
  standalone: true,
  imports: [
    ChatToolActivityComponent,
    ChatToolOutcomesComponent,
    ChatToolReceiptsComponent,
    ChatStatusPanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    CHAT_HOST_TOKENS,
    styles,
    ACTIVITY_SUMMARY_STYLES,
    STATUS_PANEL_CONTENT_STYLES,
  ],
  template: ` <section
    class="tp-tool-activity-group"
    [attr.data-phase]="phase()"
    [attr.data-active]="summary().active"
  >
    @if (resolved().length) {
    <details class="tp-tool-activity-group__details" (toggle)="open.set($any($event.target).open)">
      <summary>
        <!-- Open while running: a static count; the current step shimmers in its row. -->
        <span
          class="tp-tool-activity__label"
          [attr.data-active]="summary().active && !open()"
          >{{ summary().active && open() && label() === undefined ? working() : summary().label }}</span
        >
        @if (summary().cue) {<span class="tp-tool-activity__cue">{{
          summary().cue
        }}</span
        >}
      </summary>
      <div class="tp-tool-activity-group__items">
        @for (activity of resolved(); track activity.id) {
        <chat-tool-activity [activity]="withoutOutcome(activity)" [grouped]="true" /> }
        @for (step of upcomingSteps(); track $index) {
        <p class="tp-tool-activity-group__plan-step">{{ step.label }}</p>
        }
      </div>
    </details>
    }
    @if (summary().active && (elapsed() !== undefined || stoppable())) {
    <div class="tp-tool-activity-group__progress">
      @if (elapsed() !== undefined) {
      <span class="tp-tool-activity-group__elapsed">{{ elapsed() }}</span>
      }
      @if (stoppable()) {
      <button type="button" class="tp-tool-activity-group__stop" (click)="stop.emit()">Stop</button>
      }
    </div>
    }
    @if (resolved().length) {
    <p
      role="status"
      aria-live="polite"
      aria-atomic="true"
      class="tp-tool-activity__status"
    >
      {{ summary().status }}{{ receiptStatus() }}
    </p>
    <chat-tool-outcomes [activities]="resolved()" />
    } @if (failed()) {
    <div chatStatusPanel tone="danger" role="alert" class="tp-tool-activity__error">
      @for (failure of failures(); track failure.key) {
      <p>{{ failure.text }}</p>
      @if (failure.retry; as retry) {
      <button type="button" class="tp-tool-activity__retry" (click)="toolRetry.emit(retry.activity)">{{ retry.label }}</button>
      } } @empty {
      <p>Some tools could not finish. Check Details before retrying.</p>
      }
    </div>
    }
    <chat-tool-receipts [activities]="resolved()" />
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
  /** Steps the agent declared, such as `agent.plan()`. While the group runs and is open, its pending steps follow the calls, dimmed. */
  readonly plan = input<readonly AgentPlanStep[] | undefined>(undefined);
  /** Offers a Stop button beside the elapsed time while the group runs. Pair it with `(stop)`. */
  readonly stoppable = input(false);
  /** Emits when Stop is activated. The application owns what stopping does, usually `agent.stop()`. */
  readonly stop = output<void>();
  /** Whether the group's details are open; open and running, the heading reads "Working · 1 of 3 done". */
  protected readonly open = signal(false);
  protected readonly working = computed(() => workingLabel(this.resolved()));
  protected readonly upcomingSteps = computed(() =>
    this.summary().active
      ? this.plan()?.filter((step) => step.status === 'pending') ?? []
      : []
  );
  /** Client-observed start of the running stretch, and a clock that ticks once a second only while it runs. */
  private readonly startedAt = signal<number | undefined>(undefined);
  private readonly now = signal(0);
  /** Time since the group last started running, as "45s" or "1m 05s"; undefined while idle. */
  protected readonly elapsed = computed(() => {
    const start = this.startedAt();
    return this.summary().active && start !== undefined
      ? formatElapsed(this.now() - start)
      : undefined;
  });
  constructor() {
    let timer: ReturnType<typeof setInterval> | undefined;
    const clear = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    inject(DestroyRef).onDestroy(clear);
    effect(() => {
      const active = this.summary().active;
      if (!active) {
        clear();
        this.startedAt.set(undefined);
        return;
      }
      if (timer !== undefined) return;
      const begun = Date.now();
      this.startedAt.set(begun);
      this.now.set(begun);
      timer = setInterval(() => this.now.set(Date.now()), 1000);
    });
  }
  readonly progress = computed(() => activityProgress(this.resolved()));
  readonly summary = computed(() =>
    activitySummary(this.resolved(), this.label())
  );
  readonly failed = computed(() =>
    this.resolved().some((item) => item.phase === 'error')
  );
  /** Emits the failed activity when its declared retry is activated. The application owns what a retry does. */
  readonly toolRetry = output<ToolActivityInfo>();
  /** Every observed call in transcript order, so a retry stops being offered once a later call repeats it or work is running. Defaults to this group's activities. */
  readonly context = input<readonly ToolActivityInfo[]>();
  protected readonly failures = computed(() =>
    activityFailures(this.resolved(), this.context())
  );
  protected readonly receiptStatus = computed(() =>
    receiptOutcomes(this.resolved())
      .map((receipt) => ` ${receipt.lead} ${receipt.text}`)
      .join('')
  );
  readonly phase = computed(() => this.summary().phase);
  readonly phaseLabel = computed(() => labels[this.phase()]);
}
