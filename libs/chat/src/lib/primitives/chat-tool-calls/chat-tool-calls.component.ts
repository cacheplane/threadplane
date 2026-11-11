// libs/chat/src/lib/primitives/chat-tool-calls/chat-tool-calls.component.ts
import {
  Component,
  ChangeDetectionStrategy,
  computed,
  contentChildren,
  input,
  output,
  signal,
  inject,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  DestroyRef,
  isDevMode,
  type TemplateRef,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { Agent, Message, ToolCall, Subagent } from '../../agent';
import type { ToolCallInfo } from '../../compositions/chat-tool-call-card/chat-tool-call-card.component';
import { ChatSubagentCardComponent } from '../../compositions/chat-subagent-card/chat-subagent-card.component';
import { ChatToolCallTemplateDirective } from './chat-tool-call-template.directive';
import { ChatToolResultTemplateDirective, type ChatToolResultTemplateContext } from './chat-tool-result-template.directive';
import { resolveMessageToolCalls } from './resolve-message-tool-calls';
import {
  ChatToolActivityComponent,
  ChatToolOutcomesComponent,
  ChatToolReceiptsComponent,
  toolActivityPhase,
  type ToolActivityInfo,
  type ToolActivityOutcome,
} from '../chat-tool-activity/chat-tool-activity.component';
import {
  activityFailures,
  receiptOutcomes,
  resolveToolOutcome,
  withoutStaleRetry,
  type ToolActivityFailure,
} from '../chat-tool-activity/tool-outcome';
import { activitySummary, formatElapsed, workingLabel } from '../chat-tool-activity/activity-summary';
import {
  ChatStatusPanelComponent,
  STATUS_PANEL_CONTENT_STYLES,
} from '../chat-status-panel/chat-status-panel.component';
import { ACTIVITY_SUMMARY_STYLES } from '../chat-tool-activity/activity-summary-styles';

interface Group {
  key: string;
  name: string;
  calls: ToolCall[];
  templateRef?: ChatToolCallTemplateDirective;
  /** Present when this group anchors a subagent spawned by its (single) task call. */
  subagent?: Subagent;
}

const NONE: ReadonlySet<string> = new Set();
const stableText = (value: unknown): string => {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
};
/** Two calls repeat each other when they share a tool name and arguments. */
const repeatKey = (call: ToolCall): string => call.name + '\0' + stableText(call.args);
/** "Retrying toSorted read" from a declared label such as "Retry toSorted read". */
const retryingText = (label: string): string => {
  const rest = /^retry\b\s*(.*)$/i.exec(label.trim())?.[1];
  return rest ? `Retrying ${rest}` : 'Retrying';
};
// Unique per instance, so each group body id is unique on the page.
let nextChatToolCallsId = 0;

/** Renders tool calls with optional grouping, custom templates, and cards for spawned subagents. */
@Component({
  selector: 'chat-tool-calls',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    ChatToolActivityComponent,
    ChatToolOutcomesComponent,
    ChatToolReceiptsComponent,
    ChatStatusPanelComponent,
    ChatSubagentCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    ACTIVITY_SUMMARY_STYLES,
    STATUS_PANEL_CONTENT_STYLES,
    `
      :host {
        display: block;
        margin-bottom: 20px;
      }
      .ctc__group {
        margin: 0 0 4px;
        min-inline-size: 0;
      }
      .ctc__group-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        min-height: 32px;
        min-inline-size: 0;
        padding: 4px 0;
        background: transparent;
        border: 0;
        font: inherit;
        color: var(--tplane-chat-text);
        cursor: pointer;
        text-align: left;
      }
      .ctc__group-header:focus-visible {
        outline: 2px solid var(--tplane-chat-focus-ring);
        outline-offset: 2px;
        border-radius: var(--tplane-chat-radius-card);
      }
      .ctc__group-chevron {
        flex: none;
        width: 10px;
        height: 10px;
        transition: transform var(--tplane-chat-motion-duration) var(--tplane-chat-motion-ease);
      }
      .ctc__group-body[hidden] {
        display: none;
      }
      .ctc__group-header[hidden],
      .ctc__group-bar[hidden] {
        display: none;
      }
      .ctc__group-bar {
        display: flex;
        align-items: center;
        gap: 12px;
        min-inline-size: 0;
      }
      .ctc__group-bar > .ctc__group-header {
        flex: 1 1 auto;
        width: auto;
      }
      .ctc__group-elapsed {
        flex: none;
        color: var(--tplane-chat-text-muted);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
      .ctc__group-stop {
        flex: none;
        min-height: 32px;
        padding: 4px 12px;
        border: 1px solid var(--tplane-chat-border);
        border-radius: var(--tplane-chat-radius-sm);
        background: var(--tplane-chat-surface);
        color: var(--tplane-chat-text);
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }
      .ctc__group-stop:focus-visible {
        outline: 2px solid var(--tplane-chat-focus-ring);
        outline-offset: 2px;
      }
      @media (pointer: coarse) {
        .ctc__group-stop {
          min-height: 44px;
        }
      }
      .ctc__group--single {
        border: 0;
        margin: 0;
      }
      .ctc__group--single .ctc__group-body {
        padding: 0;
        border: 0;
      }
      @media (prefers-reduced-motion: reduce) {
        .ctc__group-chevron {
          transition: none;
        }
      }
      .ctc__group[data-expanded='true'] .ctc__group-chevron {
        transform: rotate(90deg);
      }
      .ctc__group-body {
        padding: 0 12px 8px;
      }
    `,
  ],
  template: `
    @for (group of groups(); track group.key) { @if (group.subagent) {
    <chat-subagent-card [subagent]="group.subagent" [toolLabel]="toolLabel()" />
    } @else if (!group.templateRef) {
    <!-- Default grouped strip -->
    @let grouped = grouping() !== 'none' && (group.calls.length > 1 || groupRelated());
    @let summary = summaryFor(group.name, group.calls);
    @let expanded = !grouped ||
    expandedGroups().has(group.key);
    <div
      class="ctc__group"
      [class.ctc__group--single]="!grouped"
      [attr.data-group]="grouped ? true : null"
      [attr.data-expanded]="expanded"
    >
      <div class="ctc__group-bar" [hidden]="!grouped">
        <button
          type="button"
          [hidden]="!grouped"
          class="ctc__group-header"
          [attr.aria-expanded]="expanded"
          [attr.aria-controls]="expanded ? groupBodyId($index) : null"
          (click)="toggleGroup(group.key)"
        >
          <svg
            class="ctc__group-chevron"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 2l4 4-4 4" />
          </svg>
          <span
            class="tp-tool-activity__label"
            [attr.data-active]="summary.active && !expanded"
            >{{ summary.active && expanded && !groupSummary() ? working(group.calls) : summary.label }}</span
          >
          @if (summary.cue) {<span class="tp-tool-activity__cue">{{
            summary.cue
          }}</span
          >}
        </button>
        @if (grouped && summary.active) {
        <span class="ctc__group-elapsed">{{ elapsedFor(group.key) }}</span>
        @if (agent().isLoading()) {
        <button type="button" class="ctc__group-stop" (click)="stop()">Stop</button>
        } }
      </div>
      <div
        class="ctc__group-body"
        [hidden]="!expanded"
        [id]="groupBodyId($index)"
        (focusin)="keepGroupOpen(group.key)"
      >
        @for (tc of group.calls; track tc.id) {
        <chat-tool-activity [activity]="activityFor(tc, !grouped)" [grouped]="grouped" [retrying]="grouped ? undefined : retryingFor([tc])" (toolRetry)="toolRetry.emit($event)">
          @if (grouped && expanded) {
          <!-- Sources sit under the call that produced them while the group is open. -->
          <chat-tool-outcomes [activities]="[activityFor(tc)]" show="sources" />
          }
          @if (!grouped) { @let resultTemplate = resultTemplateFor(tc.name); @if (resultTemplate) {
          <ng-container
            [ngTemplateOutlet]="resultTemplate"
            [ngTemplateOutletContext]="{ $implicit: activityFor(tc) }"
          />
          } }
        </chat-tool-activity>
        }
      </div>
    </div>
      @if (grouped) {
      <p class="tp-tool-activity__status" role="status" aria-live="polite" aria-atomic="true">{{ summary.status }}{{ receiptStatusFor(group.calls) }}</p>
      <chat-tool-outcomes [activities]="activitiesFor(group.calls)" [show]="expanded ? 'outcomes' : 'all'" />
      @if (summary.phase === 'error') {
      <!-- Ungrouped rows already show their own alert; only a group adds one. -->
      <div chatStatusPanel tone="danger" role="alert" class="tp-tool-activity__error">
        @if (retryingFor(group.calls); as retryingLine) {
        <p class="tp-tool-activity__label tp-tool-activity__retrying" data-active="true">{{ retryingLine }}</p>
        }
        @for (failure of failuresFor(group.calls); track failure.key) {
        <p>{{ failure.text }}</p>
        @if (failure.retry; as retry) {
        <button type="button" class="tp-tool-activity__retry" (click)="toolRetry.emit(retry.activity)">{{ retry.label }}</button>
        } } @empty {
        <p>Some tools could not finish. Check Details before retrying.</p>
        }
      </div>
      }
      <chat-tool-receipts [activities]="activitiesFor(group.calls)" />
      @let results = resultsFor(group.calls);
      @if (results.length) {
      <div class="tp-tool-activity__results">
        @for (result of results; track result.activity.id) {
        <div [attr.data-tool-id]="result.activity.id">
          <ng-container
            [ngTemplateOutlet]="result.template"
            [ngTemplateOutletContext]="{ $implicit: result.activity }"
          />
        </div>
        }
      </div>
      }
      }
    } @else if (group.templateRef) { @for (tc of group.calls; track tc.id) {
    <ng-container
      [ngTemplateOutlet]="group.templateRef.templateRef"
      [ngTemplateOutletContext]="{ $implicit: tc, status: tc.status }"
    />
    } } }
  `,
})
export class ChatToolCallsComponent {
  readonly agent = input.required<Agent>();
  readonly message = input<Message | undefined>(undefined);
  readonly grouping = input<'auto' | 'none'>('auto');
  readonly groupSummary = input<
    ((name: string, count: number) => string) | undefined
  >(undefined);
  /** Group default tool rows across names; false retains adjacent same-name grouping. None disables all grouping. */
  readonly groupRelated = input(true);
  /** App-owned readable labels. Receives the call's arguments so repeated calls to one tool can say what each did, such as "Read toSorted". Technical names remain in Details. */
  readonly toolLabel = input<
    ((name: string, args?: unknown) => string | undefined) | undefined
  >(undefined);
  /** App-authored confirmed result previews, or `status: 'failed'` to show a completed call as failed; custom tool templates keep ownership. */
  readonly toolOutcome = input<((activity: ToolActivityInfo) => ToolActivityOutcome | undefined) | undefined>(undefined);
  /**
   * Emits the failed activity when a retry declared by `toolOutcome` is activated. The control is offered only while the
   * agent is idle and no later call repeats the same tool and arguments. The application owns what a retry does.
   */
  readonly toolRetry = output<ToolActivityInfo>();

