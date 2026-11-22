// Internal: what the chat UI and its on-demand entry points share, so each is
// one instance: the once-per-application setup, its style tokens and the
// per-message citations resolver. Not a public API; `@threadplane/angular/chat`
// re-exports what is public.
export { ɵCHAT_RUNTIME, injectChatRuntime as ɵinjectChatRuntime } from './src/chat-runtime';
export {
  CHAT_HOST_TOKENS as ɵCHAT_HOST_TOKENS,
  REDUCED_MOTION_LOOP_SELECTORS as ɵREDUCED_MOTION_LOOP_SELECTORS,
  ROOT_TOKEN_STYLES as ɵROOT_TOKEN_STYLES,
} from './src/chat-tokens';
export { CitationsResolverService, mdDefToCitation as ɵmdDefToCitation } from './src/citations-resolver.service';
export type { ResolvedCitation } from './src/citations-resolver.service';
export { toolSourceCitations as ɵtoolSourceCitations } from './src/tool-sources';
export type { ToolActivitySource as ɵToolActivitySource } from './src/tool-sources';
