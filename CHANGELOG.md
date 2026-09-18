## Unreleased

### Features

- **ag-ui:** expose complete interrupt sessions, optional atomic persistence and authoritative recovery, and provider lifetime cleanup.

### Fixes

- **langgraph:** retain null-payload resume commands and combined message/state input for intentional retry without reusing an aborted signal.
- **ag-ui:** retain exact resume decisions, roll failed state back to committed boundaries, and reject stale callbacks and concurrent recovery actions.

### Breaking changes

- **langgraph:** `LangGraphClientOptions.apiKey` is removed and `defaultHeaders` is added. The SDK client is always constructed with `apiKey: null`, so the adapter never attaches a deployment key and never reads one from the environment. Send a per-user session token with `clientOptions.defaultHeaders` for LangGraph custom auth, and keep deployment credentials on an endpoint you own.
- **cockpit-telemetry:** the LangSmith runtime target forwards its key as `clientOptions.defaultHeaders['x-api-key']` instead of `clientOptions.apiKey`.
- **ag-ui:** native batches take precedence over compatibility events in `auto` mode. Select `legacy-command` or `mastra-command` explicitly for backends requiring command transport.
- **ag-ui:** resume requires a pending batch and each native ID exactly once; scalar responses apply only to single-entry batches. New messages, regeneration, and client-tool continuation cannot abandon an unresolved interrupt.
- **ag-ui:** uncertain resumes require authoritative reconciliation before retry. Durable client claims require an application-provided atomic store; backend duplicate-effect protection requires server idempotency.

## 0.1.0 (2026-09-08)

### 🚀 Features

