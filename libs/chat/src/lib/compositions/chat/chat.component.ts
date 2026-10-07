// libs/chat/src/lib/compositions/chat/chat.component.ts
import {
  Component, ChangeDetectionStrategy, input, model, output, computed, contentChild, effect, signal, untracked, viewChild,
  ElementRef, DestroyRef, inject, Injector, runInInjectionContext,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DEVELOPMENT_COLLECTION_POLICY, isDevelopmentRuntimeEnabled } from '@threadplane/telemetry/browser';
import { KeyValuePipe, NgTemplateOutlet } from '@angular/common';
import type { Agent, Message, MessageDelivery, Subagent } from '../../agent';
import { ChatReasoningComponent } from '../../primitives/chat-reasoning/chat-reasoning.component';
import type { ViewRegistry, RenderEvent } from '@threadplane/render';
import type { A2uiActionMessage } from '@threadplane/a2ui';
import type { StateStore } from '@json-render/core';
import { toRenderRegistry, signalStateStore, withViews } from '@threadplane/render';
import type { ClientToolRegistry } from '../../client-tools/tool-def';
import type {
  ClientToolContinuationLimitEvent,
  ClientToolContinuationPolicy,
} from '../../client-tools/tool-def';
import type { ClientToolExecutionGuard } from '../../client-tools/client-tool-execution-guard';
import { createClientToolsCoordinator } from '../../client-tools/client-tools-coordinator';
import { ChatWindowComponent } from '../../primitives/chat-window/chat-window.component';
import { ChatMessageListComponent } from '../../primitives/chat-message-list/chat-message-list.component';
import { MessageTemplateDirective } from '../../primitives/chat-message-list/message-template.directive';
import { ChatMessageComponent, type ChatMessageRole } from '../../primitives/chat-message/chat-message.component';
import { ChatInputComponent } from '../../primitives/chat-input/chat-input.component';
import { ChatTypingIndicatorComponent } from '../../primitives/chat-typing-indicator/chat-typing-indicator.component';
import { ChatErrorComponent } from '../../primitives/chat-error/chat-error.component';
import { ChatThreadListComponent, type Thread } from '../../primitives/chat-thread-list/chat-thread-list.component';
import { ChatGenerativeUiComponent } from '../../primitives/chat-generative-ui/chat-generative-ui.component';
import { ChatToolViewsComponent } from '../../primitives/chat-tool-views/chat-tool-views.component';
import {
  ChatStreamingMdComponent,
  markdownDocument,
  type StreamingMarkdownDocument,
} from '../../streaming/streaming-markdown.component';
import { ChatToolCallsComponent } from '../../primitives/chat-tool-calls/chat-tool-calls.component';
import { resolveMessageToolCalls } from '../../primitives/chat-tool-calls/resolve-message-tool-calls';
import { ChatMessageActionsComponent } from '../../primitives/chat-message-actions/chat-message-actions.component';
import { ChatWelcomeComponent } from '../../primitives/chat-welcome/chat-welcome.component';
import { ChatSelectComponent, type ChatSelectOption } from '../../primitives/chat-select/chat-select.component';
import { A2uiSurfaceComponent } from '../../a2ui/surface.component';
import { ChatScrollBubbleComponent } from '../../primitives/chat-scroll-bubble/chat-scroll-bubble.component';
import { createContentClassifier, type ContentClassifier } from '../../streaming/content-classifier';
import { createPartialArgsBridge, type PartialArgsBridge } from '../../a2ui/partial-args-bridge';
import { createA2uiSurfaceStore, type A2uiSurfaceStore } from '../../a2ui/surface-store';
import { a2uiActionLabel } from '../../a2ui/action-label';
import { messageContent } from '../shared/message-utils';
import { formatDuration } from '../../utils/format-duration';
import { CHAT_HOST_TOKENS, ensureChatRootStyles } from '../../styles/chat-tokens';
import type { ChatRenderEvent } from './chat-render-event';
import { ChatActivityTemplateDirective, type ChatActivityTemplateContext } from './chat-activity-template.directive';
import { CHAT_LIFECYCLE, type ChatLifecycle } from '../../lifecycle';

/**
 * Internal helper: WritableSignals backing the readonly ChatLifecycle surface
 * exposed via CHAT_LIFECYCLE. ChatComponent populates these as the user
 * interacts; consumers (e.g. cockpit-telemetry) only see the readonly view.
 */
interface ChatLifecycleInternal extends ChatLifecycle {
  _internal: {
    componentReady: ReturnType<typeof signal<boolean>>;
    firstMessageSent: ReturnType<typeof signal<boolean>>;
    messageCount: ReturnType<typeof signal<number>>;
    inputSubmittedAt: ReturnType<typeof signal<number | null>>;
  };
}

