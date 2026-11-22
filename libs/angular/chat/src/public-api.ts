export { TextTranscriptComponent } from './text-transcript.component';
export { ToolObservationComponent } from './tool-observation.component';

// Shared types
export type { MessageTemplateType } from './lib/chat.types';

// Agent contract. `Agent` is the instance `injectAgent()` from
// `@threadplane/angular` returns, and the data types are the ones
// `@threadplane/core` defines; they are re-exported so a component that only
// renders a conversation needs one import.
export type {
  Agent,
  AgentCheckpoint,
  AgentError,
  AgentErrorDiagnostic,
  AgentErrorKind,
  AgentInputBlock,
  AgentInterrupt,
  AgentInterruptResponse,
  AgentPlanStep,
  AgentRecovery,
  AgentSessionCustomEvent,
  AgentStatus,
  AgentSubagent,
  AgentSubagentStatus,
  AgentSubmitInput,
  AgentSubmitOptions,
  AgentUsage,
  AgentUsageEntry,
  Citation,
  CompleteOutcome,
  ContentBlock,
  Message,
  MessageDelivery,
  PlainValue,
  Role,
  StreamingToolCall,
  ToolCall,
  ToolCallStatus,
} from './lib/agent';
export {
  isUserMessage,
  isAssistantMessage,
  isToolMessage,
  isSystemMessage,
  streamingDelivery,
  completeDelivery,
  staticDelivery,
  agentPlanFromState,
  contentBlocksText,
  agentToolCalls,
  toolCallResult,
  toolCallError,
} from './lib/agent';

