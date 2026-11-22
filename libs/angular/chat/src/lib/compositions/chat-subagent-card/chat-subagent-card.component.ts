// libs/angular/chat/src/lib/compositions/chat-subagent-card/chat-subagent-card.component.ts
import { Component, ChangeDetectionStrategy, DestroyRef, input, computed, effect, inject } from '@angular/core';
import { ChatTraceComponent, type TraceState } from '../../primitives/chat-trace/chat-trace.component';
import { ChatToolCallCardComponent, type ToolCallInfo } from '../chat-tool-call-card/chat-tool-call-card.component';
import {
  ChatStreamingMdComponent,
  markdownDocument,
  type StreamingMarkdownDocument,
} from '../../streaming/streaming-markdown.component';
import { ɵCHAT_HOST_TOKENS as CHAT_HOST_TOKENS } from '@threadplane/angular/chat/shared';
import { toolCallResult, type AgentSubagent, type AgentSubagentStatus, type Message, type ToolCall } from '../../agent';
import type { ToolActivityInfo } from '../../primitives/chat-tool-activity/chat-tool-activity.component';
import { outcomeSources, type ToolActivityOutcome, type ToolActivitySource } from '../../primitives/chat-tool-activity/tool-outcome';
import { CitationsResolverService } from '@threadplane/angular/chat/shared';
import { injectChatRuntime } from '../../styles/chat-runtime';

/**
 * Returns a CSS style string for a subagent's status badge.
 * Kept exported for backward compatibility with existing consumers; the
 * preferred way to style status visually is via the `data-status` attribute
 * + CSS selectors (see component styles below).
 */
export function statusColor(status: AgentSubagentStatus): string {
  switch (status) {
    case 'pending':  return 'background: var(--tplane-chat-surface-alt); color: var(--tplane-chat-text-muted);';
    case 'running':  return 'background: var(--tplane-chat-warning-bg); color: var(--tplane-chat-warning-text);';
    case 'complete': return 'color: var(--tplane-chat-success-text);';
    case 'error':    return 'background: var(--tplane-chat-error-bg); color: var(--tplane-chat-error-text);';
    // Started, with no ending seen and no run that could still report one.
    case 'unknown':  return 'background: var(--tplane-chat-surface-alt); color: var(--tplane-chat-text-muted);';
  }
}

const STATUS_LABELS: Record<AgentSubagentStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  complete: 'Complete',
  error: 'Failed',
  unknown: 'Status unavailable',
};

function statusToTraceState(s: AgentSubagentStatus): TraceState {
  switch (s) {
    case 'pending':  return 'pending';
    case 'running':  return 'running';
    case 'complete': return 'done';
    case 'error':    return 'error';
    // No longer working, and not known to have failed.
    case 'unknown':  return 'done';
  }
}