function createChatLifecycle(): ChatLifecycleInternal {
  const componentReady = signal(false);
  const firstMessageSent = signal(false);
  const messageCount = signal(0);
  const inputSubmittedAt = signal<number | null>(null);
  return {
    componentReady: componentReady.asReadonly(),
    firstMessageSent: firstMessageSent.asReadonly(),
    messageCount: messageCount.asReadonly(),
    inputSubmittedAt: inputSubmittedAt.asReadonly(),
    _internal: { componentReady, firstMessageSent, messageCount, inputSubmittedAt },
  };
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * Returns true when the scroll position is within `tolerance` px of the bottom.
 * Pure helper extracted for unit testing.
 */
export function isPinned(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  tolerance = 150,
): boolean {
  return scrollHeight - scrollTop - clientHeight < tolerance;
}

@Component({
  selector: 'chat',
  standalone: true,
  imports: [
    KeyValuePipe, NgTemplateOutlet,
    ChatWindowComponent, ChatMessageListComponent, MessageTemplateDirective, ChatMessageComponent,
    ChatInputComponent, ChatTypingIndicatorComponent, ChatErrorComponent,
    ChatThreadListComponent, ChatGenerativeUiComponent,
    ChatStreamingMdComponent, ChatToolCallsComponent, ChatToolViewsComponent, A2uiSurfaceComponent,
    ChatMessageActionsComponent, ChatWelcomeComponent, ChatSelectComponent, ChatReasoningComponent,
    ChatScrollBubbleComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: CHAT_LIFECYCLE, useFactory: createChatLifecycle },
    {
      provide: DEVELOPMENT_COLLECTION_POLICY,
      useFactory: () => {
        const host = inject(ChatComponent);
        const parent = inject(DEVELOPMENT_COLLECTION_POLICY, { optional: true, skipSelf: true });
        return () => (parent?.() ?? true) && isDevelopmentRuntimeEnabled(host.agent());
      },
    },
  ],
  styles: [CHAT_HOST_TOKENS, `
    :host {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      height: 100%;
      min-height: 0;
      max-height: 100%;
      overflow: hidden;
      background: var(--tplane-chat-bg);
    }
    :host > chat-welcome {
      display: flex;
      flex: 1 1 auto;
      width: 100%;
    }
    .chat-shell { display: flex; flex: 1; min-height: 0; overflow: hidden; }
    .chat-shell__sidebar {
      width: 240px;
      flex-shrink: 0;
      border-right: 1px solid var(--tplane-chat-separator);
      background: var(--tplane-chat-surface-alt);
      overflow-y: auto;
      display: none;
    }
    @media (min-width: 768px) { .chat-shell__sidebar { display: block; } }
    .chat-shell__main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
    .chat-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 60px 20px;
      color: var(--tplane-chat-text-muted);
      text-align: center;
      flex: 1;
      min-height: 0;
    }
    .chat-empty[hidden] { display: none; }
    .chat-empty__title { font-size: 1.125rem; font-weight: 500; color: var(--tplane-chat-text); margin: 0; }
    .chat-empty__sub { margin: 0; font-size: var(--tplane-chat-font-size-sm); }
    .chat-empty__title { font-size: 1.125rem; font-weight: 500; color: var(--tplane-chat-text); margin: 0; }
    .chat-empty__sub { margin: 0; font-size: var(--tplane-chat-font-size-sm); }
    .chat-scroll { flex: 1; min-height: 0; overflow-y: auto; padding-top: var(--tplane-chat-edge-pad); }
    .chat-scroll::-webkit-scrollbar { width: 6px; }
    .chat-scroll::-webkit-scrollbar-thumb { background: var(--tplane-chat-separator); border-radius: 10px; }
    [chatFooter] {
      padding-bottom: var(--tplane-chat-edge-pad);
    }
    .chat-footer-wrap { position: relative; }
  `],
  template: `
    @if (showWelcome()) {
      <chat-welcome>
        <chat-input chatWelcomeInput [agent]="agent()" [submitOnEnter]="true" placeholder="Type a message...">
          @if (showModelPicker() && modelOptions().length > 0) {
            <chat-select
              chatInputModelSelect
              [options]="modelOptions()"
              [(value)]="selectedModel"
              [placeholder]="modelPickerPlaceholder()"
            />
          }
        </chat-input>
        <ng-container ngProjectAs="[chatWelcomeSuggestions]">
          <ng-content select="[chatWelcomeSuggestions]" />
        </ng-container>
      </chat-welcome>
    } @else {
    <div class="chat-shell">
      @if (threads().length > 0) {
        <aside class="chat-shell__sidebar">
          <chat-thread-list
            [threads]="threads()"
            [activeThreadId]="activeThreadId()"
            (threadSelected)="threadSelected.emit($event)"
          />
        </aside>
      }
      <div class="chat-shell__main">
        <chat-window>
          <ng-content select="[chatHeader]" chatHeader />
          <div chatBody class="chat-scroll" #scrollContainer (scroll)="onScroll()">
            <chat-message-list [agent]="agent()">
              <ng-template chatMessageTemplate="human" let-message let-i="index">
                <chat-message [role]="'user'" [prevRole]="prevRole(i)">{{ humanContent(message) }}</chat-message>
              </ng-template>

              <ng-template chatMessageTemplate="ai" let-message let-i="index">
                @let content = messageContent(message);
                @let classified = classifyMessage(content, message);
                <chat-message
                  [role]="'assistant'"
                  [message]="message"
                  [prevRole]="prevRole(i)"
                  [streaming]="message.delivery.phase === 'streaming'"
                  [current]="i === agent().messages().length - 1"
                >
                  <!-- A projected chatActivityTemplate owns the reasoning +
                       tool-call region for this message. It renders at
                       message level (never inside a clipped trace body). -->
                  @if (activityTemplate(); as activity) {
                    <ng-container
                      [ngTemplateOutlet]="activity.templateRef"
                      [ngTemplateOutletContext]="activityContextFor(message, i)"
                    />
                  } @else {
                    <!-- Reasoning is merged across a run of consecutive (tool-
                         separated) reasoning steps and rendered ONCE at the run's
                         first step as "Thought for {total} · {N} steps", so a
                         multi-step agent shows one compact pill instead of a
                         stack of "Thought for 1s" chips. Single-step turns render
                         a normal "Thought for {duration}" pill. -->
                    @if (message.reasoning && reasoningRunStart(i)) {
                      @let run = reasoningRun(i);
                      <chat-reasoning
                        [content]="run.content"
                        [delivery]="run.delivery"
                        [durationMs]="run.durationMs"
                        [label]="run.label"
                      />
                    }
                    <chat-tool-calls [agent]="agent()" [message]="message" [excludeToolNames]="excludedToolNames()">
                      <ng-container ngProjectAs="[chatToolCallTemplate]">
                        <ng-content select="[chatToolCallTemplate]" />
                      </ng-container>
                    </chat-tool-calls>
                  }
                  <chat-tool-views
                    [agent]="agent()"
                    [message]="message"
                    [views]="effectiveViews()"
                    [store]="resolvedStore()"
                    [handlers]="handlers()"
                    (events)="onClientToolEvent($event)"
                  />
                  @if (classified.markdown(); as md) {
                    <chat-streaming-md [document]="markdownDocumentFor(md, message)" />
                  }
                  @if (classified.spec(); as spec) {
                    <!-- Pass ONLY the explicit consumer store (may be
                         undefined) — never the conversation-wide internal
                         fallback. Without a consumer store, render-spec
                         self-seeds a per-instance store from spec.state so
                         same-key dashboards across messages stay isolated
                         (a2ui parity). -->
                    <chat-generative-ui
                      [spec]="spec"
                      [registry]="renderRegistry()"
                      [store]="store()"
                      [handlers]="handlers()"
                      [loading]="agent().isLoading()"
                      (events)="onSpecEvent($event, i)"
                    />
                  }
                  @if (classified.type() === 'a2ui' && views(); as catalog) {
                    @for (entry of classified.a2uiSurfaces() | keyvalue; track entry.key) {
                      <a2ui-surface
                        [surface]="entry.value"
                        [state]="classified.a2uiSurfaceStates().get(entry.key)"
                        [catalog]="catalog"
                        [handlers]="handlers()"
                        (action)="onA2uiAction($event)"
                        (events)="onA2uiEvent($event, i, entry.key)"
                      />
                    }
                  }
                  <!-- Only show message actions when there is copyable assistant
                       text. Content-less messages (a bare tool call or a subagent
                       delegation card) have nothing to copy/regenerate/rate, so the
                       actions panel is pure whitespace there — suppress it to keep
                       the stream compact. -->
                  @if (content.trim()) {
                    <chat-message-actions
                      chatMessageControls
                      [content]="content"
                      [disabled]="agent().isLoading() || !!agent().isInputBlocked?.()"
                      (regenerate)="onRegenerate(i)"
                      (rate)="onRate(message, $event)"
                      (contentCopied)="onCopy(message, $event)"
                    />
                  }
                </chat-message>
              </ng-template>

              <ng-template chatMessageTemplate="tool" let-message>
                <!-- Tool messages route through chat-trace; hidden from main flow. -->
              </ng-template>

              <ng-template chatMessageTemplate="system" let-message>
                <chat-message [role]="'system'">{{ messageContent(message) }}</chat-message>
              </ng-template>
            </chat-message-list>

            <!-- Suppress the floor typing-indicator while the current
                 assistant bubble is streaming: its own caret is already
                 the loading affordance. Showing both reads as visual
                 noise rather than richer feedback. See
                 currentAssistantStreaming() on the component class. -->
            @if (pinned() && !currentAssistantStreaming()) {
              <chat-typing-indicator [agent]="agent()" />
            }
          </div>
          <div chatFooter class="chat-footer-wrap">
            @if (!pinned()) {
              <chat-scroll-bubble
                [mode]="agent().isLoading() ? 'streaming' : 'idle'"
                (clicked)="onScrollBubbleClick()"
              />
            }
            <chat-error [agent]="agent()" />
            <chat-input [agent]="agent()" [submitOnEnter]="true" placeholder="Type a message..." (submitted)="onUserSubmitted()">
              @if (showModelPicker() && modelOptions().length > 0) {
                <chat-select
                  chatInputModelSelect
                  [options]="modelOptions()"
                  [(value)]="selectedModel"
                  [placeholder]="modelPickerPlaceholder()"
                />
              } @else {
                <ng-container ngProjectAs="[chatInputModelSelect]">
                  <ng-content select="[chatInputModelSelect]" />
                </ng-container>
              }
            </chat-input>
          </div>
        </chat-window>
      </div>
    </div>
    }
  `,
})
export class ChatComponent {
  readonly agent = input.required<Agent>();
  readonly views = input<ViewRegistry | undefined>(undefined);
  /**
   * Client-declared tools (`view`/`ask`/`function`) the model may call. When
   * provided, a coordinator ships their catalog to the agent, runs `function`
   * tools in the browser, and renders/resolves `view`/`ask` tools through the
   * same tool-views pipeline as `views`. Additive — leave undefined for the
   * classic server-tools-only experience.
   */
  readonly clientTools = input<ClientToolRegistry | undefined>(undefined);
  readonly store = input<StateStore | undefined>(undefined);
  readonly handlers = input<Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>>({});
  readonly threads = input<Thread[]>([]);
  readonly activeThreadId = input<string>('');
  readonly welcomeDisabled = input<boolean>(false);