- one route family — every capability is a docs page ([#1010](https://github.com/cacheplane/angular-agent-framework/pull/1010))
- **ag-ui:** scriptable provideFakeAgent() and a duplicate-AgentRef warning ([#1053](https://github.com/cacheplane/angular-agent-framework/pull/1053))
- **chat:** public scrollToBottom() on ChatComponent; the stage pins through it ([#1045](https://github.com/cacheplane/angular-agent-framework/pull/1045))
- ⚠️  **chat:** remove provideChat(), fix app-level markdown registry overrides, and three API cleanups ([#1055](https://github.com/cacheplane/angular-agent-framework/pull/1055))
- **docs:** ExampleCode include + guards; retire the walkthrough renderer ([#1025](https://github.com/cacheplane/angular-agent-framework/pull/1025))
- **examples/chat:** executable approval tools behind the hero's pause ([#1011](https://github.com/cacheplane/angular-agent-framework/pull/1011))
- **examples/chat:** /stage — the real chat beside the real devtools, seekable to any recorded time (live-stage plan 2 of 3) ([#1030](https://github.com/cacheplane/angular-agent-framework/pull/1030))
- **growth:** add inspectable company research pilot ([#1009](https://github.com/cacheplane/angular-agent-framework/pull/1009))
- **growth:** explain company capture failures ([#1015](https://github.com/cacheplane/angular-agent-framework/pull/1015))
- **growth:** attribute campaign sends per template with a bounded Resend tag ([#1020](https://github.com/cacheplane/angular-agent-framework/pull/1020))
- **growth:** enrich install activations and report developer journeys ([#1027](https://github.com/cacheplane/angular-agent-framework/pull/1027))
- **growth:** integrate gated Dawn company enrichment ([#1028](https://github.com/cacheplane/angular-agent-framework/pull/1028))
- **growth:** cut over company enrichment to Dawn ([#1041](https://github.com/cacheplane/angular-agent-framework/pull/1041))
- **growth:** schedule founder emails on Pacific business mornings ([#1044](https://github.com/cacheplane/angular-agent-framework/pull/1044))
- **lifecycle:** founder session offer as step one, one-word unsubscribe link ([#1012](https://github.com/cacheplane/angular-agent-framework/pull/1012))
- **lifecycle:** add optional bounded Firecrawl company capture ([#1017](https://github.com/cacheplane/angular-agent-framework/pull/1017))
- **lifecycle:** integrate self-hosted Firecrawl browser scraper ([#1019](https://github.com/cacheplane/angular-agent-framework/pull/1019))
- **lifecycle:** fulfillment mail in the campaign register ([#1018](https://github.com/cacheplane/angular-agent-framework/pull/1018))
- **lifecycle:** print the business postal address in every email footer ([#1021](https://github.com/cacheplane/angular-agent-framework/pull/1021))
- **website:** homepage restructure (live-stage plan 1 of 3) ([#1024](https://github.com/cacheplane/angular-agent-framework/pull/1024))
- **website:** whitepaper block and toast on the form kit; old form CSS removed ([#1026](https://github.com/cacheplane/angular-agent-framework/pull/1026))
- **website:** the stage on the homepage — one real run, scrubbed by scroll (live-stage plan 3 of 3) ([#1032](https://github.com/cacheplane/angular-agent-framework/pull/1032))
- **website:** the stage rail is a completeness ledger ([#1043](https://github.com/cacheplane/angular-agent-framework/pull/1043))
- **website:** the social card shows the product, and the brand gets a real mark ([#1047](https://github.com/cacheplane/angular-agent-framework/pull/1047))
- **website:** retire the last stale positioning from the brand assets ([#1051](https://github.com/cacheplane/angular-agent-framework/pull/1051))
- **website:** architecture diagram — the UI layer between your users and your agents ([#1048](https://github.com/cacheplane/angular-agent-framework/pull/1048))
- **website:** the homepage closes on a quiet open-source strip ([#1057](https://github.com/cacheplane/angular-agent-framework/pull/1057))
- **website:** ATC theme spike — aviation yellow, Archivo Black, scope navy ([#1058](https://github.com/cacheplane/angular-agent-framework/pull/1058), [#15253](https://github.com/cacheplane/angular-agent-framework/issues/15253), [#004090](https://github.com/cacheplane/angular-agent-framework/issues/004090), [#1048](https://github.com/cacheplane/angular-agent-framework/issues/1048), [#963](https://github.com/cacheplane/angular-agent-framework/issues/963), [#1057](https://github.com/cacheplane/angular-agent-framework/issues/1057))

### 🩹 Fixes

- **growth:** validate telemetry and align PostHog dashboards ([#1050](https://github.com/cacheplane/angular-agent-framework/pull/1050))
- **langgraph:** lifecycle token, error kind, root registry, required interrupt, awaitable mock transport ([#1054](https://github.com/cacheplane/angular-agent-framework/pull/1054))
- **libs:** make the type-tests targets runnable again ([#1064](https://github.com/cacheplane/angular-agent-framework/pull/1064))
- **lifecycle:** ground company research in substantive evidence ([add9e6801](https://github.com/cacheplane/angular-agent-framework/commit/add9e6801))
- ⚠️  **middleware:** server_tools router default; Python emit_custom_event helper ([#1052](https://github.com/cacheplane/angular-agent-framework/pull/1052))
- **render:** honor every ActionBinding field, per-item visible, real element lifecycle and state paths ([#1056](https://github.com/cacheplane/angular-agent-framework/pull/1056))
- **render:** resolve repeated element readiness and props in the row's own scope ([#1062](https://github.com/cacheplane/angular-agent-framework/pull/1062))
- **website:** pin the stage hold one millisecond inside it so the frame reports pause ([#1034](https://github.com/cacheplane/angular-agent-framework/pull/1034), [#1032](https://github.com/cacheplane/angular-agent-framework/issues/1032))
- **website:** ATC theme follow-ups — favicon, social cards, whitepapers ([#1059](https://github.com/cacheplane/angular-agent-framework/pull/1059), [#004090](https://github.com/cacheplane/angular-agent-framework/issues/004090), [#15253](https://github.com/cacheplane/angular-agent-framework/issues/15253))
- **website:** give arch-flow console badges an on-dark palette ([#1060](https://github.com/cacheplane/angular-agent-framework/pull/1060), [#1](https://github.com/cacheplane/angular-agent-framework/issues/1), [#15253](https://github.com/cacheplane/angular-agent-framework/issues/15253))

### ⚠️  Breaking Changes

- **chat:** remove provideChat(), fix app-level markdown registry overrides, and three API cleanups  ([#1055](https://github.com/cacheplane/angular-agent-framework/pull/1055))
- **middleware:** server_tools router default; Python emit_custom_event helper  ([#1052](https://github.com/cacheplane/angular-agent-framework/pull/1052))
  the default is now 'server_tools'. Rename your server tool
  node to server_tools and drop the override, or keep the override pointing at
  whatever name your node uses. There is no shim. The Python package's
  route_after_agent() keeps tools_node="tools"; Python LangGraph has no such
  namespace collision.
  Two integration specs record the behavior: one invokes a graph whose ToolNode
  is named server_tools with no override and asserts the tool actually ran (it
  failed with "Branch condition returned unknown or null destination" before the
  fix), and one pins the addNode('tools', …) throw so the reason is written down.
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>

## 0.0.66 (2026-09-05)

### 🚀 Features

- **growth:** add synthetic Dawn research app for LangSmith ([#1003](https://github.com/cacheplane/angular-agent-framework/pull/1003))
- **growth:** link install and development runtime to founder outreach ([#1004](https://github.com/cacheplane/angular-agent-framework/pull/1004))
- **telemetry:** collect installs and development progress for founder outreach ([#1007](https://github.com/cacheplane/angular-agent-framework/pull/1007))
- **website:** lead-form kit and footer newsletter fix ([#994](https://github.com/cacheplane/angular-agent-framework/pull/994))
- **website:** contact page on the form kit; enterprise form merges into it ([#995](https://github.com/cacheplane/angular-agent-framework/pull/995))
- **website:** replace the Yes wall with the reliability band ([#996](https://github.com/cacheplane/angular-agent-framework/pull/996))
- **website:** homepage rebuild — category hero, live demo, install dialog ([#997](https://github.com/cacheplane/angular-agent-framework/pull/997))
- **website:** phone-width hero poster, re-recorded desktop poster, redesigned OG card ([#1002](https://github.com/cacheplane/angular-agent-framework/pull/1002))

### 🩹 Fixes

- **growth:** accept Resend's current webhook payload shape ([#989](https://github.com/cacheplane/angular-agent-framework/pull/989))
- **growth:** accept Resend webhook payloads that carry a headers array; log every outcome ([#991](https://github.com/cacheplane/angular-agent-framework/pull/991))
- **hero:** drop the internal tool name from the walkthrough prompt ([#1006](https://github.com/cacheplane/angular-agent-framework/pull/1006))
- **langgraph:** adopt a transport-created thread id instead of aborting the run ([#1005](https://github.com/cacheplane/angular-agent-framework/pull/1005))
- **langgraph, ag-ui:** give each AgentRef its own agent instead of aliasing one token ([#1000](https://github.com/cacheplane/angular-agent-framework/pull/1000))
- **release:** update internal peer ranges with synchronized versions ([#1007](https://github.com/cacheplane/angular-agent-framework/pull/1007))
- **telemetry:** keep contributor workspace installation inert ([#1007](https://github.com/cacheplane/angular-agent-framework/pull/1007))
- **telemetry:** provide inert install bridges in source checkouts ([#1007](https://github.com/cacheplane/angular-agent-framework/pull/1007))
- **telemetry:** exclude automated browsers from developer collection ([#1007](https://github.com/cacheplane/angular-agent-framework/pull/1007))
- **website:** readable code panes, self-healing hero handshake, focus ring, mobile hero ([#998](https://github.com/cacheplane/angular-agent-framework/pull/998))
- **website:** restore the works-with ribbon and subhead highlight; retime the hero walkthrough ([#999](https://github.com/cacheplane/angular-agent-framework/pull/999))

## 0.0.65 (2026-09-03)

### 🚀 Features

- Mastra runtime Lane B — ag-ui-mastra Node service, proxy map, rt-mastra example, deploy workflow ([#903](https://github.com/cacheplane/angular-agent-framework/pull/903), [#899](https://github.com/cacheplane/angular-agent-framework/issues/899))
- add operational sidebar control plane ([#921](https://github.com/cacheplane/angular-agent-framework/pull/921))
- unify docs and cockpit workspace ([#949](https://github.com/cacheplane/angular-agent-framework/pull/949))
- unify docs and runtime control plane ([#963](https://github.com/cacheplane/angular-agent-framework/pull/963))
- **ag-ui:** upgrade @ag-ui/* to 0.0.59 and send protocol-standard top-level resume ([#891](https://github.com/cacheplane/angular-agent-framework/pull/891))
- **ag-ui:** consume the protocol's SUBAGENT_* events and subagentRunId attribution ([#955](https://github.com/cacheplane/angular-agent-framework/pull/955))
- **cockpit:** per-topic framework adapters in the AG-UI deployment generator ([#894](https://github.com/cacheplane/angular-agent-framework/pull/894))
- **cockpit:** Microsoft Agent Framework runtime example (cockpit/runtimes) ([#896](https://github.com/cacheplane/angular-agent-framework/pull/896), [#888](https://github.com/cacheplane/angular-agent-framework/issues/888), [#889](https://github.com/cacheplane/angular-agent-framework/issues/889), [#891](https://github.com/cacheplane/angular-agent-framework/issues/891))
- **cockpit:** AWS Strands runtime example (rt-strands) ([#898](https://github.com/cacheplane/angular-agent-framework/pull/898))
- **cockpit:** make Run discoverable from Code ([#934](https://github.com/cacheplane/angular-agent-framework/pull/934))
- **cockpit:** ag-ui subagents demo emits the protocol's SUBAGENT_* events ([#962](https://github.com/cacheplane/angular-agent-framework/pull/962))
- **e2e-harness:** restore aimock — replay+record wrapper, drift infra, scrub repairs ([#947](https://github.com/cacheplane/angular-agent-framework/pull/947))
- **e2e-harness:** bucket metadata-hash mismatches as promptChanged in the drift differ ([#951](https://github.com/cacheplane/angular-agent-framework/pull/951))
- **examples:** ag-ui demo emits the protocol's SUBAGENT_* events ([#964](https://github.com/cacheplane/angular-agent-framework/pull/964))
- **examples/chat:** /hero route — replayed LangGraph walkthrough with live takeover ([#976](https://github.com/cacheplane/angular-agent-framework/pull/976))
- **runtimes:** strands subagent delegation demo with standard SUBAGENT_* emission ([#956](https://github.com/cacheplane/angular-agent-framework/pull/956))
- **runtimes:** maf subagent delegation demo with queue-merged SUBAGENT_* emission ([#957](https://github.com/cacheplane/angular-agent-framework/pull/957))
- **runtimes:** mastra subagent delegation demo with SUBAGENT_* injection in the bridge ([#958](https://github.com/cacheplane/angular-agent-framework/pull/958))
- **runtimes:** mastra sub-agent streaming via a public-API stream tee ([#961](https://github.com/cacheplane/angular-agent-framework/pull/961))
- **runtimes:** stand-down guard so the mastra subagent injector retires ([#971](https://github.com/cacheplane/angular-agent-framework/pull/971))
- **website:** homepage punch list — hero merge, FAQ copy, FeatureBlock rows everywhere ([#897](https://github.com/cacheplane/angular-agent-framework/pull/897))
- **website:** homepage lower half — ledgers, numerals, paper, intent-gated toast ([#901](https://github.com/cacheplane/angular-agent-framework/pull/901))
- **website:** add 'We Measured the Runtime Swap' blog post ([#905](https://github.com/cacheplane/angular-agent-framework/pull/905), [#888](https://github.com/cacheplane/angular-agent-framework/issues/888), [#889](https://github.com/cacheplane/angular-agent-framework/issues/889), [#891](https://github.com/cacheplane/angular-agent-framework/issues/891))
- **website:** tighten the pricing page ([#908](https://github.com/cacheplane/angular-agent-framework/pull/908))
- **website:** library pages in the homepage manner ([#914](https://github.com/cacheplane/angular-agent-framework/pull/914))
- **website:** design-program follow-ups — showcase rails, Angular proof cell, closer order ([#919](https://github.com/cacheplane/angular-agent-framework/pull/919))
- **website:** align the docs index with the control plane ([#923](https://github.com/cacheplane/angular-agent-framework/pull/923), [#920](https://github.com/cacheplane/angular-agent-framework/issues/920), [#911](https://github.com/cacheplane/angular-agent-framework/issues/911))
- **website:** ninth arc — solutions and pilot join the design language ([#927](https://github.com/cacheplane/angular-agent-framework/pull/927))
- **website:** wire the docs -> cockpit handoff for deep-agents and runtimes ([#938](https://github.com/cacheplane/angular-agent-framework/pull/938), [#937](https://github.com/cacheplane/angular-agent-framework/issues/937), [#913](https://github.com/cacheplane/angular-agent-framework/issues/913))

### 🩹 Fixes

- subagent hardening batch — eviction order, args-buffer scoping, field-based lookup, AIMOCK_MODE warning ([#960](https://github.com/cacheplane/angular-agent-framework/pull/960))
- **ag-ui:** detect protocol-standard RUN_FINISHED interrupt outcomes ([#888](https://github.com/cacheplane/angular-agent-framework/pull/888))
- **ag-ui:** carry interrupt identity on the resume payload ([#889](https://github.com/cacheplane/angular-agent-framework/pull/889))
- **ag-ui:** relative imports in subagents topic + deploy boot gate ([#899](https://github.com/cacheplane/angular-agent-framework/pull/899))
- **ag-ui:** resolve the subagents agent URL against <base href> ([#902](https://github.com/cacheplane/angular-agent-framework/pull/902))
- **ag-ui:** attributed TOOL_CALL_START links the child message's toolCallIds so cards draw the call ([#965](https://github.com/cacheplane/angular-agent-framework/pull/965))
- **ci:** unbreak main — drop verify assertions for the removed pricing matrix ([#915](https://github.com/cacheplane/angular-agent-framework/pull/915), [#908](https://github.com/cacheplane/angular-agent-framework/issues/908))
- **ci:** accept branded AG-UI compatibility marker ([#930](https://github.com/cacheplane/angular-agent-framework/pull/930))
- **ci:** stop fanning out the whole cockpit e2e matrix for unrelated changes ([#939](https://github.com/cacheplane/angular-agent-framework/pull/939), [#932](https://github.com/cacheplane/angular-agent-framework/issues/932))
- **ci:** bump scorecard-action to v2.4.4 so the image pulls again ([#940](https://github.com/cacheplane/angular-agent-framework/pull/940), [#367732848534](https://github.com/cacheplane/angular-agent-framework/issues/367732848534))
- **ci:** compare requirements.txt drift against git, not a scratch export ([#967](https://github.com/cacheplane/angular-agent-framework/pull/967), [#966](https://github.com/cacheplane/angular-agent-framework/issues/966))
- **ci:** give the Website Vercel build its growth form policy ([#981](https://github.com/cacheplane/angular-agent-framework/pull/981), [#968](https://github.com/cacheplane/angular-agent-framework/issues/968))
- **ci:** scope vercel promote to the team that owns the deployment ([#982](https://github.com/cacheplane/angular-agent-framework/pull/982), [#963](https://github.com/cacheplane/angular-agent-framework/issues/963), [#945](https://github.com/cacheplane/angular-agent-framework/issues/945))
- **ci:** open the protected immutable cockpit preview with its own automation bypass ([#984](https://github.com/cacheplane/angular-agent-framework/pull/984), [#983](https://github.com/cacheplane/angular-agent-framework/issues/983), [#974](https://github.com/cacheplane/angular-agent-framework/issues/974))
- **cockpit:** teach the cockpit the runtimes product ([#910](https://github.com/cacheplane/angular-agent-framework/pull/910))
- **cockpit:** point docsPath at docs pages that actually exist ([#918](https://github.com/cacheplane/angular-agent-framework/pull/918))
- **cockpit:** accept the platform slash collapse for the consecutive-slash raw canary ([#987](https://github.com/cacheplane/angular-agent-framework/pull/987))
- **deployments:** regenerate ag-ui-dev artifacts after the --no-dev re-export ([#970](https://github.com/cacheplane/angular-agent-framework/pull/970), [#967](https://github.com/cacheplane/angular-agent-framework/issues/967), [#963](https://github.com/cacheplane/angular-agent-framework/issues/963))
- **examples:** sync requirements.txt with uv.lock; guard drift in CI ([#966](https://github.com/cacheplane/angular-agent-framework/pull/966), [#964](https://github.com/cacheplane/angular-agent-framework/issues/964))
- **examples/chat:** keep reading pauses in the hero walkthrough under reduced motion ([#979](https://github.com/cacheplane/angular-agent-framework/pull/979))
- **langgraph:** harden subagent attribution — ladder tests, empty-description guard, nested-delegation streams ([#945](https://github.com/cacheplane/angular-agent-framework/pull/945))
- **lifecycle:** own enrichment provenance in code; **mailbox-poller:** drop numeric separators ([#985](https://github.com/cacheplane/angular-agent-framework/pull/985))
- **website:** repair and redesign the docs adapter picker ([#911](https://github.com/cacheplane/angular-agent-framework/pull/911), [#892](https://github.com/cacheplane/angular-agent-framework/issues/892))
- **website:** give library-neutral docs pages an honest control plane ([#920](https://github.com/cacheplane/angular-agent-framework/pull/920), [#892](https://github.com/cacheplane/angular-agent-framework/issues/892))
- **website:** final-review fix batch ([#922](https://github.com/cacheplane/angular-agent-framework/pull/922))
- **website:** restore padding on Shiki code blocks ([#924](https://github.com/cacheplane/angular-agent-framework/pull/924), [#863](https://github.com/cacheplane/angular-agent-framework/issues/863), [#926](https://github.com/cacheplane/angular-agent-framework/issues/926))
- **website:** close the docs shell's nav-height and column-measure defects ([#942](https://github.com/cacheplane/angular-agent-framework/pull/942), [#932](https://github.com/cacheplane/angular-agent-framework/issues/932))
- **website:** legible diagram text on phones — 600px floor + scroll shadows ([#953](https://github.com/cacheplane/angular-agent-framework/pull/953))
- **website:** production-smoke spec must not use import.meta.url ([#973](https://github.com/cacheplane/angular-agent-framework/pull/973), [#963](https://github.com/cacheplane/angular-agent-framework/issues/963))
- **website:** keep the post-promotion e2e run off the local fixture runtime ([#983](https://github.com/cacheplane/angular-agent-framework/pull/983), [#982](https://github.com/cacheplane/angular-agent-framework/issues/982))
- **workspace:** keep utility panel focus when the drawer opens in one commit ([#972](https://github.com/cacheplane/angular-agent-framework/pull/972))

## 0.0.64 (2026-08-31)

### 🚀 Features

- support Angular 22 consumers ([#887](https://github.com/cacheplane/angular-agent-framework/pull/887))
- **website:** Basecamp-informed homepage — Yes wall, proof strip, problem-first hero ([#885](https://github.com/cacheplane/angular-agent-framework/pull/885), [#881](https://github.com/cacheplane/angular-agent-framework/issues/881))
- **website:** homepage cohesion — logo ribbon + feature-block rows ([#890](https://github.com/cacheplane/angular-agent-framework/pull/890))
- **website:** add 'What Changes in Your Angular Code When the Agent Runtime Changes' ([#884](https://github.com/cacheplane/angular-agent-framework/pull/884))

### 🩹 Fixes

- **website:** mobile polish for the homepage ([#886](https://github.com/cacheplane/angular-agent-framework/pull/886))

## 0.0.63 (2026-08-31)

### 🚀 Features

- move all packages to MIT ([#881](https://github.com/cacheplane/angular-agent-framework/pull/881))
- **examples/chat:** announce the research subagent's stream identity ([#874](https://github.com/cacheplane/angular-agent-framework/pull/874))
- **website:** unify all fonts onto the next/font variables ([#876](https://github.com/cacheplane/angular-agent-framework/pull/876))
- **website:** redesign pricing and licensing journey ([#875](https://github.com/cacheplane/angular-agent-framework/pull/875))

### 🩹 Fixes

- **proxy:** remove unauthenticated _proxy_debug disclosure endpoint ([#882](https://github.com/cacheplane/angular-agent-framework/pull/882))
- **website:** AnnouncementToast mobile presentation and a11y ([#877](https://github.com/cacheplane/angular-agent-framework/pull/877))
- **website:** fit meta descriptions to the search-snippet budget ([#880](https://github.com/cacheplane/angular-agent-framework/pull/880), [#826](https://github.com/cacheplane/angular-agent-framework/issues/826))

## 0.0.62 (2026-08-30)

### 🚀 Features

- **cockpit:** wire the dark design tokens into the 14 dark-designed apps ([#868](https://github.com/cacheplane/angular-agent-framework/pull/868))
- **design-tokens:** generate tokens-dark.css for the dark-designed cockpit apps ([#867](https://github.com/cacheplane/angular-agent-framework/pull/867), [#111](https://github.com/cacheplane/angular-agent-framework/issues/111), [#64](https://github.com/cacheplane/angular-agent-framework/issues/64))
- **langgraph:** server-announced subagent identity ([#869](https://github.com/cacheplane/angular-agent-framework/pull/869), [#864](https://github.com/cacheplane/angular-agent-framework/issues/864))
- **website:** premium-polish pass on the docs chrome ([#872](https://github.com/cacheplane/angular-agent-framework/pull/872), [#865](https://github.com/cacheplane/angular-agent-framework/issues/865), [#004090](https://github.com/cacheplane/angular-agent-framework/issues/004090))

### ❤️ Thank You

- Brian Love @blove
- Claude Opus 5

## 0.0.61 (2026-08-30)

### 🚀 Features

- **website:** add 'What Fixture Replay Can't Catch' blog post ([#854](https://github.com/cacheplane/angular-agent-framework/pull/854), [#846](https://github.com/cacheplane/angular-agent-framework/issues/846))

### 🩹 Fixes

- **langgraph:** don't guess subagent attribution when it's a coin flip ([#864](https://github.com/cacheplane/angular-agent-framework/pull/864))
- **website:** docs polish 1/3 — sticky rails, anchor offsets, honest mobile widths ([#861](https://github.com/cacheplane/angular-agent-framework/pull/861))
- **website:** docs polish 2/3 — breadcrumb, tables, rails, and mdx details ([#863](https://github.com/cacheplane/angular-agent-framework/pull/863))
- **website:** docs polish 3/3 — a11y and interaction ([#865](https://github.com/cacheplane/angular-agent-framework/pull/865))

### ❤️ Thank You

- Brian Love @blove
- Claude Opus 5

## 0.0.60 (2026-08-29)

### 🚀 Features

- **ci:** working aimock drift detection ([#846](https://github.com/cacheplane/angular-agent-framework/pull/846))
- **design-tokens:** complete the CSS-var surface so the website can leave inline styles ([#845](https://github.com/cacheplane/angular-agent-framework/pull/845), [#555770](https://github.com/cacheplane/angular-agent-framework/issues/555770), [#8](https://github.com/cacheplane/angular-agent-framework/issues/8), [#1](https://github.com/cacheplane/angular-agent-framework/issues/1))

### 🩹 Fixes

- **langgraph:** subagent cards rendered an empty transcript ([#847](https://github.com/cacheplane/angular-agent-framework/pull/847), [#751](https://github.com/cacheplane/angular-agent-framework/issues/751))

### ❤️ Thank You

- Brian Love @blove
- Claude Opus 5

## 0.0.59 (2026-08-29)

### 🚀 Features

- **examples/chat:** open the demo on a chosen suggestion via ?featured= ([#832](https://github.com/cacheplane/angular-agent-framework/pull/832))
- ⚠️  **langgraph:** classify any namespaced event as child content ([#844](https://github.com/cacheplane/angular-agent-framework/pull/844))
- **website:** AI search optimization — Search Console harness, structured data, and measurement ([#826](https://github.com/cacheplane/angular-agent-framework/pull/826), [#1](https://github.com/cacheplane/angular-agent-framework/issues/1))
- **website:** first-person /about prose, sourced and guarded ([#828](https://github.com/cacheplane/angular-agent-framework/pull/828), [#826](https://github.com/cacheplane/angular-agent-framework/issues/826))
- **website:** link Brian's X and LinkedIn profiles from the Person node ([#829](https://github.com/cacheplane/angular-agent-framework/pull/829))
- **website:** give each solutions page real code, and split the duplicated proof point ([#830](https://github.com/cacheplane/angular-agent-framework/pull/830))
- **website:** let homepage sections switch between video and code ([#831](https://github.com/cacheplane/angular-agent-framework/pull/831))
- **website:** finish the medium switcher — Render, Ship, and live tabs ([#833](https://github.com/cacheplane/angular-agent-framework/pull/833), [#832](https://github.com/cacheplane/angular-agent-framework/issues/832))
- **website:** add 'What injectAgent() Actually Returns' blog post ([#836](https://github.com/cacheplane/angular-agent-framework/pull/836))
- **website:** add 'json-render vs A2UI' blog post ([#837](https://github.com/cacheplane/angular-agent-framework/pull/837))
- **website:** add 'LangGraph Subgraphs: When to Split a Graph and When Not To' blog post ([#839](https://github.com/cacheplane/angular-agent-framework/pull/839), [#838](https://github.com/cacheplane/angular-agent-framework/issues/838), [#1](https://github.com/cacheplane/angular-agent-framework/issues/1))

### 🩹 Fixes

- **cockpit-langgraph:** make the subgraphs example demonstrate real nesting ([#838](https://github.com/cacheplane/angular-agent-framework/pull/838))
- **website:** repair frontmatter handling in docs, then use it for SERP descriptions ([#827](https://github.com/cacheplane/angular-agent-framework/pull/827))

### ⚠️  Breaking Changes

- **langgraph:** classify any namespaced event as child content  ([#844](https://github.com/cacheplane/angular-agent-framework/pull/844))

### ❤️ Thank You

- Brian Love @blove
- Claude Fable 5
- Claude Opus 5

## 0.0.58 (2026-08-18)

### 🚀 Features

- ⚠️  **a2ui:** migrate to A2UI v0.9.1 stable wire format ([#817](https://github.com/cacheplane/angular-agent-framework/pull/817))
- **a2ui:** client-side functions (Phase 2 of the v0.9 migration) ([#818](https://github.com/cacheplane/angular-agent-framework/pull/818))
- **a2ui:** validation checks + client error message (Phase 3 of the v0.9 migration) ([#819](https://github.com/cacheplane/angular-agent-framework/pull/819))
- **a2ui:** live sendDataModel round-trip + capabilities helper (Phase 4 of the v0.9 migration) ([#820](https://github.com/cacheplane/angular-agent-framework/pull/820))
- **a2ui:** advertise client capabilities through the transports ([#822](https://github.com/cacheplane/angular-agent-framework/pull/822))
- **chat:** render A2UI surface theme chrome (agentDisplayName + iconUrl) ([#823](https://github.com/cacheplane/angular-agent-framework/pull/823))

### 🩹 Fixes

- **ci:** never promote a superseded commit to production ([#816](https://github.com/cacheplane/angular-agent-framework/pull/816), [#813](https://github.com/cacheplane/angular-agent-framework/issues/813), [#814](https://github.com/cacheplane/angular-agent-framework/issues/814))
- **deploy:** restore shared-deployment namespace merge broken by src/__init__.py ([#825](https://github.com/cacheplane/angular-agent-framework/pull/825), [#642](https://github.com/cacheplane/angular-agent-framework/issues/642))
- **examples:** raise AG-UI demo initial bundle budget to chat parity ([#821](https://github.com/cacheplane/angular-agent-framework/pull/821))
- **langgraph:** reject non-durable client tool flushes ([#809](https://github.com/cacheplane/angular-agent-framework/pull/809))
- **langgraph:** retain client tool results across failed runs ([#810](https://github.com/cacheplane/angular-agent-framework/pull/810))
- **website:** render grouped API entries on middleware helpers page ([#815](https://github.com/cacheplane/angular-agent-framework/pull/815))

### ⚠️  Breaking Changes

- **a2ui:** migrate to A2UI v0.9.1 stable wire format  ([#817](https://github.com/cacheplane/angular-agent-framework/pull/817))

### ❤️ Thank You

- Brian Love @blove
- Claude Fable 5
- Claude Opus 5

## 0.0.57 (2026-08-09)

### 🚀 Features

- add client tool abort signal ([#786](https://github.com/cacheplane/angular-agent-framework/pull/786))
- add client tool execution guard ([#788](https://github.com/cacheplane/angular-agent-framework/pull/788))
- add client tool execution claims ([#789](https://github.com/cacheplane/angular-agent-framework/pull/789))
- batch client tool continuations ([#792](https://github.com/cacheplane/angular-agent-framework/pull/792))
- add signal resource agent proof ([448503dc](https://github.com/cacheplane/angular-agent-framework/commit/448503dc))
- add signal resource adapter package ([7ee0b445](https://github.com/cacheplane/angular-agent-framework/commit/7ee0b445))
- **chat-graph:** spike client-tool binding + client-tool-aware routing (#itinerary) ([74d45e2b](https://github.com/cacheplane/angular-agent-framework/commit/74d45e2b))
- **chat-graph:** add itinerary Stop state channel ([e23fb54a](https://github.com/cacheplane/angular-agent-framework/commit/e23fb54a))
- **chat-graph:** planner framing + itinerary context injection when client tools present ([cdaeeeac](https://github.com/cacheplane/angular-agent-framework/commit/cdaeeeac))
- **cockpit-langgraph:** redesign 7 langgraph examples' bespoke UI (encapsulated CSS, sky-blue accent) ([#777](https://github.com/cacheplane/angular-agent-framework/pull/777))
- **examples-chat:** wire Google Maps key via inject-env (local only) ([de8f706e](https://github.com/cacheplane/angular-agent-framework/commit/de8f706e))
- **examples-chat:** port map-bounds, geocoding, google-maps-loader ([e55515c7](https://github.com/cacheplane/angular-agent-framework/commit/e55515c7))
- **examples-chat:** port ItineraryStore — empty start, value hydration, no localStorage ([0f37460b](https://github.com/cacheplane/angular-agent-framework/commit/0f37460b))
- **examples-chat:** port itinerary panel/map/day-card/clear-day UI (langgraph agent) ([662c94a4](https://github.com/cacheplane/angular-agent-framework/commit/662c94a4))
- **examples-chat:** port itinerary client tools (drop get_itinerary, use demo agent) ([cc953105](https://github.com/cacheplane/angular-agent-framework/commit/cc953105))
- **examples-chat:** sync itinerary — submit state + value hydration + SDK checkpoint push ([d5bae8ac](https://github.com/cacheplane/angular-agent-framework/commit/d5bae8ac))
- **examples-chat:** App-mode toggle + map-compatible routing (embed↔sidebar coercion) ([62b456f7](https://github.com/cacheplane/angular-agent-framework/commit/62b456f7))
- **examples-chat:** App-mode cockpit layout (map bg + itinerary overlay + sidenav→drawer) ([7d941ad6](https://github.com/cacheplane/angular-agent-framework/commit/7d941ad6))
- **examples-chat:** wire client tools + cockpit into modes; context-aware welcome suggestions ([77ababf3](https://github.com/cacheplane/angular-agent-framework/commit/77ababf3))
- **examples-chat:** dark map via colorScheme, drop cloud-style dependency ([f8e1383d](https://github.com/cacheplane/angular-agent-framework/commit/f8e1383d))
- **examples-chat:** map light/dark follows the app color scheme ([eee067b5](https://github.com/cacheplane/angular-agent-framework/commit/eee067b5))

### 🩹 Fixes

- remove unused fake agent delay variable ([#787](https://github.com/cacheplane/angular-agent-framework/pull/787))
- **AG-UI:** version authoritative snapshot rewrites ([#804](https://github.com/cacheplane/angular-agent-framework/pull/804))
- **chat:** closed drawer sidenav must not intercept clicks on content ([#778](https://github.com/cacheplane/angular-agent-framework/pull/778))
- **chat:** never leave a client tool call unanswered on the server ([#807](https://github.com/cacheplane/angular-agent-framework/pull/807), [#782](https://github.com/cacheplane/angular-agent-framework/issues/782), [#805](https://github.com/cacheplane/angular-agent-framework/issues/805))
- **cockpit-examples:** use CSS sidebar widths ([496db8e8](https://github.com/cacheplane/angular-agent-framework/commit/496db8e8))
- **examples-chat:** import vitest globals in client-tools.spec (build compiles specs) ([2ab792e0](https://github.com/cacheplane/angular-agent-framework/commit/2ab792e0))
- **examples-chat:** drop dangling get_itinerary reference in client-tool error strings ([c81c7b87](https://github.com/cacheplane/angular-agent-framework/commit/c81c7b87))
- **examples-chat:** reliably persist itinerary to checkpoint (retry mid-run 409) ([f3f29ede](https://github.com/cacheplane/angular-agent-framework/commit/f3f29ede))
- **examples-chat:** retry checkpoint push only on 409, capped (review) ([3fb99b46](https://github.com/cacheplane/angular-agent-framework/commit/3fb99b46))

### ❤️ Thank You

- Brian Love @blove
- Claude Opus 4.8
- Claude Opus 5

## 0.0.47 (2026-05-26)

### 🚀 Features

- **billing:** Stripe Customer Portal route + email + /thanks link ([#537](https://github.com/cacheplane/angular-agent-framework/pull/537))
- **blog:** brand-polish landing + Recent articles home section ([#543](https://github.com/cacheplane/angular-agent-framework/pull/543))
- ⚠️  **chat:** relicense @ngaf/chat — MIT → PolyForm Noncommercial 1.0.0 OR commercial ([#501](https://github.com/cacheplane/angular-agent-framework/pull/501))
- **examples-chat:** URL-based thread routing — /<mode>/:threadId ([#500](https://github.com/cacheplane/angular-agent-framework/pull/500))
- **examples-chat:** round-trip agent knobs through URL query params ([#527](https://github.com/cacheplane/angular-agent-framework/pull/527))
- **licensing:** verification runtime — minting deploy + prod public-key wiring (PR C) ([#510](https://github.com/cacheplane/angular-agent-framework/pull/510))
- **minting:** handle charge.refunded to revoke license + email customer ([#529](https://github.com/cacheplane/angular-agent-framework/pull/529))
- **website:** pricing rebuild + sitewide MIT-qualification (PR B) ([#502](https://github.com/cacheplane/angular-agent-framework/pull/502))
- **website:** Stripe Checkout for paid pricing tiers (PR B-Stripe) ([#508](https://github.com/cacheplane/angular-agent-framework/pull/508))
- **website:** AG-UI tutorial blog post + brand-polished blog template ([#528](https://github.com/cacheplane/angular-agent-framework/pull/528))

### 🩹 Fixes

- **ci:** minting-deploy health check uses correct domain mint.threadplane.ai ([#512](https://github.com/cacheplane/angular-agent-framework/pull/512), [#510](https://github.com/cacheplane/angular-agent-framework/issues/510))
- **ci:** add required PR gate ([bd2bebb7](https://github.com/cacheplane/angular-agent-framework/commit/bd2bebb7))
- **ci:** repair main test regressions ([9e17fcb6](https://github.com/cacheplane/angular-agent-framework/commit/9e17fcb6))
- **examples-chat:** collapse mode routes via UrlMatcher to preserve component instance ([#504](https://github.com/cacheplane/angular-agent-framework/pull/504), [#500](https://github.com/cacheplane/angular-agent-framework/issues/500))
- **graph:** use SDK in-process ASGI transport for thread metadata writes ([#493](https://github.com/cacheplane/angular-agent-framework/pull/493), [#492](https://github.com/cacheplane/angular-agent-framework/issues/492), [#474](https://github.com/cacheplane/angular-agent-framework/issues/474))
- **minting:** handle one-time-payment Checkout sessions + align tier slugs (PR D) ([#516](https://github.com/cacheplane/angular-agent-framework/pull/516))
- **minting:** rename DATABASE_URL → MINTING_DATABASE_URL to avoid Neon integration override ([#525](https://github.com/cacheplane/angular-agent-framework/pull/525))
- **minting:** read current_period_end from subscription item ([#534](https://github.com/cacheplane/angular-agent-framework/pull/534), [#532](https://github.com/cacheplane/angular-agent-framework/issues/532))

### ⚠️  Breaking Changes

- **chat:** relicense @ngaf/chat — MIT → PolyForm Noncommercial 1.0.0 OR commercial  ([#501](https://github.com/cacheplane/angular-agent-framework/pull/501))

### ❤️ Thank You

- Brian Love @blove
- Claude Opus 4.7 (1M context)
- Claude Sonnet 4.6

## 0.0.35 (2026-05-16)

### 🚀 Features

- **gtm:** Spec 1E — qualified lead + drift guard (analytics-foundation 1e) ([#376](https://github.com/cacheplane/angular-agent-framework/pull/376))

### 🩹 Fixes

- **chat:** lifecycle-guaranteed root token injection (production regression) ([#375](https://github.com/cacheplane/angular-agent-framework/pull/375))

### ❤️ Thank You

- Brian Love @blove
- Claude Opus 4.7
- Claude Opus 4.7 (1M context)

## 0.0.34 (2026-05-16)

### 🚀 Features

- validate telemetry install and dogfood runtime events ([#370](https://github.com/cacheplane/angular-agent-framework/pull/370))
- **gtm:** Spec 1D — website reconciliation (analytics-foundation 1d) ([#365](https://github.com/cacheplane/angular-agent-framework/pull/365), [#1](https://github.com/cacheplane/angular-agent-framework/issues/1))

### 🩹 Fixes

- remove legacy licensing telemetry ([#367](https://github.com/cacheplane/angular-agent-framework/pull/367))
- **c-generative-ui:** tighten plan_tools to call ONE tool for filter/scope ([#363](https://github.com/cacheplane/angular-agent-framework/pull/363))
- **c-generative-ui:** use gpt-5 + minimal reasoning for planner LLM ([#372](https://github.com/cacheplane/angular-agent-framework/pull/372), [#363](https://github.com/cacheplane/angular-agent-framework/issues/363))
- **chat:** user-bubble word-wrap — give .chat-message__layout width:100% ([#362](https://github.com/cacheplane/angular-agent-framework/pull/362), [#313](https://github.com/cacheplane/angular-agent-framework/issues/313), [#325](https://github.com/cacheplane/angular-agent-framework/issues/325))
- **chat:** A2UI surface progressive renderer must route through render-spec ([#371](https://github.com/cacheplane/angular-agent-framework/pull/371))
- **render:** strip undeclared inputs in NgComponentOutlet pass (NG0303) ([#368](https://github.com/cacheplane/angular-agent-framework/pull/368))

### ❤️ Thank You

- Brian Love @blove
- Claude Opus 4.7
- Claude Opus 4.7 (1M context)

## 0.0.33 (2026-05-16)

### 🚀 Features

- **c-generative-ui:** airline operations KPI dashboard (PR 3 of 4) ([#355](https://github.com/cacheplane/angular-agent-framework/pull/355))
- **chat:** chat-launcher-button emits (clicked) output ([#354](https://github.com/cacheplane/angular-agent-framework/pull/354))
- **cockpit:** aimock harness library + per-example e2e (Phase 2) ([#356](https://github.com/cacheplane/angular-agent-framework/pull/356))

### 🩹 Fixes

- **c-generative-ui:** switch emit_state to get_stream_writer (LangGraph 1.x) ([#360](https://github.com/cacheplane/angular-agent-framework/pull/360))
- **chat:** chat-debug right-dock self-feedback (peer-only claim reads) ([#359](https://github.com/cacheplane/angular-agent-framework/pull/359), [#346](https://github.com/cacheplane/angular-agent-framework/issues/346))
- **cockpit:** Spec 1C smoke-test fixes (nx run, env, hydration, posthog) ([#357](https://github.com/cacheplane/angular-agent-framework/pull/357))
- **website-e2e:** assert differentiator section by stable id, not stale heading copy ([#358](https://github.com/cacheplane/angular-agent-framework/pull/358))

### ❤️ Thank You

- Brian Love @blove
- Claude Opus 4.7
- Claude Opus 4.7 (1M context)

## v0.0.32 (2026-05-16)

### 🚀 Features

- **c-examples:** aviation foundation + c-tool-calls + c-subagents (PR 1 of 4) ([#347](https://github.com/cacheplane/angular-agent-framework/pull/347))
- **c-examples:** aviation prompts for 7 simple c-* graphs (PR 2 of 4) ([#350](https://github.com/cacheplane/angular-agent-framework/pull/350))
- **chat:** move chat-debug launcher + fix Dark theme override ([#341](https://github.com/cacheplane/angular-agent-framework/pull/341))
- **chat:** chat-debug × chat-sidebar coexistence (edge-claim primitive + auto-dock) ([#346](https://github.com/cacheplane/angular-agent-framework/pull/346))
- **cockpit:** aimock E2E harness — Phase 1 (streaming pilot, replaces legacy cockpit e2e) ([#349](https://github.com/cacheplane/angular-agent-framework/pull/349))
- **gtm:** Spec 1C — cockpit instrumentation (analytics-foundation 1c) ([#351](https://github.com/cacheplane/angular-agent-framework/pull/351), [#328](https://github.com/cacheplane/angular-agent-framework/issues/328))

### ❤️ Thank You

- Brian Love @blove
- Claude Opus 4.7
- Claude Opus 4.7 (1M context)

## 0.0.31 (2026-05-15)

### 🚀 Features

- **example-layouts:** PR-0 auto-install side effect + pilot cleanup ([#338](https://github.com/cacheplane/angular-agent-framework/pull/338))
- **website:** Phase 5 — marketing rewire to canonical demo ([#335](https://github.com/cacheplane/angular-agent-framework/pull/335))

### 🩹 Fixes

- **telemetry:** preserve public publish packaging and add install reporting dashboards ([#340](https://github.com/cacheplane/angular-agent-framework/pull/340))
- **telemetry:** publish package as public ([4f463f35](https://github.com/cacheplane/angular-agent-framework/commit/4f463f35))

### ❤️ Thank You

- Brian Love @blove
- Claude Opus 4.7
- Claude Opus 4.7 (1M context)

## 0.0.29 — 2026-05-08

### Fixed

- **`@ngaf/langgraph`** — `regenerate(index)` now repositions the LangGraph thread via `as_node: '__start__'` before re-submitting, so the next pull resumes at the entry node and re-runs `generate` against the rolled-back state. Previously the run could resume mid-graph and skip generation. (#209)

### Added

- **`@ngaf/langgraph`** — `regenerate(assistantMessageIndex)` is now declared on the public `LangGraphAgent` surface (previously implemented + tested but missing from `agent.types.ts`). JSDoc matches the canonical `Agent.regenerate` contract in `@ngaf/chat`. (#207, #208)
- **`AgentTransport.updateState`** — optional `options.asNode` parameter mirrors LangGraph's `as_node`, used by `regenerate()` to anchor the rolled-back state at the entry node.

### Changed

- All 7 publishable @ngaf libraries synchronized to `0.0.29` per project policy (single version across the suite).

---

## 0.0.28 — 2026-05-07

### Breaking

- **`@ngaf/langgraph`** — removed the `messagesKey` option from `AgentOptions`. The messages slot is now fixed at the `messages` state key, matching the LangGraph Python/JS conventions. Consumers passing `messagesKey: 'customKey'` should rename the upstream graph state slot to `messages` instead. (Landed in #202; this entry backfills the release notes.)

### Fixed

- **`@ngaf/langgraph`** — `RemoveMessage` wire-shape now includes `role` + `content` so checkpoint rollback (used by `regenerate()`) round-trips correctly through the LangGraph SDK serializer.

---

## 0.0.27 — 2026-05-06

### Fixed

- **`@ngaf/langgraph`** — `regenerate(N)` now performs proper server-side rollback: emits `RemoveMessage` instances for every raw `BaseMessage` at index > userIdx and calls `client.threads.updateState` to roll back LangGraph thread state. Local buffer truncated **inclusive** of the preceding user message; re-runs via `manager.submit(null)`. Fixes the 2u/2a duplication regression from 0.0.26. (#200)
- **`@ngaf/ag-ui`** — `regenerate(N)` truncates inclusive of user, syncs source agent state via `source.setMessages(trimmed)`, then calls `source.runAgent()`. (#200)

### Added

- **`AgentTransport.updateState()`** — optional method on the transport interface; `FetchStreamTransport` implements it via `client.threads.updateState`. `StreamManagerBridge` exposes `updateState()` + `currentThreadId`. Safe no-op when unsupported. (#200)

### Changed

- **`@ngaf/ag-ui`** — replaced `fast-json-patch.applyPatch` with an inline ~50-line RFC-6902 helper (`apply-patch.ts`). Eliminates the CommonJS-in-ESM crash in Vite/vitest ESM contexts. (#200)

---

## 0.0.26 — 2026-05-05

### Added

- **`Agent.regenerate(index)`** — new method on the `Agent` interface implemented by both LangGraph and AG-UI adapters. Replace-semantics: discards the target assistant message and all subsequent messages, then re-runs against the prior user prompt. (#199)
- **`<chat-message-actions>`** — regenerate button is disabled while `agent.isLoading()`. (#199)

### Fixed

- **Regenerate semantics** — clicking "Regenerate response" no longer duplicates the conversation; runs the agent on the prior user prompt and replaces. (#199)

### Changed

- **`@ngaf/chat`** — `@cacheplane/partial-markdown` peer bumped to `^0.3.0` (consumes nested-list parser fix and `StreamStatus` rename).
- All 16 @ngaf libraries synchronized to `0.0.26`.

---

## 0.0.25 — 2026-05-04

### Fixed (live-browser smoke)

- **`<chat-input>`** — textarea now auto-resizes from `scrollHeight` (capped at 200px / ~8 lines) so multi-line input via Shift+Enter is visible. Previously stuck at the fixed 24px / `rows="1"` height. (#198)
- **`<chat-select>`** — Escape now closes the menu when focus is on the trigger (previously only handled keydown inside the menu). (#198)
- **`<chat-message-actions>`** — thumbs-up/down rating buttons gain `[attr.aria-pressed]` bound to the rating signal so screen readers can communicate toggle state. (#198)

---

## 0.0.24 — 2026-05-04

### Fixed (live-browser smoke)

- **Markdown table rendering** — `MarkdownTableComponent` now imports and dispatches `MarkdownTableRowComponent` directly instead of walking row children, so the `IS_HEADER_ROW` DI provider runs and `<thead>`/`<tbody>` cells render as proper `<th>`/`<td>`. (#197)
- **Citation marker without URL** — splits resolved branch into "with URL" (`<a [attr.href]>`) and "without URL" (`<span class="chat-citation-marker--no-url">`); switched to `[attr.href]` for explicit attribute removal so we no longer emit `<a href="">`. (#197)
- **Sources panel** — Pandoc-only citations (`[^id]:` defs in message content with no provider metadata) now render in `<chat-citations>`. Optionally injects `CitationsResolverService` and merges markdown-sidecar defs; `Message.citations` takes precedence by id. (#197)
- **Task-list checkbox layout** — checkbox + text now flow on a single line via flexbox on `.chat-md-list-item--task` with collapsed inner `<p>` margin. Multi-paragraph task items still wrap correctly. (#197)

---

## 0.0.23 — 2026-05-04

### Added

- **`@ngaf/langgraph`** — public-API export of `extractCitations` (already wired internally in 0.0.21; advanced consumers building custom adapters can now reuse). (#196)
- **`@ngaf/ag-ui`** — public-API export of `bridgeCitationsState`. (#196)

### Changed

- All 16 @ngaf libraries synchronized to `0.0.23`.

---

## 0.0.22 — 2026-05-04

### Added

- **`@ngaf/chat`** — markdown view components for GFM tables (`chat-md-table`, `chat-md-table-row`, `chat-md-table-cell`) and task-list checkbox prefix on `MarkdownListItemComponent`. The view registry now exposes all 22 node types emitted by `@cacheplane/partial-markdown@0.2.0`.

### Changed

- All 16 @ngaf libraries synchronized to `0.0.22`.

---

## 0.0.21 — 2026-05-04

### Added

- **`@ngaf/chat`** — `Citation` interface, `Message.citations` field, `<chat-citations>` primitive (sources panel), `MarkdownCitationReferenceComponent` registered in the markdown view registry, `CitationsResolverService` for message-first / markdown-fallback citation lookup.
- **`@ngaf/langgraph`** — `extractCitations()` populates `Message.citations` from `additional_kwargs.citations` or `additional_kwargs.sources`.
- **`@ngaf/ag-ui`** — `bridgeCitationsState()` populates `Message.citations` from STATE_DELTA at JSON Pointer `/citations/{messageId}`.
- **`@cacheplane/partial-markdown`** peer in `@ngaf/chat` bumped to `^0.2.0`.

### Changed

- **All @ngaf libraries synchronized to `0.0.21`** per project policy (single version across the suite).

## 0.0.2 (2026-05-01)

### 🩹 Fixes

- **minting-service:** rename @cacheplane/* imports to @ngaf/* ([#150](https://github.com/cacheplane/angular-agent-framework/pull/150), [#145](https://github.com/cacheplane/angular-agent-framework/issues/145))

### ❤️ Thank You

- Brian Love @blove
- Claude Opus 4

## 0.0.1 (2026-05-01)

### 🚀 Features

- add cockpit registry foundation ([758995c2](https://github.com/cacheplane/angular-agent-framework/commit/758995c2))
- scaffold cockpit app and harness ([d14ff406](https://github.com/cacheplane/angular-agent-framework/commit/d14ff406))
- add manifest-driven cockpit shell ([78e8f5e3](https://github.com/cacheplane/angular-agent-framework/commit/78e8f5e3))
- add cockpit registry foundation ([f199b6fd](https://github.com/cacheplane/angular-agent-framework/commit/f199b6fd))
- scaffold cockpit app and harness ([60591a9c](https://github.com/cacheplane/angular-agent-framework/commit/60591a9c))
- add manifest-driven cockpit shell ([54ddcc37](https://github.com/cacheplane/angular-agent-framework/commit/54ddcc37))
- add metadata-driven cockpit docs system ([a6fa88f4](https://github.com/cacheplane/angular-agent-framework/commit/a6fa88f4))
- roll out cockpit capability matrix ([89147140](https://github.com/cacheplane/angular-agent-framework/commit/89147140))
- add cockpit testing and deployment gates ([ec0aba99](https://github.com/cacheplane/angular-agent-framework/commit/ec0aba99))
- refresh cockpit workspace ui ([83f069a1](https://github.com/cacheplane/angular-agent-framework/commit/83f069a1))
- glassy gradient website redesign + docs refresh ([#3](https://github.com/cacheplane/angular-agent-framework/pull/3))
- autogenerated API reference from JSDoc ([#4](https://github.com/cacheplane/angular-agent-framework/pull/4))
- Mintlify-aligned docs design + code highlighting ([#6](https://github.com/cacheplane/angular-agent-framework/pull/6))
- animated arch diagram, copy buttons, tab labels, deploy docs ([#8](https://github.com/cacheplane/angular-agent-framework/pull/8))
- gradient feature chips, copy icon, TOC fix ([#9](https://github.com/cacheplane/angular-agent-framework/pull/9))
- add @cacheplane/render and @cacheplane/chat libraries ([d2a8bd63](https://github.com/cacheplane/angular-agent-framework/commit/d2a8bd63))
- rebrand to Angular Agent Framework — agent() + @cacheplane/angular ([#39](https://github.com/cacheplane/angular-agent-framework/pull/39), [#27](https://github.com/cacheplane/angular-agent-framework/issues/27), [#28](https://github.com/cacheplane/angular-agent-framework/issues/28), [#29](https://github.com/cacheplane/angular-agent-framework/issues/29))
- add lead capture form to whitepaper announcement toast ([#49](https://github.com/cacheplane/angular-agent-framework/pull/49), [#27](https://github.com/cacheplane/angular-agent-framework/issues/27), [#28](https://github.com/cacheplane/angular-agent-framework/issues/28), [#29](https://github.com/cacheplane/angular-agent-framework/issues/29))
- animated company logo scroll strip for social proof ([#50](https://github.com/cacheplane/angular-agent-framework/pull/50), [#27](https://github.com/cacheplane/angular-agent-framework/issues/27), [#28](https://github.com/cacheplane/angular-agent-framework/issues/28), [#29](https://github.com/cacheplane/angular-agent-framework/issues/29))
- add Loops.so integration for drip email campaigns ([#51](https://github.com/cacheplane/angular-agent-framework/pull/51), [#27](https://github.com/cacheplane/angular-agent-framework/issues/27), [#28](https://github.com/cacheplane/angular-agent-framework/issues/28), [#29](https://github.com/cacheplane/angular-agent-framework/issues/29))
- replace Loops with self-hosted drip via Resend scheduled_at ([#52](https://github.com/cacheplane/angular-agent-framework/pull/52), [#27](https://github.com/cacheplane/angular-agent-framework/issues/27), [#28](https://github.com/cacheplane/angular-agent-framework/issues/28), [#29](https://github.com/cacheplane/angular-agent-framework/issues/29))
- unified gradient-header email template design ([#53](https://github.com/cacheplane/angular-agent-framework/pull/53), [#27](https://github.com/cacheplane/angular-agent-framework/issues/27), [#28](https://github.com/cacheplane/angular-agent-framework/issues/28), [#29](https://github.com/cacheplane/angular-agent-framework/issues/29))
- generative UI views system — views() API + chat integration ([#57](https://github.com/cacheplane/angular-agent-framework/pull/57), [#14](https://github.com/cacheplane/angular-agent-framework/issues/14), [#55](https://github.com/cacheplane/angular-agent-framework/issues/55), [#48](https://github.com/cacheplane/angular-agent-framework/issues/48), [#56](https://github.com/cacheplane/angular-agent-framework/issues/56), [#8](https://github.com/cacheplane/angular-agent-framework/issues/8), [#9](https://github.com/cacheplane/angular-agent-framework/issues/9), [#10](https://github.com/cacheplane/angular-agent-framework/issues/10), [#11](https://github.com/cacheplane/angular-agent-framework/issues/11), [#12](https://github.com/cacheplane/angular-agent-framework/issues/12), [#13](https://github.com/cacheplane/angular-agent-framework/issues/13), [#2](https://github.com/cacheplane/angular-agent-framework/issues/2), [#16](https://github.com/cacheplane/angular-agent-framework/issues/16), [#19](https://github.com/cacheplane/angular-agent-framework/issues/19), [#24](https://github.com/cacheplane/angular-agent-framework/issues/24), [#25](https://github.com/cacheplane/angular-agent-framework/issues/25), [#26](https://github.com/cacheplane/angular-agent-framework/issues/26), [#27](https://github.com/cacheplane/angular-agent-framework/issues/27), [#28](https://github.com/cacheplane/angular-agent-framework/issues/28), [#29](https://github.com/cacheplane/angular-agent-framework/issues/29), [#30](https://github.com/cacheplane/angular-agent-framework/issues/30), [#31](https://github.com/cacheplane/angular-agent-framework/issues/31), [#32](https://github.com/cacheplane/angular-agent-framework/issues/32), [#33](https://github.com/cacheplane/angular-agent-framework/issues/33))
- real SVG brand logos in social proof scroll strip ([#62](https://github.com/cacheplane/angular-agent-framework/pull/62), [#8](https://github.com/cacheplane/angular-agent-framework/issues/8), [#9](https://github.com/cacheplane/angular-agent-framework/issues/9), [#10](https://github.com/cacheplane/angular-agent-framework/issues/10), [#11](https://github.com/cacheplane/angular-agent-framework/issues/11), [#12](https://github.com/cacheplane/angular-agent-framework/issues/12), [#13](https://github.com/cacheplane/angular-agent-framework/issues/13), [#2](https://github.com/cacheplane/angular-agent-framework/issues/2), [#14](https://github.com/cacheplane/angular-agent-framework/issues/14), [#16](https://github.com/cacheplane/angular-agent-framework/issues/16), [#19](https://github.com/cacheplane/angular-agent-framework/issues/19), [#24](https://github.com/cacheplane/angular-agent-framework/issues/24), [#25](https://github.com/cacheplane/angular-agent-framework/issues/25), [#26](https://github.com/cacheplane/angular-agent-framework/issues/26), [#27](https://github.com/cacheplane/angular-agent-framework/issues/27), [#28](https://github.com/cacheplane/angular-agent-framework/issues/28), [#29](https://github.com/cacheplane/angular-agent-framework/issues/29), [#30](https://github.com/cacheplane/angular-agent-framework/issues/30), [#31](https://github.com/cacheplane/angular-agent-framework/issues/31), [#32](https://github.com/cacheplane/angular-agent-framework/issues/32), [#33](https://github.com/cacheplane/angular-agent-framework/issues/33), [#34](https://github.com/cacheplane/angular-agent-framework/issues/34), [#35](https://github.com/cacheplane/angular-agent-framework/issues/35), [#36](https://github.com/cacheplane/angular-agent-framework/issues/36), [#37](https://github.com/cacheplane/angular-agent-framework/issues/37), [#38](https://github.com/cacheplane/angular-agent-framework/issues/38), [#39](https://github.com/cacheplane/angular-agent-framework/issues/39), [#40](https://github.com/cacheplane/angular-agent-framework/issues/40), [#41](https://github.com/cacheplane/angular-agent-framework/issues/41), [#42](https://github.com/cacheplane/angular-agent-framework/issues/42), [#44](https://github.com/cacheplane/angular-agent-framework/issues/44), [#43](https://github.com/cacheplane/angular-agent-framework/issues/43), [#45](https://github.com/cacheplane/angular-agent-framework/issues/45), [#46](https://github.com/cacheplane/angular-agent-framework/issues/46), [#47](https://github.com/cacheplane/angular-agent-framework/issues/47), [#49](https://github.com/cacheplane/angular-agent-framework/issues/49), [#50](https://github.com/cacheplane/angular-agent-framework/issues/50), [#51](https://github.com/cacheplane/angular-agent-framework/issues/51), [#48](https://github.com/cacheplane/angular-agent-framework/issues/48), [#52](https://github.com/cacheplane/angular-agent-framework/issues/52), [#53](https://github.com/cacheplane/angular-agent-framework/issues/53), [#55](https://github.com/cacheplane/angular-agent-framework/issues/55))
- streaming generative UI with partial JSON parser ([#69](https://github.com/cacheplane/angular-agent-framework/pull/69), [#14](https://github.com/cacheplane/angular-agent-framework/issues/14))
- A2UI v0.9 protocol support — message parsing, surface rendering, 12-component catalog ([#78](https://github.com/cacheplane/angular-agent-framework/pull/78))
- A2UI v0.9 Phase 2 — functions, validation, template expansion, two-way binding, actions ([#81](https://github.com/cacheplane/angular-agent-framework/pull/81))
- A2UI Phase 3 — render events, 6 new components, custom catalogs ([#89](https://github.com/cacheplane/angular-agent-framework/pull/89), [#14](https://github.com/cacheplane/angular-agent-framework/issues/14))
- add A2UI cockpit integration with auto event routing ([#93](https://github.com/cacheplane/angular-agent-framework/pull/93))
- handler injection context and consumer-extensible A2UI handlers ([#94](https://github.com/cacheplane/angular-agent-framework/pull/94))
- generative UI phase 2 — SaaS metrics dashboard ([#127](https://github.com/cacheplane/angular-agent-framework/pull/127))
- relicense to MIT (selective; minting-service stays proprietary) ([#141](https://github.com/cacheplane/angular-agent-framework/pull/141))
- **a2ui:** align validation with v0.9 CheckRule spec ([#97](https://github.com/cacheplane/angular-agent-framework/pull/97))
- **a2ui:** v0.9 action envelope and sendDataModel transport ([#101](https://github.com/cacheplane/angular-agent-framework/pull/101))
- **AG-UI:** @cacheplane/ag-ui adapter wrapping @ag-ui/client ([#139](https://github.com/cacheplane/angular-agent-framework/pull/139))
- **AG-UI:** FakeAgent for offline cockpit demo ([#140](https://github.com/cacheplane/angular-agent-framework/pull/140))
- **agent:** run license check at provider init ([fd95400f](https://github.com/cacheplane/angular-agent-framework/commit/fd95400f))
- **chat:** Apple-clean UI redesign + streaming example integration ([499ef645](https://github.com/cacheplane/angular-agent-framework/commit/499ef645))
- **chat:** eliminate streaming jank with append-only markdown and frame-synced pipeline ([#107](https://github.com/cacheplane/angular-agent-framework/pull/107))
- **chat:** run license check at provider init ([6addcd17](https://github.com/cacheplane/angular-agent-framework/commit/6addcd17))
- **chat:** decouple primitives from LangGraph via runtime-neutral ChatAgent contract ([#135](https://github.com/cacheplane/angular-agent-framework/pull/135))
- **chat:** complete runtime decoupling — compositions back to @cacheplane/chat ([#136](https://github.com/cacheplane/angular-agent-framework/pull/136))
- **chat:** require events$ on Agent contract with structured AgentEvent union ([#138](https://github.com/cacheplane/angular-agent-framework/pull/138))
- **chat): ship-readiness polish — Tailwind, auto-scroll, markdown, a11y (#27) * docs(chat): add ship-readiness polish implementation plan Addresses all 19 audit issues: theme consolidation, Tailwind conversion, auto-scroll, textarea auto-expand, markdown rendering, empty state, responsive sidebar, SVG icons, ARIA, and API cleanup. * feat(chat): consolidate theme into shared TS module, add icons + markdown utils * feat(chat): convert ChatComponent to Tailwind, add auto-scroll + empty state + responsive sidebar - Replace 80+ lines of inlined CSS vars with CHAT_THEME_STYLES import - Add CHAT_MARKDOWN_STYLES + renderMarkdown for AI message rendering - Convert all inline style="" attributes to Tailwind utility classes - Add auto-scroll via viewChild + effect tracking message count - Add empty state when no messages and not loading - Make thread sidebar responsive with hidden md:flex + mobile toggle - Add ARIA attributes: role=log, aria-live=polite, role=navigation - Use ViewEncapsulation.None for markdown styles * feat(chat): convert primitives to Tailwind, add textarea auto-expand + focused signal * feat(chat): convert ChatDebug + sub-components to theme-aware Tailwind * feat(chat): convert remaining compositions to Tailwind with SVG icons + theme vars * feat(chat:** clean up public API, add marked peer dep, verify build Remove legacy cp-chat/cp-chat-input/cp-chat-message components and migrate all cockpit examples to the new ChatComponent composition. Export shared styles, icons, and markdown utilities from public API. Update ChatConfig with renderRegistry, avatarLabel, assistantName. Add marked as optional peer dep and fix dynamic import for library build. Add @source directive to cockpit styles for Tailwind scanning. ([#27](https://github.com/cacheplane/angular-agent-framework/pull/27))
- **cockpit:** complete cockpit application with 14 capability examples ([#2](https://github.com/cacheplane/angular-agent-framework/pull/2))
- **cockpit:** complete cockpit application with 14 capability examples ([#14](https://github.com/cacheplane/angular-agent-framework/pull/14))
- **cockpit:** add design tokens CSS, Tailwind v4 to Angular apps, fix sidebar and code overflow ([#16](https://github.com/cacheplane/angular-agent-framework/pull/16))
- **cockpit:** wire all 13 remaining Angular examples to @cacheplane/chat ([40def35a](https://github.com/cacheplane/angular-agent-framework/commit/40def35a))
- **cockpit:** production deployment - LangGraph Cloud, Angular hosting, CI ([#19](https://github.com/cacheplane/angular-agent-framework/pull/19))
- **cockpit:** Tier 1 example customization — thread management + capability sidebars ([7e2da191](https://github.com/cacheplane/angular-agent-framework/commit/7e2da191))
- **cockpit:** Tier 2 — memory sidebar, subagent tracking, interrupt panel ([f0f1967c](https://github.com/cacheplane/angular-agent-framework/commit/f0f1967c))
- **cockpit:** Tier 3 — time-travel checkpoint nav + durable-execution step pipeline ([170b3047](https://github.com/cacheplane/angular-agent-framework/commit/170b3047))
- **cockpit:** wire view components into all 6 examples ([#67](https://github.com/cacheplane/angular-agent-framework/pull/67))
- **cockpit:** add render and chat product sections ([#68](https://github.com/cacheplane/angular-agent-framework/pull/68))
- **cockpit:** update generative-ui example for streaming auto-detection ([#75](https://github.com/cacheplane/angular-agent-framework/pull/75))
- **cockpit:** full-screen mobile navigation overlay ([#91](https://github.com/cacheplane/angular-agent-framework/pull/91))
- **cockpit): complete sidebar implementations for all 14 capability examples (#31) * fix(stream-resource): fix 3 runtime errors in streaming chat flow 1. Guard Object.keys(v) against null/undefined in values$ subscriber    (stream-resource.fn.ts:94) — crashed when values event had no data 2. Handle plain JSON messages from SSE (not hydrated BaseMessage instances)    in getMessageType() — _getType() is a class method not available on    plain objects; fall back to reading the `type` property 3. Fix event data extraction in processEvent — normalizeSdkEvent spreads    data into the event object, so event['values'] was always undefined;    use extractEventData() to read from event['data'] instead. Also sync    messages$ from values events and merge messages/partial updates by id    to preserve the full message history including human messages. * fix(stream-resource): handle both SDK and mock event formats in extractEventData * docs(cockpit): add cockpit examples validation implementation plan * feat(cockpit): add thread picker sidebar to persistence example * feat(cockpit): add checkpoint timeline sidebar to time-travel example * feat(cockpit): add step progress sidebar to durable-execution example * feat(cockpit): add plan checklist sidebar to planning example * feat(cockpit): add skill invocations sidebar to skills example * feat(cockpit): add delegation tracker sidebar to subagents example Derive delegations from stream.messages() by finding tool_calls in AI messages and matching them with tool result messages. Each delegation shows a status dot (green=complete, amber=running, red=error), agent name, and status text. * feat(cockpit): add file operations sidebar to filesystem example * feat(cockpit): add execution output sidebar to sandboxes example * feat(cockpit:** add learned facts sidebar to memory example Derive memory entries from stream.value() by checking for agent_memory or memory dict fields in graph state. Sidebar displays each fact as a bold key with muted value text, plus a count in the header. ([#31](https://github.com/cacheplane/angular-agent-framework/pull/31))
- **db:** scaffold @cacheplane/db lib ([eea577c3](https://github.com/cacheplane/angular-agent-framework/commit/eea577c3))
- **db:** add Drizzle client factory ([15dcbd88](https://github.com/cacheplane/angular-agent-framework/commit/15dcbd88))
- **db:** add licenses table schema ([aea37a5f](https://github.com/cacheplane/angular-agent-framework/commit/aea37a5f))
- **db:** add processed_events table schema ([3d46420d](https://github.com/cacheplane/angular-agent-framework/commit/3d46420d))
- **db:** configure drizzle-kit and generate initial migration ([9dc0ad3e](https://github.com/cacheplane/angular-agent-framework/commit/9dc0ad3e))
- **db:** add testcontainers-based integration test helpers ([42c5a44d](https://github.com/cacheplane/angular-agent-framework/commit/42c5a44d))
- **db:** add processed-events queries with idempotency ([00c0cb73](https://github.com/cacheplane/angular-agent-framework/commit/00c0cb73))
- **db:** add license queries (upsert, get, revoke, updateToken, byEmail) ([97f23917](https://github.com/cacheplane/angular-agent-framework/commit/97f23917))
- **example-layouts:** shared responsive layout library for 30 cockpit apps ([#95](https://github.com/cacheplane/angular-agent-framework/pull/95))
- **generative-ui:** update standalone graph to Phase 2 dashboard ([#129](https://github.com/cacheplane/angular-agent-framework/pull/129))
- **licensing:** scaffold @cacheplane/licensing library ([3c825f1a](https://github.com/cacheplane/angular-agent-framework/commit/3c825f1a))
- **licensing:** add license token schema and parser ([17ae35f8](https://github.com/cacheplane/angular-agent-framework/commit/17ae35f8))
- **licensing:** add offline ed25519 license verification ([5f0464d2](https://github.com/cacheplane/angular-agent-framework/commit/5f0464d2))
- **licensing:** add license status evaluation with grace window ([952d0671](https://github.com/cacheplane/angular-agent-framework/commit/952d0671))
- **licensing:** add nag UX with per-package dedupe ([192cdc73](https://github.com/cacheplane/angular-agent-framework/commit/192cdc73))
- **licensing:** add non-blocking telemetry client with opt-out ([5e3787c2](https://github.com/cacheplane/angular-agent-framework/commit/5e3787c2))
- **licensing:** embed ed25519 public key at build time ([b9aac384](https://github.com/cacheplane/angular-agent-framework/commit/b9aac384))
- **licensing:** add runLicenseCheck orchestrator and public API ([f8d816b3](https://github.com/cacheplane/angular-agent-framework/commit/f8d816b3))
- **licensing:** add signLicense for minting signed license tokens ([bb2d6255](https://github.com/cacheplane/angular-agent-framework/commit/bb2d6255))
- **minting-service:** scaffold Nx Node app ([6d248412](https://github.com/cacheplane/angular-agent-framework/commit/6d248412))
- **minting-service:** add runtime deps and .env.example ([cfd6cd3a](https://github.com/cacheplane/angular-agent-framework/commit/cfd6cd3a))
- **minting-service:** add env var validation ([6091cb4b](https://github.com/cacheplane/angular-agent-framework/commit/6091cb4b))
- **minting-service:** add tier extraction and seat computation ([ff392a0d](https://github.com/cacheplane/angular-agent-framework/commit/ff392a0d))
- **minting-service:** add mintToken wrapper over @cacheplane/licensing ([08711164](https://github.com/cacheplane/angular-agent-framework/commit/08711164))
- **minting-service:** add license email renderer and Resend wrapper ([c1be7713](https://github.com/cacheplane/angular-agent-framework/commit/c1be7713))
- **minting-service:** add Stripe SDK singleton ([351f0d05](https://github.com/cacheplane/angular-agent-framework/commit/351f0d05))
- **minting-service:** add handleEvent dispatcher with idempotency + compensating delete ([3eea7110](https://github.com/cacheplane/angular-agent-framework/commit/3eea7110))
- **minting-service:** implement handleCheckoutCompleted ([84595278](https://github.com/cacheplane/angular-agent-framework/commit/84595278))
- **minting-service:** implement handleSubscriptionUpdated with material-change check ([43f86e58](https://github.com/cacheplane/angular-agent-framework/commit/43f86e58))
- **minting-service:** add /api/health probe ([d65b2e5b](https://github.com/cacheplane/angular-agent-framework/commit/d65b2e5b))
- **minting-service:** add /api/stripe-webhook endpoint ([e1ce4082](https://github.com/cacheplane/angular-agent-framework/commit/e1ce4082))
- **minting-service:** add Vercel deployment config ([c8e80ca3](https://github.com/cacheplane/angular-agent-framework/commit/c8e80ca3))
- **minting-service:** add manual re-mint CLI ([7907e787](https://github.com/cacheplane/angular-agent-framework/commit/7907e787))
- **render:** run license check at provider init ([ad8a5e73](https://github.com/cacheplane/angular-agent-framework/commit/ad8a5e73))
- **website:** add Examples link to header and footer ([#25](https://github.com/cacheplane/angular-agent-framework/pull/25))
- **website:** lead gen with Resend + mobile fixes + design improvements ([#36](https://github.com/cacheplane/angular-agent-framework/pull/36), [#27](https://github.com/cacheplane/angular-agent-framework/issues/27), [#28](https://github.com/cacheplane/angular-agent-framework/issues/28), [#29](https://github.com/cacheplane/angular-agent-framework/issues/29))
- **website:** multi-library docs for agent, render, and chat ([#48](https://github.com/cacheplane/angular-agent-framework/pull/48))
- **website:** replace FullStackSection with LibrariesSection teaser cards ([316bf2bc](https://github.com/cacheplane/angular-agent-framework/commit/316bf2bc))
- **website:** add Libraries column to footer for SEO/bot discovery ([0a41e5d5](https://github.com/cacheplane/angular-agent-framework/commit/0a41e5d5))
- **website:** merge DocsMobileNav into header for unified mobile navigation ([f7e1d703](https://github.com/cacheplane/angular-agent-framework/commit/f7e1d703))
- **website:** add /angular landing page with full conversion funnel ([63daf39e](https://github.com/cacheplane/angular-agent-framework/commit/63daf39e))
- **website:** add /render landing page — Vercel json-render generative UI ([0495a109](https://github.com/cacheplane/angular-agent-framework/commit/0495a109))
- **website:** add /chat landing page — batteries-included agent chat UI ([cae4b94f](https://github.com/cacheplane/angular-agent-framework/commit/cae4b94f))
- **website:** refactor whitepaper pipeline for multi-config generation ([d712c256](https://github.com/cacheplane/angular-agent-framework/commit/d712c256))
- **website:** whitepaper signup API accepts paper field for library-specific tracking ([d0812ba1](https://github.com/cacheplane/angular-agent-framework/commit/d0812ba1))
- **website:** add library-specific download confirmation and drip email campaigns ([8c0eeb06](https://github.com/cacheplane/angular-agent-framework/commit/8c0eeb06))
- **website:** full-screen mobile nav overlay with tab-based docs navigation ([aa751c4d](https://github.com/cacheplane/angular-agent-framework/commit/aa751c4d))
- **website:** wire whitepaper signup to email pipeline ([90bd1046](https://github.com/cacheplane/angular-agent-framework/commit/90bd1046))
- **website:** update landing pages with A2UI specifics ([f1879c3f](https://github.com/cacheplane/angular-agent-framework/commit/f1879c3f))
- **website:** add Shiki syntax highlighting to landing page code blocks ([2a4e2d8f](https://github.com/cacheplane/angular-agent-framework/commit/2a4e2d8f))
- **website:** home page narrative funnel redesign ([#125](https://github.com/cacheplane/angular-agent-framework/pull/125))
- **website:** add solutions landing pages for enterprise use cases ([#128](https://github.com/cacheplane/angular-agent-framework/pull/128))
- **website:** align product landing pages with home page narrative ([#130](https://github.com/cacheplane/angular-agent-framework/pull/130))
- **website): add narrative sections, pilot-to-prod page, and rebrand integration (#29) * fix(website): add track shake animation to ProblemSection stall phase * fix(website): ProblemSection quality fixes — timer cleanup, unique SVG ID, aria-hidden, correct import - Store setTimeout IDs and clear them on unmount (prevents state updates on unmounted component) - Use useId() to generate unique hatchId per instance (prevents SVG pattern id collision) - Add role=progressbar + aria-valuenow to track container for screen readers - Add aria-hidden=true to decorative animated elements (pins, labels, badge, counter) - Fix import: use local lib/design-tokens instead of unresolved @cacheplane/design-tokens - Add invariant comment for done-timeout vs counter-duration coupling * feat: add FullStackSection with animated stack diagram and roadmap strip * feat: add ChatFeaturesSection with 4 interactive chat scenarios * feat: add FairComparisonSection comparison table * feat: wire ProblemSection, FullStackSection, ChatFeaturesSection, FairComparisonSection into landing page - Insert ProblemSection + FullStackSection + ChatFeaturesSection after StatsStrip - Insert FairComparisonSection after DeepAgentsShowcase - Add two ambient gradient blobs for extended page height - Task 5 (FeatureStrip copy): no-op — the problematic 'no established pattern' copy was not present in this branch * chore: add puppeteer devDependency and generate-whitepaper script * feat: add whitepaper signup API route with NDJSON persistence * feat: add whitepaper generation script * feat: add WhitePaperSection with free download and optional lead-gen form * feat: add WhitePaperSection to landing page; remove useStream parity copy from FeatureStrip * fix(whitepaper): add JetBrains Mono to Google Fonts URL and regenerate preview Fixes missing code font in whitepaper output. Regenerates whitepaper-preview.html with correct 'EB Garamond' and 'JetBrains Mono' font references throughout. * feat: add PilotHero component and /pilot-to-prod page skeleton * fix: PilotHero responsive padding, eyebrow style conflict, page metadata * feat: add WhatIsIncluded 3-column component for pilot-to-prod page * feat: add HowItWorks 3-phase timeline for pilot-to-prod page * feat: add PricingSignal pricing callout for pilot-to-prod page * feat: add WhitePaperGate 5-field lead gen form for pilot-to-prod page * fix: change role=alert to role=status to match aria-live=polite in WhitePaperGate * feat: add PilotFooterCTA and wire complete pilot-to-prod page * fix: use tokens.colors.accent in PilotFooterCTA, add aria-hidden to page blobs * feat: add Pilot to Prod nav link and restructure homepage (remove FeatureStrip/CockpitCTA/CodeBlock, add PilotProgram CTA) * fix: correct design-tokens import path in pilot-to-prod page (3 levels up) * fix: apply full review findings — messaging, mobile, UX, and RiskRemoval section - Remove useStream() parity messaging from HeroTwoCol, WhatIsIncluded, StatsStrip - Fix PricingSignal: remove ambiguous '/year', clarify as fixed fee + pilot included - Add PricingSignal mobile padding reduction via media query - Fix ProblemSection stat grid to collapse on mobile (auto-fit minmax) - Add RiskRemoval section to pilot-to-prod page (between PricingSignal and WhitePaperGate) - Fix Nav Examples link: external=true, target=_blank, rel=noopener noreferrer - Fix WhitePaperGate: role field sent in message body, not merged into company string - Fix PilotFooterCTA: replace broken whileHover borderColor with CSS class hover - Fix PilotHero: remove opacity from initial animations (prevents blank hero flash) - Increase PilotHero CTA padding to meet 44px touch target * fix: remove remaining useStream parity messaging from layout, Footer, and ValueProps * fix: second review pass — docs messaging, title, broken link, a11y labels - introduction.mdx: remove parity/useStream opening line, use Signal-native positioning - AGENTS.md.template + CLAUDE.md.template: update tagline to Signal-native - layout.tsx: update <title> from LangChain to LangGraph - Footer.tsx: fix /api-reference → /docs/api/stream-resource (was 404) - PilotHero.tsx: add aria-hidden to decorative gradient blobs - WhitePaperSection.tsx: add sr-only labels + aria-label to name/email inputs - LeadForm.tsx (pricing): add sr-only labels + aria-label to all four form inputs * feat: add whitepaper.pdf to public directory Generated from whitepaper-preview.html via Puppeteer. All 6 chapters present (Streaming State Management, Thread Persistence, Tool-Call Rendering, Human Approval Flows, Generative UI, Deterministic Testing). Fixes dead 'Download the Guide' CTAs on pilot-to-prod and homepage. * feat: citation badges on stats, pricing reframe to app deployment license Citation badges: - New CitationBadge component — click-to-open popover with source, stat, note, and link - 66% stat → Stack Overflow Developer Survey 2025 - 31% stat → ISG AI Adoption Reports - 75% stat → Stack Overflow Developer Survey 2025 - Keyboard (Escape) and outside-click dismissal, ARIA dialog role Pricing reframe (app deployment license): - Remove ALL refund/money-back/guarantee language site-wide - PilotHero: trust line → "App deployment license · $20,000 · 3-month co-pilot engagement" - PilotHero: subheadline removes "guaranteed outcome" - WhatIsIncluded: card 3 renamed from "Production Guarantee" → "App Deployment License" - HowItWorks: phase 3 removes "full refund" language, deliverable → "Production deployment" - PricingSignal: subtitle + features list updated to license/co-pilot framing - RiskRemoval: section reframed from guarantee → "What's included in the license"   Replaces money-back card with "We work alongside your team" card - PilotFooterCTA: fine print updated - pilot-to-prod/page.tsx: meta description updated * feat: subtler citation badge + citations on all 77% claims CitationBadge: - Reduced to 13px, transparent background, faint border (rgba 0.2) - Text color rgba(0,64,144,0.35) at rest — nearly invisible until hovered - No fill on idle state, border-only approach New citation placements: - PilotHero subheadline: 77% → McKinsey State of AI 2024 - PilotFooterCTA body copy: 77% → McKinsey State of AI 2024 - HomePilotCTA (new component): extracts inline pilot CTA from page.tsx   so it can be a client component with CitationBadge on the 77% claim - page.tsx: replaces inline section with <HomePilotCTA /> * docs: add FullStackSection redesign spec (EM/CTO layer narrative + Gen UI bug fix) * feat(website): redesign FullStackSection for EM/CTO audience * docs: apply Angular Stream Resource rebrand to narrative components * chore: sync package-lock.json after merge * fix(website:** update e2e test for new landing page structure ([#29](https://github.com/cacheplane/angular-agent-framework/pull/29))

### 🩹 Fixes

- guard cockpit secret integration in ci ([01d6c738](https://github.com/cacheplane/angular-agent-framework/commit/01d6c738))
- stabilize cockpit integration workflows ([1dc96157](https://github.com/cacheplane/angular-agent-framework/commit/1dc96157))
- align website cockpit integration checks ([f18745f5](https://github.com/cacheplane/angular-agent-framework/commit/f18745f5))
- stabilize cockpit deployment verification ([7e431109](https://github.com/cacheplane/angular-agent-framework/commit/7e431109))
- align chat agent with langgraph dev runtime ([542b7448](https://github.com/cacheplane/angular-agent-framework/commit/542b7448))
- verify website deploy via custom domain ([1427f8d2](https://github.com/cacheplane/angular-agent-framework/commit/1427f8d2))
- align chat agent e2e stream assertions ([768d2f38](https://github.com/cacheplane/angular-agent-framework/commit/768d2f38))
- deploy affected apps via nx ([a124eaaf](https://github.com/cacheplane/angular-agent-framework/commit/a124eaaf))
- use portable deploy target detection ([7a8e6fa9](https://github.com/cacheplane/angular-agent-framework/commit/7a8e6fa9))
- fetch base commit for affected deploys ([4e43963c](https://github.com/cacheplane/angular-agent-framework/commit/4e43963c))
- stabilize cockpit e2e shell hydration ([bf0a8f58](https://github.com/cacheplane/angular-agent-framework/commit/bf0a8f58))
- TOC links, mobile polish, glass callouts, expanded intro ([#7](https://github.com/cacheplane/angular-agent-framework/pull/7), [#1](https://github.com/cacheplane/angular-agent-framework/issues/1), [#3](https://github.com/cacheplane/angular-agent-framework/issues/3), [#4](https://github.com/cacheplane/angular-agent-framework/issues/4), [#5](https://github.com/cacheplane/angular-agent-framework/issues/5))
- complete rebrand audit — nav bug, hero copy, templates ([#42](https://github.com/cacheplane/angular-agent-framework/pull/42), [#27](https://github.com/cacheplane/angular-agent-framework/issues/27), [#28](https://github.com/cacheplane/angular-agent-framework/issues/28), [#29](https://github.com/cacheplane/angular-agent-framework/issues/29))
- API docs, pricing updates, rebrand audit fixes ([#44](https://github.com/cacheplane/angular-agent-framework/pull/44), [#27](https://github.com/cacheplane/angular-agent-framework/issues/27), [#28](https://github.com/cacheplane/angular-agent-framework/issues/28), [#29](https://github.com/cacheplane/angular-agent-framework/issues/29))
- docs tables, pricing, favicon, animation, announcement toast ([#47](https://github.com/cacheplane/angular-agent-framework/pull/47), [#27](https://github.com/cacheplane/angular-agent-framework/issues/27), [#28](https://github.com/cacheplane/angular-agent-framework/issues/28), [#29](https://github.com/cacheplane/angular-agent-framework/issues/29))
- redesign logo strip with larger ghost-style logos ([#58](https://github.com/cacheplane/angular-agent-framework/pull/58), [#8](https://github.com/cacheplane/angular-agent-framework/issues/8), [#9](https://github.com/cacheplane/angular-agent-framework/issues/9), [#10](https://github.com/cacheplane/angular-agent-framework/issues/10), [#11](https://github.com/cacheplane/angular-agent-framework/issues/11), [#12](https://github.com/cacheplane/angular-agent-framework/issues/12), [#13](https://github.com/cacheplane/angular-agent-framework/issues/13), [#2](https://github.com/cacheplane/angular-agent-framework/issues/2), [#14](https://github.com/cacheplane/angular-agent-framework/issues/14), [#16](https://github.com/cacheplane/angular-agent-framework/issues/16), [#19](https://github.com/cacheplane/angular-agent-framework/issues/19), [#24](https://github.com/cacheplane/angular-agent-framework/issues/24), [#25](https://github.com/cacheplane/angular-agent-framework/issues/25), [#26](https://github.com/cacheplane/angular-agent-framework/issues/26), [#27](https://github.com/cacheplane/angular-agent-framework/issues/27), [#28](https://github.com/cacheplane/angular-agent-framework/issues/28), [#29](https://github.com/cacheplane/angular-agent-framework/issues/29), [#30](https://github.com/cacheplane/angular-agent-framework/issues/30), [#31](https://github.com/cacheplane/angular-agent-framework/issues/31), [#32](https://github.com/cacheplane/angular-agent-framework/issues/32), [#33](https://github.com/cacheplane/angular-agent-framework/issues/33), [#34](https://github.com/cacheplane/angular-agent-framework/issues/34), [#35](https://github.com/cacheplane/angular-agent-framework/issues/35), [#36](https://github.com/cacheplane/angular-agent-framework/issues/36), [#37](https://github.com/cacheplane/angular-agent-framework/issues/37), [#38](https://github.com/cacheplane/angular-agent-framework/issues/38), [#39](https://github.com/cacheplane/angular-agent-framework/issues/39), [#40](https://github.com/cacheplane/angular-agent-framework/issues/40), [#41](https://github.com/cacheplane/angular-agent-framework/issues/41), [#42](https://github.com/cacheplane/angular-agent-framework/issues/42), [#44](https://github.com/cacheplane/angular-agent-framework/issues/44), [#43](https://github.com/cacheplane/angular-agent-framework/issues/43), [#45](https://github.com/cacheplane/angular-agent-framework/issues/45), [#46](https://github.com/cacheplane/angular-agent-framework/issues/46), [#47](https://github.com/cacheplane/angular-agent-framework/issues/47), [#49](https://github.com/cacheplane/angular-agent-framework/issues/49), [#50](https://github.com/cacheplane/angular-agent-framework/issues/50), [#51](https://github.com/cacheplane/angular-agent-framework/issues/51), [#48](https://github.com/cacheplane/angular-agent-framework/issues/48), [#52](https://github.com/cacheplane/angular-agent-framework/issues/52), [#53](https://github.com/cacheplane/angular-agent-framework/issues/53), [#55](https://github.com/cacheplane/angular-agent-framework/issues/55))
- resolve merge conflicts in SocialProof, increase logo visibility ([#60](https://github.com/cacheplane/angular-agent-framework/pull/60), [#8](https://github.com/cacheplane/angular-agent-framework/issues/8), [#9](https://github.com/cacheplane/angular-agent-framework/issues/9), [#10](https://github.com/cacheplane/angular-agent-framework/issues/10), [#11](https://github.com/cacheplane/angular-agent-framework/issues/11), [#12](https://github.com/cacheplane/angular-agent-framework/issues/12), [#13](https://github.com/cacheplane/angular-agent-framework/issues/13), [#2](https://github.com/cacheplane/angular-agent-framework/issues/2), [#14](https://github.com/cacheplane/angular-agent-framework/issues/14), [#16](https://github.com/cacheplane/angular-agent-framework/issues/16), [#19](https://github.com/cacheplane/angular-agent-framework/issues/19), [#24](https://github.com/cacheplane/angular-agent-framework/issues/24), [#25](https://github.com/cacheplane/angular-agent-framework/issues/25), [#26](https://github.com/cacheplane/angular-agent-framework/issues/26), [#27](https://github.com/cacheplane/angular-agent-framework/issues/27), [#28](https://github.com/cacheplane/angular-agent-framework/issues/28), [#29](https://github.com/cacheplane/angular-agent-framework/issues/29), [#30](https://github.com/cacheplane/angular-agent-framework/issues/30), [#31](https://github.com/cacheplane/angular-agent-framework/issues/31), [#32](https://github.com/cacheplane/angular-agent-framework/issues/32), [#33](https://github.com/cacheplane/angular-agent-framework/issues/33), [#34](https://github.com/cacheplane/angular-agent-framework/issues/34), [#35](https://github.com/cacheplane/angular-agent-framework/issues/35), [#36](https://github.com/cacheplane/angular-agent-framework/issues/36), [#37](https://github.com/cacheplane/angular-agent-framework/issues/37), [#38](https://github.com/cacheplane/angular-agent-framework/issues/38), [#39](https://github.com/cacheplane/angular-agent-framework/issues/39), [#40](https://github.com/cacheplane/angular-agent-framework/issues/40), [#41](https://github.com/cacheplane/angular-agent-framework/issues/41), [#42](https://github.com/cacheplane/angular-agent-framework/issues/42), [#44](https://github.com/cacheplane/angular-agent-framework/issues/44), [#43](https://github.com/cacheplane/angular-agent-framework/issues/43), [#45](https://github.com/cacheplane/angular-agent-framework/issues/45), [#46](https://github.com/cacheplane/angular-agent-framework/issues/46), [#47](https://github.com/cacheplane/angular-agent-framework/issues/47), [#49](https://github.com/cacheplane/angular-agent-framework/issues/49), [#50](https://github.com/cacheplane/angular-agent-framework/issues/50), [#51](https://github.com/cacheplane/angular-agent-framework/issues/51), [#48](https://github.com/cacheplane/angular-agent-framework/issues/48), [#52](https://github.com/cacheplane/angular-agent-framework/issues/52), [#53](https://github.com/cacheplane/angular-agent-framework/issues/53), [#55](https://github.com/cacheplane/angular-agent-framework/issues/55))
- resolve merge conflicts + cockpit iframe URL + stale references ([#61](https://github.com/cacheplane/angular-agent-framework/pull/61), [#57](https://github.com/cacheplane/angular-agent-framework/issues/57))
- clean up remaining stale stream-resource references ([#72](https://github.com/cacheplane/angular-agent-framework/pull/72))
- add production error handling for streaming JSON parsing ([#82](https://github.com/cacheplane/angular-agent-framework/pull/82))
- deploy 17 chat/render examples to LangGraph Cloud ([#115](https://github.com/cacheplane/angular-agent-framework/pull/115))
- **a2ui:** remove unused EnvelopeKey type alias breaking production builds ([#84](https://github.com/cacheplane/angular-agent-framework/pull/84))
- **a2ui:** improve catalog tests and fix misleading _bindings docs ([#106](https://github.com/cacheplane/angular-agent-framework/pull/106))
- **agent:** filter SDK metadata from messages/partial events ([#102](https://github.com/cacheplane/angular-agent-framework/pull/102))
- **agent:** consolidate chat graphs into streaming LangGraph deployment ([#113](https://github.com/cacheplane/angular-agent-framework/pull/113))
- **angular:** normalize relative apiUrl to absolute for LangGraph SDK ([#43](https://github.com/cacheplane/angular-agent-framework/pull/43))
- **chat:** fix broken style interpolation in ChatInput border-color ([5fb4a584](https://github.com/cacheplane/angular-agent-framework/commit/5fb4a584))
- **chat:** send simple {role, content} dict instead of HumanMessage object ([b35ea6af](https://github.com/cacheplane/angular-agent-framework/commit/b35ea6af))
- **chat:** refocus input after submit + force scroll on new messages ([#34](https://github.com/cacheplane/angular-agent-framework/pull/34))
- **chat:** wrap content classifier in untracked() to fix NG0600 streaming crash ([#104](https://github.com/cacheplane/angular-agent-framework/pull/104))
- **chat:** correct generative-ui prompt — use root not rootKey ([#116](https://github.com/cacheplane/angular-agent-framework/pull/116))
- **chat:** align a2ui assistant ID with deployed graph name ([#117](https://github.com/cacheplane/angular-agent-framework/pull/117))
- **chat:** revert a2ui assistant ID to c-a2ui to match deployment ([#118](https://github.com/cacheplane/angular-agent-framework/pull/118), [#117](https://github.com/cacheplane/angular-agent-framework/issues/117))
- **chat:** use c-a2ui assistant ID matching standalone deployment ([#119](https://github.com/cacheplane/angular-agent-framework/pull/119), [#117](https://github.com/cacheplane/angular-agent-framework/issues/117), [#118](https://github.com/cacheplane/angular-agent-framework/issues/118))
- **chat:** replace LLM-based a2ui graph with hardcoded JSONL ([#120](https://github.com/cacheplane/angular-agent-framework/pull/120))
- **chat:** route chat examples through streaming backend ([#121](https://github.com/cacheplane/angular-agent-framework/pull/121), [#113](https://github.com/cacheplane/angular-agent-framework/issues/113), [#120](https://github.com/cacheplane/angular-agent-framework/issues/120))
- **chat:** add trailing newline to a2ui JSONL for parser compatibility ([#122](https://github.com/cacheplane/angular-agent-framework/pull/122))
- **chat): fix runtime errors + ViewEncapsulation breaking theme (#30) * fix(stream-resource): fix 3 runtime errors in streaming chat flow 1. Guard Object.keys(v) against null/undefined in values$ subscriber    (stream-resource.fn.ts:94) — crashed when values event had no data 2. Handle plain JSON messages from SSE (not hydrated BaseMessage instances)    in getMessageType() — _getType() is a class method not available on    plain objects; fall back to reading the `type` property 3. Fix event data extraction in processEvent — normalizeSdkEvent spreads    data into the event object, so event['values'] was always undefined;    use extractEventData() to read from event['data'] instead. Also sync    messages$ from values events and merge messages/partial updates by id    to preserve the full message history including human messages. * fix(chat): fix ViewEncapsulation breaking all CSS theme variables ViewEncapsulation.None caused :host selectors in CHAT_THEME_STYLES to not match anything (no shadow DOM = :host doesn't apply). All 40+ CSS custom properties were empty, breaking the entire design. Fix: remove ViewEncapsulation.None from ChatComponent and ChatDebugComponent (default Emulated encapsulation processes :host correctly). Prefix markdown styles with ::ng-deep for innerHTML content penetration. * fix(chat): replace [innerHTML] icon bindings with inline SVG (sanitizer fix) * fix(chat): center input text, remove Assistant label, ChatGPT pattern - Input: items-end → items-center for vertical centering of single-line text - Input: inline SVG for send button (replaces [innerHTML] which Angular sanitizes) - AI messages: remove "Assistant" label, use avatar inline with content (ChatGPT pattern) - Typing indicator: match new AI message layout (avatar + dots, no label) * fix(stream-resource:** handle both SDK and mock event formats in extractEventData ([#30](https://github.com/cacheplane/angular-agent-framework/pull/30))
- **ci:** isolate examples deploy to prevent overwriting website ([#26](https://github.com/cacheplane/angular-agent-framework/pull/26))
- **ci:** trigger examples redeploy when libs change ([#46](https://github.com/cacheplane/angular-agent-framework/pull/46), [#43](https://github.com/cacheplane/angular-agent-framework/issues/43))
- **cockpit:** production review pass — 22 fixes across 14 examples ([647aa50e](https://github.com/cacheplane/angular-agent-framework/commit/647aa50e))
- **cockpit:** restore streaming and deployment-runtime to use ChatComponent (reverted by PR #19) ([#19](https://github.com/cacheplane/angular-agent-framework/issues/19))
- **cockpit:** update e2e tests for current UI ([#24](https://github.com/cacheplane/angular-agent-framework/pull/24))
- **cockpit:** restore fileReplacements for dev environment in all 13 Angular examples ([ef804f1a](https://github.com/cacheplane/angular-agent-framework/commit/ef804f1a))
- **cockpit:** use full URLs in dev environments (SDK requires absolute URLs) ([9d3e02a9](https://github.com/cacheplane/angular-agent-framework/commit/9d3e02a9))
- **cockpit:** align all proxy configs to port 8123 ([#35](https://github.com/cacheplane/angular-agent-framework/pull/35))
- **cockpit:** fix chat/input and chat/threads production builds ([#77](https://github.com/cacheplane/angular-agent-framework/pull/77))
- **cockpit:** add Render/Chat to sidebar labels and prefix stripping ([#80](https://github.com/cacheplane/angular-agent-framework/pull/80))
- **cockpit:** prevent [object Object] rendering when props contain unresolved $state bindings ([#83](https://github.com/cacheplane/angular-agent-framework/pull/83))
- **cockpit:** add render and chat to examples deployment pipeline ([79e8e0c6](https://github.com/cacheplane/angular-agent-framework/commit/79e8e0c6))
- **cockpit:** preserve iframe when switching between Run and Code tabs ([#112](https://github.com/cacheplane/angular-agent-framework/pull/112))
- **cockpit:** align production smoke checks with chat demos ([#124](https://github.com/cacheplane/angular-agent-framework/pull/124))
- **deploy:** rewrite base href per example so assets resolve to correct subpath ([#37](https://github.com/cacheplane/angular-agent-framework/pull/37))
- **e2e:** update stale selectors from pre-rebrand cp-chat to chat ([cf3a2a29](https://github.com/cacheplane/angular-agent-framework/commit/cf3a2a29))
- **e2e:** fix stale selectors in production smoke and all e2e tests ([26143a6c](https://github.com/cacheplane/angular-agent-framework/commit/26143a6c))
- **e2e:** update stale test — FairComparisonSection removed, test LibrariesSection instead ([4811c95b](https://github.com/cacheplane/angular-agent-framework/commit/4811c95b))
- **e2e:** use .first() for .chat-md locator to avoid strict mode violation ([525c8324](https://github.com/cacheplane/angular-agent-framework/commit/525c8324))
- **licensing:** make library dist ESM-loadable ([4c19e299](https://github.com/cacheplane/angular-agent-framework/commit/4c19e299))
- **licensing:** repair fixtures.ts import after signLicense consolidation ([de34a3de](https://github.com/cacheplane/angular-agent-framework/commit/de34a3de))
- **licensing:** make library browser-safe for Angular consumers ([1d394107](https://github.com/cacheplane/angular-agent-framework/commit/1d394107))
- **minting-service:** bundle Vercel functions via Nx esbuild build ([#133](https://github.com/cacheplane/angular-agent-framework/pull/133))
- **minting-service:** move handler sources out of api/ for Vercel deploy ([#134](https://github.com/cacheplane/angular-agent-framework/pull/134), [#133](https://github.com/cacheplane/angular-agent-framework/issues/133))
- **stream-resource:** persist thread ID across messages + smooth scroll ([#32](https://github.com/cacheplane/angular-agent-framework/pull/32))
- **website:** replace unsourced stats with verified Gartner citations ([#33](https://github.com/cacheplane/angular-agent-framework/pull/33), [#27](https://github.com/cacheplane/angular-agent-framework/issues/27), [#28](https://github.com/cacheplane/angular-agent-framework/issues/28), [#29](https://github.com/cacheplane/angular-agent-framework/issues/29))
- **website:** fix flaky e2e test blocking production deploys ([#38](https://github.com/cacheplane/angular-agent-framework/pull/38))
- **website:** correct api reference e2e test path after rebrand ([#40](https://github.com/cacheplane/angular-agent-framework/pull/40))
- **website:** remove invalid eslint-disable blocking all deploys ([#64](https://github.com/cacheplane/angular-agent-framework/pull/64))
- **website:** fix API nav link, comment out logo strip, add missing deps ([#87](https://github.com/cacheplane/angular-agent-framework/pull/87))
- **website:** correct cockpit iframe URLs to match 5-segment route pattern ([0336c75d](https://github.com/cacheplane/angular-agent-framework/commit/0336c75d))
- **website:** simplify mobile docs nav — remove pills, uppercase labels, background highlights ([fefed4ba](https://github.com/cacheplane/angular-agent-framework/commit/fefed4ba))
- **website:** redesign mobile docs nav — larger touch targets, match sidebar style ([0706e9f8](https://github.com/cacheplane/angular-agent-framework/commit/0706e9f8))
- **website:** enlarge mobile nav section headers — match link size with SVG chevron ([56e6a206](https://github.com/cacheplane/angular-agent-framework/commit/56e6a206))
- **website:** lock body scroll when mobile menu open, fix overlay gap, bigger chevrons ([0aa329e0](https://github.com/cacheplane/angular-agent-framework/commit/0aa329e0))
- **website:** remove unused headerColor variable breaking Vercel build ([d1006300](https://github.com/cacheplane/angular-agent-framework/commit/d1006300))
- **website:** resolve all 27 lint warnings — zero warnings ([01cb4950](https://github.com/cacheplane/angular-agent-framework/commit/01cb4950))
- **website:** update SVG assets — replace streamResource with agent() and cacheplane branding ([309010db](https://github.com/cacheplane/angular-agent-framework/commit/309010db))
- **website:** address code review — responsive grid, unique IDs, iframe sandbox, design tokens ([#1](https://github.com/cacheplane/angular-agent-framework/issues/1), [#5](https://github.com/cacheplane/angular-agent-framework/issues/5))
- **website:** prevent mobile horizontal overflow on docs pages ([906f5290](https://github.com/cacheplane/angular-agent-framework/commit/906f5290))
- **website:** remove fair comparison section and fix mobile alignment ([e845ed5a](https://github.com/cacheplane/angular-agent-framework/commit/e845ed5a))
- **website:** make all landing page sections responsive on mobile ([a081862c](https://github.com/cacheplane/angular-agent-framework/commit/a081862c))
- **website:** landing page polish — code padding, SDK comparison, embed frames ([3bd6d267](https://github.com/cacheplane/angular-agent-framework/commit/3bd6d267))
- **website:** add mobile responsive padding and sizing to home page sections ([#126](https://github.com/cacheplane/angular-agent-framework/pull/126))
- **website:** correct stale GitHub URL in Footer and Nav ([a59d0b12](https://github.com/cacheplane/angular-agent-framework/commit/a59d0b12))

### ❤️ Thank You

- Brian Love @blove
- Claude Haiku 4.5
- Claude Opus 4
- Claude Opus 4.6
- Claude Opus 4.6 (1M context)
- Claude Opus 4.7
- Claude Sonnet 4.6