  /**
   * Per-tool-name + wildcard result templates supplied by a parent composition,
   * for the same reason as `toolCallTemplates`. Content children win by name.
   */
  readonly toolResultTemplates = input<readonly ChatToolResultTemplateDirective[]>([]);

  /** App-owned per-call result or action templates registered as content children. */
  readonly resultTemplates = contentChildren(ChatToolResultTemplateDirective);

  /**
   * Tool names whose groups should be hidden. Used by chat compositions
   * to filter out internal/orchestration tools (e.g. GenUI dispatchers)
   * whose args streaming is not meaningful to surface in the chat.
   * Default empty — preserves prior behavior for non-filtering consumers.
   */
  readonly excludeToolNames = input<readonly string[]>([]);

  /**
   * Per-tool-name + wildcard templates supplied by a parent composition.
   * Compositions that forward templates projected into themselves (such as
   * `<chat>`) pass them here, because a content query cannot see templates
   * re-projected through another component. Templates registered as content
   * children of this component take precedence for the same tool name.
   */
  readonly toolCallTemplates = input<readonly ChatToolCallTemplateDirective[]>(
    []
  );

  /** Per-tool-name + wildcard templates registered as content children. */
  readonly templates = contentChildren(ChatToolCallTemplateDirective);

  private readonly templateRegistry = computed(() => {
    const map = new Map<string, ChatToolCallTemplateDirective>();
    for (const t of this.toolCallTemplates()) {
      map.set(t.name(), t);
    }
    for (const t of this.templates()) {
      map.set(t.name(), t);
    }
    return map;
  });