  /**
   * High-level model-picker API. When `modelOptions` is non-empty, the chat
   * composition renders a `<chat-select>` inside the input pill (in BOTH
   * welcome and conversation modes), wired to the two-way `selectedModel`
   * model. Consumers who want full control should leave `modelOptions`
   * empty and project a `<chat-select chatInputModelSelect>` themselves.
   */
  readonly modelOptions = input<readonly ChatSelectOption[]>([]);
  /**
   * When `false`, hide the auto-rendered model picker even when
   * `modelOptions` is non-empty. Useful in cramped surfaces (popup,
   * sidebar) where the picker crowds the input. Defaults to `true`.
   * Has no effect when consumers project their own
   * `<chat-select chatInputModelSelect>` via content projection.
   */
  readonly showModelPicker = input<boolean>(true);
  readonly selectedModel = model<string>('');
  readonly modelPickerPlaceholder = input<string>('Choose a model');

  /**
   * Tool names whose calls produce a rendered GenUI surface rather than
   * visible text. Used to (a) filter <chat-tool-calls> so internal
   * dispatchers don't render args JSON as cards, and (b) detect
   * "this is a GenUI turn" for the building-UI skeleton.
   * Default covers the canonical A2UI + json-render schema tools.
   */
  readonly genuiToolNames = input<readonly string[]>([
    'generate_a2ui_schema',
    'generate_json_render_spec',
    'render_spec',
  ]);
  readonly clientToolExecutionGuard = input<ClientToolExecutionGuard | undefined>(undefined);
  readonly clientToolContinuationPolicy = input<ClientToolContinuationPolicy | undefined>(undefined);

