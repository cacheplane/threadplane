import {
  Component,
  ChangeDetectionStrategy,
  forwardRef,
  input,
} from '@angular/core';
import { KeyValuePipe, NgTemplateOutlet } from '@angular/common';
import { ChatMessageListComponent } from '../../primitives/chat-message-list/chat-message-list.component';
import { ChatMessageComponent } from '../../primitives/chat-message/chat-message.component';
import { ChatReasoningComponent } from '../../primitives/chat-reasoning/chat-reasoning.component';
import { ChatToolCallsComponent } from '../../primitives/chat-tool-calls/chat-tool-calls.component';
import { ChatToolViewsComponent } from '../../primitives/chat-tool-views/chat-tool-views.component';
import { ChatStreamingMdComponent } from '../../streaming/streaming-markdown.component';
import { ChatGenerativeUiComponent } from '../../primitives/chat-generative-ui/chat-generative-ui.component';
import { ChatMessageActionsComponent } from '../../primitives/chat-message-actions/chat-message-actions.component';
import { A2uiSurfaceComponent } from '../../a2ui/surface.component';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_MESSAGE_LIST_STYLES } from '../../styles/chat-message-list.styles';
import type { ChatComponent } from './chat.component';

/** Internal live callbacks; no message or configuration snapshots. */
export interface ChatDefaultRowsRenderer {
  readonly activityContextFor: (
    ...args: Parameters<ChatComponent['activityContextFor']>
  ) => ReturnType<ChatComponent['activityContextFor']>;
  readonly activityTemplate: (
    ...args: Parameters<ChatComponent['activityTemplate']>
  ) => ReturnType<ChatComponent['activityTemplate']>;
  readonly agent: (
    ...args: Parameters<ChatComponent['agent']>
  ) => ReturnType<ChatComponent['agent']>;
  readonly classifyMessage: (
    ...args: Parameters<ChatComponent['classifyMessage']>
  ) => ReturnType<ChatComponent['classifyMessage']>;
  readonly effectiveViews: (
    ...args: Parameters<ChatComponent['effectiveViews']>
  ) => ReturnType<ChatComponent['effectiveViews']>;
  readonly excludedToolNames: (
    ...args: Parameters<ChatComponent['excludedToolNames']>
  ) => ReturnType<ChatComponent['excludedToolNames']>;
  readonly handlers: (
    ...args: Parameters<ChatComponent['handlers']>
  ) => ReturnType<ChatComponent['handlers']>;
  readonly humanContent: (
    ...args: Parameters<ChatComponent['humanContent']>
  ) => ReturnType<ChatComponent['humanContent']>;
  readonly markdownDocumentFor: (
    ...args: Parameters<ChatComponent['markdownDocumentFor']>
  ) => ReturnType<ChatComponent['markdownDocumentFor']>;
  readonly messageContent: (
    ...args: Parameters<ChatComponent['messageContent']>
  ) => ReturnType<ChatComponent['messageContent']>;
  readonly onA2uiAction: (
    ...args: Parameters<ChatComponent['onA2uiAction']>
  ) => ReturnType<ChatComponent['onA2uiAction']>;
  readonly onA2uiEvent: (
    ...args: Parameters<ChatComponent['onA2uiEvent']>
  ) => ReturnType<ChatComponent['onA2uiEvent']>;
  readonly onClientToolEvent: (
    ...args: Parameters<ChatComponent['onClientToolEvent']>
  ) => ReturnType<ChatComponent['onClientToolEvent']>;
  readonly onCopy: (
    ...args: Parameters<ChatComponent['onCopy']>
  ) => ReturnType<ChatComponent['onCopy']>;
  readonly onRate: (
    ...args: Parameters<ChatComponent['onRate']>
  ) => ReturnType<ChatComponent['onRate']>;
  readonly onRegenerate: (
    ...args: Parameters<ChatComponent['onRegenerate']>
  ) => ReturnType<ChatComponent['onRegenerate']>;
  readonly onSpecEvent: (
    ...args: Parameters<ChatComponent['onSpecEvent']>
  ) => ReturnType<ChatComponent['onSpecEvent']>;
  readonly previousRole: (
    ...args: Parameters<ChatComponent['previousRole']>
  ) => ReturnType<ChatComponent['previousRole']>;
  readonly reasoningRun: (
    ...args: Parameters<ChatComponent['reasoningRun']>
  ) => ReturnType<ChatComponent['reasoningRun']>;
  readonly reasoningRunStart: (
    ...args: Parameters<ChatComponent['reasoningRunStart']>
  ) => ReturnType<ChatComponent['reasoningRunStart']>;
  readonly renderRegistry: (
    ...args: Parameters<ChatComponent['renderRegistry']>
  ) => ReturnType<ChatComponent['renderRegistry']>;
  readonly resolvedStore: (
    ...args: Parameters<ChatComponent['resolvedStore']>
  ) => ReturnType<ChatComponent['resolvedStore']>;
  readonly store: (
    ...args: Parameters<ChatComponent['store']>
  ) => ReturnType<ChatComponent['store']>;
  readonly toolCallTemplates: (
    ...args: Parameters<ChatComponent['toolCallTemplates']>
  ) => ReturnType<ChatComponent['toolCallTemplates']>;
  readonly views: (
    ...args: Parameters<ChatComponent['views']>
  ) => ReturnType<ChatComponent['views']>;
}

