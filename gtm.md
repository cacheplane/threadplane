# Threadplane GTM Strategy

> Durable strategy. Hand-edited. Operational details live in `docs/gtm/`.
> Workstream plans live in `docs/superpowers/specs/gtm/`.
> Current system ownership and operator commands: [Growth architecture and operations](docs/growth/README.md).
> The phase roadmap below is historical planning, not a deployment inventory.

## 1. What we are

Threadplane is the open-source thread-plane for agents, built for Angular teams. It turns LangGraph, AG-UI, A2UI, and custom agent streams into real Angular experiences — chat, threads, tool progress, human approvals, generative UI, fallbacks, observability, tests — without rewriting in React or adopting a proprietary cloud.

## 2. Category

- **Primary:** Threadplane
- **Tagline (2026-09-18):** "The open-source thread-plane for Angular agents." The description that follows it everywhere: "The open-source thread-plane for agents: chat, durable threads, persistence, human approvals, and generative UI for Angular, on LangGraph and AG-UI."
- **Secondary (only after "Agent UI"):** Angular Agent UI Framework
- **Do not use:** "Threadplane" (ambiguous with backend runtimes and coding agents), "Enterprise Angular agent framework" (reads sales-first).

The category claim is the **Angular final mile**: official streaming SDKs (LangChain, AG-UI, A2UI) get events into Angular; Threadplane turns those events into production-ready Angular experiences. We do not compete as a general agent UI framework. We do not compete with backend runtimes.

## 3. ICP

Two tracks, both addressed from the homepage via the CTA fork.

| Track       | Buyer                                    | Channel                    | Primary CTA              | Secondary surface       |
|-------------|------------------------------------------|----------------------------|--------------------------|-------------------------|
| Developer   | Angular engineer on an agent project     | docs, GitHub, npm, search  | `Install @threadplane/chat`     | cockpit recipes         |
| Enterprise  | Architect / eng lead at an Angular shop  | direct, partner, content   | `Talk to our engineers`  | `/contact` → LeadForm   |

Detailed personas, buying signals, and disqualifiers: `docs/gtm/icp.md`.

## 4. Acquisition, activation and follow-up

Developer acquisition includes website engagement, npm installs and development
runtime announcements. Growth records evidence and evaluates linked install/runtime
activation. The founder sequence uses durable authorization and stop controls;
company intelligence comes from enrichment and signals, not explicit associations.

Enterprise forms record requests and submitted context. A work email and company
field are useful signals, not verified qualification or employment. Use the Growth
journey to assess intent and evidence. The former server-side
`marketing:lead_qualified` helper is removed; its absence is not a delivery alarm.

Cockpit engagement remains a separate product analytics measurement. Completing a
cockpit funnel is not the same as becoming eligible for founder outreach.

## 5. Measurement

- Growth funnel and journey reports describe recorded observations, linked
  activation decisions, contact controls and lifecycle outcomes.
- PostHog's committed dashboards cover developer engagement and runtime telemetry.
  Additional dashboards in the historical roadmap are not evidence of implementation.
- Search Console scripts measure website search performance.
- Social metrics do not yet feed a central ingestion pipeline.

See [the operational map](docs/growth/README.md) for commands, schedules and
attribution/reporting limits. Do not infer a complete anonymous conversion funnel
from independent observation counts.

## 6. Phases

Four phases. Each phase = one or more workstream specs. Exit gates are blocking.

| Phase | Goal                          | Specs                                                                   | Exit gate |
|------:|-------------------------------|-------------------------------------------------------------------------|-----------|
| 0     | Measurement foundation        | analytics-foundation-1a, 1b, 1c, 1d                                     | 5 dashboards live, 3 event namespaces emitting, `@threadplane/telemetry@0.0.1` published, weekly report runnable. |
| 1     | Developer clarity in 30 sec   | positioning-and-risks, comparison-pages, cockpit-activation-recipes     | New hero shipped (incl. CTA fork), 4 comparison pages live, six-signal activation funnel non-zero, ≥1 qualified lead recorded. |
| 2     | Ecosystem path (SEO + recipes)| content-pillar-pages                                                    | 6 pillar pages indexed, organic traffic baseline captured. |
| 3     | Community launch              | community-launch                                                        | Launch executed, week-1 snapshot committed, post-mortem committed. |
| 4     | Enterprise design partners    | enterprise-pipeline                                                     | 3 pilots tracked end-to-end in `enterprise-funnel`, ≥1 sanitized public artifact produced. |

Deferred (post-Phase-4, own specs): PostHog feature flags as code, experiments as code, session replay, group analytics, Cowork plugin packaging.