  private readonly resultRegistry = computed(() => {
    const map = new Map<string, ChatToolResultTemplateDirective>();
    for (const t of this.toolResultTemplates()) map.set(t.name(), t);
    for (const t of this.resultTemplates()) map.set(t.name(), t);
    return map;
  });

  readonly toolCalls = computed((): ToolCall[] =>
    resolveMessageToolCalls(this.agent(), this.message())
  );

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private previousGroups: Group[] = [];
  private nextGroupKey = 0;

  readonly groups = computed((): Group[] => {
    const scopedCalls = this.toolCalls();
    if (scopedCalls.length === 0) { this.previousGroups = []; return []; }
    const excludeSet = new Set(this.excludeToolNames());
    const calls = scopedCalls.filter((tc) => !excludeSet.has(tc.name));
    // Anchor subagents by the contract field `Subagent.toolCallId` (the tool
    // call that spawned them), NOT by the adapter's map key. Adapters key the
    // map differently — LangGraph by toolCallId, AG-UI activities by
    // messageId, AG-UI native SUBAGENT_* by subagentRunId (e.g.
    // `<toolCallId>-sub`) — and only the wrapper's toolCallId is guaranteed
    // to match the spawning call.
    const rawSubs = this.agent().subagents?.() ?? new Map<string, Subagent>();
    const subs = new Map<string, Subagent>();
    rawSubs.forEach((sa) => subs.set(sa.toolCallId, sa));
    const groupingMode = this.grouping();
    const registry = this.templateRegistry();
    const wildcard = registry.get('*');
    const out: Group[] = [];
    for (const tc of calls) {
      // A tool call that spawned a subagent renders as a standalone subagent
      // card anchored to that call. It never groups with adjacent calls, on
      // either side: it is its own group and carries a `subagent`, so the next
      // call can't append to it (a subagent group is never a group target).
      if (subs.has(tc.id)) {
        out.push({ key: '', name: tc.name, calls: [tc], subagent: subs.get(tc.id) });
        continue;
      }
      const tpl = registry.get(tc.name) ?? wildcard;
      const last = out[out.length - 1];
      const sameName = last && !last.subagent && last.name === tc.name;
      const canGroup =
        groupingMode === 'auto' &&
        !tpl &&
        !last?.templateRef &&
        !last?.subagent &&
        last &&
        (sameName || this.groupRelated());
      if (canGroup) {
        last.calls.push(tc);
        if (!last.templateRef && tpl) last.templateRef = tpl;
      } else {
        out.push({ key: '', name: tc.name, calls: [tc], templateRef: tpl });
      }
    }
    // Reconcile presentation identity by member overlap, rather than the first
    // position. Reordering a batch or appending its second call keeps its DOM.
    const used = new Set<string>();
    for (const group of out) {
      const ids = new Set(group.calls.map(call => call.id));
      let best: Group | undefined, score = 0;
      for (const previous of this.previousGroups) {
        const overlap = previous.calls.filter(call => ids.has(call.id)).length;
        if (!used.has(previous.key) && overlap > score) { best = previous; score = overlap; }
      }
      group.key = best?.key ?? `activity-group-${this.nextGroupKey++}`;
      used.add(group.key);
    }
    const reordered = out.some(group => {
      const previous = this.previousGroups.find(old => old.key === group.key);
      return previous && previous.calls.map(call => call.id).join('\0') !== group.calls.map(call => call.id).join('\0');
    });
    if (reordered) {
      const host = this.host.nativeElement, document = host.ownerDocument;
      const focused = document?.activeElement as HTMLElement | null;
      if (focused && host.contains(focused)) afterNextRender(() => {
        // DOM moves can drop focus. Restore only this same connected control,
        // and only if nobody else took focus in the meantime.
        if (focused.isConnected && document.activeElement === document.body) focused.focus({ preventScroll: true });
      }, { injector: this.injector });
    }
    this.previousGroups = out;
    return out;
  });