  readonly showWelcome = computed(() => {
    if (this.welcomeDisabled()) return false;
    const a = this.agent() as unknown as { isThreadLoading?: () => boolean };
    if (a.isThreadLoading?.()) return false;
    return this.agent().messages().length === 0;
  });
  readonly threadSelected = output<string>();
  readonly renderEvent = output<ChatRenderEvent>();
  readonly clientToolContinuationLimit = output<ClientToolContinuationLimitEvent>();
  /** Emitted when the user clicks the regenerate button on an assistant message. */
  readonly regenerate = output<void>();
  /** Emitted when the user rates an assistant message. */
  readonly rate = output<{ messageIndex: number; rating: 'up' | 'down' }>();
  /** Emitted when the user copies an assistant message. */
  readonly messageCopy = output<{ messageIndex: number; content: string }>();
  private readonly _internalStore = signalStateStore({});
  readonly resolvedStore = computed(() => {
    const explicit = this.store();
    if (explicit) return explicit;
    // A render store is needed whenever there's any view registry to render
    // through — user-supplied `views()` OR client-tool view/ask components.
    if (this.effectiveViews()) return this._internalStore;
    return undefined;
  });

  /**
   * Lazily-built client-tools coordinator, memoized on the `clientTools`
   * registry input. Undefined when no client tools are declared. The
   * coordinator owns the catalog/executor wiring and the view/ask render
   * registry; the composition merges and connects it below.
   */
  private readonly coordinator = computed(() => {
    const reg = this.clientTools();
    const policy = this.clientToolContinuationPolicy();
    return reg ? createClientToolsCoordinator(reg, {
      executionGuard: this.clientToolExecutionGuard(),
      continuationPolicy: {
        ...policy,
        onLimit: (event) => {
          policy?.onLimit?.(event);
          this.clientToolContinuationLimit.emit(event);
        },
      },
    }) : undefined;
  });

  /**
   * The view registry actually used for rendering tool-views and for
   * excluding view-backed tool names from default tool-call cards. Merges
   * the coordinator's `view`/`ask` components (keyed by tool name) into the
   * user-supplied `views()` so client-declared component tools render through
   * the same pipeline. Falls back to `views()` when no client tools exist.
   */
  protected readonly effectiveViews = computed(() => {
    const base = this.views();
    const coord = this.coordinator();
    if (!coord) return base;
    return base ? withViews(base, coord.viewRegistry) : coord.viewRegistry;
  });

  readonly renderRegistry = computed(() => {
    const v = this.views();
    return v ? toRenderRegistry(v) : undefined;
  });

  /** Tool names that have a registered view (keys of the effective view
   *  registry, including client-declared view/ask tools). These render as
   *  inline tool-views and are excluded from the default tool-call card so
   *  they don't render twice. */
  readonly viewToolNames = computed<readonly string[]>(() => Object.keys(this.effectiveViews() ?? {}));

  /** Union of GenUI dispatcher tool names and registered view tool names. */
  readonly excludedToolNames = computed<readonly string[]>(() => [
    ...this.genuiToolNames(),
    ...this.viewToolNames(),
  ]);

  readonly messageContent = messageContent;

  /**
   * Optional per-message activity renderer projected as
   * `<ng-template chatActivityTemplate>`. When present it replaces the
   * reasoning pill and the tool-call region of every assistant message, and
   * takes precedence over any projected `chatToolCallTemplate`.
   */
  readonly activityTemplate = contentChild(ChatActivityTemplateDirective);

  private readonly activityContexts = new Map<string, ChatActivityTemplateContext>();

  /**
   * Builds the activity template context for one assistant message. Tool
   * calls are scoped to the message (same resolution as `<chat-tool-calls>`,
   * minus excluded dispatcher/view tool names); subagents are anchored by
   * `Subagent.toolCallId` to the message's calls. The previous context is
   * reused when nothing changed, so the embedded view keeps stable inputs.
   */
  protected activityContextFor(message: Message, index: number): ChatActivityTemplateContext {
    const agent = this.agent();
    const excluded = new Set(this.excludedToolNames());
    const toolCalls = resolveMessageToolCalls(agent, message).filter((tc) => !excluded.has(tc.name));
    const byCallId = new Map<string, Subagent>();
    agent.subagents?.().forEach((sa) => byCallId.set(sa.toolCallId, sa));
    const subagents: Subagent[] = [];
    for (const tc of toolCalls) {
      const sa = byCallId.get(tc.id);
      if (sa) subagents.push(sa);
    }
    const prior = this.activityContexts.get(message.id);
    if (
      prior &&
      prior.$implicit === message &&
      prior.index === index &&
      prior.agent === agent &&
      sameItems(prior.toolCalls, toolCalls) &&
      sameItems(prior.subagents, subagents)
    ) {
      return prior;
    }
    const context: ChatActivityTemplateContext = { $implicit: message, index, toolCalls, subagents, agent };
    this.activityContexts.set(message.id, context);
    return context;
  }

