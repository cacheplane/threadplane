# Boot-time runtime observation and founder install digest

Date: 2026-09-16
Status: approved for planning
Scope: two changes to the developer activation funnel. Nothing else in the growth system changes.

## Why

After the first week in production, 105 installation subjects reached Neon and zero external developers produced a runtime observation.
A fresh-consumer smoke test on 2026-09-16 proved the install, runtime, link, and approval chain works end to end on npm 11 and `ng serve`.
The gap is behavioral: the development collector only sends after the first `submit()`, so a developer who configures the provider and loads the page is invisible.
Separately, identified installers who never dev-serve (for example the de.bosch.com identity from 2026-09-07) are never surfaced to the founder at all.

## Decisions

1. `runtime.session_started` is sent when the app boots with an integration configured, not on first use.
2. Boot-time `runtime.session_started` remains the outreach signal. The lifecycle link, approval, enrollment, and founder step 1 trigger on it exactly as today. The founder accepted this on 2026-09-16.
3. Install-only identities are reported to the founder in a daily digest. The digest never emails the developer, never creates a contact, and never approves anyone.
4. Each digest line carries a signed one-click approve link. Clicking it creates and approves the contact and enrolls them in the founder sequence, through the same path the install-runtime link uses.
5. Auto-enrollment from install alone is explicitly rejected for now. Revisit only with a month of digest evidence.

## Change 1: session observation on boot

### Behavior

Each integration calls `touch()` on its development runtime once, immediately after creating it:

| Integration | Creation point | Today's first `touch()` |
|---|---|---|
| langgraph | `createStreamManagerBridge` in `libs/langgraph/src/lib/internals/stream-manager.bridge.ts` | first request or history refresh |
| ag-ui | `toAgent` in `libs/ag-ui/src/lib/to-agent.ts` | `beginRun` |
| render | `render-element.component.ts` initialization | never; only the `generative_ui.rendered` milestone |

All existing guards stay as they are and are relied on, not re-implemented:

- `allowed()` requires dev mode, a real browser with `window` and `document`, `navigator.webdriver === false`, no `window.__THREADPLANE_TELEMETRY_DISABLED__`, no `THREADPLANE_TELEMETRY_DISABLED=1` in localStorage, a valid package name and version, and the integration policy. For langgraph and ag-ui the policy is "the `telemetry` option is unset". Render uses `DEVELOPMENT_COLLECTION_POLICY`.
- `session.initialization()` reuses one start envelope per integration per session while version and token are unchanged and the envelope is younger than `MAX_AGE`.
- `session.claim()` allows one `runtime.session_started` per integration per session.
- Milestones are unchanged.

Net: one observation with the installation token per integration per 30-minute-inactivity session, sent on boot. A reload inside the session sends nothing new. Server-side rendering is a no-op.

### Not in scope

Displaying announcements, collector diagnostics, endpoint renaming, and any change to the lifecycle link condition.

### Tests

- `libs/telemetry`: creating a runtime and calling `touch()` with no milestone enqueues exactly one `runtime.session_started`; a second `touch()` in the same session enqueues nothing; a disabled policy enqueues nothing.
- `libs/langgraph`: building the bridge in dev mode calls `touch()` before any request. Existing specs that assert no collection before first use are updated to assert collection on creation.
- `libs/ag-ui`: `toAgent` calls `touch()` on creation.
- `libs/render`: component initialization calls `touch()`; the rendered milestone still fires.
- Mutation check: each new assertion must fail when the `touch()` call is removed.

### Release

Patch release of `@threadplane/telemetry`, `@threadplane/langgraph`, `@threadplane/ag-ui`, and `@threadplane/render`. Existing installs change behavior only when they upgrade. Verification after publish is the attended fresh-consumer smoke: install the published versions, `ng serve`, load the page without sending a message, and confirm the runtime row in Neon.

## Change 2: founder install digest

### Candidate selection

A candidate is an email that appears in `growth_observation_identities` for an install observation where all of the following hold:

- `growth_observations.source = 'install'` and `redacted_at is null`
- `properties->>'environment' <> 'ci'`
- the email's domain is not personal, per `isPersonalEmailDomain` in `libs/growth/src/lib/company-domain.ts`
- no `growth_contacts` row exists for that email in any state, looked up through the existing HMAC candidate mechanism so rotated keys are covered
- no row exists in the new `growth_install_digest_reports` table for that email HMAC and key version