// Primitives
export { ChatMessageListComponent, getMessageType } from './lib/primitives/chat-message-list/chat-message-list.component';
export { MessageTemplateDirective } from './lib/primitives/chat-message-list/message-template.directive';
export { ChatMessageComponent } from './lib/primitives/chat-message/chat-message.component';
export type { ChatMessageRole } from './lib/primitives/chat-message/chat-message.component';
export { ChatMessageActionsComponent } from './lib/primitives/chat-message-actions/chat-message-actions.component';
export { ChatWindowComponent } from './lib/primitives/chat-window/chat-window.component';
export { ChatTraceComponent } from './lib/primitives/chat-trace/chat-trace.component';
export type { TraceState } from './lib/primitives/chat-trace/chat-trace.component';
export { ChatReasoningComponent } from './lib/primitives/chat-reasoning/chat-reasoning.component';
export { ChatLauncherButtonComponent } from './lib/primitives/chat-launcher-button/chat-launcher-button.component';
export { ChatSuggestionsComponent } from './lib/primitives/chat-suggestions/chat-suggestions.component';
export { ChatInputComponent, submitMessage } from './lib/primitives/chat-input/chat-input.component';
export { ChatTypingIndicatorComponent, isTyping } from './lib/primitives/chat-typing-indicator/chat-typing-indicator.component';
export { ChatHistorySearchPaletteComponent } from './lib/primitives/chat-history-search-palette/chat-history-search-palette.component';
export { ChatOverflowMenuComponent } from './lib/primitives/chat-overflow-menu/chat-overflow-menu.component';
export type { OverflowMenuItem } from './lib/primitives/chat-overflow-menu/chat-overflow-menu.component';
export { ChatConfirmDialogComponent } from './lib/primitives/chat-confirm-dialog/chat-confirm-dialog.component';
export type { ThreadMatch } from './lib/primitives/chat-history-search-palette/chat-history-search-palette.component';
export { ChatScrollBubbleComponent } from './lib/primitives/chat-scroll-bubble/chat-scroll-bubble.component';
export type { ChatScrollBubbleMode } from './lib/primitives/chat-scroll-bubble/chat-scroll-bubble.component';
export { ChatErrorComponent, extractErrorMessage } from './lib/primitives/chat-error/chat-error.component';
export { ChatInterruptComponent, getInterrupt } from './lib/primitives/chat-interrupt/chat-interrupt.component';
export { ChatToolCallsComponent } from './lib/primitives/chat-tool-calls/chat-tool-calls.component';
export { ChatToolViewsComponent } from './lib/primitives/chat-tool-views/chat-tool-views.component';
export { ChatToolCallTemplateDirective } from './lib/primitives/chat-tool-calls/chat-tool-call-template.directive';
export type { ChatToolCallTemplateContext } from './lib/primitives/chat-tool-calls/chat-tool-call-template.directive';
export { ChatToolResultTemplateDirective } from './lib/primitives/chat-tool-calls/chat-tool-result-template.directive';
export type { ChatToolResultTemplateContext } from './lib/primitives/chat-tool-calls/chat-tool-result-template.directive';
export { resolveToolOutcome, toolOutcomes } from './lib/primitives/chat-tool-activity/tool-outcome';
export { ChatStatusPanelComponent, type ChatStatusPanelTone } from './lib/primitives/chat-status-panel/chat-status-panel.component';
export { ChatSubagentsComponent } from './lib/primitives/chat-subagents/chat-subagents.component';
export { ChatThreadListComponent } from './lib/primitives/chat-thread-list/chat-thread-list.component';
export type { Thread, ThreadActionAdapter, ThreadRowAction } from './lib/primitives/chat-thread-list/chat-thread-list.component';
export type {
  ProjectEntry,
  ThreadDirectory,
  ThreadDirectoryError,
  ThreadDirectorySnapshot,
  ThreadDirectoryStatus,
  ThreadEntry,
} from './lib/thread-directory/thread-directory';
export { ChatProjectListComponent } from './lib/primitives/chat-project-list/chat-project-list.component';
export type { Project, ProjectActionAdapter } from './lib/primitives/chat-project-list/chat-project-list.component';
export { ChatGenuiSkeletonComponent } from './lib/primitives/chat-genui-skeleton/chat-genui-skeleton.component';
export { ChatTimelineComponent } from './lib/primitives/chat-timeline/chat-timeline.component';
export { ChatGenerativeUiComponent } from './lib/primitives/chat-generative-ui/chat-generative-ui.component';
export { ChatWelcomeComponent } from './lib/primitives/chat-welcome/chat-welcome.component';
export { ChatWelcomeSuggestionComponent } from './lib/primitives/chat-welcome/chat-welcome-suggestion.component';
export { ChatSelectComponent } from './lib/primitives/chat-select/chat-select.component';
export type { ChatSelectOption } from './lib/primitives/chat-select/chat-select.component';
export { ChatOverlayOriginDirective, ChatConnectedOverlayDirective } from './lib/primitives/overlay/connected-overlay.directive';
export type { ConnectedPosition, OverlayPositionResult } from './lib/primitives/overlay/connected-position';
export { ChatCitationsComponent, ChatCitationCardTemplateDirective } from './lib/primitives/chat-citations/chat-citations.component';
export { ChatCitationsCardComponent } from './lib/primitives/chat-citations/chat-citations-card.component';
export { ChatCitationPreviewComponent } from './lib/primitives/chat-citations/chat-citation-preview.component';
export {
  deriveDomain, deriveSourceType, deriveMonogram, monogramHue, monogramColor, citationTypeLabel,
  citationTypeMeta, citationSourceVisual, formatPublished,
} from './lib/agent/citation-display';
export type {
  CitationTypeIcon, CitationTypeMeta, CitationSourceVisual,
  CitationImageVisual, CitationTypeIconVisual, CitationMonogramVisual,
} from './lib/agent/citation-display';

// Routing utilities
export { injectThreadRouting } from './lib/routing/thread-routing';
export type { ThreadRoutingConfig } from './lib/routing/thread-routing';

// Lifecycle
export { CHAT_LIFECYCLE } from './lib/lifecycle';
export type { ChatLifecycle } from './lib/lifecycle';

