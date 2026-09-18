# PostHog instrumentation fix — restoring a trustworthy bounce rate

> Makes the homepage bounce rate comparable to an industry benchmark, restores
> path analysis, and turns on Core Web Vitals. Written after a diagnosis of a
> reported 59% homepage bounce rate found that two of PostHog's three
> bounce-escape branches were dead.

## Why

PostHog Web Analytics reported a 59% bounce rate for `/`. Before treating that
as a homepage problem, we checked what the number measures.

PostHog computes `$is_bounce` in `posthog/hogql/database/schema/sessions_v3.py`:

```
if page_screen_count == 0 → NULL
else → NOT (page_screen_count >= 2
            OR has_autocapture
            OR session_duration >= bounce_rate_duration_seconds)
```

`bounce_rate_duration_seconds` defaults to 10. A session escapes the bounce
bucket through any one of three branches. Two of ours are dead:

- **`has_autocapture` is always false.** The project's remote config returns
  `"autocapture_opt_out": true`. Verified live: clicking a homepage FAQ
  accordion produced zero requests to `/ingest/i/v0/e/`.
- **`page_screen_count` never exceeds 1.** `instrumentation-client.ts` sets
  `capture_pageview: true`. posthog-js gates its History API monitor on
  `get isEnabled(){return "history_change" === this._instance.config.capture_pageview}`,
  so soft navigations emit no `$pageview`. Verified live: clicking the nav link
  to `/pricing` changed `location.pathname` while
  `performance.getEntriesByType('navigation')[0].name` stayed at the homepage
  URL, and no pageview followed.

Only the duration branch works, so the reported figure means *"59% of sessions
entering the homepage ended within 10 seconds."*

### What is not broken

`$pageleave` **is** captured, so session duration reflects the real exit time.
posthog-js resolves it as
`!0===config.capture_pageleave || "if_capture_pageview"===config.capture_pageleave && (!0===config.capture_pageview || "history_change"===config.capture_pageview)`;
the default is `"if_capture_pageview"` and `capture_pageview: true` satisfies the
second clause. This matters: a visitor who soft-navigates from `/` to `/docs`
and reads for five minutes gets a five-minute session duration and is correctly
not counted as a bounce, even though PostHog only ever saw one `$pageview`.

The missing-pageview bug therefore damages **path analysis**, not bounce rate.
Both are worth fixing; only one of them explains the 59%.

### Is 59% even bad

No. Databox's aggregated GA4 data puts the **Technology sector median at 56.0%**,
with a 44%–70% interquartile range on the nearest segment that discloses one.
Our configuration is *stricter* than GA4 — GA4 un-bounces a sub-10s session that
had a key event or two pageviews; ours cannot. The GA4-comparable figure is
likely at or below the median.

This spec does not try to lower the number. It makes the number mean something
stable, so that a future homepage change can be judged against it.

## Goals

1. Restore all three branches of `$is_bounce` so the metric is comparable to the
   published benchmark.
2. Restore per-navigation pageviews so entry/exit and path reports work.
3. Turn on Core Web Vitals, of which we currently collect none.
4. Make the two PostHog settings that live only in the project UI discoverable
   from the repository.
5. Record the pre-change baseline and the cutover date, because both fixes lower
   bounce rate on unchanged traffic.

## Non-goals

- **Session recordings, heatmaps, and a consent banner.** Higher diagnostic
  value — replays of sub-10s visits would answer *why* people leave, which no
  aggregate can. Also a new UI component, persisted consent state, a
  privacy-policy rewrite, and a measured-traffic drop once people decline. It
  gets its own spec and its own review.