Grouping is per email. One person appears once even when they installed four packages on three days.

### Digest content

Plain text, one block per candidate:

- email, git display name, company domain
- repository provider and owner when present
- packages and versions installed, install count, first and last seen
- git config origin, because a global config is a weaker identity than a local one
- the approve link

Two context lines at the end: install subjects with no identity in the same period, and CI install subjects in the same period. No runtime data, no PostHog data.

### Storage

New migration `0008_growth_install_digest.sql`:

```
growth_install_digest_reports (
  email_lookup_hmac text not null,
  email_key_version smallint not null,
  first_install_observation_id uuid not null references growth_observations(id),
  digest_job_id uuid not null references growth_jobs(id),
  reported_at timestamptz not null,
  primary key (email_key_version, email_lookup_hmac)
)
```

Rows are written in the same transaction that completes the digest job. A retried job cannot double-report.

### Scheduling

- Runs inside the existing lifecycle tick. No new cron.
- One digest per Pacific business day. The tick computes the current Pacific business date and uses idempotency key `install_digest:<YYYY-MM-DD>` on `growth_jobs`, kind `digest`, so a second tick the same day is a no-op.
- The job is enqueued only when at least one candidate exists. Quiet days send nothing.
- `digest` is added to `LEASED_KINDS` in `apps/lifecycle/src/dispatcher.ts`.
- Delivery uses the same Resend submission path and `FOUNDER_NOTIFICATION_EMAIL` that `notify` jobs use. `DELIVERY_ENABLED=false` defers it like any other send.

### Switch

`GROWTH_INSTALL_DIGEST_ENABLED`, default false, exact lowercase `true`, same parsing as the other switches. Off means no candidates are evaluated and no jobs are enqueued.

### Approve link

- New token purpose `founder_approve_install` in `libs/growth/src/lib/tokens.ts`. The payload's `contactId` field carries the first install observation id for this purpose, because no contact exists yet. Verification checks purpose before interpreting the field.
- Max age 7 days. Digest mail is read later than a stop link, which has 24 hours.
- New route `apps/website/src/app/api/growth/approve-install/route.ts`, mirroring the stop route: GET verifies and renders a confirm form, POST verifies and acts. Same failure and success responses, same body cap.
- POST resolves the observation to its identity email, then calls a new `approveContactFromInstallInTransaction` in `libs/growth/src/lib/contacts.ts`, factored from `approveContactFromInstallRuntimeInTransaction` so both share the contact create-or-reactivate logic. It records activity kind `install_digest.outreach_approved` with the observation id and token nonce, then enrolls the contact exactly as the install-runtime path does.
- Clicking twice, or clicking after the person already became a contact by another path, returns the success page and changes nothing. A stopped or deleted contact is never reactivated by this link; the response is the failure page.
- Links are built with `GROWTH_PUBLIC_ACTION_ORIGIN` and the action token keyring, as the stop link is.

### Tests

- `libs/growth/test` integration specs against real Postgres: personal domain excluded, CI excluded, existing contact in each state excluded, previously reported excluded, redacted excluded, one line per email across multiple installs, HMAC rotation covered.
- Template spec for the digest text, including the empty context lines and link presence.
- Dispatcher spec: `digest` is leased; two ticks on one Pacific business day produce one job; a job that fails after send but before commit reports the same candidates on retry rather than dropping them.
- Route spec mirroring `stop/route.spec.ts`: bad token, expired token, wrong purpose, happy path, double click, stopped contact.
- Contacts spec: `approveContactFromInstallInTransaction` creates and approves a new contact, reuses an existing unapproved one, and refuses stopped or deleted ones.

## Operations

- Cutover order: deploy, set `GROWTH_ACTION_TOKEN_*` if not already present on the website project, then set `GROWTH_INSTALL_DIGEST_ENABLED=true`. The first digest covers everything unreported since the observability tables were created on 2026-09-05.
- The synthetic contact `brian+smoke-0916@cacheplane.ai` from the smoke test is stopped, not deleted. Delete it with the operator CLI before the first digest runs, or it will simply be excluded as an existing contact.
- Rollback: set the switch to false. Reported rows stay, so re-enabling does not resend.

## Out of scope, recorded for later

Announcement display in the dev console, collector diagnostics, collect endpoint renaming, npm download denominators, observation projection in the tick, the enrich retry cap, provider suppression sync, and auto-enrollment from install alone.
