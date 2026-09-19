# Event & Property Taxonomy — Threadplane

> Single source of truth for PostHog event names, properties, CTA ids, and surface ids. Implementation lands in `apps/website/src/lib/analytics/events.ts`, `apps/cockpit/src/lib/analytics/events.ts`, and `libs/telemetry/src/shared/events.ts`. Whenever those files change, this file changes.

## Namespace rules

Single PostHog project. Three event-name prefixes:

| Prefix       | Source                        | Notes                                                                                                    |
| ------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `marketing:` | `apps/website`                | Carried forward from May-2 instrumentation plan.                                                         |
| `cockpit:`   | `apps/cockpit`                | Activation surface. New in Spec 1.                                                                       |
| `tplane:`      | `libs/telemetry`              | Library telemetry. Opt-out node, opt-in browser.                                                         |
| `docs:`      | `apps/website` (docs surface) | Subset of website events scoped to docs interactions. Distinguished by prefix for filtering convenience. |

The standard PostHog `$pageview` event is used as-is across all three surfaces.

## Naming rules

- lowercase snake_case after the prefix (`marketing:lead_form_submit`, not `marketing:LeadFormSubmit`).
- Static event names. Vary via properties, not event names.
- One event per discrete user action. Submits, successes, failures are distinct events.
- Server-side events for conversion truth; client-side for journey signal.

## Marketing (website)

| Event                                 | When                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `$pageview`                           | Automatic, every route                                                                        |
| `marketing:cta_click`                 | Any tracked CTA                                                                               |
| `marketing:external_link_click`       | External outbound (github, npm, cockpit)                                                      |
| `marketing:whitepaper_download_click` | Direct PDF download click                                                                     |
| `marketing:whitepaper_signup_submit`  | Submit attempt                                                                                |
| `marketing:whitepaper_signup_success` | Server 2xx                                                                                    |
| `marketing:whitepaper_signup_fail`    | Server non-2xx or validation error                                                            |
| `marketing:lead_form_submit`          | Submit attempt (any surface)                                                                  |
| `marketing:lead_form_success`         | Server 2xx                                                                                    |
| `marketing:lead_form_fail`            | Server non-2xx                                                                                |
| `marketing:lead_qualified`            | Historical only: retired qualification emitter. Current evidence and authorization live in Growth. |
| `marketing:newsletter_signup_submit`  | Submit attempt                                                                                |
| `marketing:newsletter_signup_success` | Server 2xx                                                                                    |
| `marketing:newsletter_signup_fail`    | Failure                                                                                       |
| `marketing:ai_crawler_visit`          | Edge middleware saw a known AI crawler UA on an observed route (HTML pages plus llms.txt / sitemap.xml / robots.txt). Props: `ai_crawler`, `source_page`, `user_agent`. Deduped per crawler/path/hour and capped by a per-instance emission ceiling. |
| `marketing:ai_referral_visit`         | Edge middleware saw a referrer from an AI answer engine. Props: `ai_source`, `source_page`. Anonymous (no person profile). |
| `docs:search_submit`                  | Docs search invocation                                                                        |
| `docs:search_result_click`            | Result click                                                                                  |
| `docs:copy_prompt_click`              | Prompt-copy button                                                                            |
| `docs:copy_code_click`                | Code-copy button                                                                              |
| `blog:cta_click`                      | Tracked CTA inside a blog post body. Props: `surface: 'blog'`, `cta_id?`, `destination_url?`. |
| `blog:copy_code_click`                | Copy-button click on a code block inside a blog post. Props: `surface: 'blog'`, `code_lang?`. |
| `docs:tab_select`                     | MDX tab change                                                                                |
| `docs:sidebar_section_toggle`         | Sidebar nav toggle                                                                            |
| `docs:workspace_navigation` | Workspace capability navigation; `capability`, `category`, `from_capability`, `surface`. |
| `docs:workspace_mode_switched` | Workspace mode change; `capability`, `from_mode`, `to_mode`, `surface`. |
| `docs:workspace_runtime_action` | Explicit runtime action; `capability`, `action`, `state_before`, `outcome`, `surface`. |
| `docs:workspace_runtime_status_changed` | Runtime status transition; `capability`, `from_state`, `to_state`, optional `elapsed_ms`/`reason_code`, `surface`. |
| `marketing:stage_progress` | Recorded homepage stage progress; `surface`, `stage_event`, optional `beat`. Not a live developer runtime. |
| `marketing:engaged_time` | Cumulative **visible** seconds on a page; `engaged_seconds` (10 or 30), `source_page`. Fires on every viewport. Hidden background time is excluded by construction, so it reads as attention rather than a tab left open. |

Current dashboards distinguish website intent, client-observed form acceptance,
and independent demo milestones. `hero_install` is a copy attempt recorded before
clipboard success, not an npm install. The former six-signal activation funnel
does not represent Growth's install/runtime activation and is no longer managed.
Actual install/runtime activation, enrichment, authorization and email outcomes
remain authoritative in Neon; see [Growth operations](../growth/README.md).

## Cockpit (activation surface)

