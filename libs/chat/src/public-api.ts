// Shared types
export type { MessageTemplateType } from './lib/chat.types';

// Agent contract (runtime-neutral)
export type {
  Agent,
  AgentWithHistory,
  Citation,
  CompleteOutcome,
  Message,
  MessageDelivery,
  Role,
  ContentBlock,
  ToolCall,
  ToolCallStatus,
  AgentStatus,
  AgentInterrupt,
  Subagent,
  SubagentStatus,
  AgentSubmitInput,
  AgentSubmitOptions,
  AgentEvent,
  AgentStateUpdateEvent,
  AgentCustomEvent,
  AgentCheckpoint,
  AgentRuntimeTelemetryEvent,
  AgentRuntimeTelemetryPayload,
  AgentRuntimeTelemetryProperties,
  AgentRuntimeTelemetrySink,
} from './lib/agent';
export {
  isUserMessage,
  isAssistantMessage,
  isToolMessage,
  isSystemMessage,
  streamingDelivery,
  completeDelivery,
  staticDelivery,
  createAgentRef,
  AgentError,
  AGENT_ERROR_MESSAGES,
  AGENT_RECOVERY_MESSAGES,
  AGENT_RECOVERY_DETAILS,
  toAgentError,
  isAbortError,
} from './lib/agent';
export type { AgentRef } from './lib/agent';
export type { AgentErrorKind, AgentRecovery } from './lib/agent';

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
export { ChatSubagentsComponent } from './lib/primitives/chat-subagents/chat-subagents.component';
export { ChatThreadListComponent } from './lib/primitives/chat-thread-list/chat-thread-list.component';
export type { Thread, ThreadActionAdapter } from './lib/primitives/chat-thread-list/chat-thread-list.component';
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
export { ChatPopupComponent } from './lib/compositions/chat-popup/chat-popup.component';
export { ChatSidebarComponent } from './lib/compositions/chat-sidebar/chat-sidebar.component';
export { ChatTimelineSliderComponent } from './lib/compositions/chat-timeline-slider/chat-timeline-slider.component';
export { ChatSidenavComponent } from './lib/compositions/chat-sidenav/chat-sidenav.component';
export { ChatSidenavScrimComponent } from './lib/primitives/chat-sidenav-scrim/chat-sidenav-scrim.component';
export type { ChatSidenavMode } from './lib/compositions/chat-sidenav/chat-sidenav.component';
export { ChatInterruptPanelComponent } from './lib/compositions/chat-interrupt-panel/chat-interrupt-panel.component';
export type { InterruptAction } from './lib/compositions/chat-interrupt-panel/chat-interrupt-panel.component';
export { ChatApprovalCardComponent } from './lib/compositions/chat-approval-card/chat-approval-card.component';
export type { ChatApprovalAction } from './lib/compositions/chat-approval-card/chat-approval-card.component';
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

// Views (re-exported from @threadplane/render for convenience)
export { views, withViews, withoutViews, toRenderRegistry } from '@threadplane/render';
export type { ViewRegistry } from '@threadplane/render';

// Streaming / Generative UI
export { createContentClassifier } from './lib/streaming/content-classifier';
export type { ContentClassifier, ContentType } from './lib/streaming/content-classifier';
export { createParseTreeStore } from './lib/streaming/parse-tree-store';
export type { ParseTreeStore, ElementAccumulationState } from './lib/streaming/parse-tree-store';

// A2UI
export { createA2uiSurfaceStore } from './lib/a2ui/surface-store';
export type { A2uiSurfaceStore, A2uiSurfaceState } from './lib/a2ui/surface-store';
export { normalizeViewEntry } from './lib/a2ui/views';
export type { A2uiViewEntry, A2uiViews } from './lib/a2ui/views';
export type { A2uiComponentView } from './lib/a2ui/component-view';
export { createPartialArgsBridge } from './lib/a2ui/partial-args-bridge';
export type { PartialArgsBridge } from './lib/a2ui/partial-args-bridge';
export { normalizeEnvelopeArgs } from './lib/a2ui/envelope-normalizer';
export { A2uiSurfaceComponent } from './lib/a2ui/surface.component';
// surfaceToSpec: internal A2UI plumbing — consumed via relative imports, not public.
export { buildA2uiActionMessage } from './lib/a2ui/build-action-message';
export { a2uiBasicCatalog } from './lib/a2ui/catalog/index';
export { emitBinding } from './lib/a2ui/catalog/emit-binding';
export { a2uiClientCapabilities } from './lib/a2ui/capabilities';

// A2UI catalog components (for custom catalog composition via withViews)
export { A2uiTextFieldComponent } from './lib/a2ui/catalog/text-field.component';
export { A2uiCheckBoxComponent } from './lib/a2ui/catalog/check-box.component';
export { A2uiButtonComponent } from './lib/a2ui/catalog/button.component';
export { A2uiChoicePickerComponent } from './lib/a2ui/catalog/choice-picker.component';
export { A2uiSliderComponent } from './lib/a2ui/catalog/slider.component';
export { A2uiDateTimeInputComponent } from './lib/a2ui/catalog/date-time-input.component';
export { A2uiTextComponent } from './lib/a2ui/catalog/text.component';
export { A2uiIconComponent } from './lib/a2ui/catalog/icon.component';
export { A2uiImageComponent } from './lib/a2ui/catalog/image.component';
export { A2uiColumnComponent } from './lib/a2ui/catalog/column.component';
export { A2uiRowComponent } from './lib/a2ui/catalog/row.component';
export { A2uiCardComponent } from './lib/a2ui/catalog/card.component';
export { A2uiDividerComponent } from './lib/a2ui/catalog/divider.component';
export { A2uiListComponent } from './lib/a2ui/catalog/list.component';
export { A2uiModalComponent } from './lib/a2ui/catalog/modal.component';
export { A2uiTabsComponent } from './lib/a2ui/catalog/tabs.component';
export { A2uiAudioPlayerComponent } from './lib/a2ui/catalog/audio-player.component';
export { A2uiVideoComponent } from './lib/a2ui/catalog/video.component';

// A2UI types (re-exported from @threadplane/a2ui for convenience)
export type {
  A2uiActionMessage, A2uiErrorMessage, A2uiClientDataModel, A2uiClientCapabilities,
  A2uiSurface, A2uiComponent, A2uiComponentBase, A2uiCatalogComponent, A2uiTheme,
  DynamicString, DynamicNumber, DynamicBoolean, DynamicStringList, DynamicValue,
  A2uiChildren, A2uiAction, A2uiEventAction, A2uiFunctionAction, A2uiCheck,
  A2uiPathRef, A2uiFunctionCall,
} from '@threadplane/a2ui';
export {
  isPathRef, isFunctionCall,
  A2UI_WIRE_VERSION, A2UI_MIME_TYPE, A2UI_BASIC_CATALOG_ID,
} from '@threadplane/a2ui';

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
export type { ClientToolsCapability, ClientToolResult } from './lib/client-tools/client-tools-capability';
export { selectPendingClientToolCalls } from './lib/client-tools/select-pending-client-tool-calls';
export type { SelectPendingClientToolCallsInput } from './lib/client-tools/select-pending-client-tool-calls';
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

// Test utilities (no vitest dep — safe to ship in the main runtime bundle)
export { mockAgent } from './lib/testing/mock-agent';
export type { MockAgent, MockAgentOptions } from './lib/testing/mock-agent';

// Conformance helpers ship from the secondary entry point @threadplane/chat/testing
// (they import vitest at module level; keeping them out of the main bundle).