- **Any change to `src/app/privacy/page.tsx`.** Out of scope by decision. See
  [Accepted risks](#accepted-risks).
- **Homepage copy, layout, or performance changes.** Separate work, deliberately
  sequenced after this, so its effect is measurable.

## Design

### 1. Make the config testable

`apps/website/instrumentation-client.ts` calls `posthog.init()` inline, so
nothing can assert on it. Extract the options into an exported const and
initialise from it — the shape `apps/website/next.config.spec.ts` already relies
on for the `/ingest` rewrites.

```ts
export const POSTHOG_INIT_OPTIONS = {
  api_host: '/ingest',
  ui_host: 'https://us.posthog.com',
  defaults: '2026-01-30',
  capture_pageview: 'history_change',
  capture_pageleave: 'if_capture_pageview',
  autocapture: true,
  capture_performance: { web_vitals: true },
  person_profiles: 'always',
} as const satisfies Partial<PostHogConfig>;
```

Changes from today's behaviour:

| Option | Today | After | Effect |
| --- | --- | --- | --- |
| `capture_pageview` | `true` | `'history_change'` | Soft navigations emit `$pageview`; the `page_screen_count >= 2` branch becomes reachable |
| `autocapture` | inherited `true` | explicit `true` | No runtime change on its own — the project setting overrides it. Explicit so the code states the intent. |
| `capture_pageleave` | inherited `'if_capture_pageview'` | explicit | No runtime change. Pins behaviour that `capture_pageview` currently determines implicitly. |
| `capture_performance` | unset | `{ web_vitals: true }` | Core Web Vitals begin collecting |

Writing the inherited defaults down is the point, not noise. `defaults:
'2026-01-30'` is a version pin whose meaning changes when it is bumped — that pin
is what *would* have set `'history_change'` had the explicit `true` not
overridden it. Stating each value makes the next bump a decision rather than a
silent behaviour change.

### 2. The regression guard

New `apps/website/instrumentation-client.spec.ts`, modelled on
`next.config.spec.ts`: import `POSTHOG_INIT_OPTIONS` and assert each
bounce-relevant value, with test names carrying the reason.

Importing the module runs `posthog.init()` as a side effect, so the spec mocks
`posthog-js`.

**The assertions must compare against literals.** `capture_pageview` must be
asserted equal to the string `'history_change'`, never merely truthy — `true` is
truthy and `true` is precisely the bug. A guard written as `toBeTruthy()` passes
against the broken config and is worse than no guard, because it reports safety
it does not provide. Each assertion is verified to fail against today's shipped
values before the fix lands.

### 3. Documentation of the UI/code split

`tools/posthog/README.md` states: "PostHog is configured via a Public-API-driven
sync script — not through the PostHog UI. Git is the source of truth." Two
settings contradict that today, with *different* override semantics:

| Setting | Lives in | Semantics | posthog-js resolution |
| --- | --- | --- | --- |
| `autocapture_opt_out` | Project UI only | **Project wins.** Client config cannot re-enable it. | `return !!config.autocapture && !s` — ANDed against the remote flag |
| `capture_performance.web_vitals` | Project UI, overridable | **Client wins** when the client sets it explicitly. | `var t = isObject(oo) ? oo.web_vitals : …; return isBoolean(t) ? t : $s` — remote is the fallback |

A section in `docs/growth/README.md` records both, plus the command that reveals
the live truth:

```bash
curl -s "https://threadplane.ai/ingest/array/<NEXT_PUBLIC_POSTHOG_TOKEN>/config.js"
```

### 4. The project setting

`autocapture_opt_out` must be set to `false`. Two routes:

1. **Preferred — API**, so the change is scripted and repeatable:
   `PATCH /api/projects/406826/` with `{"autocapture_opt_out": false}`, using a
   personal API key with **project write** scope. The exact scope name is
   confirmed against the API response rather than assumed; PostHog's published
   docs page truncates before its scope table.
2. **Fallback — UI**, if the key lacks the scope: PostHog → Project settings →
   Autocapture.

Either way the end state is verified by re-reading the remote config, not by the
exit code of the call that made the change.

### 5. Baseline and cutover

Both fixes make dead branches of `$is_bounce` reachable, so bounce rate drops on
unchanged traffic. Pre- and post-cutover numbers are not comparable.

Record in `docs/growth/README.md`, following the running-log pattern
`docs/gtm/ai-search-measurement.md` already established:

- the 59% baseline and the window it covers
- the cutover date
- an explicit note that the series breaks at that date

Whoever reads the number next needs to know the definition changed underneath it.

## Verification

Unit tests prove the config shape. They do not prove deployed behaviour. After
deploy and after the project setting changes:

1. **Remote config** — re-fetch `/ingest/array/<token>/config.js` and confirm
   `autocapture_opt_out: false` and `capturePerformance.web_vitals: true`.
2. **Autocapture** — click a non-navigating element on `/` and confirm a POST to
   `/ingest/i/v0/e/`. Today this produces nothing; that is the test that found
   the defect.
3. **Pageviews** — soft-navigate between two routes and confirm a pageview POST
   per navigation, with `location.pathname` changing while the navigation
   entry's `name` stays constant (proving it was a soft nav).

Each of these reads state back through a different channel than the one that
changed it.

## Accepted risks

**Event volume and billing.** Autocapture captures every click; `history_change`
multiplies pageviews by in-app navigations per session. Both are billable, and
the current plan and volume were not available when this was written. Check
before flipping the project setting.

**The privacy disclosure becomes narrower than the collection.**
`src/app/privacy/page.tsx` discloses "content topics, campaign and referral
context, and interactions with setup commands." Autocapture is broader: it
captures clicked element text and attributes across the whole page. Editing that
page is explicitly out of scope by decision, so this ships as a known gap rather
than an oversight. It is a public legal page and a one-sentence broadening would
close it.

## Files

| File | Change |
| --- | --- |
| `apps/website/instrumentation-client.ts` | Export `POSTHOG_INIT_OPTIONS`; change `capture_pageview`; add `capture_performance` |
| `apps/website/instrumentation-client.spec.ts` | New — the regression guard |
| `docs/growth/README.md` | UI/code split table; baseline and cutover log |
| PostHog project 406826 | `autocapture_opt_out` → `false` (not a repository change) |