// Compositions
export { ChatComponent } from './lib/compositions/chat/chat.component';
export type { ChatRenderEvent } from './lib/compositions/chat/chat-render-event';
export { ChatActivityTemplateDirective } from './lib/compositions/chat/chat-activity-template.directive';
export type { ChatActivityTemplateContext } from './lib/compositions/chat/chat-activity-template.directive';
export { ChatRunActivityTemplateDirective } from './lib/compositions/chat/chat-run-activity-template.directive';
export type { ChatRunActivityTemplateContext } from './lib/compositions/chat/chat-run-activity-template.directive';
export { ChatInterruptTemplateDirective } from './lib/compositions/chat/chat-interrupt-template.directive';
export type { ChatInterruptTemplateContext } from './lib/compositions/chat/chat-interrupt-template.directive';
export { ChatPopupComponent } from './lib/compositions/chat-popup/chat-popup.component';
export { ChatSidebarComponent } from './lib/compositions/chat-sidebar/chat-sidebar.component';
export { ChatTimelineSliderComponent } from './lib/compositions/chat-timeline-slider/chat-timeline-slider.component';
export { ChatSidenavComponent } from './lib/compositions/chat-sidenav/chat-sidenav.component';
export {
  ChatThreadSidebarComponent,
  ChatThreadRowTemplateDirective,
} from './lib/compositions/chat-thread-sidebar/chat-thread-sidebar.component';
export type {
  ThreadSidebarFeatures,
  ChatThreadRowTemplateContext,
} from './lib/compositions/chat-thread-sidebar/chat-thread-sidebar.component';
export { ChatSidenavScrimComponent } from './lib/primitives/chat-sidenav-scrim/chat-sidenav-scrim.component';
export type { ChatSidenavMode } from './lib/compositions/chat-sidenav/chat-sidenav.component';
export { ChatInterruptPanelComponent } from './lib/compositions/chat-interrupt-panel/chat-interrupt-panel.component';
export type { InterruptAction } from './lib/compositions/chat-interrupt-panel/chat-interrupt-panel.component';
export { ChatApprovalCardComponent } from './lib/compositions/chat-approval-card/chat-approval-card.component';
export type { ChatApprovalAction, ChatApprovalPresentation } from './lib/compositions/chat-approval-card/chat-approval-card.component';
export { ChatToolCallCardComponent } from './lib/compositions/chat-tool-call-card/chat-tool-call-card.component';
export type { ToolCallInfo } from './lib/compositions/chat-tool-call-card/chat-tool-call-card.component';
export { ChatSubagentCardComponent, statusColor } from './lib/compositions/chat-subagent-card/chat-subagent-card.component';

// Citations resolver
export { CitationsResolverService } from './lib/markdown/citations-resolver.service';
export type { ResolvedCitation } from './lib/markdown/citations-resolver.service';

// Streaming
export {
  ChatStreamingMdComponent,
  markdownDocument,
  STREAMING_MARKDOWN_CONTRACT_VIOLATION_POLICY,
} from './lib/streaming/streaming-markdown.component';
export type {
  StreamingMarkdownContractViolationPolicy,
  StreamingMarkdownDocument,
} from './lib/streaming/streaming-markdown.component';

// Markdown rendering primitives + registry
export { MARKDOWN_VIEW_REGISTRY } from './lib/markdown/markdown-view-registry';
export { MarkdownChildrenComponent } from './lib/markdown/markdown-children.component';
export { cacheplaneMarkdownViews } from './lib/markdown/cacheplane-markdown-views';

