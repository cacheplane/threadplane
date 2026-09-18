# PostHog Instrumentation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore all three branches of PostHog's `$is_bounce` calculation and turn on Core Web Vitals, so the website's bounce rate is comparable to a published benchmark and cannot silently regress again.

**Architecture:** Extract the inline `posthog.init()` options in `apps/website/instrumentation-client.ts` into an exported const, guard it with a unit test that asserts literal values, document the two PostHog settings that live only in the project UI, and flip `autocapture_opt_out` through the Projects API. The code change and the project-setting change land together so the metric series breaks at exactly one point.

**Tech Stack:** Next.js App Router, posthog-js 1.372.6, Vitest (jsdom), Nx, PostHog Query + Projects API.

**Spec:** `docs/superpowers/specs/2026-09-18-posthog-instrumentation-fix-design.md`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/website/instrumentation-client.ts` | Modify. Owns the PostHog browser config. Exports it so it can be asserted on; still performs the `init()` side effect on import. |
| `apps/website/instrumentation-client.spec.ts` | Create. The regression guard. Asserts literal config values with reasons in the test names. |
| `docs/growth/README.md` | Modify. Records the two UI-only PostHog settings, their opposing override semantics, and the pre-cutover baseline. |
| PostHog project 406826 | Not a repository change. `autocapture_opt_out` → `false`, `autocapture_web_vitals_opt_in` → `true`. |

`apps/website/vite.config.mts` already includes `'*.spec.ts'` at the app root, so a new spec beside `instrumentation-client.ts` is picked up with no config change. Do not edit that file.

---

### Task 1: Export and guard the PostHog config

> **On the test command:** `nx test website -- instrumentation-client` silently ignores the
> filter and runs the whole website suite (1,525 tests), which is green but makes the "6 tests"
> expectation below unrecognisable. The `vitest` form used in the steps below runs the 6
> assertions in isolation. Use `npx nx build website` from the repo root for the typecheck, and
> return to the repo root before any `git` step.

**Files:**
- Create: `apps/website/instrumentation-client.spec.ts`
- Modify: `apps/website/instrumentation-client.ts`

> **AS BUILT — this block is superseded.** Task 1 shipped as `f8f146007`. Code review
> replaced the six per-property assertions below with four tests: one exhaustive `toEqual`
> over the whole options object (which also catches an *added* key, as six per-property
> assertions could not), the dedicated `capture_pageview` literal test, and two tests
> proving `posthog.init` actually receives the exported object — one on the local path,
> one on the production path. Read the committed file, not this block. The "6 tests"
> expectations in Steps 4-6 are therefore 4, and Step 5's mutation list is extended in
> the commit message.

- [ ] **Step 1: Write the failing test**

Create `apps/website/instrumentation-client.spec.ts` with exactly this content:

```ts
import { describe, expect, it, vi } from 'vitest';

// Importing the module runs posthog.init() as a side effect. The real module
// is not needed to assert on the options object.
vi.mock('posthog-js', () => ({ default: { init: vi.fn() } }));

import { POSTHOG_INIT_OPTIONS } from './instrumentation-client';

/**
 * PostHog computes $is_bounce as
 *   NOT (page_screen_count >= 2 OR has_autocapture OR session_duration >= 10s)
 * Two of those three branches were dead. These assertions pin the client half
 * open. See docs/superpowers/specs/2026-09-18-posthog-instrumentation-fix-design.md
 */