  private readonly _expandedGroups = signal(new Set<string>());
  readonly expandedGroups = this._expandedGroups.asReadonly();

  toggleGroup(index: string): void {
    this._expandedGroups.update((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }
  protected keepGroupOpen(id: string): void {
    if (!this._expandedGroups().has(id))
      this._expandedGroups.update((previous) => new Set([...previous, id]));
  }

  private readonly instanceId = nextChatToolCallsId++;

  protected groupBodyId(index: number): string {
    return `chat-tool-calls-${this.instanceId}-group-${index}`;
  }

  protected working(calls: readonly ToolCall[]): string {
    return workingLabel(this.activitiesFor(calls));
  }

  /** Stops the run from the activity group; the same action as the composer's Stop. */
  protected stop(): void {
    void this.agent().stop();
  }

  /** Client-observed start of each group's running stretch, and a clock that ticks only while one runs. */
  private readonly runStarts = new Map<string, number>();
  private readonly now = signal(Date.now());
  private readonly activeGroupKeys = computed(() =>
    this.groups()
      .filter((group) => !group.templateRef && !group.subagent)
      .filter((group) => this.activitiesFor(group.calls).some((item) => item.phase === 'running'))
      .map((group) => group.key)
  );
  constructor() {
    let timer: ReturnType<typeof setInterval> | undefined;
    const clear = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    inject(DestroyRef).onDestroy(clear);
    effect(() => {
      const active = this.activeGroupKeys();
      const now = Date.now();
      for (const key of [...this.runStarts.keys()])
        if (!active.includes(key)) this.runStarts.delete(key);
      for (const key of active) if (!this.runStarts.has(key)) this.runStarts.set(key, now);
      this.now.set(now);
      if (active.length && timer === undefined)
        timer = setInterval(() => this.now.set(Date.now()), 1000);
      else if (!active.length) clear();
    });
  }

  protected elapsedFor(key: string): string {
    const now = this.now();
    return formatElapsed(now - (this.runStarts.get(key) ?? now));
  }

  protected summaryFor(name: string, calls: readonly ToolCall[]) {
    return activitySummary(
      this.activitiesFor(calls),
      this.groupSummary()?.(name, calls.length)
    );
  }

  protected toToolCallInfo(tc: ToolCall): ToolCallInfo {
    return {
      id: tc.id,
      name: tc.name,
      args: tc.args,
      result: tc.result,
      status: tc.status,
      error: tc.error,
    };
  }
  /** Each call with the app's outcome applied, before a stale retry is withdrawn. */
  private readonly resolvedActivities = computed(() => new Map(
    this.groups().filter(group => !group.templateRef && !group.subagent)
      .flatMap(group => group.calls.map(call => [call.id, this.resolveActivity(call)] as const))
  ));
  private resolvedFor(tc: ToolCall): ToolActivityInfo {
    return this.resolvedActivities().get(tc.id) ?? this.resolveActivity(tc);
  }
  protected activityFor(tc: ToolCall, withOutcome = true): ToolActivityInfo {
    const resolved = this.resolvedFor(tc);
    // Read agent-wide state only for a call that declares a retry, so ordinary rows stay isolated from later activity.
    const declaresRetry = resolved.outcome?.status === 'failed' && !!resolved.outcome.retry;
    const activity = declaresRetry && this.staleRetryIds().has(tc.id) ? withoutStaleRetry(resolved, NONE) : resolved;
    return withOutcome ? activity : { ...activity, outcome: undefined };
  }
  /** The call with the app's outcome applied, before a stale retry is withdrawn. */
  private resolveActivity(tc: ToolCall): ToolActivityInfo {
    const delivery = this.message()?.delivery;
    const phase = toolActivityPhase(tc.status, delivery);
    const literal = (value: unknown): string => {
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value, null, 2) ?? '';
      } catch {
        return String(value);
      }
    };
    const activity: ToolActivityInfo = {
      id: tc.id,
      name: tc.name,
      label: this.toolLabel()?.(tc.name, tc.args),
      phase,
      argumentsText: literal(tc.args),
      resultText: tc.status === 'complete' ? literal(tc.result) : undefined,
      errorText: tc.error === undefined ? undefined : literal(tc.error),
    };
    return resolveToolOutcome(activity, this.safeOutcome(activity));
  }
  /** Calls whose declared retry is no longer offered: all while the agent works, else those a later call repeats. */
  private readonly staleRetryIds = computed((): ReadonlySet<string> => {
    const agent = this.agent();
    const all = agent.toolCalls();
    if (agent.isLoading()) return new Set(all.map((call) => call.id));
    const last = new Map<string, string>();
    for (const call of all) last.set(repeatKey(call), call.id);
    return new Set(all.filter((call) => last.get(repeatKey(call)) !== call.id).map((call) => call.id));
  });
  /**
   * "Retrying toSorted read" while a later call repeats a failed call that declared a retry and has not
   * finished yet. Reads agent-wide calls only for a group holding such a failure.
   */
  protected retryingFor(calls: readonly ToolCall[]): string | undefined {
    const declared = calls.flatMap((call) => {
      // The retry is withdrawn while the agent works, which is when it runs: read the declaration itself.
      const outcome = this.resolvedFor(call).outcome;
      return outcome?.status === 'failed' && outcome.retry ? [{ call, label: outcome.retry.label }] : [];
    });
    if (declared.length === 0) return undefined;
    const all = this.agent().toolCalls();
    for (const { call, label } of declared) {
      const key = repeatKey(call);
      const after = all.slice(all.findIndex((c) => c.id === call.id) + 1);
      if (after.some((c) => repeatKey(c) === key && (c.status === 'pending' || c.status === 'running'))) return retryingText(label);
    }
    return undefined;
  }
  /** A throwing app hook must not break the transcript; the call keeps its core phase. */
  private safeOutcome(activity: ToolActivityInfo): ToolActivityOutcome | undefined {
    try {
      return this.toolOutcome()?.(activity);
    } catch (error) {
      if (isDevMode()) {
        console.error('toolOutcome threw; the tool call keeps its core phase.', error);
      }
      return undefined;
    }
  }
  protected resultTemplateFor(name: string): TemplateRef<ChatToolResultTemplateContext> | undefined {
    const registry = this.resultRegistry();
    return (registry.get(name) ?? registry.get('*'))?.templateRef;
  }
  protected resultsFor(calls: readonly ToolCall[]): readonly { activity: ToolActivityInfo; template: TemplateRef<ChatToolResultTemplateContext> }[] {
    return calls.flatMap((call) => {
      const template = this.resultTemplateFor(call.name);
      return template ? [{ activity: this.activityFor(call), template }] : [];
    });
  }
  protected failuresFor(calls: readonly ToolCall[]): readonly ToolActivityFailure[] {
    return activityFailures(this.activitiesFor(calls));
  }
  protected receiptStatusFor(calls: readonly ToolCall[]): string {
    return receiptOutcomes(this.activitiesFor(calls)).map((receipt) => ` ${receipt.lead} ${receipt.text}`).join('');
  }
  protected activitiesFor(calls: readonly ToolCall[]): readonly ToolActivityInfo[] { return calls.map((call) => this.activityFor(call)); }
}
