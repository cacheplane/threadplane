# Growth architecture and operations

Growth covers acquisition, publishing, developer progress, company research,
and founder follow-up. This is the current implementation map. `gtm.md` owns
positioning and audience strategy; historical plans describe decisions at the
time they were written, not which services or capabilities exist today.

## Ownership

| Location | Owns | Boundary |
| --- | --- | --- |
| `apps/website` | Landing pages, forms, collection HTTP routes, browser engagement | Accept requests and record evidence; do not send campaign email in a browser request |
| `libs/telemetry` | Public SDK capture and development install/runtime collection | Keep the explicit analytics API distinct from development-only Growth collection |
| `libs/growth` | Contacts, authorization, observations, activation, durable jobs, delivery state, reports | Authoritative operational state in Neon; no dependencies on application implementations or publishing tools |
| `libs/growth-capture` | Company page capture, SSRF controls, evidence extraction and diagnostics | Shared server-side capture library; no contacts, outreach policy, or model execution |
| `apps/lifecycle` | Dawn job execution, research orchestration, fulfillment, notifications and founder sequence | Vercel deployment; consumes shared Growth and capture libraries |
| `apps/growth-research` | Dawn company research execution and local evaluation | LangSmith deployment; shared company primitives live in `src/company`, local corpus tooling in `src/pilot` |
| `marketing/assets`, `marketing/channels` | Branded images and manually invoked X/Dev.to publishing | Private operator packages; no contact database access or automatic campaign worker |
| `tools/posthog` | Event contracts, dashboard definitions, quality checks and reporting | Engagement measurement, not authorization or delivery truth |
| `apps/website/scripts/gsc` | Search Console snapshots and search reports | Website-specific operator tooling; local output, no in-repo schedule |
| `scripts/growth-*`, `migrations` | Operational commands and Growth schema changes | Explicit operator entry points; migrations belong to Growth despite their root location |

Separate runtime deployments remain intentional. The lifecycle application uses
a small documented source bridge for Dawn's native Vercel bundler. Research's
standalone package contains registry dependencies only; the local evaluation
harness and its capture dependency do not enter that deployment.

One existing source-level exception remains: lifecycle imports research's wire
contracts, candidate validation, settlement-claim reader and trace transport.
These imports share protocol and cleanup behavior without loading research's
graph or model bootstrap. They are explicitly documented at their call sites;
this cleanup does not claim complete source independence between those apps.

## Data flow and vocabulary

Social posts may link to the website with campaign UTMs. Website collection
records sanitized campaign metadata. Forms and install/runtime signals enter
Growth's observation and contact flows. Lifecycle leases durable jobs, requests
company capture and Dawn research, and persists the resulting evidence.

Account intelligence comes from enrichment and observed signals. A submitted
company name or install email is evidence, not verified employment. Intelligence
and progress do not override authorization, reply stops or suppression.

The **founder sequence** is the once-per-contact three-email lifecycle flow.
A **publishing campaign** is a content brief and its social posts. They do not
share a campaign scheduler. Newsletter signup uses Growth; there is no generic
newsletter broadcast engine, drafting agent, automated publishing approval loop,
or social metrics ingestion worker in this repository.

The website whitepaper toast is an acquisition form. Development runtime
announcements are a separate collection surface; they do not send email inline.

Neon is authoritative for contact eligibility and lifecycle outcomes. PostHog
measures engagement. LangSmith traces explain research execution. None should
be treated as a substitute for the other two.

## Operator entry points

Run from the repository root with the relevant service configuration available.
Commands do not share a global credential loader: adapters load only their own
configuration, and deployed apps receive secrets through their hosting platforms.

| Command | Purpose and side effects |
| --- | --- |
| `npm run growth:report -- funnel --from <UTC> --to <UTC>` | Read observation/activation cohorts; range must be positive and at most 31 days |
| `npm run growth:report -- journey --contact <UUID>` | Read one contact's recorded journey |
| `npm run growth:control -- status --email <address>` | Read contact controls; `approve`, `stop` and `delete` are separate explicit mutations |
| `npm run growth:research -- synthetic --output <absolute-directory>` | Write a local synthetic evaluation corpus; `acquire` and `run` can call providers |
| `npm run growth:analytics:plan` | Read-only PostHog configuration comparison |
| Founder install digest (lifecycle tick, `GROWTH_INSTALL_DIGEST_ENABLED`) | Daily plain-text list of install-only work-email identities with one-click approve links; read-only unless a link is clicked |
| `npm run growth:analytics:report` | Fetch dashboard results and write a local report for review |
| `npm run growth:analytics:quality -- --days 7` | Read recent event samples and validate the analytics contract |
| `npm run growth:search:pull` / `growth:search:report` | Pull Search Console data, then render local snapshots |

