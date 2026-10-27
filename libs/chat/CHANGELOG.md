# `@threadplane/chat` changelog

## [Unreleased]

### Removed

- **`@langchain/core` is no longer a peer dependency.** `messageContent()` now takes
  any `{ content: unknown }`, so nothing in the published package imports LangChain.
  Keep installing it for `@threadplane/langgraph`, which still requires it.
- **`provideChat()`, `ChatConfig`, and `CHAT_CONFIG` are gone.** No component in the library ever injected the token, so calling `provideChat({})` configured nothing: `renderRegistry`, `avatarLabel`, and `assistantName` were values only your own wrappers could read back. Delete the call and the import; `provideAgent()` from your runtime adapter is the only provider the chat components require, and everything they render is driven by component inputs. If you were reading `CHAT_CONFIG` from your own components, define your own injection token for those values.

### Fixed

- **An application-level `MARKDOWN_VIEW_REGISTRY` provider now takes effect.** `<chat-streaming-md>` provided the token on its own injector from its own default, which shadowed any provider at the application root or on a route. It now resolves most-specific-first — the `[viewRegistry]` input, then an ancestor injector, then `cacheplaneMarkdownViews` — so one root provider overrides markdown rendering across every chat surface, including inside `<chat>`, with nothing to forward.

### Added

- **Development-only scripted runs for the AG-UI DevTools run simulator.** A `threadplane:devtools:arm` `CustomEvent` (`{ v: 1, armId, adapter, runs }`) makes the next runs of that adapter's agents stream the scripted LangGraph frames or AG-UI events through the adapter's real event handling instead of the network; `threadplane:devtools:disarm` cancels, and every step is answered with a `threadplane:devtools:ack`. At most 8 runs of 5,000 frames or events and 2 MB per arm, one pending arm per adapter, expiring after 10 minutes. The store ships here as the private `ɵdevtoolsScriptedRuns`, behind the same development-only gate and opt-out as the signals report; production builds strip it.
- **A development-only devtools hook for the runtime adapters.** `@threadplane/langgraph` and `@threadplane/ag-ui` now report, per event, the names of the signals it wrote as a `threadplane:devtools` `CustomEvent` on `window` (names and timing only — never values), for the AG-UI DevTools extension's Signals tab. The emitter ships here as the private `ɵcreateDevtoolsEmitter`; production builds strip it, and `window.__THREADPLANE_DEVTOOLS_DISABLED__ = true` turns it off in development.
- **`--tplane-chat-launcher-offset-x` / `--tplane-chat-launcher-offset-y`** (both `1rem`) position the `<chat-popup>` launcher, replacing hard-coded corner offsets. The popup window reads the horizontal one too, so it stays aligned when you move the launcher clear of a bottom bar or a consent banner.

### Changed

- **`messageContent()` takes any `{ content: unknown }`.** It was typed against LangChain's `BaseMessage` while every caller holds the runtime-neutral `Message` from `agent.messages()`, which forced a cast. The function only ever reads `.content`, so the parameter is now structural and both shapes type-check.
- **`ContentType` no longer includes `'mixed'`.** `createContentClassifier` never emitted it, so any consumer branching on it had dead code. Prose with inline JSON-render specs classifies as `'markdown'`, as it always did.
- **`@angular/forms` peer dependency removed:** `chat-input` now binds its textarea with a direct `[value]`/`(input)` pair (fixes the composer keeping sent text under zoneless + OnPush). `@threadplane/chat` no longer requires `@angular/forms` — consumers may drop it unless they use it themselves.
- **json-render store isolation:** `<chat>`'s json-render message surfaces no longer fall back to the conversation-wide internal store — each surface self-seeds from its spec's `state` unless you pass an explicit `[store]`. Pass `[store]` (e.g. `signalStateStore({})`) when dashboards should receive backend agent state (STATE_SNAPSHOT) or share live values across surfaces; same-key dashboards in different messages are now isolated by default. Tool views (`chat-tool-views`) keep the previous shared-store behavior.
- **Public API trim:** `@threadplane/chat` no longer re-exports `provideViews` / `VIEW_REGISTRY` from `@threadplane/render`. Consumers using `<render-spec>` / `<render-element>` directly should import from `@threadplane/render`. For chat's markdown view overrides, pass `overrideViews(cacheplaneMarkdownViews, { … })` from `@threadplane/render` to the `[viewRegistry]` input on `<chat-streaming-md>`, or provide the same value for `MARKDOWN_VIEW_REGISTRY` at the application root or on a route to override every markdown surface at once. The previously-documented `provideViews(withViews(…))` pattern never drove rendering.
- **License:** `@threadplane/chat` is now MIT-licensed for commercial and noncommercial use. The package no longer accepts or checks activation tokens.
