# Threadplane lifecycle service

Part of [Growth architecture and operations](../../docs/growth/README.md).

This Node 24 service builds Dawn 0.8.26's native Vercel target and adds a thin app-owned service boundary. The Vercel adapter requires the exact `LIFECYCLE_SERVICE_SECRET` bearer token on every Dawn path. Dawn route middleware repeats the same check for execution routes.

The service has two database boundaries:

- `DATABASE_URL` is the growth CRM/control-plane database used by `@threadplane-internal/growth`.
- `DAWN_DATABASE_URL` is a separate database or isolated schema/database endpoint used only for Dawn threads, checkpoints, and permission state.

Neither variable falls back to the other. Preview and production must use different Neon resources for both boundaries. Configure no lifecycle secret with a `NEXT_PUBLIC_` prefix.

Install/runtime activation has a separate rollout switch: `GROWTH_INSTALL_RUNTIME_HELLO_ENABLED` defaults to `false` and accepts only exact `true` or `false`. Only when it and campaign enrollment are enabled does the existing lifecycle tick resolve linked activations before materializing the campaign cohort. Configure the same server-only `GROWTH_EMAIL_HMAC_ACTIVE_VERSION`, `GROWTH_EMAIL_HMAC_ACTIVE_SECRET`, and optional `GROWTH_EMAIL_HMAC_PREVIOUS_KEYS` used by collection; these keys are read lazily only for enabled activation processing. Existing form and claim enrollment needs no new HMAC configuration while the rollout switch is off. Announcement requests do not run this work or submit email.

The founder install digest has its own switch: `GROWTH_INSTALL_DIGEST_ENABLED` defaults to `false` and accepts only exact `true` or `false`. When enabled, the lifecycle tick enqueues one `digest` job per Pacific business day (idempotency key `install_digest:<YYYY-MM-DD>`) only when at least one identified, non-CI installer with a work-email domain has no contact record and has not been reported before. The job renders a plain-text summary and sends it to `FOUNDER_NOTIFICATION_EMAIL` through the internal notification sender; it never emails the installer and never creates a contact. Each line carries a seven-day signed `founder_approve_install` link to `/api/growth/approve-install` on `GROWTH_PUBLIC_ACTION_ORIGIN`, which creates and approves the contact through the founder reauthorization path so the next tick enrolls them. Reported identities are recorded in `growth_install_digest_reports` in the same transaction that completes the job. `DELIVERY_ENABLED=false` defers digest jobs like any other send.

Apply migrations 0004–0007 before deploying the backend: contact deletion and campaign authorization use the observation tables even while the activation switch is off. Verify a second migration run applies nothing. For databases with historical deletions, run `npm run growth:observability -- initialize-redactions --limit 100` with the matching collection HMAC keys, passing each returned `nextCursor` as `--cursor` until exhausted, before enabling identity collection or activation.

Deploy backend observation acceptance and bridge resolution with the rollout switch off. Verify the synthetic journey in preview with a controlled recipient and lifecycle's matching HMAC keys, then publish the matching collectors and enable production collection and activation gradually. Preserve the existing enrollment start timestamp, campaign, delivery, and cron controls.

All three campaign steps are founder session offers and send without waiting for an enrichment artifact; a cited research angle only selects an angle-flavored version of the same offer. A persisted `install_runtime` enrollment reason keeps all three steps generic even if optional research later becomes available. Form and project-claim enrollments retain their existing behavior. The shared delivery authorization, reply/suppression stops, mailbox recovery guard, unsubscribe links, and once-per-contact three-step enrollment remain in force; install-derived eligibility does not verify identity or employment.

An eligible install/runtime link also queues at most one optional company-enrichment job per contact when the admitted install email has a valid non-personal domain. It uses the Dawn company worker, browser capture, and `company_enrichment.v1` artifact. Its payload contains observation references and an explicit `install_runtime` source; it does not invent a form submission or verified company association. The worker rechecks contact approval, stops, lease, and linked evidence before capture and again before model execution. Persistence checks these controls again, and evidence redaction cancels affected work and removes retained artifacts. A skipped or failed enrichment job does not delay the generic hello sequence.