| Event                                   | When                                                            |
| --------------------------------------- | --------------------------------------------------------------- |
| `cockpit:recipe_opened`                 | Sidebar capability link clicked                                 |
| `cockpit:mode_switched`                 | Run/Code/Docs/API tab change                                    |
| `cockpit:code_copied`                   | Copy click in code mode, doc snippet, or agentic-prompt block   |
| `cockpit:transport_connected`           | LangGraph/AG-UI/custom adapter wired in iframe                  |
| `cockpit:chat_first_message`            | First user message sent in cockpit chat                         |
| `cockpit:thread_persisted`              | Thread saved (re-load demonstrated)                             |
| `cockpit:interrupt_handled`             | Human-approval interrupt completed                              |
| `cockpit:generative_component_rendered` | One generative Angular component rendered                       |
| `cockpit:activation_complete`           | All five activation signals fired within 30 min for one session |

The five activation signals (whose union fires `cockpit:activation_complete`) are
`transport_connected`, `chat_first_message`, `thread_persisted`, `interrupt_handled`,
and `generative_component_rendered`. The shell events (`recipe_opened`,
`mode_switched`, `code_copied`) are context for the funnel — they fire before
or alongside the activation signals but are not part of the five-step rollup.
Package installation is not measured. Runtime events are evaluated separately
from cockpit sessions.

## tplane (library telemetry)

| Event                           | When                                                       | Surface        | Default                                    |
| ------------------------------- | ---------------------------------------------------------- | -------------- | ------------------------------------------ |
| `tplane:runtime_instance_created` | Runtime adapter init                                       | Node / Browser | **Explicit call** on Node, **Opt-in** in Browser |
| `tplane:runtime_request_created`  | Runtime adapter request created                            | Node / Browser | **Explicit call** on Node, **Opt-in** in Browser |
| `tplane:stream_started`           | Stream begins                                              | Node / Browser | **Explicit call** on Node, **Opt-in** in Browser |
| `tplane:stream_ended`             | Stream ends normally                                       | Node / Browser | **Explicit call** on Node, **Opt-in** in Browser |
| `tplane:stream_errored`           | Stream errors                                              | Node / Browser | **Explicit call** on Node, **Opt-in** in Browser |
| `tplane:browser_provided`         | `provideThreadplaneTelemetry({enabled:true})`                     | Browser        | **Opt-in**                                 |
| `tplane:browser_chat_init`        | Browser chat surface initialized                           | Browser        | **Opt-in**                                 |

Browser events never fire unless the consumer explicitly opts in. See `libs/telemetry/README.md` for the trust contract.

### Runtime telemetry properties

| Property        | Type   | Notes                                                                         |
| --------------- | ------ | ----------------------------------------------------------------------------- |
| `transport`     | string | Runtime transport, e.g. `langgraph`, `ag-ui`, or `custom`.                    |
| `surface`       | string | Adapter surface emitting the event.                                           |
| `requestType`   | string | Request shape, e.g. `submit`, `resubmit`, `regenerate`, `enqueue`, or `join`. |
| `provider`      | string | Model provider when known.                                                    |
| `model`         | string | Model name when known.                                                        |
| `durationMs`    | number | Stream duration for end/error events.                                         |
| `errorClass`    | string | Error class only. Never send error messages.                                  |
| `sample_weight` | number | Inverse sample rate for weighted counts.                                      |

## Shared properties

| Property          | Type   | Notes                                                                                                               |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `source_page`     | string | Stable pathname or surface id (`home`, `compare_langchain_angular`, `pricing`).                                     |
| `source_section`  | string | Stable section/component id where known.                                                                            |
| `surface`         | enum   | `nav` `mobile_nav` `footer` `home` `pricing` `docs` `blog` `library_landing` `solution` `toast` `cockpit` `contact` |
| `destination_url` | string | Clicked URL where applicable.                                                                                       |
| `cta_id`          | string | Stable CTA id (see below).                                                                                          |
| `cta_text`        | string | Visible label where stable.                                                                                         |
| `track`           | enum   | `developer` `enterprise` `pricing` `pilot`                                                                          |
| `paper`           | enum   | `overview` `angular` `render` `chat`                                                                                |
| `library`         | enum   | `agent` `render` `chat` `unknown`                                                                                   |
| `email_domain`    | string | Extracted server-side. Never raw email in client events.                                                            |
| `company`         | string | Server-side only, on conversion events, if approved.                                                                |
| `is_success`      | bool   | Generic success flag for wrapper events.                                                                            |
| `failure_reason`  | string | Short stable code on failure events.                                                                                |
| `referrer_host`   | string | Sanitized host of HTTP referrer.                                                                                    |
| `message_length`  | int    | Lead form / whitepaper message length (never the content).                                                          |
| `message_empty`   | bool   | Whether the free-text body was empty.                                                                               |

## CTA ids (stable, lowercase snake_case)

**Hero**