Existing `growth:observability`, `posthog:*` and `gsc:*` commands remain available.
Publishing/authentication commands and dry-run instructions live in
[the channel guide](../../marketing/channels/README.md). Live publishing is an
explicit operator action; a smoke command without `DRY_RUN=1` can publish.

## Schedules and measurement limits

The website Vercel cron invokes lifecycle every minute. Due times live in Growth
jobs. The founder sequence starts the next business morning at 07:00 Pacific;
later steps are three and five business days after the preceding accepted send.
The send window is 07:00–08:00 Pacific, weekdays, with daylight-saving handling.
Requested fulfillment and internal notifications use their own execution rules.
See [lifecycle operations](../../apps/lifecycle/README.md).

GitHub runs PostHog quality checks daily. Weekly GTM reports are operator-run;
the repository does not install a workstation scheduler. Social publishing and
search reporting also have no in-repo recurring worker.

The Growth funnel is an observation/activation report, not a complete sequential
anonymous conversion funnel. A UTM is not a proven link from a social post to a
developer identity. PostHog's Quick overview separates acquisition, docs, demo
and public runtime signals; install copy attempts do not measure npm installs.
The runtime dashboard includes demo usage and historical malformed events.
The weekly report separates additive daily series and marks funnels, unique
counts, breakdowns and missing results `Unavailable`. An analytics contract
failure does not itself prove a lifecycle delivery failure. See the
[dashboard inventory and measurement limits](../../tools/posthog/README.md#current-growth-dashboards).

## Website analytics configuration

Two PostHog settings that change what the website measures live only in the
project UI. Neither is in this repository, and `tools/posthog/` does not sync
them. They have opposite precedence against `apps/website/instrumentation-client.ts`:

| Setting | Precedence | posthog-js resolution |
| --- | --- | --- |
| `autocapture_opt_out` | **Project wins.** Client config cannot re-enable autocapture. | `!!config.autocapture && !remoteOptOut` |
| `capture_performance.web_vitals` | **Client wins** when it sets an explicit boolean. | `isBoolean(clientValue) ? clientValue : remoteValue` |

Read the live values rather than trusting either source:

```bash
curl -s "https://threadplane.ai/ingest/array/<NEXT_PUBLIC_POSTHOG_TOKEN>/config.js"
```

The client half is pinned by `apps/website/instrumentation-client.spec.ts`,
which asserts literal values — `capture_pageview` must equal the string
`'history_change'`, because `true` is truthy and is exactly the bug that spec
exists to prevent.

### Bounce rate baseline, pre-cutover

PostHog decides a bounce with
`NOT (page_screen_count >= 2 OR has_autocapture OR session_duration >= 10s)`.
Until 2026-09-18 only the duration branch worked, so the figures below mean
"share of sessions that ended within 10 seconds". Entry pathname `/`:

| Month | Sessions | Bounce | ±95% CI | Zero-duration | Median duration |
| --- | --- | --- | --- | --- | --- |
| 2026-05 | 186 | 82.5% | ±5.5pp | 43.0% | 1.0s |
| 2026-06 | 160 | 79.1% | ±6.3pp | 37.5% | 2.0s |
| 2026-07 | 176 | 86.9% | ±5.0pp | 44.9% | 2.0s |
| 2026-08 | 180 | 65.4% | ±7.0pp | 25.6% | 3.0s |
| 2026-09 | 159 | 50.7% | ±7.8pp | 18.2% | 6.0s |

**The series breaks after 2026-09-18.** Restoring the other two branches lowers
the rate on unchanged traffic. Do not compare across that date.

**The volume does not support fine comparisons.** At ~160 homepage sessions per
month a ±7.8pp interval cannot separate 50.7% from 59%. Judging a homepage
change on this metric needs a much longer accumulation window, or more traffic.

Two limits this baseline exposed. `$pageleave` is missing from 17–20% of
sessions across every browser measured — Chrome Desktop 17.2%, Safari Desktop
19.6%, Mobile Safari 20.0%, Chrome Mobile 18.8% — so those sessions collapse to
zero duration and become automatic bounces; the zero-duration share tracks the
bounce rate month over month. And 89% of homepage entries are Direct (142 of 159
in September, 55% bounce) against 14 Organic Search sessions at 14% bounce, so
the headline figure is mostly a statement about untagged traffic.

## Contributor checks

Use project-scoped Nx tests, lint and builds. Changes to company primitives must
also pass the standalone LangSmith packaging check. Changes to lifecycle's
shared imports must pass the native Vercel artifact check. Keep graph identifiers
and deployment configuration stable during source-only refactors.

Relevant guides: [Growth records and reports](../../libs/growth/README.md),
[research](../../apps/growth-research/README.md),
[publishing](../../marketing/README.md),
[analytics](../../tools/posthog/README.md),
[search](../../apps/website/scripts/gsc/README.md).