Use the [growth operator reports](../../libs/growth/README.md) for the bounded funnel and contact journey. Collection and activation can precede fact projection; the report exposes pending observation work. Projection currently runs through the existing operator command rather than the lifecycle tick.

Recipient delivery also requires `GROWTH_PUBLIC_ACTION_ORIGIN`, a server-only bare HTTPS origin for the Website deployment that owns `/api/unsubscribe`. In preview, use a dedicated public custom-domain alias for the exact Website preview deployment while keeping generated preview URLs protected; the signed action token is the application-layer authorization. In production, use the canonical Website origin. Paths, query strings, fragments, credentials, and HTTP origins are rejected. The lifecycle service uses this value only to construct opaque, contact-bound unsubscribe action URLs; it never derives the origin from a request or hardcodes the production site.

Set `GROWTH_DATABASE_ENVIRONMENT` to exactly `preview`, `production`, or `test` in every process that handles verified Resend events. A verified webhook whose `environment` provider tag is missing or differs from that value is acknowledged without opening a growth transaction or changing delivery/suppression state.

The app's Vercel project must use `apps/lifecycle` as its root directory, enable access to files outside that directory for the npm/Nx monorepo build, and select Node 24. `npx nx build lifecycle` generates the closed native function in `.vercel/output`, bundles a sibling authentication wrapper, and verifies it under plain Node outside the workspace. The wrapper passes the original request with an explicit Dawn database binding; generated source is never rewritten. A missing `DAWN_DATABASE_URL` fails closed. Function metadata preserves the 60-second limit. The existing Nx build command is intentional; Dawn may emit a reference Vercel configuration because it only recognizes its direct CLI command. Resend's optional React email renderer is installed so the native bundle has no unresolved package imports; campaign templates remain unchanged.

Keep `LIFECYCLE_CRON_ENABLED` unset or set to anything other than the exact value `true` until the preview dogfood checklist in `docs/superpowers/runbooks/2026-08-31-growth-lifecycle-cutover.md` passes. In particular, verify outer auth on all Dawn surfaces, named-thread dispatch, duplicate invocation behavior, recovery pause/resume, cancellation/AbortSignal propagation, and Dawn persistence across fresh instances. Send findings to Dawn task `01a05e2f-7e93-7bd0-af74-f13d5a7719cd` for generalized backport.

Use [DOGFOOD.md](./DOGFOOD.md) for the provider-free setup, probe, and exact cleanup commands. The harness binds the growth target to a database-owned comment sentinel and binds each authenticated lifecycle health response to Vercel's `VERCEL_DEPLOYMENT_ID`; it also validates lifecycle origins in memory before making requests.

## Founder campaign schedule

Campaign email uses `America/Los_Angeles` calendar dates. Enrollment schedules
the first email for 07:00 on the next weekday, even if enrollment happens before
07:00 that day. The second email is due three business days after actual provider
acceptance of the first; the third is due five business days after acceptance of
the second. Weekends are skipped; public holidays are not excluded in V1.
Each target date resolves its own Pacific offset, preserving 07:00 across DST.

Due times are persisted in Growth jobs. The existing cron leases campaign sends
only Monday–Friday during 07:00–08:00 Pacific; final authorization and provider
submission recheck the window. Normal sends begin on the first successful cron
tick after 07:00. Retries can run within that hour; missed windows wait until the
next weekday morning. Stops, mailbox recovery and ambiguous provider acceptance
remain authoritative. Requested fulfillment and internal notifications do not
use this campaign window. Replayed acceptance cannot move later jobs earlier.

## Company evidence capture