// Per-node-type markdown view components (consumers use these to override
// individual nodes via withViews(cacheplaneMarkdownViews, { … })).
export { MarkdownDocumentComponent }       from './lib/markdown/views/markdown-document.component';
export { MarkdownParagraphComponent }      from './lib/markdown/views/markdown-paragraph.component';
export { MarkdownHeadingComponent }        from './lib/markdown/views/markdown-heading.component';
export { MarkdownBlockquoteComponent }     from './lib/markdown/views/markdown-blockquote.component';
export { MarkdownListComponent }           from './lib/markdown/views/markdown-list.component';
export { MarkdownListItemComponent }       from './lib/markdown/views/markdown-list-item.component';
export { MarkdownCodeBlockComponent }      from './lib/markdown/views/markdown-code-block.component';
export { MarkdownCodeCopyComponent }       from './lib/markdown/views/markdown-code-copy.component';
export { MarkdownThematicBreakComponent }  from './lib/markdown/views/markdown-thematic-break.component';
export { MarkdownTextComponent }           from './lib/markdown/views/markdown-text.component';
export { MarkdownEmphasisComponent }       from './lib/markdown/views/markdown-emphasis.component';
export { MarkdownStrongComponent }         from './lib/markdown/views/markdown-strong.component';
export { MarkdownStrikethroughComponent }  from './lib/markdown/views/markdown-strikethrough.component';
export { MarkdownInlineCodeComponent }     from './lib/markdown/views/markdown-inline-code.component';
export { MarkdownMathComponent }           from './lib/markdown/views/markdown-math.component';
export { MarkdownHtmlComponent }           from './lib/markdown/views/markdown-html.component';
export { MarkdownLinkComponent }           from './lib/markdown/views/markdown-link.component';
export { MarkdownAutolinkComponent }       from './lib/markdown/views/markdown-autolink.component';
export { MarkdownImageComponent }          from './lib/markdown/views/markdown-image.component';
export { MarkdownSoftBreakComponent }      from './lib/markdown/views/markdown-soft-break.component';
export { MarkdownHardBreakComponent }      from './lib/markdown/views/markdown-hard-break.component';
export { MarkdownCitationReferenceComponent } from './lib/markdown/views/markdown-citation-reference.component';
export { MarkdownTableComponent }             from './lib/markdown/views/markdown-table.component';
export { MarkdownTableRowComponent }          from './lib/markdown/views/markdown-table-row.component';
export { MarkdownTableCellComponent }         from './lib/markdown/views/markdown-table-cell.component';
export { IS_HEADER_ROW }                      from './lib/markdown/markdown-table-row.token';

// Shared utilities
// (Internal styling constants CHAT_MARKDOWN_STYLES and ICON_* are intentionally
//  NOT exported — they are implementation details consumed via relative imports
//  inside the lib; theming is done through CSS custom properties, not these.)
export { renderMarkdown } from './lib/streaming/markdown-render';
export { messageContent } from './lib/compositions/shared/message-utils';
export { formatDuration } from './lib/utils/format-duration';

// Views (re-exported from @threadplane/angular/render for convenience)
export { views, withViews, withoutViews, toRenderRegistry } from '@threadplane/angular/render';
export type { ViewRegistry } from '@threadplane/angular/render';

// Streaming / Generative UI
export { createContentClassifier } from './lib/streaming/content-classifier';
export type { ContentClassifier, ContentType } from './lib/streaming/content-classifier';
export { createParseTreeStore } from './lib/streaming/parse-tree-store';
export type { ParseTreeStore, ElementAccumulationState } from './lib/streaming/parse-tree-store';

// A2UI: `<chat [a2ui]>` takes a renderer; `@threadplane/angular/a2ui` has it,
// with the surface, the catalog and the A2UI helpers.
export type { ChatA2uiRenderer, ChatA2uiInputs } from './lib/compositions/chat/chat-a2ui';

// Client tools (declaration API — tools/action/view/ask + JSON-schema derivation)
export { tools, action, view, ask } from './lib/client-tools/tools';
export { deriveJsonSchema } from './lib/client-tools/to-json-schema';
export type {
  ClientToolContinuationOptions,
  ClientToolContinuationLimitEvent,
  ClientToolContinuationPolicy,
  ClientToolDef,
  ClientToolExecutionOptions,
  ClientToolLifecycle,
  ClientToolLifecyclePhase,
  ClientToolViewProps,
  AnyFunctionToolDef,
  FunctionToolDef,
  FunctionToolHandlerContext,
  ViewToolDef,
  AskToolDef,
  ClientToolRegistry,
  StandardSchemaV1,
  StandardSchemaInferInput,
  StandardSchemaInferOutput,
} from './lib/client-tools/tool-def';
export type { ViewProps } from './lib/client-tools/component-inputs';
/** Inferred argument type for a schema (alias of StandardSchemaInferOutput). */
export type ToolArgs<S extends import('./lib/client-tools/tool-def').StandardSchemaV1> = import('./lib/client-tools/tool-def').StandardSchemaInferOutput<S>;
export type { ClientToolSpec } from './lib/client-tools/to-json-schema';
export type { ClientToolResult } from './lib/client-tools/client-tools-capability';
export { stopAgent } from './lib/client-tools/stop-agent';
export { validateArgs, executeFunctionTool } from './lib/client-tools/execute';
export { startClientToolExecutor } from './lib/client-tools/client-tool-executor';
export type { ClientToolExecutorOptions } from './lib/client-tools/client-tool-executor';
export {
  cancelledClientToolResult,
  clientToolGuardFailureResult,
  defaultInterruptedClientToolResult,
  shouldClaimBeforeExecute,
} from './lib/client-tools/client-tool-execution-guard';
export type {
  ClientToolExecutionGuard,
  ClientToolExecutionKey,
  ClientToolExecutionRecord,
  ClientToolExecutionStore,
} from './lib/client-tools/client-tool-execution-guard';
// createClientToolsCoordinator: internal — the chat compositions wire it; not public.
export { toClientToolSpecs } from './lib/client-tools/client-tools-coordinator';
export type { ClientToolsCoordinator } from './lib/client-tools/client-tools-coordinator';