/** Internal composition renderer: preserves the public list host and token. */
@Component({
  selector: 'chat-message-list[chatDefaultMessages]',
  standalone: true,
  imports: [
    KeyValuePipe,
    NgTemplateOutlet,
    ChatMessageComponent,
    ChatReasoningComponent,
    ChatToolCallsComponent,
    ChatToolViewsComponent,
    ChatStreamingMdComponent,
    ChatGenerativeUiComponent,
    ChatMessageActionsComponent,
    A2uiSurfaceComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: ChatMessageListComponent,
      useExisting: forwardRef(() => ChatDefaultMessageListComponent),
    },
  ],
  styles: [CHAT_HOST_TOKENS, CHAT_MESSAGE_LIST_STYLES],
  template: `
    @let rows = renderer(); @let currentAgent = agent(); @let currentMessages =
    messages(); @for (message of currentMessages; track message.id; let i =
    $index) { @switch (message.role) { @case ('user') {
    <chat-message
      [role]="'user'"
      [prevRole]="rows.previousRole(currentMessages, i)"
      >{{ rows.humanContent(message) }}</chat-message
    >
    } @case ('tool') {
    <!-- Tool messages route through chat-trace; hidden from main flow. -->
    } @case ('system') {
    <chat-message [role]="'system'">{{
      rows.messageContent(message)
    }}</chat-message>
    } @default { @let content = rows.messageContent(message); @let classified =
    rows.classifyMessage(content, message);
    <chat-message
      [role]="'assistant'"
      [message]="message"
      [prevRole]="rows.previousRole(currentMessages, i)"
      [streaming]="message.delivery.phase === 'streaming'"
      [current]="i === currentMessages.length - 1"
    >
      <!-- A projected chatActivityTemplate owns the reasoning +
                 tool-call region for this message. It renders at
                 message level (never inside a clipped trace body). -->
      @if (rows.activityTemplate(); as activity) {
      <ng-container
        [ngTemplateOutlet]="activity.templateRef"
        [ngTemplateOutletContext]="rows.activityContextFor(message, i)"
      />
      } @else {
      <!-- Reasoning is merged across a run of consecutive (tool-
                   separated) reasoning steps and rendered ONCE at the run's
                   first step as "Thought for {total} · {N} steps", so a
                   multi-step agent shows one compact pill instead of a
                   stack of "Thought for 1s" chips. Single-step turns render
                   a normal "Thought for {duration}" pill. -->
      @if (message.reasoning && rows.reasoningRunStart(i)) { @let run =
      rows.reasoningRun(i);
      <chat-reasoning
        [content]="run.content"
        [delivery]="run.delivery"
        [durationMs]="run.durationMs"
        [label]="run.label"
      />
      }
      <!-- Per-tool templates projected into <chat> are collected
                   here and handed down as an input: a content query on
                   <chat-tool-calls> cannot see templates re-projected
                   through <chat>'s own ng-content. -->
      <chat-tool-calls
        [agent]="currentAgent"
        [message]="message"
        [excludeToolNames]="rows.excludedToolNames()"
        [toolCallTemplates]="rows.toolCallTemplates()"
      />
      }
      <chat-tool-views
        [agent]="currentAgent"
        [message]="message"
        [views]="rows.effectiveViews()"
        [store]="rows.resolvedStore()"
        [handlers]="rows.handlers()"
        (events)="rows.onClientToolEvent($event)"
      />
      @if (classified.markdown(); as md) {
      <chat-streaming-md [document]="rows.markdownDocumentFor(md, message)" />
      } @if (classified.spec(); as spec) {
      <!-- Pass ONLY the explicit consumer store (may be
                   undefined) — never the conversation-wide internal
                   fallback. Without a consumer store, render-spec
                   self-seeds a per-instance store from spec.state so
                   same-key dashboards across messages stay isolated
                   (a2ui parity). -->
      <chat-generative-ui
        [spec]="spec"
        [registry]="rows.renderRegistry()"
        [store]="rows.store()"
        [handlers]="rows.handlers()"
        [loading]="rows.agent().isLoading()"
        (events)="rows.onSpecEvent($event, i)"
      />
      } @if (classified.type() === 'a2ui' && rows.views(); as catalog) { @for
      (entry of classified.a2uiSurfaces() | keyvalue; track entry.key) {
      <a2ui-surface
        [surface]="entry.value"
        [state]="classified.a2uiSurfaceStates().get(entry.key)"
        [catalog]="catalog"
        [handlers]="rows.handlers()"
        (action)="rows.onA2uiAction($event)"
        (events)="rows.onA2uiEvent($event, i, entry.key)"
      />
      } }
      <!-- Only show message actions when there is copyable assistant
                 text. Content-less messages (a bare tool call or a subagent
                 delegation card) have nothing to copy/regenerate/rate, so the
                 actions panel is pure whitespace there — suppress it to keep
                 the stream compact. -->
      @if (content.trim()) {
      <chat-message-actions
        chatMessageControls
        [content]="content"
        [disabled]="rows.agent().isLoading() || !!rows.agent().isInputBlocked?.()"
        (regenerate)="rows.onRegenerate(i)"
        (rate)="rows.onRate(message, $event)"
        (contentCopied)="rows.onCopy(message, $event)"
      />
      }
    </chat-message>
    } } }
  `,
})
export class ChatDefaultMessageListComponent extends ChatMessageListComponent {
  readonly renderer = input.required<ChatDefaultRowsRenderer>();
}