- `hero_install_open` — primary button opens the install dialog
- `hero_install` — copy in the dialog; property `adapter: fake | langgraph | ag_ui`
- `hero_quickstart` — dialog footer link and final CTA primary; property `adapter`
- `hero_live_demo` — hero text link → docs run surface; final CTA secondary
- `hero_demo_play` — "Play walkthrough" pressed (mobile / reduced motion)
- `hero_demo_takeover` — visitor took control of the hero demo (frame reported `live`)
- `hero_demo_replay` — visitor restarted the walkthrough
- `hero_demo_fallback_open` — poster fallback link → demo.threadplane.ai
- `hero_talk_to_engineers` — enterprise section CTA (moved from the hero 2026-09-02)
- retired 2026-09-02: `hero_demo_open_workspace`, `hero_demo_open_workspace_caption`, `hero_proof_pill`

**Homepage sections**

- `home_runtime_parity_toggle` — property `adapter`
- `home_adapter_guide` — parity CTA → `/docs/choosing-an-adapter`
- `home_coding_agent_prompt` — prompt copied (prompt text is never sent)
- `home_coding_agent_link` — property `cta_text` names which link
- `home_no_runtime_docs` — No-runtime band text link → `/docs/choosing-an-adapter`
- retired 2026-09-04: `home_production_readiness_expand`, `home_yes_wall_docs` (the Yes wall was replaced by the reliability band)

**Nav**

The navbar was rebuilt on 2026-09-08 into four triggers, three of which open panels.
Every panel destination is data in `apps/website/src/components/shared/nav-config.ts`,
and `trackNavItem` prefixes each item's `ctaId` with the surface — so **every id below
also exists with a `mobile_nav_` prefix**, emitted by the same items in the mobile
drill-in drawer. Add a destination there and its id appears on both surfaces
automatically; there is no second list to keep in sync.

- Libraries panel — `nav_libraries_langgraph` `nav_libraries_ag_ui` `nav_libraries_chat`
  `nav_libraries_render` `nav_libraries_choosing_an_adapter`
- Docs panel — `nav_docs_documentation` `nav_docs_quick_start`
  `nav_docs_choosing_an_adapter` `nav_docs_guides` `nav_docs_concepts`
  `nav_docs_api_reference`
- Docs panel, external demos — `nav_docs_demo_langgraph` `nav_docs_demo_ag_ui`
  (derived from `DEMOS` in `lib/demos.ts`, so a new demo adds its own id)
- Solutions panel — `nav_solutions_customer_support` `nav_solutions_analytics`
  `nav_solutions_compliance` `nav_solutions_pilot_to_prod` `nav_solutions_blog`
  `nav_solutions_about`
- Bar itself — `nav_pricing` `nav_github` `nav_talk_to_us`
- Mobile drawer only — `mobile_nav_docs_page` (any link inside the docs tree, with the
  page title in `cta_text` and the library in `library`)

- retired 2026-09-08: `nav_demo_langgraph` `nav_demo_ag_ui` (the hand-rolled `Demo ▾`
  dropdown was absorbed into the Docs panel — the demos are now
  `nav_docs_demo_langgraph` / `nav_docs_demo_ag_ui`); `nav_docs` (now
  `nav_docs_documentation`); `nav_pilot_to_prod` (now `nav_solutions_pilot_to_prod`)
- retired earlier, date unknown: `nav_get_started` `nav_npm` `nav_cockpit` — these were
  already listed here but no longer emitted by the pre-redesign nav either, so this
  section had drifted before the rebuild. Recorded rather than silently dropped, in case
  a dashboard still filters them.

**Footer**

- `footer_github` `footer_npm` `footer_cockpit` `footer_pricing` `footer_pilot_to_prod` `footer_contact`

**Comparison pages** (`/compare/<x>`)

- `compare_<x>_install` — primary CTA on each comparison page
- `compare_<x>_talk_to_engineers` — secondary CTA on each comparison page
- `compare_<x>_view_demo` — link to cockpit recipe

**Pricing & Pilot**

- `pricing_enterprise_lead` — pricing page form submit
- `pilot_book_call` — `/pilot-to-prod` form submit

**Contact**

- `contact_send` — `/contact` form submit

## Privacy & redaction rules

- **Never send** raw lead form `message`, raw docs search query, copied code content, or any free-form customer text.
- **Always send** message _length_ and _is_empty_ booleans instead.
- **Email domains only** in client-side events; raw emails never leave the form.
- **Company** is server-side only, on conversion events.
- **Free-form lead body** is never forwarded to PostHog under any property name.
- Treat email, name, company, and any free-form customer text as sensitive.

## Version + change log

This file is human-edited. When events are added/renamed/removed, update the affected event-constant files in the same PR. CI guards `posthog:sync` will warn if a dashboard JSON references an event not listed here.

| Date       | Change                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 2026-05-13 | Initial draft per Spec 0.                                                                                                      |
| 2026-05-15 | Drop cockpit:install_command_copied, rename cockpit:six_signals_complete → cockpit:activation_complete (Spec 1C).              |
| 2026-05-15 | Cockpit shell events: rename `recipe_start` → `recipe_opened`; add `mode_switched` and `code_copied` (Spec 1C implementation). |
| 2026-05-17 | Add `blog:cta_click` + `blog:copy_code_click` events; add `'blog'` to `AnalyticsSurface` (Spec 5).                             |