// `mockAgent` stays in the main entry on purpose: the documented way to render
// `<chat>` before a backend exists is `mockAgent()` from `@threadplane/angular/chat`.
// It needs the in-memory session of `@threadplane/core/testing`, which has no
// test-runner dependency. Everything that needs one is in
// `@threadplane/angular/chat/testing`.
export { mockAgent } from './lib/testing/mock-agent';
export type { MockAgent, MockAgentField, MockAgentLifecycle, MockAgentOptions } from './lib/testing/mock-agent';

// Conformance helpers ship from the secondary entry point @threadplane/angular/chat/testing
// (they import vitest at module level; keeping them out of the main bundle).

// The once-per-application chat setup every chat component injects. Private
// (ɵ): a seam for tooling that proves the setup without rendering a component.
export { ɵCHAT_RUNTIME } from './lib/styles/chat-runtime';

// Development-only devtools hook: the adapters report which signals each event
// wrote (names and timing, never values). Private (ɵ) — an adapter seam, not API.
export { ɵcreateDevtoolsEmitter } from './lib/devtools/devtools-emitter';
export type {
  DevtoolsEmitter as ɵDevtoolsEmitter,
  DevtoolsPseudoEvent as ɵDevtoolsPseudoEvent,
  LangGraphDevtoolsSignal as ɵLangGraphDevtoolsSignal,
  AgUiDevtoolsSignal as ɵAgUiDevtoolsSignal,
} from './lib/devtools/devtools-emitter';
// Development-only render report: which spec elements mounted, fell back, did
// not resolve, or did not render, per surface (AG-UI DevTools UI tab).
export { ɵcreateRenderDevtoolsReporter, ɵprovideRenderDevtools } from './lib/devtools/devtools-render-report';
export type {
  RenderDevtoolsReport as ɵRenderDevtoolsReport,
  RenderDevtoolsReporter as ɵRenderDevtoolsReporter,
} from './lib/devtools/devtools-render-report';
// Development-only scripted runs: the AG-UI DevTools run simulator arms the
// next run(s) of an adapter with protocol events in place of the network.
// Private (ɵ) — an adapter seam, not API.
export { ɵdevtoolsScriptedRuns } from './lib/devtools/devtools-scripted-runs';
export type {
  DevtoolsScriptedRuns as ɵDevtoolsScriptedRuns,
  LangGraphScriptedRun as ɵLangGraphScriptedRun,
  AgUiScriptedRun as ɵAgUiScriptedRun,
} from './lib/devtools/devtools-scripted-runs';
export {
  ChatToolActivityComponent,
  ChatToolActivityGroupComponent,
  toolActivityPhase,
  type ToolActivityDelivery,
  type ToolActivityInfo,
  type ToolActivityOutcome,
  type ToolActivityRetry,
  type ToolActivitySource,
  type ToolActivityPhase,
  type ToolOutcomeCall,
  type ToolOutcomeDecoder,
} from './lib/primitives/chat-tool-activity/chat-tool-activity.component';