  /**
   * Renderable content for a human-role message bubble. Most human
   * messages are typed prompts and pass through `messageContent`
   * unchanged. A2UI action messages (e.g. form submits, button clicks
   * on a rendered surface) flow through the same submit channel and
   * land in the message stream as a HumanMessage whose content is a
   * JSON-serialized `A2uiActionMessage`. Showing the raw JSON as if
   * the user typed it leaks the protocol; per the A2UI spec
   * those events resemble tool calls more than user utterances.
   *
   * `a2uiActionLabel` returns a short human-readable label for
   * recognized action shapes ("Search flights", "Selected flight UA123",
   * etc.) — or null for any non-action content, in which case we fall
   * back to the original text.
   */
  protected humanContent(message: { content: unknown }): string {
    const raw = messageContent(message);
    return a2uiActionLabel(raw) ?? raw;
  }

  /** The nearest preceding assistant message (skipping hidden tool messages), or undefined. */
  private prevAssistant(msgs: Message[], index: number): Message | undefined {
    for (let j = index - 1; j >= 0; j--) {
      if (msgs[j].role === 'tool') continue;
      return msgs[j].role === 'assistant' ? msgs[j] : undefined;
    }
    return undefined;
  }

  /**
   * True when message[index] starts a reasoning RUN — a maximal sequence of
   * consecutive assistant reasoning steps separated only by (hidden) tool
   * messages. The merged reasoning pill renders once, here.
   */
  protected reasoningRunStart(index: number): boolean {
    const msgs = this.agent().messages();
    if (!msgs[index]?.reasoning) return false;
    return !this.prevAssistant(msgs, index)?.reasoning;
  }

  /**
   * Aggregate the reasoning RUN starting at `index`: joins each step's
   * reasoning, sums durations, counts steps, and returns the last step's
   * delivery because that step owns the current aggregate snapshot. Also
   * computes the merged label when N > 1 ("Thought for {total} · {N} steps",
   * or just "{N} steps" when no step reported timing).
   */
  protected reasoningRun(index: number): {
    content: string;
    durationMs: number | undefined;
    delivery: MessageDelivery;
    label: string | undefined;
  } {
    const msgs = this.agent().messages();
    const steps: Message[] = [];
    for (let j = index; j < msgs.length; j++) {
      const m = msgs[j];
      if (m.role === 'tool') continue;            // skip hidden tool messages
      if (m.role === 'assistant' && m.reasoning) { steps.push(m); continue; }
      break;                                      // any other message ends the run
    }
    const content = steps.map((step) => step.reasoning ?? '').filter(Boolean).join('\n\n');
    const durations = steps
      .map((step) => step.reasoningDurationMs)
      .filter((d): d is number => typeof d === 'number');
    const durationMs = durations.length ? durations.reduce((a, b) => a + b, 0) : undefined;
    const last = steps[steps.length - 1];
    const delivery = last?.delivery ?? msgs[index].delivery;
    // Only claim a duration when at least one step reported timing. Otherwise
    // "Thought for <1s" would read as "fast" when it really means "unknown", so
    // drop the duration phrase and label by step count alone.
    const label =
      steps.length > 1
        ? durationMs !== undefined
          ? `Thought for ${formatDuration(durationMs)} · ${steps.length} steps`
          : `${steps.length} steps`
        : undefined;
    return { content, durationMs, delivery, label };
  }

  private readonly classifiers = new Map<
    string,
    { generation: string; classifier: ContentClassifier }
  >();
  private readonly markdownDocuments = new Map<string, StreamingMarkdownDocument>();
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  // Resolved against the component's own `providers` in normal use. The fallback
  // is for tests that construct ChatComponent via `new` inside a bare injection
  // context (no element injector, so component-level providers are skipped).
  private readonly lifecycle = (inject(CHAT_LIFECYCLE, { optional: true }) ?? createChatLifecycle()) as ChatLifecycleInternal;
  private eventsSubscribed = false;

  /**
   * Shared A2UI surface store fed by the live partial-args bridge. The
   * content-classifier path will share this store via tool_call_id
   * short-circuit (skipping re-dispatch for live tool_call_ids).
   */
  protected readonly liveSurfaceStore: A2uiSurfaceStore = createA2uiSurfaceStore();
  private readonly partialBridge: PartialArgsBridge = createPartialArgsBridge(this.liveSurfaceStore);
  private partialEventsLastIndex = 0;

  private readonly scrollContainer = viewChild<ElementRef<HTMLElement>>('scrollContainer');
  private readonly messageCount = computed(() => this.agent().messages().length);
  private prevMessageCount = 0;
  private wasLoading = false;
  protected readonly pinned = signal<boolean>(true);
  private programmaticScrollCount = 0;
  private static readonly PIN_TOLERANCE_PX = 150;

  /**
   * True iff the current (last-index) assistant message owns an active
   * delivery generation. The bubble's own caret already signals loading;
   * we suppress the floor typing-indicator in that case so the user
   * doesn't see two loading affordances at once.
   *
   * Matches the same `streaming + current` condition the bubble uses
   * to enable `.chat-message__caret`.
   *
   * Restricted to assistant role because the caret only renders on
   * assistant bubbles (`:host([data-role="assistant"][data-current=...
   *  ][data-streaming=...])`).
   */
  protected readonly currentAssistantStreaming = computed(() => {
    const msgs = this.agent().messages();
    if (msgs.length === 0) return false;
    const last = msgs[msgs.length - 1];
    return last?.role === 'assistant' && last.delivery.phase === 'streaming';
  });