describe('website posthog init options', () => {
  it('captures a pageview on every history change, not just on document load', () => {
    // posthog-js gates its History API monitor on an exact string compare:
    //   get isEnabled(){return "history_change" === config.capture_pageview}
    // `true` is truthy but does NOT start the monitor. Assert the literal.
    expect(POSTHOG_INIT_OPTIONS.capture_pageview).toBe('history_change');
  });

  it('keeps pageleave capture tied to pageview capture', () => {
    // $pageleave sets the session's exit timestamp, which feeds session_duration
    // and therefore the only bounce branch that was still working.
    expect(POSTHOG_INIT_OPTIONS.capture_pageleave).toBe('if_capture_pageview');
  });

  it('asks for autocapture, which the project setting can still override', () => {
    // posthog-js resolves this as `!!config.autocapture && !remoteOptOut`, so
    // the project's autocapture_opt_out wins. This states the client intent.
    expect(POSTHOG_INIT_OPTIONS.autocapture).toBe(true);
  });

  it('turns on Core Web Vitals, which the client wins outright', () => {
    // Resolution here is `isBoolean(clientValue) ? clientValue : remoteValue`,
    // so an explicit client true beats capturePerformance.web_vitals: false.
    expect(POSTHOG_INIT_OPTIONS.capture_performance).toEqual({
      web_vitals: true,
    });
  });

  it('routes through the first-party /ingest proxy', () => {
    expect(POSTHOG_INIT_OPTIONS.api_host).toBe('/ingest');
  });

  it('pins the posthog-js defaults bundle', () => {
    // This pin is what would have set capture_pageview to 'history_change' had
    // the explicit value not overridden it. A bump changes behaviour; make it
    // fail here so the bump is a decision.
    expect(POSTHOG_INIT_OPTIONS.defaults).toBe('2026-01-30');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/website && npx vitest run --config vite.config.mts instrumentation-client
```

Expected: FAIL. The error names the missing export, e.g. `No "POSTHOG_INIT_OPTIONS" export is defined on the "./instrumentation-client" mock` or a TypeScript/resolution error on the import.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `apps/website/instrumentation-client.ts` with:

```ts
import posthog from 'posthog-js';
import type { PostHogConfig } from 'posthog-js';
import { shouldCaptureAnalytics } from '@threadplane/telemetry/browser';

const token = process.env.NEXT_PUBLIC_POSTHOG_TOKEN;
const captureLocal = process.env.NEXT_PUBLIC_POSTHOG_CAPTURE_LOCAL === 'true';
const browserHost = typeof window === 'undefined' ? undefined : window.location.host;

/**
 * Every option is stated, including ones that match a posthog-js default.
 *
 * PostHog decides a bounce with
 *   NOT (page_screen_count >= 2 OR has_autocapture OR session_duration >= 10s)
 * and for a long time only the third branch worked here: `capture_pageview: true`
 * stopped the History API monitor from starting, so soft navigations emitted no
 * $pageview, and the project's `autocapture_opt_out` killed the middle branch.
 *
 * `defaults` is a version pin whose meaning changes when it is bumped. Writing
 * the values it implies down next to it turns the next bump into a decision
 * instead of a silent behaviour change. `instrumentation-client.spec.ts` fails
 * if any of them drifts.
 *
 * Two of these are also project-level settings in the PostHog UI, with opposite
 * precedence — see docs/growth/README.md.
 */
export const POSTHOG_INIT_OPTIONS = {
  api_host: '/ingest',
  ui_host: 'https://us.posthog.com',
  defaults: '2026-01-30',
  capture_pageview: 'history_change',
  capture_pageleave: 'if_capture_pageview',
  autocapture: true,
  capture_performance: { web_vitals: true },
  person_profiles: 'always',
} satisfies Partial<PostHogConfig>;

if (shouldCaptureAnalytics({ token, captureLocal, host: browserHost })) {
  posthog.init(token!, POSTHOG_INIT_OPTIONS);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/website && npx vitest run --config vite.config.mts instrumentation-client
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Verify the guard is not vacuous**

A guard that passes against the broken value is worse than no guard. Prove each key assertion fails against what shipped before this change.

In `apps/website/instrumentation-client.ts`, temporarily change `capture_pageview: 'history_change'` to `capture_pageview: true`, then run:

```bash
cd apps/website && npx vitest run --config vite.config.mts instrumentation-client
```

Expected: FAIL, exactly one test — "captures a pageview on every history change, not just on document load" — reporting `expected true to be 'history_change'`.

Now restore `capture_pageview: 'history_change'`, temporarily delete the `capture_performance` line, and run the same command.

Expected: FAIL, exactly one test — "turns on Core Web Vitals, which the client wins outright" — reporting `expected undefined to equal { web_vitals: true }`.

Restore the `capture_performance` line and re-run:

```bash
cd apps/website && npx vitest run --config vite.config.mts instrumentation-client
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Typecheck through a production build**

`nx test` and `nx lint` do not typecheck this app. Only the production build does, and `satisfies Partial<PostHogConfig>` is a type-level assertion that nothing else will exercise.

```bash
npx nx build website
```

Expected: build succeeds. If `.next/dev` exists from an earlier dev server it can panic the Turbopack build; remove `apps/website/.next` and re-run.

- [ ] **Step 7: Check for regenerated files before staging**

`nx test` rewrites a generated package-version file. Confirm the working tree contains only the two intended files.

```bash
git status --short
```

Expected: exactly `apps/website/instrumentation-client.ts` and `apps/website/instrumentation-client.spec.ts`. Revert anything else, in particular any `package-version.ts`.

- [ ] **Step 8: Commit**

```bash
git add apps/website/instrumentation-client.ts apps/website/instrumentation-client.spec.ts
git commit -m "fix(website): capture pageviews on history change and enable web vitals

capture_pageview: true stopped posthog-js from starting its History API
monitor, which gates on an exact compare against 'history_change', so soft
navigations emitted no \$pageview and PostHog's page_screen_count >= 2 bounce
branch was unreachable. The defaults: '2026-01-30' pin on the line above would
have set it correctly; the explicit true reverted it.

Every option is now stated and guarded by a spec that asserts literals, so a
future defaults bump surfaces as a failing test rather than a silent change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Document the UI/code split and the baseline

**Files:**
- Modify: `docs/growth/README.md`

- [ ] **Step 1: Add the new section**

In `docs/growth/README.md`, insert the following immediately before the `## Contributor checks` heading:

```markdown
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
Only the duration branch works today, so the figures below mean
"share of sessions that ended within 10 seconds". Entry pathname `/`:

| Month | Sessions | Sessions scored | Bounce | ±95% CI | Zero-duration | Median duration |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-05 | 186 | 171 | 82.5% | ±5.70pp | 43.0% | 1.0s |
| 2026-06 | 160 | 158 | 79.1% | ±6.34pp | 37.5% | 2.0s |
| 2026-07 | 176 | 168 | 86.9% | ±5.10pp | 44.9% | 2.0s |
| 2026-08 | 180 | 153 | 65.4% | ±7.54pp | 25.6% | 3.0s |
| 2026-09 | 161 | 144 | 50.0% | ±8.17pp | 18.0% | 6.0s |

`$is_bounce` is NULL for a session with no pageview and PostHog excludes those
from its denominator, which is why Sessions and Sessions scored differ. The
bounce percentage and its interval both use Sessions scored.
Window pinned 2026-05-01 to 2026-09-18; September is a partial month.

**The series will break once both the pageview fix ships and the project
setting flips — it has not yet.** Restoring the other two `$is_bounce` branches
lowers the rate on unchanged traffic. The break date is whichever of the two
ships second. Do not compare across that date once it happens.

**The volume does not support fine comparisons.** At ~160 homepage sessions per
month a ±8.17pp interval cannot separate 50.0% from 59%. Judging a homepage
change on this metric needs a much longer accumulation window, or more traffic.

Two limits this baseline exposed. `$pageleave` is missing from 17–20% of
sessions in the four browsers with samples large enough to read: Chrome Desktop
(17.2%), Safari Desktop (19.6%), Mobile Safari (20.0%), and Chrome Mobile (3 of
16 sessions, 18.8% — a single extra session would move this to 25.0%). Firefox
Desktop (3 of 3 missing) and Edge Desktop (0 of 3) have samples too small to
read. Those missing sessions collapse to zero duration and become automatic
bounces; the zero-duration share tracks the bounce rate month over month. And
89% of homepage entries are Direct (143 of the 161 September sessions, 54.3%
bounce) against 15 Organic Search sessions at 13.3% bounce, so the headline
figure is mostly a statement about untagged traffic.
```

- [ ] **Step 2: Verify the markdown renders and links resolve**

```bash
npx nx lint website
```

Expected: no new errors. Warnings are acceptable; errors are not.

- [ ] **Step 3: Commit**

```bash
git add docs/growth/README.md
git commit -m "docs(growth): record the PostHog UI/code split and the bounce baseline

autocapture_opt_out and capture_performance.web_vitals live only in the project
UI and resolve with opposite precedence against the client config. Neither is
synced by tools/posthog, whose README claims git is the source of truth.

Also records the pre-cutover bounce series, which breaks on 2026-09-18 when the
dead branches of \$is_bounce become reachable again.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Flip the project settings and verify the end state

Run this **after** Task 1 is deployed to production, so the code change and the
project-setting change cut the metric series at one point rather than two.

The personal API key is `POSTHOG_PERSONAL_API_KEY` in `/Users/blove/repos/angular-agent-framework/.env`. That file has an unquoted `&` on line 27 that breaks `set -a; . .env`, so read the key with `grep`, never by sourcing the file. Do not echo the key.

**Files:** none. This changes PostHog project 406826 only.

- [ ] **Step 1: Confirm the deployed bundle carries the new config**

```bash
mkdir -p /tmp/tpverify && cd /tmp/tpverify && rm -f *.js
for c in $(curl -s https://threadplane.ai/ | grep -o '/_next/static/chunks/[A-Za-z0-9-]*\.js'); do
  curl -s -o "$(basename $c)" "https://threadplane.ai$c"
done
LC_ALL=C grep -oh 'ui_host:"https://us.posthog.com".\{0,140\}' *.js
```

Expected: the printed config contains `capture_pageview:"history_change"` and `capture_performance:{web_vitals:!0}`. If it still shows `capture_pageview:!0`, the deploy has not landed — a green CI run is not a deployment. Confirm the commit's Vercel deployment status before continuing.

- [ ] **Step 2: Read the current project settings**

```bash
KEY=$(grep -m1 '^POSTHOG_PERSONAL_API_KEY=' /Users/blove/repos/angular-agent-framework/.env | cut -d= -f2-)
curl -s -H "Authorization: Bearer $KEY" \
  "https://us.posthog.com/api/projects/406826/" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print({k:d.get(k) for k in ['autocapture_opt_out','autocapture_web_vitals_opt_in']})"
```

Expected: `{'autocapture_opt_out': True, 'autocapture_web_vitals_opt_in': False}`.

- [ ] **Step 3: Flip both settings**

```bash
KEY=$(grep -m1 '^POSTHOG_PERSONAL_API_KEY=' /Users/blove/repos/angular-agent-framework/.env | cut -d= -f2-)
curl -s -X PATCH -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"autocapture_opt_out": false, "autocapture_web_vitals_opt_in": true}' \
  "https://us.posthog.com/api/projects/406826/" \
  | python3 -c "import sys;d=sys.stdin.read();print(d[-200:])"
```

Expected: `HTTP 200`.

If the response is `HTTP 403` with a message naming a missing scope, the key lacks project write. Do not retry. Report the exact scope named in the error and set both fields in the PostHog UI under Project settings → Autocapture and → Web vitals instead.

- [ ] **Step 4: Verify the end state through a different channel**

Do not trust the PATCH response. Read the setting back from the public remote-config endpoint the browser actually uses. It is cached, so allow a minute.

```bash
curl -s "https://threadplane.ai/ingest/array/phc_AzRfFkKMnisxPEECwnCrrN6JLB6bC5aYFyGqXopkhEAY/config.js" \
  | grep -o '"autocapture_opt_out":[a-z]*\|"web_vitals":[a-z]*'
```

Expected: `"autocapture_opt_out":false` and `"web_vitals":true`.

- [ ] **Step 5: Verify autocapture actually fires in a browser**

Open `https://threadplane.ai/` in the browser pane, wait 6 seconds for the initial batch, record the number of POSTs to `/ingest/i/v0/e/`, then click a FAQ accordion (a control that does not navigate) and wait 4 seconds.

Expected: at least one **new** POST to `/ingest/i/v0/e/` after the click. Before this change that click produced zero requests — that is the observation that found the defect, and it is the one that proves it fixed.

- [ ] **Step 6: Verify pageviews fire on soft navigation**

On `https://threadplane.ai/`, click the nav link to `/pricing`, wait 5 seconds, then evaluate:

```js
({ url: location.pathname,
   documentLoadedFor: performance.getEntriesByType('navigation')[0].name })
```

Expected: `url` is `/pricing` while `documentLoadedFor` is still `https://threadplane.ai/` — proving it was a soft navigation — **and** a new POST to `/ingest/i/v0/e/` appeared. Before this change the soft navigation produced no pageview.

- [ ] **Step 7: Record the cutover date**

The baseline section of `docs/growth/README.md` currently states the cutover as a prediction: "**The series will break once both the pageview fix ships and the project setting flips — it has not yet.**" Now that both have happened, rewrite that paragraph to name the actual date Step 3 succeeded, and change "Do not compare across that date once it happens" to the past tense. Make the same edit to the matching paragraph in `docs/superpowers/specs/2026-09-18-posthog-instrumentation-fix-design.md`.

```bash
git add docs/growth/README.md
git commit -m "docs(growth): record the actual PostHog cutover date

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

If the date is already correct, skip the commit and say so rather than creating an empty one.

---

## Out of scope

Recorded here so they are visibly excluded rather than forgotten:

- **`src/app/privacy/page.tsx`.** Autocapture captures clicked element text and attributes across the whole page; the current disclosure names "interactions with setup commands". Excluded by decision. Tracked in the spec's Accepted risks.
- **Session recordings, heatmaps, and a consent banner.** Their own spec.
- **The missing `$pageleave` on 17–20% of sessions.** A real measurement leak, cause not established, no fix designed. Worth its own investigation.
- **Homepage copy, layout, and mobile fold changes.** Deliberately sequenced after this so their effect is measurable.
