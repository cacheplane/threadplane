// libs/chat/src/lib/primitives/chat-tool-calls/chat-tool-calls.component.ts
import {
  Component, ChangeDetectionStrategy,
  computed, contentChildren, input, signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { Agent, Message, ToolCall, Subagent } from '../../agent';
import { ChatToolCallCardComponent, type ToolCallInfo } from '../../compositions/chat-tool-call-card/chat-tool-call-card.component';
import { ChatSubagentCardComponent } from '../../compositions/chat-subagent-card/chat-subagent-card.component';
import { ChatToolCallTemplateDirective } from './chat-tool-call-template.directive';
import { summarizeGroup as defaultSummarizeGroup } from './group-summary';
import { resolveMessageToolCalls } from './resolve-message-tool-calls';

interface Group {
  name: string;
  calls: ToolCall[];
  templateRef?: ChatToolCallTemplateDirective;
  /** Present when this group anchors a subagent spawned by its (single) task call. */
  subagent?: Subagent;
}

// Unique per instance, so each group body id is unique on the page.
let nextChatToolCallsId = 0;

@Component({
  selector: 'chat-tool-calls',
  standalone: true,
  imports: [NgTemplateOutlet, ChatToolCallCardComponent, ChatSubagentCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; margin-bottom: 20px; }
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
      width: 10px; height: 10px;
      transition: transform 120ms ease;
    }
    .ctc__group[data-expanded="true"] .ctc__group-chevron { transform: rotate(90deg); }
    .ctc__group-body {
      padding: 0 12px 8px;
      border-top: 1px solid var(--tplane-chat-separator);
    }
  `],
  template: `
    @for (group of groups(); track $index) {
      @if (group.subagent) {
        <chat-subagent-card [subagent]="group.subagent" />
      } @else if (group.calls.length > 1 && !group.templateRef) {
        <!-- Default grouped strip -->
        @let expanded = expandedGroups().has($index);
        <div class="ctc__group" [attr.data-group]="true" [attr.data-expanded]="expanded">
          <button
            type="button"
            class="ctc__group-header"
            [attr.aria-expanded]="expanded"
            [attr.aria-controls]="expanded ? groupBodyId($index) : null"
            (click)="toggleGroup($index)"
          >
            <svg class="ctc__group-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 2l4 4-4 4"/>
            </svg>
            <span>{{ summarize(group.name, group.calls.length) }}</span>
          </button>
          @if (expanded) {
            <div class="ctc__group-body" [id]="groupBodyId($index)">
              @for (tc of group.calls; track tc.id) {
                <chat-tool-call-card [toolCall]="toToolCallInfo(tc)" />
              }
            </div>
          }
        </div>
      } @else if (group.templateRef) {
        @for (tc of group.calls; track tc.id) {
          <ng-container
            [ngTemplateOutlet]="group.templateRef.templateRef"
            [ngTemplateOutletContext]="{ $implicit: tc, status: tc.status }"
          />
        }
      } @else {
        @for (tc of group.calls; track tc.id) {
          <chat-tool-call-card [toolCall]="toToolCallInfo(tc)" />
        }
      }
    }
  `,
})
export class ChatToolCallsComponent {
  readonly agent = input.required<Agent>();
  readonly message = input<Message | undefined>(undefined);
  readonly grouping = input<'auto' | 'none'>('auto');
  readonly groupSummary = input<((name: string, count: number) => string) | undefined>(undefined);

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
  readonly toolCallTemplates = input<readonly ChatToolCallTemplateDirective[]>([]);

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
    resolveMessageToolCalls(this.agent(), this.message()),
  );

  readonly groups = computed((): Group[] => {
    const excludeSet = new Set(this.excludeToolNames());
    const calls = this.toolCalls().filter(tc => !excludeSet.has(tc.name));
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
        out.push({ name: tc.name, calls: [tc], subagent: subs.get(tc.id) });
        continue;
      }
      const tpl = registry.get(tc.name) ?? wildcard;
      const last = out[out.length - 1];
      const sameName = last && !last.subagent && last.name === tc.name;
      const canGroup = groupingMode === 'auto' && sameName;
      if (canGroup) {
        last.calls.push(tc);
        if (!last.templateRef && tpl) last.templateRef = tpl;
      } else {
        out.push({ name: tc.name, calls: [tc], templateRef: tpl });
      }
    }
    return out;
  });

  private readonly _expandedGroups = signal(new Set<number>());
  readonly expandedGroups = this._expandedGroups.asReadonly();

  toggleGroup(index: number): void {
    this._expandedGroups.update((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }

  private readonly instanceId = nextChatToolCallsId++;

  protected groupBodyId(index: number): string {
    return `chat-tool-calls-${this.instanceId}-group-${index}`;
  }

  protected summarize(name: string, count: number): string {
    return (this.groupSummary() ?? defaultSummarizeGroup)(name, count);
  }

  protected toToolCallInfo(tc: ToolCall): ToolCallInfo {
    return { id: tc.id, name: tc.name, args: tc.args, result: tc.result, status: tc.status };
  }
}