## 7. Workstream agents

Operational progress lives in agent runs and PostHog. The repo holds durable strategy and the Cowork skill definition. This table is the static inventory — *who owns what*, not *what's done*.

| Phase | Workstream                 | Subagent                                  | Spec                                                                          | Dashboard                  |
|------:|----------------------------|-------------------------------------------|-------------------------------------------------------------------------------|----------------------------|
| 0     | gtm-meta                   | `cowork/gtm/SKILL.md`                     | [meta](docs/superpowers/specs/gtm/2026-05-13-gtm-meta-design.md)               | —                          |
| 0     | analytics-foundation-1a    | `cowork/gtm/SKILL.md`                     | [spec](docs/superpowers/specs/gtm/2026-05-14-analytics-foundation-1a-dashboards-as-code-design.md) | `developer-funnel` (sample)  |
| 0     | analytics-foundation-1b    | `cowork/gtm/SKILL.md`                     | [spec](docs/superpowers/specs/gtm/2026-05-15-analytics-foundation-1b-tplane-telemetry-design.md) | `runtime-telemetry`        |
| 0     | analytics-foundation-1c    | `cowork/gtm/SKILL.md`                     | (pending)                                                                      | `activation-six-signals`   |
| 0     | analytics-foundation-1d    | `cowork/gtm/SKILL.md`                     | (pending)                                                                      | `enterprise-funnel`        |
| 1     | positioning-and-risks      | `cowork/gtm/SKILL.md`                     | (pending)                                                                      | —                          |
| 1     | comparison-pages           | `cowork/gtm/SKILL.md`                     | (pending)                                                                      | `content-intent`           |
| 1     | cockpit-activation-recipes | `cowork/gtm/SKILL.md`                     | (pending)                                                                      | `activation-six-signals`   |
| 2     | content-pillar-pages       | `cowork/gtm/SKILL.md`                     | (pending)                                                                      | `content-intent`           |
| 3     | community-launch           | `cowork/gtm/SKILL.md`                     | (pending)                                                                      | —                          |
| 4     | enterprise-pipeline        | `cowork/gtm/SKILL.md`                     | (pending)                                                                      | `enterprise-funnel`        |

## 8. Non-goals (current phase)

- We do not compete as a general agent UI framework. We claim the Angular final mile.
- Public analytics helpers remain explicit. Development-only install/runtime Growth collection follows its own controls; see [libs/telemetry/README.md](libs/telemetry/README.md) for the complete contract.
- We do not run paid acquisition until Phase 2 organic baselines exist.
- We do not pursue stars as a vanity metric.
- We do not run A/B positioning experiments in Phase 1. Ship one hero, measure, iterate.
- We do not instrument the smoke/demo app — it's a canonical reference, not a funnel surface.
- We do not auto-commit weekly snapshots. A human reviews Notes before merge.
- We do not publish the Cowork skill as a marketplace plugin in Phase 0–4. Project-local; reconsider after Phase 4.

## 9. Cadence

- **Weekly:** `/gtm` Cowork skill runs the weekly snapshot procedure — `npm run posthog:report`, drafts a 3-bullet Notes section, opens a PR with `docs/gtm/reports/<date>-weekly.md`. Human reviews Notes before merge.
- **Monthly:** re-read this document. Edit positioning, ICP, non-goals, or phase exit gates if reality has moved.
- **Per workstream:** brainstorm → spec → plan → execute → dashboard signals verified → spec frontmatter `status: done` → §7 inventory updated.

## 10. References

- Strategy + visual research: `.superpowers/brainstorm/` (gitignored)
- Meta-spec: [docs/superpowers/specs/gtm/2026-05-13-gtm-meta-design.md](docs/superpowers/specs/gtm/2026-05-13-gtm-meta-design.md)
- ICP: [docs/gtm/icp.md](docs/gtm/icp.md)
- Messaging: [docs/gtm/messaging.md](docs/gtm/messaging.md)
- Taxonomy: [docs/gtm/taxonomy.md](docs/gtm/taxonomy.md)
- Dashboards-as-code: [tools/posthog/README.md](tools/posthog/README.md)
- Telemetry contract: [libs/telemetry/README.md](libs/telemetry/README.md)
- Cowork skill: [cowork/README.md](cowork/README.md) · [cowork/gtm/SKILL.md](cowork/gtm/SKILL.md)
- Prior PostHog instrumentation plan (subsumed by Spec 1): [docs/superpowers/plans/2026-05-02-posthog-gtm-analytics.md](docs/superpowers/plans/2026-05-02-posthog-gtm-analytics.md)