Company enrichment uses Dawn. Set `GROWTH_DAWN_ENRICHMENT_ENABLED=false` to pause
new work; production uses an explicit `true` value for an enabled rollout.
Configure the private bare HTTPS `GROWTH_RESEARCH_URL`, `LANGSMITH_API_KEY`,
`GROWTH_RESEARCH_DATABASE_URL` for its dedicated execution fences, and matching
`GROWTH_RESEARCH_TRACE_PROJECT_ID`. The switch controls new work. Existing
persisted Dawn attempts and cleanup still reconcile when the switch is off;
they never fall back to another paid generator.

The former Anthropic lifecycle generator and baseline execution command are
retired. Lifecycle no longer needs `ANTHROPIC_API_KEY` or
`LIFECYCLE_ENRICHMENT_MODEL`; keep provider credentials used by unrelated tools
in their own configuration.

Growth records the immutable captured snapshot and opaque attempt/thread identity
before submission. A lost acknowledgement triggers lookup of that exact attempt,
never a replacement POST. Validated results become `company_enrichment.v1` artifacts
with source quotes and execution references. The newest company artifact supersedes
historical campaign drafts for generic fallback; deterministic progress scores remain
separate. Existing legacy artifacts remain readable.

Independent `research_cleanup` jobs remain dispatchable after contact cancellation
or deletion. V1 gives uncertain submissions and crashed attempts five minutes beyond
their execution deadline to reconcile, then fails unresolved enrichment and cleans
up its temporary thread. Cleanup cancels any remaining run, deletes the thread, and
checks absence again on a later dispatcher tick. This is bounded recovery, not proof
that the remote worker stopped. The opaque execution fence remains unchanged and
prevents a replay from starting another paid attempt.

Trace deletion is checked separately and retried hourly. Cleanup has a seven-day
limit; an unresolved deletion ends visibly failed, never reported as successful.
Cleanup removes captured research input from terminal parent jobs, including when
the cleanup limit is reached. That limit also fails any still-active parent attempt.
Published company artifacts retain their source evidence until contact deletion.

Company capture uses our self-hosted Firecrawl open-source browser scraper. Configure `COMPANY_SCRAPER_URL` as its bare HTTPS origin and supply the shared server-only `COMPANY_SCRAPER_SECRET`. These are our own service settings; no Firecrawl account or hosted API key is used. The former `LIFECYCLE_COMPANY_CAPTURE_PROVIDER` selector and direct HTTP transport are retired. Explicit HTTP loopback IP origins are accepted for local container verification. Configuration is checked only when enrichment needs company evidence and does not gate email delivery. Failures use existing enrichment retry handling, without a direct-fetch fallback.

The client makes one homepage request with a 15-second total deadline and 2 MiB response limit. The scraper has a shorter 10-second work budget and one active capture; busy requests fail without queueing. The existing HTML extractor produces the same bounded evidence schema. The service returns the requested source and actual final browser URL; the client validates both and checks public input/final hostnames. The browser service owns remote navigation and subresource checks. Client-side DNS checks do not pin the remote browser's connections, and capture is not proof of employment or company ownership. See [the scraper deployment](../../deployments/company-scraper/README.md) for its pinned source, patch, and verification commands.

Client capture logs contain provider, outcome, status, and byte count where available. They exclude page text, company URLs, and credentials. Browser rendering does not include Firecrawl Cloud's advanced anti-bot engine. The [Dawn research app](../growth-research/README.md) retains the bounded research pilot and deployment findings.

Evidence extraction excludes navigation, menu, footer, and header-list subtrees, including nested text. Snippets prefer paragraphs and product lists in `<main>`, falling back to the remaining document when main has no eligible snippets. Title, hero headings and paragraphs, and description metadata remain available. Empty captured pages are omitted from model input. The enrichment prompt requires substantive support for capability claims and explicit first-party attribution for retained promotional rankings or assertions. This improves evidence selection; valid source references alone do not prove a generated claim is true.
