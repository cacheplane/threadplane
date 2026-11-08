// libs/chat/src/lib/primitives/chat-tool-calls/chat-tool-calls.component.ts
import {
  Component,
  ChangeDetectionStrategy,
  computed,
  contentChildren,
  input,
  signal,
  inject,
  ElementRef,
  Injector,
  afterNextRender,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { Agent, Message, ToolCall, Subagent } from '../../agent';
import type { ToolCallInfo } from '../../compositions/chat-tool-call-card/chat-tool-call-card.component';
import { ChatSubagentCardComponent } from '../../compositions/chat-subagent-card/chat-subagent-card.component';
import { ChatToolCallTemplateDirective } from './chat-tool-call-template.directive';
import { summarizeGroup as defaultSummarizeGroup } from './group-summary';
import { resolveMessageToolCalls } from './resolve-message-tool-calls';
import {
  ChatToolActivityComponent,
  toolActivityPhase,
  type ToolActivityInfo,
} from '../chat-tool-activity/chat-tool-activity.component';

interface Group {
  key: string;
  name: string;
  calls: ToolCall[];
  templateRef?: ChatToolCallTemplateDirective;
  /** Present when this group anchors a subagent spawned by its (single) task call. */
  subagent?: Subagent;
}

// Unique per instance, so each group body id is unique on the page.
let nextChatToolCallsId = 0;

/** Renders tool calls with optional grouping, custom templates, and cards for spawned subagents. */
@Component({
  selector: 'chat-tool-calls',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    ChatToolActivityComponent,
    ChatSubagentCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
        margin-bottom: 20px;
      }
      .ctc__group {
        border: 1px solid var(--tplane-chat-separator);
        border-radius: var(--tplane-chat-radius-card);
        margin: 0 0 4px;
      }
      .ctc__group-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        min-height: 24px;
        padding: 8px 12px;
        background: transparent;
        border: 0;
        font: inherit;
        color: var(--tplane-chat-text);
        cursor: pointer;
        text-align: left;
      }
      .ctc__group-header:focus-visible {
        outline: 2px solid var(--tplane-chat-primary);
        outline-offset: 2px;
        border-radius: var(--tplane-chat-radius-card);
      }
      .ctc__group-chevron {
        width: 10px;
        height: 10px;
        transition: transform 120ms ease;
      }
      .ctc__group-status {
        margin-inline-start: auto;
        font-size: 12px;
        color: var(--tplane-chat-text-muted);
      }
      .ctc__group-body[hidden] {
        display: none;
      }
      .ctc__group-header[hidden] {
        display: none;
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
        border-top: 1px solid var(--tplane-chat-separator);
      }
    `,
  ],
  template: `
    @for (group of groups(); track group.key) { @if (group.subagent) {
    <chat-subagent-card [subagent]="group.subagent" />
    } @else if (!group.templateRef) {
    <!-- Default grouped strip -->
    @let expanded = group.calls.length === 1 ||
    expandedGroups().has(group.key);
    <div
      class="ctc__group"
      [class.ctc__group--single]="group.calls.length === 1"
      [attr.data-group]="group.calls.length > 1 ? true : null"
      [attr.data-expanded]="expanded"
    >
      <button
        type="button"
        [hidden]="group.calls.length === 1"
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
        <span>{{ summarize(group.name, group.calls.length) }}</span>
        <span class="ctc__group-status">{{ groupStatus(group.calls) }}</span>
      </button>
      <div
        class="ctc__group-body"
        [hidden]="!expanded"
        [id]="groupBodyId($index)"
        (focusin)="keepGroupOpen(group.key)"
      >
        @for (tc of group.calls; track tc.id) {
        <chat-tool-activity [activity]="activityFor(tc)" />
        }
      </div>
      @if (groupStatus(group.calls) === 'Failed') {
      <p role="alert">
        Some tools could not finish. Check Details before retrying.
      </p>
      }
    </div>
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
  /** Opt in to grouping related default tool rows across names; none still disables grouping. */
  readonly groupRelated = input(false);
  /** App-owned readable labels. Technical names remain in Details. */
  readonly toolLabel = input<
    ((name: string) => string | undefined) | undefined
  >(undefined);

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

  protected summarize(name: string, count: number): string {
    return (this.groupSummary() ?? defaultSummarizeGroup)(name, count);
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
  protected activityFor(tc: ToolCall): ToolActivityInfo {
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
    return {
      id: tc.id,
      name: tc.name,
      label: this.toolLabel()?.(tc.name),
      phase,
      argumentsText: literal(tc.args),
      resultText: tc.status === 'complete' ? literal(tc.result) : undefined,
      errorText: tc.error === undefined ? undefined : literal(tc.error),
    };
  }
  protected groupStatus(calls: readonly ToolCall[]): string {
    const phases = calls.map((call) => this.activityFor(call).phase);
    return phases.includes('error')
      ? 'Failed'
      : phases.includes('running')
      ? 'Running'
      : phases.includes('waiting')
      ? 'Waiting'
      : phases.includes('stopped')
      ? 'Stopped'
      : phases.includes('pending')
      ? 'Pending'
      : phases.every((phase) => phase === 'complete')
      ? 'Complete'
      : 'Status unavailable';
  }
}