  constructor() {
    // Inject the chat lib's root CSS custom properties (--tplane-chat-bg,
    // --tplane-chat-surface, --tplane-chat-radius-input, etc.) the first
    // time any chat composition is constructed. The module-eval side
    // effect that previously handled this is unreliable under
    // aggressive production tree-shaking — bundlers that don't see
    // the source `chat-tokens.ts` path in the published artifact's
    // `sideEffects` glob drop the call entirely, leaving consumers
    // with zero token defaults (sidenav has no width, input has no
    // border, chips have no chrome — everything renders as plain
    // text on the page background). Calling from a constructor that
    // is unconditionally reachable from user code defeats that
    // tree-shaking and is idempotent. */
    ensureChatRootStyles();
    effect(() => {
      if (this.eventsSubscribed) return;
      let agent: ReturnType<typeof this.agent>;
      try { agent = this.agent(); } catch { return; }
      this.eventsSubscribed = true;
      this.lifecycle._internal.componentReady.set(true);
      agent.events$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
        if (event.type !== 'state_update') return;
        const store = this.resolvedStore();
        if (!store) return;
        store.update(event.data);
      });
    });

    // Sync the agent STATE signal into the render store. AG-UI delivers
    // backend data as agent shared state (STATE_SNAPSHOT/STATE_DELTA); other
    // adapters expose graph state via the same `state()` signal. The render
    // store keys are JSON pointers, so map each top-level state key `k` to
    // `/k`. Exclude `messages` (carried in the snapshot but irrelevant to the
    // render store and large). Fires for any adapter whose `state()` carries
    // non-message keys; no-op when no render store is active. Coexists with
    // the events$ `state_update` path above (both merge into the same store).
    effect(() => {
      let agentRef: ReturnType<typeof this.agent>;
      try { agentRef = this.agent(); } catch { return; }
      const stateFn = (agentRef as unknown as { state?: () => unknown }).state;
      if (typeof stateFn !== 'function') return;
      const state = stateFn.call(agentRef);
      const store = this.resolvedStore();
      if (!store || state == null || typeof state !== 'object' || Array.isArray(state)) return;
      const updates: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(state as Record<string, unknown>)) {
        if (k === 'messages') continue;
        updates['/' + k] = v;
      }
      if (Object.keys(updates).length > 0) store.update(updates);
    });

    // Spec 4: flip CHAT_LIFECYCLE.firstMessageSent when the agent's stream
    // starts, regardless of submit path (input-bound, programmatic, suggestion-
    // click). Sticky — guarded so we never re-set a flag that's already true.
    // `lifecycle` is not on the base Agent contract; adapters like @threadplane/langgraph
    // attach it. Duck-type the read so non-lifecycle agents are a no-op.
    effect(() => {
      let agentRef: ReturnType<typeof this.agent>;
      try { agentRef = this.agent(); } catch { return; }
      const lc = (agentRef as unknown as { lifecycle?: { streamStartedAt?: () => number | null } }).lifecycle;
      const streamStartedAt = lc?.streamStartedAt?.();
      if (streamStartedAt != null && !this.lifecycle._internal.firstMessageSent()) {
        this.lifecycle._internal.firstMessageSent.set(true);
      }
    });

    // Auto-scroll-to-bottom. Fires on every signal update during streaming
    // (each token mutates the last message's content), so this MUST be cheap
    // and idempotent. Earlier this used scrollTo({ behavior: 'smooth' }) per
    // token, which queues overlapping smooth-scroll animations (~12/sec)
    // and produces visibly jerky scroll. Direct `scrollTop = scrollHeight`
    // is instant, free, and only repaints when the value actually changes.
    effect(() => {
      let count: number;
      let msgs: ReturnType<ReturnType<typeof this.agent>['messages']>;
      try { count = this.messageCount(); msgs = this.agent().messages(); } catch { return; }
      const lastContent = msgs.length > 0 ? (msgs[msgs.length - 1] as unknown as Record<string, unknown>)['content'] : undefined;
      void lastContent;
      const el = this.scrollContainer()?.nativeElement;
      if (!el) return;
      const isNewMessage = count !== this.prevMessageCount;
      this.prevMessageCount = count;
      if (isNewMessage || this.pinned()) {
        this.programmaticScrollCount++;
        el.scrollTop = el.scrollHeight;
        requestAnimationFrame(() => { this.programmaticScrollCount--; });
        if (isNewMessage) untracked(() => this.pinned.set(true));
      }
    });

    // Final scroll when streaming completes. The content-mutation effect above
    // fires on every token but stops when streaming ends; action buttons
    // (reload, copy) render on idle and can land below the fold without this.
    effect(() => {
      let loading: boolean;
      try { loading = this.agent().isLoading(); } catch { return; }
      if (loading) {
        this.wasLoading = true;
        return;
      }
      if (!this.wasLoading) return;
      this.wasLoading = false;
      if (this.pinned()) {
        // Defer one frame so message-actions have rendered.
        requestAnimationFrame(() => {
          const el2 = this.scrollContainer()?.nativeElement;
          if (!el2) return;
          this.programmaticScrollCount++;
          el2.scrollTop = el2.scrollHeight;
          requestAnimationFrame(() => { this.programmaticScrollCount--; });
        });
      }
    });

    // Subscribe to a2ui-partial custom events from the LangGraph backend.
    // Each event delivers a cumulative args string keyed by tool_call_id;
    // bridge.push() re-parses and dispatches new envelopes incrementally.
    // The runtime-neutral Agent contract does not require a customEvents
    // signal, so we feature-detect: adapters that expose it (e.g.
    // LangGraphAgent's customEvents signal) light up live streaming;
    // others continue to use the wrapped final-message classifier path.
    effect(() => {
      let agent: ReturnType<typeof this.agent>;
      try { agent = this.agent(); } catch { return; }
      const customSig = (agent as unknown as {
        customEvents?: () => readonly { name: string; data: unknown }[];
      }).customEvents;
      if (typeof customSig !== 'function') return;
      const events = customSig();
      for (let i = this.partialEventsLastIndex; i < events.length; i++) {
        const e = events[i];
        if (e.name !== 'a2ui-partial') continue;
        const d = e.data as { tool_call_id?: string; args_so_far?: string } | null;
        if (!d || typeof d.tool_call_id !== 'string' || typeof d.args_so_far !== 'string') continue;
        this.partialBridge.push(d.tool_call_id, d.args_so_far);
      }
      this.partialEventsLastIndex = events.length;
    });

    // Connect the client-tools coordinator to the agent. connect() ships the
    // tool catalog, starts the function-tool executor, and installs the view
    // auto-ack effect. Those installs create effect()s of their own, which
    // Angular forbids from *within* a running effect (NG0602). So this effect
    // only detects readiness (both coordinator + agent present) and defers the
    // actual connect() to a microtask that runs OUTSIDE the reactive context,
    // re-entering the component's injection context so the coordinator's
    // effects bind to this component's lifecycle. `connected` guards against
    // re-running per coordinator identity (a new clientTools registry yields a
    // new coordinator and re-connects; the old one's effects are abandoned).
    let connected: unknown;
    effect(() => {
      const coord = this.coordinator();
      let agentRef: ReturnType<typeof this.agent>;
      try { agentRef = this.agent(); } catch { return; }
      if (!coord || !agentRef) return;
      if (connected === coord) return;
      connected = coord;
      queueMicrotask(() => {
        runInInjectionContext(this.injector, () => coord.connect(agentRef));
      });
    });

    effect(() => {
      // janitor: drop classifiers for messages no longer in the agent's list
      let liveIds: Set<string>;
      try {
        liveIds = new Set<string>();
        for (const m of this.agent().messages()) {
          const id = (m as unknown as { id?: string }).id;
          if (id) liveIds.add(id);
        }
      } catch { return; }
      for (const key of [...this.classifiers.keys()]) {
        if (!liveIds.has(key)) {
          this.classifiers.get(key)?.classifier.dispose();
          this.classifiers.delete(key);
        }
      }
      for (const key of [...this.markdownDocuments.keys()]) {
        if (!liveIds.has(key)) this.markdownDocuments.delete(key);
      }
      for (const key of [...this.activityContexts.keys()]) {
        if (!liveIds.has(key)) this.activityContexts.delete(key);
      }
    });
  }

  prevRole(index: number): ChatMessageRole | undefined {
    if (index === 0) return undefined;
    const prev = this.agent().messages()[index - 1];
    if (!prev) return undefined;
    const role = (prev as unknown as { role?: string }).role;
    if (role === 'user') return 'user';
    if (role === 'assistant') return 'assistant';
    if (role === 'system') return 'system';
    if (role === 'tool') return 'tool';
    return undefined;
  }

  protected onScroll(): void {
    if (this.programmaticScrollCount > 0) return;
    const el = this.scrollContainer()?.nativeElement;
    if (!el) return;
    const nextPinned = isPinned(el.scrollHeight, el.scrollTop, el.clientHeight, ChatComponent.PIN_TOLERANCE_PX);
    if (nextPinned !== this.pinned()) this.pinned.set(nextPinned);
  }

  /**
   * Scrolls the transcript to its newest content and re-pins it, exactly as
   * the scroll-to-bottom bubble does. Hosts that apply many messages in one
   * pass (a replay seeking to a recorded time, a restored thread rendered
   * after tool views mount) call this once their layout has settled: the
   * chat's own pin runs when messages change, which can be before the views
   * that follow them have rendered. The write is counted as programmatic so
   * the scroll event it raises does not read as the user unpinning.
   */
  scrollToBottom(): void {
    const el = this.scrollContainer()?.nativeElement;
    if (!el) return;
    this.programmaticScrollCount++;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => { this.programmaticScrollCount--; });
    this.pinned.set(true);
  }

  protected onScrollBubbleClick(): void {
    this.scrollToBottom();
  }

  protected onUserSubmitted(): void {
    this.pinned.set(true);
    this.recordSubmit();
  }

  /**
   * Programmatic submit. Calls `agent.submit({ message: text })` and updates
   * the CHAT_LIFECYCLE signals. Trimmed-empty text is a no-op.
   */
  submitMessage(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || this.agent().isInputBlocked?.()) return;
    void this.agent().submit({ message: trimmed });
    this.recordSubmit();
  }

  /**
   * Clears local view state (classifiers, surface store, lifecycle counters)
   * for a new thread.
   *
   * Resets messageCount to 0 and inputSubmittedAt to null. componentReady and
   * firstMessageSent are NOT reset (sticky for the chat instance lifetime).
   */
  clearThread(): void {
    this.clearClassifiers();
    this.lifecycle._internal.messageCount.set(0);
    this.lifecycle._internal.inputSubmittedAt.set(null);
  }

  private recordSubmit(): void {
    if (!this.lifecycle._internal.firstMessageSent()) {
      this.lifecycle._internal.firstMessageSent.set(true);
    }
    this.lifecycle._internal.messageCount.update((c) => c + 1);
    this.lifecycle._internal.inputSubmittedAt.set(Date.now());
  }

  /**
   * Look up the previous message in the agent's messages list.
   * Returns undefined for the first message.
   */
  protected prevMessage(index: number): unknown {
    if (index === 0) return undefined;
    return this.agent().messages()[index - 1];
  }

  /**
   * True when this assistant message is part of a GenUI render turn.
   * Walks backward through messages from `index` until it finds either
   * an assistant message with `tool_calls` referencing a GenUI tool
   * (→ this turn produces a surface) or a human message (→ the
   * preceding turn ended; this assistant message stands on its own).
   *
   * Also checks the message itself for:
   *   - `extra.tool_calls[].name` matching a GenUI tool (post-streaming
   *     state of the tool-call AI message), OR
   *   - `extra.content[].type === 'function_call' && .name` matching
   *     (live during the OpenAI Responses-API streaming chunks before
   *     `tool_calls` populates).
   *
   * The walk-back approach is robust to LangGraph's in-place
   * replacement of the ToolMessage (which strips the `name` field),
   * unlike a single prev-message check.
   */
  protected isGenuiTurn(message: unknown, _prevMsg: unknown, index?: number): boolean {
    const names = new Set(this.genuiToolNames());
    const m = message as { extra?: Record<string, unknown> } | null | undefined;
    if (!m) return false;

    // Direct check on the message itself (covers the tool-call AI message).
    const calls = (m.extra?.['tool_calls'] as Array<{ name?: string }> | undefined) ?? [];
    if (calls.some(c => c.name != null && names.has(c.name))) return true;

    const rawContent = m.extra?.['content'];
    if (Array.isArray(rawContent)) {
      for (const block of rawContent) {
        if (block != null
            && typeof block === 'object'
            && (block as { type?: unknown }).type === 'function_call'
            && typeof (block as { name?: unknown }).name === 'string'
            && names.has((block as { name: string }).name)) {
          return true;
        }
      }
    }

    // Content-shape detector: during streaming, LangGraph projects the
    // sub-LLM's tool_call.arguments as the assistant message's content
    // string (NOT as a structured array). The structured array form
    // only materialises after streaming completes. So during streaming,
    // we see the JSON envelopes flowing in as text — neither tool_calls
    // nor content[].function_call are populated. Detect via stable
    // A2UI/json-render markers in the content string.
    const projectedContent = (m as { content?: unknown }).content;
    if (typeof projectedContent === 'string' && projectedContent.length > 0) {
      // A2UI v0.9 envelope keys (canonical Google shape).
      if (projectedContent.includes('"createSurface"')
          || projectedContent.includes('"updateComponents"')
          || projectedContent.includes('"updateDataModel"')) {
        return true;
      }
      // json-render spec shape — looks like `{ "root": "...", "elements": ... }`.
      if (projectedContent.includes('"root"') && projectedContent.includes('"elements"')) {
        return true;
      }
    }

    // Direct prev-message check (fast path for the well-formed case
    // where the immediately-preceding tool message still has its name).
    const p = _prevMsg as { role?: string; name?: string; extra?: Record<string, unknown> } | null | undefined;
    if (p && p.role === 'tool') {
      const toolName = (p.extra?.['name'] as string | undefined) ?? p.name;
      if (typeof toolName === 'string' && names.has(toolName)) return true;
    }

    // Walk backward through messages for the emit-phase assistant
    // message whose own structure has no GenUI hint. Bounded by the
    // most recent human message (= start of the current turn).
    if (typeof index === 'number' && index > 0) {
      const msgs = this.agent().messages();
      for (let i = index - 1; i >= 0; i--) {
        const prev = msgs[i] as { role?: string; extra?: Record<string, unknown> };
        if (!prev) break;
        if (prev.role === 'user') break;  // crossed the turn boundary

        const prevCalls = (prev.extra?.['tool_calls'] as Array<{ name?: string }> | undefined) ?? [];
        if (prevCalls.some(c => c.name != null && names.has(c.name))) return true;

        const prevRaw = prev.extra?.['content'];
        if (Array.isArray(prevRaw)) {
          for (const block of prevRaw) {
            if (block != null
                && typeof block === 'object'
                && (block as { type?: unknown }).type === 'function_call'
                && typeof (block as { name?: unknown }).name === 'string'
                && names.has((block as { name: string }).name)) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  classifyMessage(
    content: string,
    message: Pick<Message, 'id' | 'delivery'>,
  ): ContentClassifier {
    const generation = message.delivery.generation;
    let entry = this.classifiers.get(message.id);
    if (!entry || entry.generation !== generation) {
      entry?.classifier.dispose();
      entry = { generation, classifier: createContentClassifier() };
      this.classifiers.set(message.id, entry);
    }
    entry.classifier.update(content);
    return entry.classifier;
  }

  protected markdownDocumentFor(
    content: string,
    message: Pick<Message, 'id' | 'delivery'>,
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

  clearClassifiers(): void {
    for (const [, entry] of this.classifiers) {
      entry.classifier.dispose();
    }
    this.classifiers.clear();
    this.markdownDocuments.clear();
    this.activityContexts.clear();
  }

  onSpecEvent(event: RenderEvent, messageIndex: number): void {
    this.renderEvent.emit({ messageIndex, event });
  }

  /**
   * Forwards a render event bubbled up from a `<chat-tool-views>` component
   * (a client-declared `view`/`ask` tool's rendered UI) to the client-tools
   * coordinator. The coordinator resolves the matching pending `ask` tool call
   * when the event is a `result`. No-op when no client tools are wired.
   */
  protected onClientToolEvent(event: RenderEvent): void {
    const coord = this.coordinator();
    if (!coord) return;
    let agentRef: ReturnType<typeof this.agent>;
    try { agentRef = this.agent(); } catch { return; }
    coord.handleRenderEvent(agentRef, event);
  }

  onA2uiAction(message: A2uiActionMessage): void {
    if (this.agent().isInputBlocked?.()) return;
    void this.agent().submit({ message: JSON.stringify(message) });
  }

  onA2uiEvent(event: RenderEvent, messageIndex: number, surfaceId: string): void {
    this.renderEvent.emit({ messageIndex, surfaceId, event });
  }

  /** Regenerate the assistant response at the given message index. */
  onRegenerate(messageIndex: number): void {
    void this.agent().regenerate(messageIndex);
    this.regenerate.emit();
  }

  onRate(message: unknown, value: 'up' | 'down'): void {
    const idx = this.agent().messages().indexOf(message as never);
    this.rate.emit({ messageIndex: idx, rating: value });
  }

  onCopy(message: unknown, content: string): void {
    const idx = this.agent().messages().indexOf(message as never);
    this.messageCopy.emit({ messageIndex: idx, content });
  }

}