/** Displays a subagent’s status, reasoning, markdown messages, and message-scoped tool calls in a collapsible trace. */
@Component({
  selector: 'chat-subagent-card',
  standalone: true,
  imports: [ChatTraceComponent, ChatToolCallCardComponent, ChatStreamingMdComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, `
    :host { display: block; }
    .sac__name { color: var(--tplane-chat-text); font-weight: 500; font-size: var(--tplane-chat-font-size-sm); }
    .sac__pill {
      padding: 1px 8px;
      border-radius: var(--tplane-chat-radius-launcher);
      font-size: var(--tplane-chat-font-size-xs);
      font-weight: 500;
    }
    .sac__pill[data-status="unknown"],
    .sac__pill[data-status="pending"] { background: var(--tplane-chat-surface-alt); color: var(--tplane-chat-text-muted); }
    .sac__pill[data-status="running"] { background: var(--tplane-chat-warning-bg); color: var(--tplane-chat-warning-text); }
    .sac__pill[data-status="complete"] { color: var(--tplane-chat-success-text); }
    .sac__pill[data-status="error"] { background: var(--tplane-chat-error-bg); color: var(--tplane-chat-error-text); }
    @media (forced-colors: active) {
      .sac__pill[data-status] { border: 1px solid CanvasText; background: Canvas; color: CanvasText; }
    }
    .sac__count { font-size: var(--tplane-chat-font-size-xs); color: var(--tplane-chat-text-muted); }
    .sac__msg { padding: 6px 0; }
    .sac__msg + .sac__msg { border-top: 1px solid var(--tplane-chat-separator); }
    .sac__reasoning {
      font-size: var(--tplane-chat-font-size-xs);
      color: var(--tplane-chat-text-muted);
      font-style: italic;
      margin-bottom: 4px;
    }
  `],
  template: `
    <chat-trace [state]="state()">
      <span traceLabel>
        <!-- The space keeps a screen reader from running the name and status together. -->
        <span class="sac__name">{{ subagent().name ?? 'Subagent' }}</span>&ngsp;<span class="sac__pill" [attr.data-status]="subagent().status">{{ statusLabel() }}</span>
      </span>
      <div class="sac__count" traceMeta>{{ messageCount() }}</div>
      @for (m of subagent().messages; track m.id) {
        <div class="sac__msg" [attr.data-role]="m.role">
          @if (m.reasoning) {
            <div class="sac__reasoning">{{ m.reasoning }}</div>
          }
          @if (textOf(m); as t) {
            <chat-streaming-md [document]="markdownDocumentFor(t, m)" />
          }
          @for (tc of toolCallsFor(m); track tc.id) {
            <chat-tool-call-card [toolCall]="toToolCallInfo(tc)" />
          }
        </div>
      }
    </chat-trace>
  `,
})
export class ChatSubagentCardComponent {
  protected readonly chatRuntime = injectChatRuntime();
  readonly subagent = input.required<AgentSubagent>();
  /** App-owned readable labels for the subagent's own tool calls. Technical names stay inside each opened call. */
  readonly toolLabel = input<((name: string) => string | undefined) | undefined>(undefined);
  /**
   * App-authored outcomes for the subagent's own completed calls, the same callback `<chat>` takes.
   * Sources an outcome declares are listed in the Sources panel of the message that started the subagent.
   */
  readonly toolOutcome = input<((activity: ToolActivityInfo) => ToolActivityOutcome | undefined) | undefined>(undefined);
  /** The status in reader's words; `data-status` keeps the raw value for styling. */
  protected readonly statusLabel = computed(() => STATUS_LABELS[this.subagent().status]);
  readonly state = computed<TraceState>(() => statusToTraceState(this.subagent().status));
  /** Sources declared for the subagent's completed calls; empty without `toolOutcome`. */
  private readonly sources = computed<readonly ToolActivitySource[]>(() => {
    const decode = this.toolOutcome();
    if (!decode) return [];
    const literal = (value: unknown): string => {
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value, null, 2) ?? '';
      } catch {
        return String(value);
      }
    };
    return outcomeSources(
      this.subagent().toolCalls.flatMap((tc) => {
        if (tc.status !== 'complete') return [];
        const activity: ToolActivityInfo = {
          id: tc.id,
          name: tc.name,
          label: this.toolLabel()?.(tc.name),
          phase: 'complete',
          argumentsText: literal(tc.args),
          resultText: literal(tc.result),
        };
        try {
          return [{ ...activity, outcome: decode(activity) }];
        } catch {
          // A throwing app hook must not break the card.
          return [];
        }
      }),
    );
  });
  /** "1 message" / "3 messages". The spawning call's ID is not shown: it means nothing to a reader. */
  protected readonly messageCount = computed(() => {
    const count = this.subagent().messages.length;
    return `${count} ${count === 1 ? 'message' : 'messages'}`;
  });
  private readonly markdownDocuments = new Map<string, StreamingMarkdownDocument>();

  constructor() {
    // Inside a message, what the subagent read joins that message's Sources panel.
    const resolver = inject(CitationsResolverService, { optional: true });
    if (resolver) {
      effect(() => resolver.setToolSources(this, this.sources()));
      inject(DestroyRef).onDestroy(() => resolver.setToolSources(this, []));
    }
    effect(() => {
      let liveIds: Set<string>;
      try {
        liveIds = new Set(this.subagent().messages.map((message) => message.id));
      } catch {
        return;
      }
      for (const id of [...this.markdownDocuments.keys()]) {
        if (!liveIds.has(id)) this.markdownDocuments.delete(id);
      }
    });
  }

  protected markdownDocumentFor(
    content: string,
    message: Message,
  ): StreamingMarkdownDocument {
    const prior = this.markdownDocuments.get(message.id);
    const delivery = message.delivery;
    if (
      prior?.generation === delivery.generation &&
      prior.phase === delivery.phase &&
      prior.content === content
    ) {
      return prior;
    }
    const document = markdownDocument(content, delivery);
    this.markdownDocuments.set(message.id, document);
    return document;
  }

  protected textOf(m: Message): string {
    return m.content;
  }

  protected toolCallsFor(m: Message): ToolCall[] {
    const ids = m.toolCallIds ?? [];
    if (ids.length === 0) return [];
    const all = this.subagent().toolCalls;
    return ids.map((id) => all.find((tc) => tc.id === id)).filter((tc): tc is ToolCall => !!tc);
  }

  protected toToolCallInfo(tc: ToolCall): ToolCallInfo {
    return {
      id: tc.id,
      name: tc.name,
      label: this.toolLabel()?.(tc.name),
      args: tc.args,
      result: toolCallResult(tc),
      status: tc.status,
    };
  }
}
