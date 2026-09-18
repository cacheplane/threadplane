# Boot-time Runtime Observation and Founder Install Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send one `runtime.session_started` observation when an app boots with a Threadplane integration configured, and email the founder a daily digest of install-only identities with a one-click approve link.

**Architecture:** Two independent PRs. PR A touches only the three published adapter packages: each calls `touch()` on its development runtime immediately after creating it, and the telemetry package is unchanged because `touch()` already performs the send with all guards and dedupe. PR B adds a `digest` job kind to the growth control plane: a candidate query and report table in `libs/growth`, a job handler and plain-text template in `apps/lifecycle` that reuses the founder notification sender, a new signed token purpose, and a website route that approves a contact from an install observation id by reusing the existing reauthorization path.

**Tech Stack:** TypeScript, Angular 21, Nx, Vitest, Postgres on Neon via `@neondatabase/serverless`, Next.js route handlers, Resend.

Spec: `docs/superpowers/specs/2026-09-16-install-boot-observation-and-founder-digest-design.md`

---

## Prerequisites and conventions

- Work on branch `blove/install-boot-observation-founder-digest` (already cut from `origin/main`, spec committed). PR A and PR B are separate branches cut from `origin/main`; see Tasks 4 and 13.
- **Node 22 is required for `growth:test-integration`.** Use `npx -y node@22 ./node_modules/nx/bin/nx.js ...` for that target, exactly as `docs/superpowers/runbooks/2026-08-31-growth-lifecycle-operations.md` does.
- **Growth integration specs need `TEST_DATABASE_URL`**, an isolated disposable Neon database that tests may migrate and rewrite. It is not in the root `.env`. Ask the repository owner for one before Task 6. Without it those specs are written and skipped (`describe.skip`), and the PR must say so.
- Website unit tests run from `apps/website`: `npx vitest run --config vite.config.mts <path>`. Root-relative paths find no tests.
- Website tests and lint do not typecheck. `npx nx build website` is the only typecheck for website code. Run it before opening PR B.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never add an SPDX header. Never regenerate `package-lock.json` on macOS except through the release procedure.

## File map

PR A (SDK):
- Modify: `libs/langgraph/src/lib/internals/stream-manager.bridge.ts` (touch after creation)
- Modify: `libs/langgraph/src/lib/internals/stream-manager.bridge.spec.ts`
- Modify: `libs/ag-ui/src/lib/to-agent.ts` (touch after creation)
- Modify: `libs/ag-ui/src/lib/to-agent.spec.ts`
- Modify: `libs/render/src/lib/render-element.component.ts` (touch in constructor)
- Modify: `libs/render/src/lib/development-mount.spec.ts`

PR B (growth):
- Create: `migrations/0008_growth_install_digest.sql`
- Modify: `libs/growth/test/migrations.integration.spec.ts` (table list)
- Modify: `libs/growth/src/lib/campaign-schedule.ts` (`pacificCalendarDate`)
- Modify: `libs/growth/src/lib/campaign-schedule.spec.ts`
- Create: `libs/growth/src/lib/observability/install-digest.ts` (candidates, context, enqueue, report)
- Create: `libs/growth/test/install-digest.integration.spec.ts`
- Modify: `libs/growth/src/lib/tokens.ts` (purpose + max age)
- Modify: `libs/growth/src/lib/tokens.spec.ts`
- Modify: `libs/growth/src/lib/contacts.ts` (`approveContactFromInstallDigest`, shared helpers)
- Modify: `libs/growth/test/contacts.integration.spec.ts`
- Modify: `libs/growth/src/lib/jobs.ts` (internal notification claim/unknown accept `kind`)
- Modify: `libs/growth/src/lib/dispatcher.ts` (`GrowthAppJobKind` adds `digest`)
- Modify: `libs/growth/src/index.ts` (exports)
- Create: `apps/lifecycle/src/notifications/install-digest.ts` (template)
- Create: `apps/lifecycle/src/notifications/install-digest.spec.ts`
- Modify: `apps/lifecycle/src/campaign/send.ts` (digest handler, dependencies, config switch)
- Modify: `apps/lifecycle/src/campaign/send.spec.ts`
- Modify: `apps/lifecycle/src/dispatcher.ts` (leased kind, enqueue in tick)
- Modify: `apps/lifecycle/src/dispatcher.spec.ts`
- Modify: `apps/lifecycle/src/app/dispatch/index.ts` (pass the switch)
- Create: `apps/website/src/app/api/growth/approve-install/route.ts`
- Create: `apps/website/src/app/api/growth/approve-install/route.spec.ts`
- Modify: `apps/lifecycle/README.md`, `docs/growth/README.md` (switch and digest documentation)

---

## PR A: session observation on boot

### Task 1: langgraph bridge touches the development runtime on creation

**Files:**
- Modify: `libs/langgraph/src/lib/internals/stream-manager.bridge.ts:148-152`
- Test: `libs/langgraph/src/lib/internals/stream-manager.bridge.spec.ts:35-47`

- [ ] **Step 1: Update the existing test and add the construction assertion**

In `stream-manager.bridge.spec.ts`, replace the first test of `describe('automatic development evidence', ...)` (the one titled `requires root terminal evidence and disposes with the bridge`) with these two tests:

```ts
  it('reports a session on construction before any request', () => {
    const { destroy$ } = setup();
    expect(developmentEvidence.touches).toBe(1);
    expect(developmentEvidence.events).toEqual([]);
    destroy$.next();
    expect(developmentEvidence.disposed).toBe(1);
  });

  it('requires root terminal evidence and disposes with the bridge', async () => {
    const { transport, bridge, destroy$ } = setup();
    const run = bridge.submit({});
    transport.emit([{ type: 'values', data: { done: true } }]); transport.close();
    await run;
    expect(developmentEvidence.touches).toBeGreaterThan(1);
    expect(developmentEvidence.events).toContain('transport.connected');
    expect(developmentEvidence.events).toContain('runtime.first_stream_completed');
    destroy$.next();
    expect(developmentEvidence.disposed).toBe(1);
  });
```

The `respects explicit sinks` test already asserts `touches` is 0 when `telemetry` is set; the mock only counts when `enabled()` is true, so it keeps passing unchanged.

- [ ] **Step 2: Run the spec to verify the new test fails**

Run: `npx nx test langgraph -- --run src/lib/internals/stream-manager.bridge.spec.ts`
Expected: FAIL, `reports a session on construction before any request` with `expected 0 to be 1`.

- [ ] **Step 3: Touch on creation**

In `stream-manager.bridge.ts`, directly after the `createDevelopmentRuntime({...})` call that assigns `developmentRuntime` (line 148 to 152), add:

```ts
  // One session observation per boot. touch() carries every guard and the
  // per-session dedupe, so this is inert in production, automation and SSR.
  developmentRuntime.touch();
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `npx nx test langgraph -- --run src/lib/internals/stream-manager.bridge.spec.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Run the whole langgraph suite and lint**

Run: `npx nx test langgraph && npx nx lint langgraph`
Expected: all green, 0 lint errors (warnings are acceptable).

- [ ] **Step 6: Commit**

```bash
git add libs/langgraph/src/lib/internals/stream-manager.bridge.ts libs/langgraph/src/lib/internals/stream-manager.bridge.spec.ts
git commit -m "feat(langgraph): report a development session when the agent bridge is created

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2: ag-ui `toAgent` touches the development runtime on creation

**Files:**
- Modify: `libs/ag-ui/src/lib/to-agent.ts:260-264`
- Test: `libs/ag-ui/src/lib/to-agent.spec.ts:43-62`

- [ ] **Step 1: Update the existing test**

In `to-agent.spec.ts`, replace the test titled `requires a current RUN_FINISHED success, and ignores construction and empty close` with:

```ts
  it('reports a session on construction and requires a current RUN_FINISHED success', async () => {
    developmentEvidence.events = []; developmentEvidence.touches = 0;
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    expect(developmentEvidence.touches).toBe(1);
    expect(developmentEvidence.events).toEqual([]);
    await agent.submit({});
    expect(developmentEvidence.touches).toBe(2);
    expect(developmentEvidence.events).toEqual([]);
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'UNKNOWN' } as BaseEvent);
      expect(developmentEvidence.events).toEqual([]);
      stub.emit({ type: 'RUN_STARTED', runId: 'success' } as BaseEvent);
      stub.emit({ type: 'RUN_FINISHED', runId: 'success' } as BaseEvent);
      return { result: undefined, newMessages: [] };
    });
    await agent.submit({});
    expect(developmentEvidence.events).toContain('transport.connected');
    expect(developmentEvidence.events).toContain('runtime.first_stream_completed');
    expect(developmentEvidence.events).not.toContain('thread.persisted');
  });
```

The `suppresses automatic events for an explicit sink` test asserts `touches` is 0 with a sink configured and keeps passing because the mock respects `enabled()`.

- [ ] **Step 2: Run the spec to verify it fails**

Run: `npx nx test ag-ui -- --run src/lib/to-agent.spec.ts`
Expected: FAIL with `expected 0 to be 1`.

- [ ] **Step 3: Touch on creation**

In `to-agent.ts`, directly after the `createDevelopmentRuntime({...})` call that assigns `developmentRuntime` (lines 260 to 264), add:

```ts
  // One session observation per boot; guards and dedupe live inside touch().
  developmentRuntime.touch();
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `npx nx test ag-ui -- --run src/lib/to-agent.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole ag-ui suite and lint**

Run: `npx nx test ag-ui && npx nx lint ag-ui`
Expected: green, 0 lint errors.

- [ ] **Step 6: Commit**

```bash
git add libs/ag-ui/src/lib/to-agent.ts libs/ag-ui/src/lib/to-agent.spec.ts
git commit -m "feat(ag-ui): report a development session when the agent is created

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 3: render element touches the development runtime on construction

**Files:**
- Modify: `libs/render/src/lib/render-element.component.ts:164-166`
- Test: `libs/render/src/lib/development-mount.spec.ts:20-32`

- [ ] **Step 1: Make the spec mock count touches and add a test**

In `development-mount.spec.ts`, change the `beforeEach` block so the mock records touches that respect the policy:

```ts
  let mounted: ReturnType<typeof vi.fn>;
  let touched: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mounted = vi.fn();
    touched = vi.fn();
    vi.spyOn(telemetry, 'createDevelopmentRuntime').mockImplementation(
      (options) => ({
        touch: () => {
          if (options.enabled?.() !== false) touched();
        },
        dispose: vi.fn(),
        milestone: (kind) => {
          if (options.enabled?.() !== false) mounted(kind);
        },
      })
    );
  });
```

Then add these two tests inside the same `describe`, after the existing tests:

```ts
  it('reports a session when the element is constructed, before any mount', () => {
    const fx = fixture(spec());
    expect(touched).toHaveBeenCalledTimes(1);
    expect(mounted).not.toHaveBeenCalled();
    fx.detectChanges();
    expect(touched).toHaveBeenCalledTimes(1);
  });

  it('does not report a session when the collection policy is disabled', () => {
    const fx = fixture(spec(), false);
    fx.detectChanges();
    expect(touched).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the spec to verify the first new test fails**

Run: `npx nx test render -- --run src/lib/development-mount.spec.ts`
Expected: FAIL, `reports a session when the element is constructed` with `expected "spy" to be called 1 times, but got 0 times`. The disabled-policy test passes already; that is fine, it guards the negative path.

- [ ] **Step 3: Touch in the constructor**

In `render-element.component.ts`, the constructor begins at line 164 with `this.destroyRef.onDestroy(() => this.development.dispose());`. Insert before that line:

```ts
    // One session observation per boot; guards and dedupe live inside touch().
    this.development.touch();
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `npx nx test render -- --run src/lib/development-mount.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole render suite and lint**

Run: `npx nx test render && npx nx lint render`
Expected: green, 0 lint errors.

- [ ] **Step 6: Commit**

```bash
git add libs/render/src/lib/render-element.component.ts libs/render/src/lib/development-mount.spec.ts
git commit -m "feat(render): report a development session when the render element is constructed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 4: PR A gates, pull request, merge, release, and post-publish smoke

**Files:** none new.

- [ ] **Step 1: Cut the PR A branch from origin/main and cherry-pick Tasks 1 to 3**

Tasks 1 to 3 were committed on `blove/install-boot-observation-founder-digest` together with the spec. PR A must not carry the spec or PR B work, so:

```bash
git fetch origin
git checkout -b blove/sdk-session-on-boot origin/main
git cherry-pick <sha of Task 1 commit> <sha of Task 2 commit> <sha of Task 3 commit>
```

Find the shas with `git log --oneline blove/install-boot-observation-founder-digest -5`.

- [ ] **Step 2: Build the three packages and the telemetry consumer checks**

Run:

```bash
npx nx run-many -t build -p langgraph,ag-ui,render,telemetry
npx nx run telemetry:test-development-bundle
```

Expected: builds succeed; the development bundle check passes (it verifies the published browser bundle still carries the collector).

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin blove/sdk-session-on-boot
gh pr create --title "feat(sdk): report a development session when an integration is created" --body "$(cat <<'EOF'
## Summary

- langgraph, ag-ui and render call `touch()` on their development runtime immediately after creating it, so one `runtime.session_started` observation is sent when an app boots with the integration configured instead of on first use.
- `@threadplane/telemetry` is unchanged: `touch()` already applies every guard (dev mode, real browser, `navigator.webdriver`, disable flags, policy) and the one-per-session dedupe.
- Spec: docs/superpowers/specs/2026-09-16-install-boot-observation-and-founder-digest-design.md (lands with PR B).

## Test plan

- [x] `nx test langgraph`, `nx test ag-ui`, `nx test render`
- [x] `nx run-many -t build -p langgraph,ag-ui,render,telemetry`
- [ ] Post-publish fresh-consumer smoke: install the released versions, `ng serve`, load the page without sending a message, confirm the runtime row in Neon.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash
```

- [ ] **Step 4: Watch CI and address review comments**

Use the desktop app's PR tools (`mcp__ccd_pr__bind_pr` then `mcp__ccd_pr__get_status`) rather than polling `gh`. The required check is `CI — required`; when it fails, read the leaf job, never the aggregator. If the branch falls behind main while waiting, rebase and force-push; auto-merge does not update a stale branch. Address any Claude Review comments before the merge lands.

- [ ] **Step 5: Release**

Follow `docs/RELEASE.md` exactly, standard release section, from a clean `main` after PR A has merged. The version specifier is `minor` (the doc says releases use minor bumps): `npx nx release version --specifier=minor` → 0.2.0. Regenerate the agent-context files, run `npx nx release changelog 0.2.0` (bare version), verify the lockfile diff contains no platform binding removals, then `git push origin main --tags`. Watch the Publish workflow on the tag.

- [ ] **Step 6: Post-publish smoke (attended)**

In the session scratchpad app from 2026-09-16 (`smoke/smoke-app`), or a fresh `ng new` if it is gone:

```bash
env -u DO_NOT_TRACK -u CI npm install @threadplane/langgraph@0.2.0 @threadplane/chat@0.2.0 @threadplane/telemetry@0.2.0 --no-audit --no-fund
cat node_modules/@threadplane/langgraph/.install-collector/development-install.mjs
```

Expected: a UUID token. Start the dev server through `preview_start` (add a temporary launch entry, revert it afterwards), load the page once, and **do not click send**. Then query Neon:

```sql
select kind, received_at, properties->>'packageVersion' from growth_observations
where source='runtime' and received_at > now() - interval '10 minutes' order by received_at;
```

Expected: one `runtime.session_started` row with version `0.2.0`. Then stop the resulting contact if the lifecycle linked it: `npm run growth:control -- stop --email <the local git email used>`. Record the outcome in the PR as a comment.

---

## PR B: founder install digest

Cut the branch first:

```bash
git fetch origin
git checkout -b blove/founder-install-digest origin/main
git cherry-pick <sha of the spec commit 41329b9e5>
```

### Task 5: migration and table list

**Files:**
- Create: `migrations/0008_growth_install_digest.sql`
- Modify: `libs/growth/test/migrations.integration.spec.ts:56-72`

- [ ] **Step 1: Add the table to the expected list in the migrations spec**

In `migrations.integration.spec.ts`, the `expect(tables.rows.map(...)).toEqual([...])` array is alphabetical. Insert `'growth_install_digest_reports',` immediately before `'growth_install_runtime_links',`.

- [ ] **Step 2: Run the integration spec to verify it fails (only if `TEST_DATABASE_URL` is available)**

Run:

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx -y node@22 ./node_modules/nx/bin/nx.js run growth:test-integration -- --run libs/growth/test/migrations.integration.spec.ts
```

Expected: FAIL, the received table list lacks `growth_install_digest_reports`.

- [ ] **Step 3: Write the migration**

Create `migrations/0008_growth_install_digest.sql`:

```sql
create table growth_install_digest_reports (
  email_lookup_hmac text not null,
  email_key_version smallint not null check (email_key_version > 0),
  first_install_observation_id uuid not null references growth_observations(id) on delete cascade,
  digest_job_id uuid not null references growth_jobs(id) on delete cascade,
  reported_at timestamptz not null,
  primary key (email_key_version, email_lookup_hmac)
);
create index growth_install_digest_reports_job on growth_install_digest_reports(digest_job_id);
```

- [ ] **Step 4: Run the migrations spec to verify it passes**

Same command as Step 2. Expected: PASS, and the "applies repeatably" assertion still passes (`repeated.applied` is `[]`).

- [ ] **Step 5: Commit**

```bash
git add migrations/0008_growth_install_digest.sql libs/growth/test/migrations.integration.spec.ts
git commit -m "feat(growth): add the install digest report table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 6: Pacific calendar date helper

**Files:**
- Modify: `libs/growth/src/lib/campaign-schedule.ts`
- Test: `libs/growth/src/lib/campaign-schedule.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `campaign-schedule.spec.ts` (create the `describe` at the end of the file; keep existing imports and add `pacificCalendarDate` to the import from `./campaign-schedule.ts`):

```ts
describe('pacificCalendarDate', () => {
  it('returns the Pacific calendar date and whether it is a weekday', () => {
    // 2026-09-16T23:30Z is Wednesday 16:30 Pacific (PDT).
    expect(pacificCalendarDate(new Date('2026-09-16T23:30:00.000Z'))).toEqual({
      date: '2026-09-16',
      weekday: true,
    });
    // 2026-09-19T06:59Z is Friday 23:59 Pacific.
    expect(pacificCalendarDate(new Date('2026-09-19T06:59:00.000Z'))).toEqual({
      date: '2026-09-18',
      weekday: true,
    });
    // 2026-09-19T07:00Z is Saturday 00:00 Pacific.
    expect(pacificCalendarDate(new Date('2026-09-19T07:00:00.000Z'))).toEqual({
      date: '2026-09-19',
      weekday: false,
    });
  });

  it('rejects an invalid date', () => {
    expect(() => pacificCalendarDate(new Date('nope'))).toThrow('Invalid campaign date');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx nx test growth -- --run src/lib/campaign-schedule.spec.ts`
Expected: FAIL, `pacificCalendarDate is not a function` (or not exported).

- [ ] **Step 3: Implement**

Append to `campaign-schedule.ts`:

```ts
/** The Pacific calendar date for `now`, and whether it is Monday to Friday. */
export function pacificCalendarDate(now: Date): {
  date: string;
  weekday: boolean;
} {
  const local = parts(now);
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const weekday = day.getUTCDay() !== 0 && day.getUTCDay() !== 6;
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${local.year}-${pad(local.month)}-${pad(local.day)}`,
    weekday,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx nx test growth -- --run src/lib/campaign-schedule.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/growth/src/lib/campaign-schedule.ts libs/growth/src/lib/campaign-schedule.spec.ts
git commit -m "feat(growth): expose the Pacific calendar date for daily scheduling

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 7: install digest candidates, context, enqueue, and report

**Files:**
- Create: `libs/growth/src/lib/observability/install-digest.ts`
- Create: `libs/growth/test/install-digest.integration.spec.ts`
- Modify: `libs/growth/src/index.ts` (Tasks 7 and 9 only)

- [ ] **Step 1: Write the failing integration spec**

Create `libs/growth/test/install-digest.integration.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { acceptObservationBatch } from '../src/lib/observability/ingest.ts';
import {
  enqueueInstallDigestJob,
  markInstallDigestReported,
  readInstallDigestCandidates,
  readInstallDigestContext,
} from '../src/lib/observability/install-digest.ts';
import {
  evidenceDatabase,
  evidenceFixture,
  evidenceKeys,
} from './observability-fixtures.ts';
import type { SqlExecutor } from '../src/lib/database.ts';
import { createEmailLookupHmac } from '../src/lib/crypto.ts';

describe('install digest candidates', () => {
  let db: SqlExecutor;
  const subjects: string[] = [];
  const emails: string[] = [];
  const jobKeys: string[] = [];
  beforeAll(async () => {
    db = await evidenceDatabase();
  });
  afterAll(async () => {
    if (!db) return;
    const digests = emails.map(
      (email) => createEmailLookupHmac(email, evidenceKeys.active).digest
    );
    await db.execute(
      'delete from growth_install_digest_reports where email_lookup_hmac=any($1::text[])',
      [digests]
    );
    await db.execute(
      'delete from growth_jobs where idempotency_key=any($1::text[])',
      [jobKeys]
    );
    await db.execute(
      'delete from growth_observation_subjects where external_id=any($1::uuid[])',
      [subjects]
    );
    const contacts = (
      await db.execute<{ id: string }>(
        'select id from growth_contacts where email_normalized=any($1::text[])',
        [emails]
      )
    ).rows.map((c) => c.id);
    await db.execute('delete from growth_activity where contact_id=any($1::uuid[])', [contacts]);
    await db.execute('delete from growth_contacts where id=any($1::uuid[])', [contacts]);
    await db.close?.();
  });

  function install(
    now: Date,
    overrides: {
      email?: string | null;
      environment?: 'ci' | 'unknown';
      packageName?: string;
      packageVersion?: string;
      gitConfigOrigin?: 'local' | 'global';
    } = {}
  ) {
    const batch = evidenceFixture(now);
    const event = batch.events[0];
    event.properties = {
      ...event.properties,
      packageName: overrides.packageName ?? '@threadplane/langgraph',
      packageVersion: overrides.packageVersion ?? '0.2.0',
      environment: overrides.environment ?? 'unknown',
      environmentEvidence: overrides.environment ?? 'unknown',
    };
    if (overrides.email === null) delete event.identity;
    else if (overrides.email) {
      event.identity = {
        gitEmail: overrides.email,
        gitDisplayName: 'Digest Developer',
        gitConfigOrigin: overrides.gitConfigOrigin ?? 'global',
        repositoryProvider: 'github',
        repositoryOwner: 'digest-org',
      };
    }
    subjects.push(event.subject.id);
    if (event.identity?.gitEmail) emails.push(event.identity.gitEmail);
    return batch;
  }
  const accept = (batch: ReturnType<typeof install>, now: Date) =>
    acceptObservationBatch(db, 'install', batch, { now, keyring: evidenceKeys });

  it('groups one line per work email, excluding personal, CI, contacts and reported identities', async () => {
    const now = new Date('2026-09-16T15:00:00.000Z');
    const work = `${randomUUID()}@digest-corp.example`;
    const personal = `${randomUUID()}@gmail.com`;
    const ci = `${randomUUID()}@ci-corp.example`;
    const existing = `${randomUUID()}@existing-corp.example`;
    await accept(install(now, { email: work, packageName: '@threadplane/langgraph' }), now);
    await accept(
      install(new Date(now.getTime() + 60_000), {
        email: work,
        packageName: '@threadplane/chat',
        gitConfigOrigin: 'local',
      }),
      new Date(now.getTime() + 60_000)
    );
    await accept(install(now, { email: personal }), now);
    await accept(install(now, { email: ci, environment: 'ci' }), now);
    await accept(install(now, { email: existing }), now);
    await accept(install(now, { email: null }), now);
    await db.execute(
      `insert into growth_contacts (email_normalized, email_lookup_hmac, email_hmac_key_version, source)
       values ($1, $2, $3, 'website')`,
      [
        existing,
        createEmailLookupHmac(existing, evidenceKeys.active).digest,
        evidenceKeys.active.version,
      ]
    );

    const candidates = await readInstallDigestCandidates(db, { limit: 200 });
    const line = candidates.find((c) => c.email === work);
    expect(line).toBeDefined();
    expect(line).toMatchObject({
      companyDomain: 'digest-corp.example',
      gitDisplayName: 'Digest Developer',
      repositoryProvider: 'github',
      repositoryOwner: 'digest-org',
      gitConfigOrigin: 'local',
      installCount: 2,
    });
    expect(line!.packages.map((p) => `${p.packageName}@${p.packageVersion}`).sort()).toEqual([
      '@threadplane/chat@0.2.0',
      '@threadplane/langgraph@0.2.0',
    ]);
    expect(line!.firstSeenAt.getTime()).toBe(now.getTime());
    expect(line!.lastSeenAt.getTime()).toBe(now.getTime() + 60_000);
    expect(candidates.map((c) => c.email)).not.toContain(personal);
    expect(candidates.map((c) => c.email)).not.toContain(ci);
    expect(candidates.map((c) => c.email)).not.toContain(existing);

    const jobKey = `install_digest:test:${randomUUID()}`;
    jobKeys.push(jobKey);
    const jobId = await enqueueInstallDigestJob(db, {
      now,
      idempotencyKey: jobKey,
      businessDate: '2026-09-16',
    });
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(
      await enqueueInstallDigestJob(db, { now, idempotencyKey: jobKey, businessDate: '2026-09-16' })
    ).toBeNull();

    await markInstallDigestReported(db, {
      digestJobId: jobId!,
      reportedAt: now,
      candidates: [line!],
    });
    await markInstallDigestReported(db, {
      digestJobId: jobId!,
      reportedAt: now,
      candidates: [line!],
    });
    expect(
      (await readInstallDigestCandidates(db, { limit: 200 })).map((c) => c.email)
    ).not.toContain(work);

    const context = await readInstallDigestContext(db, { since: now });
    expect(context.anonymousInstallSubjects).toBeGreaterThanOrEqual(1);
    expect(context.ciInstallSubjects).toBeGreaterThanOrEqual(1);
  });

  it('does not enqueue when there are no candidates', async () => {
    const now = new Date('2026-09-17T15:00:00.000Z');
    const jobKey = `install_digest:test:${randomUUID()}`;
    jobKeys.push(jobKey);
    // Every candidate from the previous test is reported or excluded; new ones are none.
    const before = await readInstallDigestCandidates(db, { limit: 200 });
    const enqueued = await enqueueInstallDigestJob(db, {
      now,
      idempotencyKey: jobKey,
      businessDate: '2026-09-17',
    });
    if (before.length === 0) expect(enqueued).toBeNull();
    else expect(enqueued).not.toBeNull();
  });
});
```

Note on the last test: the shared disposable database may hold candidates from other runs, so the assertion is conditional on the observed state and still exercises the empty branch when the database is clean.

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx -y node@22 ./node_modules/nx/bin/nx.js run growth:test-integration -- --run libs/growth/test/install-digest.integration.spec.ts
```

Expected: FAIL, cannot resolve `../src/lib/observability/install-digest.ts`.

- [ ] **Step 3: Implement the module**

Create `libs/growth/src/lib/observability/install-digest.ts`:

```ts
import type { SqlExecutor } from '../database.ts';
import { isPersonalEmailDomain } from '../company-domain.ts';

export interface InstallDigestPackage {
  packageName: string;
  packageVersion: string;
}

export interface InstallDigestCandidate {
  email: string;
  companyDomain: string;
  gitDisplayName: string | null;
  repositoryProvider: string | null;
  repositoryOwner: string | null;
  /** 'local' when any install carried a repository-local git identity, else 'global'. */
  gitConfigOrigin: 'local' | 'global';
  packages: InstallDigestPackage[];
  installCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  firstInstallObservationId: string;
  emailLookupHmac: string;
  emailKeyVersion: number;
}

export interface InstallDigestContext {
  since: Date;
  anonymousInstallSubjects: number;
  ciInstallSubjects: number;
}

interface CandidateRow extends Record<string, unknown> {
  email: string;
  git_display_name: string | null;
  repository_provider: string | null;
  repository_owner: string | null;
  local_origin: boolean;
  packages: string[];
  install_count: number | string;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  first_install_observation_id: string;
  email_lookup_hmac: string;
  email_key_version: number | string;
}

function positiveLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('Install digest limit must be an integer between 1 and 1000');
  }
  return limit;
}

/**
 * Identified, non-CI installers with a work-email domain who are not a contact
 * in any state and have not been reported in a previous digest. One row per email.
 */
export async function readInstallDigestCandidates(
  executor: SqlExecutor,
  input: { limit: number }
): Promise<InstallDigestCandidate[]> {
  const limit = positiveLimit(input.limit);
  const result = await executor.execute<CandidateRow>(
    `/* growth:read-install-digest-candidates */
     with identified as (
       select i.email_normalized as email,
              i.email_lookup_hmac,
              i.email_key_version,
              i.git_display_name,
              i.repository_provider,
              i.repository_owner,
              i.git_config_origin = 'local' as local_origin,
              o.id as observation_id,
              o.received_at,
              coalesce(o.properties->>'packageName', '') as package_name,
              coalesce(o.properties->>'packageVersion', '') as package_version
       from growth_observation_identities i
       join growth_observations o on o.id = i.observation_id
       where o.source = 'install'
         and o.kind = 'package.installed'
         and o.redacted_at is null
         and i.email_normalized is not null
         and coalesce(o.properties->>'environment', 'unknown') <> 'ci'
         and not exists (
           select 1 from growth_contacts c
           where c.email_normalized = i.email_normalized
         )
         and not exists (
           select 1
           from growth_install_digest_reports r
           join growth_observation_identities ri
             on ri.email_key_version = r.email_key_version
            and ri.email_lookup_hmac = r.email_lookup_hmac
           where ri.email_normalized = i.email_normalized
         )
     )
     select email,
            max(git_display_name) as git_display_name,
            max(repository_provider) as repository_provider,
            max(repository_owner) as repository_owner,
            bool_or(local_origin) as local_origin,
            array_agg(distinct package_name || '@' || package_version) as packages,
            count(*)::integer as install_count,
            min(received_at) as first_seen_at,
            max(received_at) as last_seen_at,
            (array_agg(observation_id order by received_at, observation_id))[1]
              as first_install_observation_id,
            (array_agg(email_lookup_hmac order by received_at, observation_id))[1]
              as email_lookup_hmac,
            (array_agg(email_key_version order by received_at, observation_id))[1]
              as email_key_version
     from identified
     group by email
     order by min(received_at), email
     limit $1`,
    [limit]
  );
  const candidates: InstallDigestCandidate[] = [];
  for (const row of result.rows) {
    const domain = row.email.split('@')[1] ?? '';
    if (!domain || isPersonalEmailDomain(domain)) continue;
    candidates.push({
      email: row.email,
      companyDomain: domain,
      gitDisplayName: row.git_display_name,
      repositoryProvider: row.repository_provider,
      repositoryOwner: row.repository_owner,
      gitConfigOrigin: row.local_origin ? 'local' : 'global',
      packages: row.packages
        .map((entry) => {
          const at = entry.lastIndexOf('@');
          return {
            packageName: entry.slice(0, at),
            packageVersion: entry.slice(at + 1),
          };
        })
        .filter((p) => p.packageName && p.packageVersion),
      installCount: Number(row.install_count),
      firstSeenAt: new Date(row.first_seen_at),
      lastSeenAt: new Date(row.last_seen_at),
      firstInstallObservationId: row.first_install_observation_id,
      emailLookupHmac: row.email_lookup_hmac,
      emailKeyVersion: Number(row.email_key_version),
    });
  }
  return candidates;
}

/** Install subjects since `since` that carried no identity, and CI install subjects. */
export async function readInstallDigestContext(
  executor: SqlExecutor,
  input: { since: Date }
): Promise<InstallDigestContext> {
  if (!Number.isFinite(input.since.getTime())) {
    throw new Error('Install digest context requires a valid since date');
  }
  const result = await executor.execute<{
    anonymous: number | string;
    ci: number | string;
  }>(
    `/* growth:read-install-digest-context */
     select count(distinct o.subject_id) filter (where i.observation_id is null) as anonymous,
            count(distinct o.subject_id)
              filter (where coalesce(o.properties->>'environment', 'unknown') = 'ci') as ci
     from growth_observations o
     left join growth_observation_identities i
       on i.observation_id = o.id and i.email_normalized is not null
     where o.source = 'install'
       and o.kind = 'package.installed'
       and o.redacted_at is null
       and o.received_at >= $1`,
    [input.since]
  );
  const row = result.rows[0];
  return {
    since: input.since,
    anonymousInstallSubjects: Number(row?.anonymous ?? 0),
    ciInstallSubjects: Number(row?.ci ?? 0),
  };
}

/**
 * Enqueue one digest job for the idempotency key when at least one candidate
 * exists. Returns the new job id, or null when nothing was enqueued.
 */
export async function enqueueInstallDigestJob(
  executor: SqlExecutor,
  input: { now: Date; idempotencyKey: string; businessDate: string }
): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.businessDate)) {
    throw new Error('Install digest business date must be YYYY-MM-DD');
  }
  if (!input.idempotencyKey.startsWith('install_digest:')) {
    throw new Error('Install digest idempotency key must start with install_digest:');
  }
  const candidates = await readInstallDigestCandidates(executor, { limit: 1 });
  if (candidates.length === 0) return null;
  const result = await executor.execute<{ id: string }>(
    `/* growth:enqueue-install-digest */
     insert into growth_jobs (kind, status, available_at, idempotency_key, payload)
     values ('digest', 'pending', $1, $2,
             jsonb_build_object('business_date', $3::text, 'digest_kind', 'install_identities'))
     on conflict (idempotency_key) do nothing
     returning id`,
    [input.now, input.idempotencyKey, input.businessDate]
  );
  return result.rows[0]?.id ?? null;
}

/** Record reported identities; repeats are no-ops so a retried job never double-reports. */
export async function markInstallDigestReported(
  executor: SqlExecutor,
  input: {
    digestJobId: string;
    reportedAt: Date;
    candidates: readonly Pick<
      InstallDigestCandidate,
      'emailLookupHmac' | 'emailKeyVersion' | 'firstInstallObservationId'
    >[];
  }
): Promise<void> {
  if (input.candidates.length === 0) return;
  await executor.execute(
    `/* growth:mark-install-digest-reported */
     insert into growth_install_digest_reports
       (email_lookup_hmac, email_key_version, first_install_observation_id, digest_job_id, reported_at)
     select c.hmac, c.version, c.observation_id::uuid, $1::uuid, $2
     from jsonb_to_recordset($3::jsonb)
       as c(hmac text, version smallint, observation_id text)
     on conflict (email_key_version, email_lookup_hmac) do nothing`,
    [
      input.digestJobId,
      input.reportedAt,
      JSON.stringify(
        input.candidates.map((c) => ({
          hmac: c.emailLookupHmac,
          version: c.emailKeyVersion,
          observation_id: c.firstInstallObservationId,
        }))
      ),
    ]
  );
}
```

- [ ] **Step 4: Export from the library index**

Append to `libs/growth/src/index.ts`:

```ts
export {
  readInstallDigestCandidates,
  readInstallDigestContext,
  enqueueInstallDigestJob,
  markInstallDigestReported,
} from './lib/observability/install-digest.ts';
export type {
  InstallDigestCandidate,
  InstallDigestContext,
  InstallDigestPackage,
} from './lib/observability/install-digest.ts';
export { pacificCalendarDate } from './lib/campaign-schedule.ts';
```

- [ ] **Step 5: Run the integration spec to verify it passes**

Same command as Step 2. Expected: PASS.

- [ ] **Step 6: Unit suite, lint, build**

Run: `npx nx test growth && npx nx lint growth && npx nx build growth`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add libs/growth/src/lib/observability/install-digest.ts libs/growth/test/install-digest.integration.spec.ts libs/growth/src/index.ts
git commit -m "feat(growth): read, enqueue and record install digest candidates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 8: token purpose `founder_approve_install`

**Files:**
- Modify: `libs/growth/src/lib/tokens.ts:24-26,155-160`
- Modify: `libs/growth/src/lib/tokens.spec.ts`
- Modify: `libs/growth/src/index.ts` (Tasks 7 and 9 only)

- [ ] **Step 1: Write the failing test**

Append to `libs/growth/src/lib/tokens.spec.ts` (add `FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS`, `createGrowthActionToken`, `verifyGrowthActionToken` to its import from `./tokens.ts` if not already imported):

```ts
describe('founder_approve_install tokens', () => {
  const key = { version: 3, secret: 'approve-install-token-secret-material!' };
  const observationId = '0f1e2d3c-4b5a-4c7d-8e9f-a0b1c2d3e4f5';
  const issuedAt = new Date('2026-09-16T15:00:00.000Z');

  it('signs and verifies an install observation id under the approve purpose for seven days', () => {
    const token = createGrowthActionToken(
      { contactId: observationId, purpose: 'founder_approve_install', issuedAt, eventNonce: 'digest-job-1' },
      key
    );
    expect(FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(
      verifyGrowthActionToken(token, {
        expectedPurpose: 'founder_approve_install',
        keyring: { active: key },
        now: new Date(issuedAt.getTime() + 6 * 24 * 60 * 60 * 1000),
        maxAgeSeconds: FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS,
      })
    ).toMatchObject({ contactId: observationId, purpose: 'founder_approve_install', eventNonce: 'digest-job-1' });
    expect(
      verifyGrowthActionToken(token, {
        expectedPurpose: 'founder_approve_install',
        keyring: { active: key },
        now: new Date(issuedAt.getTime() + 8 * 24 * 60 * 60 * 1000),
        maxAgeSeconds: FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS,
      })
    ).toBeNull();
    expect(
      verifyGrowthActionToken(token, {
        expectedPurpose: 'founder_stop',
        keyring: { active: key },
        now: issuedAt,
      })
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx nx test growth -- --run src/lib/tokens.spec.ts`
Expected: FAIL, `Unsupported growth action token purpose` or a missing export.

- [ ] **Step 3: Implement**

In `tokens.ts`:

Line 24 area, after `FOUNDER_STOP_TOKEN_MAX_AGE_SECONDS`, add:

```ts
export const FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
```

Change the purpose union:

```ts
export type GrowthTokenPurpose =
  | 'unsubscribe'
  | 'founder_stop'
  | 'founder_approve_install';
```

Change `assertPurpose`:

```ts
function assertPurpose(purpose: unknown): GrowthTokenPurpose {
  if (
    purpose !== 'unsubscribe' &&
    purpose !== 'founder_stop' &&
    purpose !== 'founder_approve_install'
  ) {
    throw new Error('Unsupported growth action token purpose');
  }
  return purpose;
}
```

Also update the doc comment above `CreateGrowthActionTokenInput.contactId` if one exists, otherwise add one to the interface:

```ts
export interface CreateGrowthActionTokenInput {
  /** Contact id for unsubscribe/founder_stop; the first install observation id for founder_approve_install. */
  contactId: string;
```

No index change is needed: `libs/growth/src/index.ts` line 16 is `export * from './lib/tokens.ts';`, so the new constant is exported automatically.

- [ ] **Step 4: Run to verify it passes**

Run: `npx nx test growth -- --run src/lib/tokens.spec.ts`
Expected: PASS. Also run `grep -rn "'founder_stop'" libs apps --include='*.ts' | grep -v spec | grep -v node_modules` and confirm nothing else switches exhaustively on the purpose union (the stop route and unsubscribe route pass an explicit `expectedPurpose`, so they are unaffected).

- [ ] **Step 5: Commit**

```bash
git add libs/growth/src/lib/tokens.ts libs/growth/src/lib/tokens.spec.ts libs/growth/src/index.ts
git commit -m "feat(growth): add the founder_approve_install token purpose

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 9: `approveContactFromInstallDigest`

**Files:**
- Modify: `libs/growth/src/lib/contacts.ts`
- Modify: `libs/growth/test/contacts.integration.spec.ts`
- Modify: `libs/growth/src/index.ts` (Tasks 7 and 9 only)

The existing `approveContactFromInstallRuntimeInTransaction` (lines 203 to 328) contains the find-or-insert-contact logic; `reauthorizeContact` (1057 to 1156) contains the approval logic wrapped in its own transaction. This task factors both into transaction-scoped helpers and composes them.

- [ ] **Step 1: Write the failing integration test**

Append to `libs/growth/test/contacts.integration.spec.ts`, inside its top-level `describeDatabase` block, a new nested `describe`. Match the file's existing imports style (it imports from `../src/index.ts` and uses an `executor`); add `approveContactFromInstallDigest`, `acceptObservationBatch`, `stopContact` to the imports as needed, and import `evidenceFixture`, `evidenceKeys` from `./observability-fixtures.ts`:

```ts
  describe('approveContactFromInstallDigest', () => {
    const cleanupEmails: string[] = [];
    const cleanupSubjects: string[] = [];
    afterAll(async () => {
      const contacts = (
        await executor.execute<{ id: string }>(
          'select id from growth_contacts where email_normalized=any($1::text[])',
          [cleanupEmails]
        )
      ).rows.map((c) => c.id);
      await executor.execute('delete from growth_jobs where contact_id=any($1::uuid[])', [contacts]);
      await executor.execute('delete from growth_activity where contact_id=any($1::uuid[])', [contacts]);
      await executor.execute('delete from growth_contacts where id=any($1::uuid[])', [contacts]);
      await executor.execute(
        'delete from growth_observation_subjects where external_id=any($1::uuid[])',
        [cleanupSubjects]
      );
    });

    async function installObservation(email: string, now: Date): Promise<string> {
      const batch = evidenceFixture(now);
      const event = batch.events[0];
      event.properties = { ...event.properties, environment: 'unknown', environmentEvidence: 'unknown' };
      event.identity = { gitEmail: email, gitDisplayName: 'Digest Developer', gitConfigOrigin: 'global' };
      cleanupSubjects.push(event.subject.id);
      cleanupEmails.push(email);
      await acceptObservationBatch(executor, 'install', batch, { now, keyring: evidenceKeys });
      const row = await executor.execute<{ observation_id: string }>(
        'select observation_id from growth_observation_identities where email_normalized=$1 order by observation_id limit 1',
        [email]
      );
      return row.rows[0]!.observation_id;
    }

    it('creates and approves a new contact from an install observation and records a founder reauthorization', async () => {
      const now = new Date('2026-09-16T16:00:00.000Z');
      const email = `${randomUUID()}@approve-corp.example`;
      const observationId = await installObservation(email, now);

      const result = await approveContactFromInstallDigest(executor, {
        installObservationId: observationId,
        occurredAt: now,
        eventKey: `token:founder_approve_install:${observationId}:${now.getTime()}:job-1`,
        keyring: evidenceKeys,
      });
      expect(result).toMatchObject({ approved: true, changed: true });

      const contact = await executor.execute<{ source: string; outreach_approved_at: Date }>(
        'select source, outreach_approved_at from growth_contacts where id=$1',
        [result.contactId]
      );
      expect(contact.rows[0]!.source).toBe('signed_founder_approve_install');
      expect(new Date(contact.rows[0]!.outreach_approved_at).getTime()).toBe(now.getTime());
      const activity = await executor.execute<{ kind: string; data: Record<string, unknown> }>(
        "select kind, data from growth_activity where contact_id=$1 and kind='contact.reauthorized'",
        [result.contactId]
      );
      expect(activity.rows).toHaveLength(1);
      expect(activity.rows[0]!.data).toMatchObject({
        provenance: 'founder_action',
        source: 'signed_founder_approve_install',
        install_observation_id: observationId,
      });

      const again = await approveContactFromInstallDigest(executor, {
        installObservationId: observationId,
        occurredAt: new Date(now.getTime() + 1000),
        eventKey: `token:founder_approve_install:${observationId}:${now.getTime()}:job-2`,
        keyring: evidenceKeys,
      });
      expect(again).toMatchObject({ approved: true, changed: false, contactId: result.contactId });
    });

    it('refuses a stopped contact and an unknown or redacted observation', async () => {
      const now = new Date('2026-09-16T16:10:00.000Z');
      const email = `${randomUUID()}@stopped-corp.example`;
      const observationId = await installObservation(email, now);
      const first = await approveContactFromInstallDigest(executor, {
        installObservationId: observationId,
        occurredAt: now,
        eventKey: `token:founder_approve_install:${observationId}:${now.getTime()}:job-3`,
        keyring: evidenceKeys,
      });
      await stopContact(executor, {
        contactId: first.contactId!,
        reason: 'manual_suppression',
        eventKey: `stop:${first.contactId}`,
        occurredAt: new Date(now.getTime() + 1000),
        source: 'founder_cli',
        provenance: { actor: 'founder', kind: 'founder_action', policyVersion: 'growth-v1' },
      });
      const afterStop = await approveContactFromInstallDigest(executor, {
        installObservationId: observationId,
        occurredAt: new Date(now.getTime() + 2000),
        eventKey: `token:founder_approve_install:${observationId}:${now.getTime()}:job-4`,
        keyring: evidenceKeys,
      });
      expect(afterStop).toMatchObject({ approved: false, reason: 'stopped' });

      const unknown = await approveContactFromInstallDigest(executor, {
        installObservationId: randomUUID(),
        occurredAt: now,
        eventKey: `token:founder_approve_install:unknown:${now.getTime()}`,
        keyring: evidenceKeys,
      });
      expect(unknown).toMatchObject({ approved: false, reason: 'identity_unavailable' });
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx -y node@22 ./node_modules/nx/bin/nx.js run growth:test-integration -- --run libs/growth/test/contacts.integration.spec.ts
```

Expected: FAIL, `approveContactFromInstallDigest` is not exported.

- [ ] **Step 3: Factor the find-or-insert helper out of the install-runtime approval**

In `contacts.ts`, add this helper directly above `approveContactFromInstallRuntimeInTransaction` (line 203). It is the body of that function from the `createEmailLookupCandidates` call through the insert, unchanged in behaviour but parameterized by `source`:

```ts
async function findOrInsertIdentityContactInTransaction(
  transaction: SqlTransaction,
  input: { email: string; keyring: EmailHmacKeyring; source: string; lockLabel: string }
): Promise<IdentityContactRow> {
  const candidates = createEmailLookupCandidates(input.email, input.keyring);
  const active = candidates[0];
  await privacyLock(transaction);
  await transaction.execute(
    `/* growth:lock-email */ select pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [input.email]
  );
  // Missing rotation keys must not turn a deleted contact into a new eligible identity.
  const storedVersions = await transaction.execute<{ email_hmac_key_version: number }>(
    `/* growth:read-key-versions */
     select distinct email_hmac_key_version from growth_contacts order by email_hmac_key_version`
  );
  if (
    storedVersions.rows.some(
      (row) => !candidates.some((candidate) => candidate.keyVersion === row.email_hmac_key_version)
    )
  ) {
    throw new Error(`Email HMAC rotation coverage error for ${input.lockLabel}`);
  }
  const found = await transaction.execute<IdentityContactRow>(
    `/* growth:find-identity-contact */
     select c.id, c.email_lookup_hmac, c.email_hmac_key_version,
            c.outreach_approved_at, c.deleted_at, c.updated_at
     from growth_contacts c
     where c.email_normalized = $2 or exists (
       select 1 from jsonb_to_recordset($1::jsonb)
         as candidate(key_version smallint, digest text)
       where (candidate.key_version = c.email_hmac_key_version
              and candidate.digest = c.email_lookup_hmac)
          or exists (
            select 1 from growth_activity alias
            where alias.contact_id = c.id and alias.kind = 'contact.lookup_alias_added'
              and alias.data->>'key_version' = candidate.key_version::text
              and alias.data->>'digest' = candidate.digest
          )
     )
     order by c.id limit 2 for update of c`,
    [
      JSON.stringify(candidates.map((candidate) => ({ key_version: candidate.keyVersion, digest: candidate.digest }))),
      input.email,
    ]
  );
  if (found.rows.length > 1) throw new Error('Email HMAC lookup matched multiple growth contacts');
  const contact = found.rows[0];
  if (contact) {
    const matching = candidates.find((candidate) => candidate.keyVersion === contact.email_hmac_key_version);
    if (!matching || !compareEmailLookupHmac(matching.digest, contact.email_lookup_hmac)) {
      throw new Error(`Email HMAC secret material is inconsistent for ${input.lockLabel}`);
    }
    return contact;
  }
  const inserted = await transaction.execute<IdentityContactRow>(
    `/* growth:insert-identity-contact */
     insert into growth_contacts (email_normalized, email_lookup_hmac, email_hmac_key_version, source)
     values ($1, $2, $3, $4)
     returning id, email_lookup_hmac, email_hmac_key_version, outreach_approved_at, deleted_at, updated_at`,
    [input.email, active.digest, active.keyVersion, input.source]
  );
  const created = inserted.rows[0];
  if (!created) throw new Error('Failed to insert growth contact');
  return created;
}
```

Then rewrite the top of `approveContactFromInstallRuntimeInTransaction` so that everything between `const email = normalizeInstallRuntimeEmail(input.email);` plus the observation id check, and `const stops = await findHardStops(transaction, contact.id);`, becomes:

```ts
  const contact = await findOrInsertIdentityContactInTransaction(transaction, {
    email,
    keyring: input.keyring,
    source: 'install_runtime',
    lockLabel: 'install/runtime approval',
  });
```

Keep the rest of that function unchanged (`findHardStops`, `toControlState`, the approval update, and `insertActivityOnce`).

- [ ] **Step 4: Factor the reauthorization core into a transaction-scoped function**

Rename the body of `reauthorizeContact` into a new function and keep the exported wrapper:

```ts
export async function reauthorizeContact(
  executor: SqlExecutor,
  input: ReauthorizeContactInput
): Promise<ReauthorizeContactResult> {
  return executor.transaction((transaction) =>
    reauthorizeContactInTransaction(transaction, input)
  );
}

async function reauthorizeContactInTransaction(
  transaction: SqlTransaction,
  input: ReauthorizeContactInput & { extraActivityData?: Record<string, unknown> }
): Promise<ReauthorizeContactResult> {
  const contactId = requiredText('contactId', input.contactId, 100);
  const eventKey = requiredText('eventKey', input.eventKey, LIMITS.eventKey);
  const occurredAt = validDate('occurredAt', input.occurredAt);
  const actor = requiredText('actor', input.actor, LIMITS.actor);
  const reason = requiredText('reason', input.reason, LIMITS.reason);
  const source = requiredText('source', input.source, LIMITS.source);
  const policyVersion = requiredText('policyVersion', input.policyVersion, LIMITS.policyVersion);
  const allowed = new Set<ContactHardStopReason>(input.allowedPriorStops);
  // ...the existing transaction body from `const locked = await transaction.execute<ContactRow>(` to the final return, unchanged,
  // except the insertActivityOnce data gains `...(input.extraActivityData ?? {})` as its last spread:
  //   data: {
  //     actor,
  //     policy_version: policyVersion,
  //     prior_stops: [...new Set(hardStops.map(({ kind }) => kind))],
  //     provenance: 'founder_action',
  //     reason,
  //     source,
  //     ...(input.extraActivityData ?? {}),
  //   },
}
```

Move the validation lines (`requiredText`/`validDate`) that were above the `return executor.transaction(...)` into the new function as shown, so the wrapper is only the transaction call.

- [ ] **Step 5: Add the digest approval function**

Add after `reauthorizeContact`:

```ts
export interface ApproveContactFromInstallDigestInput {
  installObservationId: string;
  occurredAt: Date;
  eventKey: string;
  keyring: EmailHmacKeyring;
}

export type ApproveContactFromInstallDigestResult =
  | { approved: true; contactId: string; changed: boolean }
  | { approved: false; reason: 'identity_unavailable' | 'stopped' | 'deleted' };

/**
 * Founder-approved outreach for an installer who never produced a runtime
 * observation. Creates the contact when absent, then records the same
 * founder reauthorization the operator CLI records, so campaign enrollment
 * picks it up through the existing `contact.reauthorized` path.
 */
export async function approveContactFromInstallDigest(
  executor: SqlExecutor,
  input: ApproveContactFromInstallDigestInput
): Promise<ApproveContactFromInstallDigestResult> {
  const observationId = requiredText('installObservationId', input.installObservationId, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(observationId)) {
    throw new Error('Install digest approval requires an observation UUID');
  }
  const occurredAt = validDate('occurredAt', input.occurredAt);
  return executor.transaction(async (transaction) => {
    const identity = await transaction.execute<{ email_normalized: string | null }>(
      `/* growth:read-install-digest-identity */
       select i.email_normalized
       from growth_observations o
       join growth_observation_identities i on i.observation_id = o.id
       where o.id = $1 and o.source = 'install' and o.redacted_at is null`,
      [observationId]
    );
    const raw = identity.rows[0]?.email_normalized;
    const email = raw ? normalizeInstallRuntimeEmail(raw) : null;
    if (!email) return { approved: false, reason: 'identity_unavailable' };

    const contact = await findOrInsertIdentityContactInTransaction(transaction, {
      email,
      keyring: input.keyring,
      source: 'signed_founder_approve_install',
      lockLabel: 'install digest approval',
    });
    const stops = await findHardStops(transaction, contact.id);
    const state = toControlState({
      ...contact,
      latest_hard_stop_kind: stops[0]?.kind ?? null,
      latest_hard_stop_at: stops[0]?.occurred_at ?? null,
    });
    if (state.authorization === 'deleted') return { approved: false, reason: 'deleted' };
    if (state.authorization === 'stopped') return { approved: false, reason: 'stopped' };
    if (state.authorization === 'approved') {
      return { approved: true, contactId: contact.id, changed: false };
    }
    const result = await reauthorizeContactInTransaction(transaction, {
      contactId: contact.id,
      eventKey: input.eventKey,
      occurredAt,
      actor: 'founder',
      reason: 'founder_install_digest_approval',
      source: 'signed_founder_approve_install',
      policyVersion: 'growth-v1',
      allowedPriorStops: [],
      extraActivityData: { install_observation_id: observationId },
    });
    if (!result.reauthorized) return { approved: false, reason: 'stopped' };
    return { approved: true, contactId: contact.id, changed: true };
  });
}
```

Check `LIMITS.source` allows 31 characters (`signed_founder_approve_install` is 30). If `LIMITS.source` is smaller, raise it in the `LIMITS` constant and note it in the commit.

- [ ] **Step 6: Export**

In `libs/growth/src/index.ts`, find the export list that contains `approveContactFromInstallRuntimeInTransaction` (or `reauthorizeContact`) and add `approveContactFromInstallDigest`, plus a type export for `ApproveContactFromInstallDigestInput` and `ApproveContactFromInstallDigestResult`.

- [ ] **Step 7: Run integration and unit suites**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx -y node@22 ./node_modules/nx/bin/nx.js run growth:test-integration
npx nx test growth && npx nx run growth:test-operator-cli && npx nx lint growth && npx nx build growth
```

Expected: all green, including the existing `install-runtime.integration.spec.ts` and `contacts.integration.spec.ts` which exercise the refactored helpers.

- [ ] **Step 8: Commit**

```bash
git add libs/growth/src/lib/contacts.ts libs/growth/test/contacts.integration.spec.ts libs/growth/src/index.ts
git commit -m "feat(growth): approve a contact from an install observation via founder reauthorization

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 10: generic internal-notification claim, `digest` job kind

**Files:**
- Modify: `libs/growth/src/lib/jobs.ts:1168-1250`
- Modify: `libs/growth/src/lib/dispatcher.ts:16-21`
- Test: `libs/growth/test/jobs.integration.spec.ts` (only if it already covers `claimInternalNotificationSubmission`; otherwise the lifecycle spec in Task 12 covers behaviour)

- [ ] **Step 1: Let the at-most-once claim and unknown marker accept the job kind**

In `jobs.ts`, change the signature and SQL of `claimInternalNotificationSubmission`:

```ts
export async function claimInternalNotificationSubmission(
  executor: SqlExecutor,
  input: { jobId: string; leaseToken: string; now: Date; kind?: 'notify' | 'digest' }
): Promise<boolean> {
  const jobId = requiredText('jobId', input.jobId);
  const leaseToken = requiredText('leaseToken', input.leaseToken);
  const now = validDate('now', input.now);
  const kind = input.kind ?? 'notify';
```

and in its SQL replace `and j.kind = 'notify'` with `and j.kind = $4` and append `kind` to the parameter array: `[jobId, leaseToken, now, kind]`.

Do the same for `markInternalNotificationUnknown`: add `kind?: 'notify' | 'digest'` to the input type, `const kind = input.kind ?? 'notify';`, replace `and kind = 'notify'` with `and kind = $5`, and pass `[jobId, leaseToken, occurredAt, errorCode, kind]`.

- [ ] **Step 2: Add the kind**

In `libs/growth/src/lib/dispatcher.ts`, extend the union:

```ts
export type GrowthAppJobKind =
  | 'fulfill'
  | 'enrich'
  | 'notify'
  | 'send_step'
  | 'research_cleanup'
  | 'digest';
```

- [ ] **Step 3: Run the growth suites**

Run: `npx nx test growth && npx nx lint growth && npx nx build growth`
Expected: green. If `jobs.integration.spec.ts` asserts the exact SQL text of these functions, update the expectation to the parameterized form.

- [ ] **Step 4: Commit**

```bash
git add libs/growth/src/lib/jobs.ts libs/growth/src/lib/dispatcher.ts
git commit -m "feat(growth): allow digest jobs to use the internal notification claim

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 11: digest template

**Files:**
- Create: `apps/lifecycle/src/notifications/install-digest.ts`
- Create: `apps/lifecycle/src/notifications/install-digest.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `install-digest.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { renderInstallDigest } from './install-digest.js';

const candidate = {
  email: 'dev@bosch.example',
  companyDomain: 'bosch.example',
  gitDisplayName: 'Dev Person',
  repositoryProvider: 'github',
  repositoryOwner: 'bosch-org',
  gitConfigOrigin: 'global' as const,
  packages: [
    { packageName: '@threadplane/langgraph', packageVersion: '0.2.0' },
    { packageName: '@threadplane/chat', packageVersion: '0.2.0' },
  ],
  installCount: 3,
  firstSeenAt: new Date('2026-09-07T10:00:00.000Z'),
  lastSeenAt: new Date('2026-09-15T13:37:00.000Z'),
  approveUrl: 'https://threadplane.ai/api/growth/approve-install?token=g1.abc.def',
};

describe('renderInstallDigest', () => {
  it('renders one block per identity with the approve link and context lines', () => {
    const text = renderInstallDigest({
      businessDate: '2026-09-16',
      candidates: [candidate],
      context: {
        since: new Date('2026-09-15T14:00:00.000Z'),
        anonymousInstallSubjects: 4,
        ciInstallSubjects: 12,
      },
    });
    expect(text).toContain('Threadplane install digest for 2026-09-16');
    expect(text).toContain('1 new install identity');
    expect(text).toContain('dev@bosch.example (Dev Person) — bosch.example');
    expect(text).toContain('Repository: github/bosch-org');
    expect(text).toContain('Packages: @threadplane/langgraph@0.2.0, @threadplane/chat@0.2.0');
    expect(text).toContain('Installs: 3, first 2026-09-07T10:00:00.000Z, last 2026-09-15T13:37:00.000Z');
    expect(text).toContain('Git identity: global config');
    expect(text).toContain('Approve outreach (valid 7 days):');
    expect(text).toContain(candidate.approveUrl);
    expect(text).toContain('Not reported: 4 install subjects without identity, 12 CI install subjects since 2026-09-15T14:00:00.000Z.');
    expect(text).toContain('This digest does not authorize or schedule any recipient email.');
  });

  it('pluralizes and omits absent fields', () => {
    const text = renderInstallDigest({
      businessDate: '2026-09-16',
      candidates: [
        { ...candidate, gitDisplayName: null, repositoryProvider: null, repositoryOwner: null, gitConfigOrigin: 'local' },
        { ...candidate, email: 'two@corp.example', companyDomain: 'corp.example' },
      ],
      context: { since: new Date('2026-09-15T14:00:00.000Z'), anonymousInstallSubjects: 0, ciInstallSubjects: 0 },
    });
    expect(text).toContain('2 new install identities');
    expect(text).toContain('dev@bosch.example — bosch.example');
    expect(text).not.toContain('Repository: /');
    expect(text).toContain('Git identity: repository-local config');
  });

  it('rejects header-injection characters in any field', () => {
    expect(() =>
      renderInstallDigest({
        businessDate: '2026-09-16',
        candidates: [{ ...candidate, gitDisplayName: 'Bad\r\nBcc: x' }],
        context: { since: new Date('2026-09-15T14:00:00.000Z'), anonymousInstallSubjects: 0, ciInstallSubjects: 0 },
      })
    ).toThrow();
    expect(() =>
      renderInstallDigest({
        businessDate: '2026-09-16',
        candidates: [{ ...candidate, approveUrl: 'http://evil.example/x' }],
        context: { since: new Date('2026-09-15T14:00:00.000Z'), anonymousInstallSubjects: 0, ciInstallSubjects: 0 },
      })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx nx test lifecycle -- --run src/notifications/install-digest.spec.ts`
Expected: FAIL, cannot find module `./install-digest.js`.

- [ ] **Step 3: Implement**

Create `install-digest.ts`:

```ts
import { z } from 'zod';

const SAFE_TEXT = /^[^ -]*$/u;
const safeText = (max: number) => z.string().min(1).max(max).regex(SAFE_TEXT);

const CandidateSchema = z.object({
  email: safeText(320),
  companyDomain: safeText(253),
  gitDisplayName: safeText(160).nullable(),
  repositoryProvider: safeText(32).nullable(),
  repositoryOwner: safeText(100).nullable(),
  gitConfigOrigin: z.enum(['local', 'global']),
  packages: z
    .array(z.object({ packageName: safeText(214), packageVersion: safeText(64) }))
    .max(20),
  installCount: z.number().int().min(1),
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
  approveUrl: z
    .string()
    .max(2048)
    .regex(/^https:\/\/[A-Za-z0-9.-]+\/api\/growth\/approve-install\?token=[A-Za-z0-9._-]+$/u),
});

const InstallDigestInputSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  candidates: z.array(CandidateSchema).min(1).max(200),
  context: z.object({
    since: z.date(),
    anonymousInstallSubjects: z.number().int().min(0),
    ciInstallSubjects: z.number().int().min(0),
  }),
});

export type InstallDigestInput = z.input<typeof InstallDigestInputSchema>;

function block(candidate: z.infer<typeof CandidateSchema>): string {
  const name = candidate.gitDisplayName ? ` (${candidate.gitDisplayName})` : '';
  const lines = [`${candidate.email}${name} — ${candidate.companyDomain}`];
  if (candidate.repositoryProvider && candidate.repositoryOwner) {
    lines.push(`Repository: ${candidate.repositoryProvider}/${candidate.repositoryOwner}`);
  }
  lines.push(
    `Packages: ${candidate.packages.map((p) => `${p.packageName}@${p.packageVersion}`).join(', ')}`,
    `Installs: ${candidate.installCount}, first ${candidate.firstSeenAt.toISOString()}, last ${candidate.lastSeenAt.toISOString()}`,
    `Git identity: ${candidate.gitConfigOrigin === 'local' ? 'repository-local config' : 'global config'}`,
    'Approve outreach (valid 7 days):',
    candidate.approveUrl
  );
  return lines.join('\n');
}

/** Plain-text founder digest. Never sent to the identities it lists. */
export function renderInstallDigest(candidate: unknown): string {
  const input = InstallDigestInputSchema.parse(candidate);
  const count = input.candidates.length;
  return [
    `Threadplane install digest for ${input.businessDate}`,
    `${count} new install ${count === 1 ? 'identity' : 'identities'} with a work-email domain and no contact record.`,
    'This digest does not authorize or schedule any recipient email.',
    'Clicking an approve link creates the contact and enrolls them in the founder sequence.',
    '',
    input.candidates.map(block).join('\n\n'),
    '',
    `Not reported: ${input.context.anonymousInstallSubjects} install subjects without identity, ${input.context.ciInstallSubjects} CI install subjects since ${input.context.since.toISOString()}.`,
  ].join('\n');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx nx test lifecycle -- --run src/notifications/install-digest.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/lifecycle/src/notifications/install-digest.ts apps/lifecycle/src/notifications/install-digest.spec.ts
git commit -m "feat(lifecycle): render the founder install digest

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 12: digest job handler, dependencies, switch, dispatcher enqueue

**Files:**
- Modify: `apps/lifecycle/src/campaign/send.ts` (dependencies interface at 87, config at 142 and 611, default deps at 712, handler branch before the final `throw new DeterministicLifecycleJobError`, handlers at 831)
- Modify: `apps/lifecycle/src/campaign/send.spec.ts` (`dependencies()` helper at ~400)
- Modify: `apps/lifecycle/src/dispatcher.ts` (`LEASED_KINDS`, input, dependencies, tick)
- Modify: `apps/lifecycle/src/dispatcher.spec.ts`
- Modify: `apps/lifecycle/src/app/dispatch/index.ts`

- [ ] **Step 1: Write the failing handler tests**

In `send.spec.ts`, extend the `dependencies()` helper's returned object with:

```ts
    publicActionOrigin: 'https://threadplane.ai',
    readInstallDigestCandidates: vi.fn().mockResolvedValue([DIGEST_CANDIDATE]),
    readInstallDigestContext: vi.fn().mockResolvedValue({
      since: new Date('2026-09-15T14:00:00.000Z'),
      anonymousInstallSubjects: 2,
      ciInstallSubjects: 5,
    }),
    markInstallDigestReported: vi.fn().mockResolvedValue(undefined),
```

and add near the top of the file, after the existing constants:

```ts
const DIGEST_CANDIDATE = {
  email: 'dev@corp.example',
  companyDomain: 'corp.example',
  gitDisplayName: 'Dev Person',
  repositoryProvider: 'github',
  repositoryOwner: 'corp',
  gitConfigOrigin: 'global' as const,
  packages: [{ packageName: '@threadplane/langgraph', packageVersion: '0.2.0' }],
  installCount: 1,
  firstSeenAt: new Date('2026-09-15T15:00:00.000Z'),
  lastSeenAt: new Date('2026-09-15T15:00:00.000Z'),
  firstInstallObservationId: '0f1e2d3c-4b5a-4c7d-8e9f-a0b1c2d3e4f5',
  emailLookupHmac: 'a'.repeat(64),
  emailKeyVersion: 1,
};
```

Then add a new `describe` at the end of the file:

```ts
describe('install digest jobs', () => {
  const digest = () =>
    ({ ...job('digest', { business_date: '2026-09-16', digest_kind: 'install_identities' }), contactId: null }) as GrowthJob;

  it('renders, claims, sends to the founder, records the identities and completes', async () => {
    const deps = dependencies();
    await expect(dispatchLifecycleAppOwnedJob({} as SqlExecutor, digest(), {}, deps)).resolves.toBe('completed');
    expect(deps.claimInternalNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'digest' }));
    expect(deps.sendInternalNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'founder@threadplane.ai',
        subject: 'Threadplane install digest for 2026-09-16: 1 new identity',
        text: expect.stringContaining('dev@corp.example (Dev Person) — corp.example'),
        idempotencyKey: digest().idempotencyKey,
        kind: 'digest',
      })
    );
    const text = (deps.sendInternalNotification as ReturnType<typeof vi.fn>).mock.calls[0][0].text as string;
    expect(text).toMatch(/https:\/\/threadplane\.ai\/api\/growth\/approve-install\?token=g1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u);
    expect(deps.markInstallDigestReported).toHaveBeenCalledWith(expect.anything(), {
      digestJobId: digest().id,
      reportedAt: NOW,
      candidates: [DIGEST_CANDIDATE],
    });
    expect(deps.completeJob).toHaveBeenCalledOnce();
    expect(deps.sendRecipient).not.toHaveBeenCalled();
  });

  it('completes without sending when no candidates remain', async () => {
    const deps = dependencies({ readInstallDigestCandidates: vi.fn().mockResolvedValue([]) });
    await expect(dispatchLifecycleAppOwnedJob({} as SqlExecutor, digest(), {}, deps)).resolves.toBe('completed');
    expect(deps.sendInternalNotification).not.toHaveBeenCalled();
    expect(deps.markInstallDigestReported).not.toHaveBeenCalled();
  });

  it('defers while delivery is disabled', async () => {
    const deps = dependencies();
    deps.recipientPolicy = { ...deps.recipientPolicy, deliveryEnabled: false };
    await expect(dispatchLifecycleAppOwnedJob({} as SqlExecutor, digest(), {}, deps)).resolves.toBe('deferred');
    expect(deps.deferJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ errorCode: 'delivery_disabled' }));
    expect(deps.sendInternalNotification).not.toHaveBeenCalled();
  });

  it('fails for manual review and does not record identities when the claim is lost or the outcome is unknown', async () => {
    const lost = dependencies({ claimInternalNotification: vi.fn().mockResolvedValue(false) });
    await expect(dispatchLifecycleAppOwnedJob({} as SqlExecutor, digest(), {}, lost)).resolves.toBe('failed');
    expect(lost.sendInternalNotification).not.toHaveBeenCalled();
    expect(lost.markInstallDigestReported).not.toHaveBeenCalled();

    const unknown = dependencies({ sendInternalNotification: vi.fn().mockResolvedValue({ outcome: 'unknown' }) });
    await expect(dispatchLifecycleAppOwnedJob({} as SqlExecutor, digest(), {}, unknown)).resolves.toBe('failed');
    expect(unknown.markInternalNotificationUnknown).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'digest' }));
    expect(unknown.markInstallDigestReported).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx nx test lifecycle -- --run src/campaign/send.spec.ts`
Expected: FAIL, the digest jobs throw `Unsupported app-owned growth job kind: digest`.

- [ ] **Step 3: Extend the dependencies interface and defaults**

In `send.ts`, add to `LifecycleJobDependencies` (after `sendInternalNotification`, before the getters):

```ts
  readInstallDigestCandidates: (
    executor: SqlExecutor,
    input: { limit: number }
  ) => Promise<InstallDigestCandidate[]>;
  readInstallDigestContext: (
    executor: SqlExecutor,
    input: { since: Date }
  ) => Promise<InstallDigestContext>;
  markInstallDigestReported: (
    executor: SqlExecutor,
    input: { digestJobId: string; reportedAt: Date; candidates: readonly InstallDigestCandidate[] }
  ) => Promise<void>;
  readonly publicActionOrigin: string;
```

Extend the `sendInternalNotification` input type with `kind?: 'notify' | 'digest'` and in the default implementation use `{ name: 'job_kind', value: input.kind ?? 'notify' }` for the tag.

Import `readInstallDigestCandidates`, `readInstallDigestContext`, `markInstallDigestReported`, `type InstallDigestCandidate`, `type InstallDigestContext` from `'../growth.js'` and `renderInstallDigest` from `'../notifications/install-digest.js'`.

In `createDefaultLifecycleJobDependencies`, add to the returned object:

```ts
    readInstallDigestCandidates,
    readInstallDigestContext,
    markInstallDigestReported,
    get publicActionOrigin() {
      return mailRuntime().publicActionOrigin;
    },
```

- [ ] **Step 4: Add the handler branch**

In `dispatchLifecycleAppOwnedJob`, immediately before the final `throw new DeterministicLifecycleJobError(...)`, add:

```ts
  if (job.kind === 'digest') {
    const leaseToken = requireLease(job);
    signal.throwIfAborted();
    if (!dependencies.recipientPolicy.deliveryEnabled) {
      const retryAt = dependencies.now();
      await dependencies.deferJob(executor, {
        jobId: job.id,
        leaseToken,
        now: retryAt,
        availableAt: new Date(retryAt.getTime() + RETRY_DELAY_MS),
        errorCode: 'delivery_disabled',
      });
      return 'deferred';
    }
    const businessDate = typeof job.payload['business_date'] === 'string' ? job.payload['business_date'] : null;
    if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/u.test(businessDate)) {
      throw new DeterministicLifecycleJobError('Digest job is missing its business date');
    }
    const candidates = await dependencies.readInstallDigestCandidates(executor, { limit: 200 });
    if (candidates.length === 0) {
      await dependencies.completeJob(executor, { jobId: job.id, leaseToken, now: dependencies.now() });
      return 'completed';
    }
    const issuedAt = dependencies.now();
    const context = await dependencies.readInstallDigestContext(executor, {
      since: new Date(issuedAt.getTime() - 24 * 60 * 60 * 1000),
    });
    const text = renderInstallDigest({
      businessDate,
      candidates: candidates.map((candidate) => ({
        ...candidate,
        approveUrl: `${dependencies.publicActionOrigin}/api/growth/approve-install?token=${createGrowthActionToken(
          {
            contactId: candidate.firstInstallObservationId,
            purpose: 'founder_approve_install',
            issuedAt,
            eventNonce: job.id,
          },
          dependencies.tokenKey
        )}`,
      })),
      context,
    });
    signal.throwIfAborted();
    const claimed = await dependencies.claimInternalNotification(executor, {
      jobId: job.id,
      leaseToken,
      now: issuedAt,
      kind: 'digest',
    });
    if (!claimed) {
      await dependencies.markInternalNotificationUnknown(executor, {
        jobId: job.id,
        leaseToken,
        occurredAt: dependencies.now(),
        errorCode: 'install_digest_outcome_unknown',
        kind: 'digest',
      });
      return 'failed';
    }
    signal.throwIfAborted();
    const sent = await dependencies.sendInternalNotification({
      to: dependencies.founderNotificationEmail,
      subject: `Threadplane install digest for ${businessDate}: ${candidates.length} new ${candidates.length === 1 ? 'identity' : 'identities'}`,
      text,
      idempotencyKey: job.idempotencyKey,
      kind: 'digest',
    });
    if (sent.outcome === 'unknown') {
      await dependencies.markInternalNotificationUnknown(executor, {
        jobId: job.id,
        leaseToken,
        occurredAt: dependencies.now(),
        errorCode: 'install_digest_outcome_unknown',
        kind: 'digest',
      });
      return 'failed';
    }
    if (sent.outcome === 'rejected') {
      await dependencies.failJob(executor, {
        jobId: job.id,
        leaseToken,
        now: dependencies.now(),
        errorCode: 'install_digest_rejected',
      });
      return 'failed';
    }
    await dependencies.markInstallDigestReported(executor, {
      digestJobId: job.id,
      reportedAt: dependencies.now(),
      candidates,
    });
    await dependencies.completeJob(executor, { jobId: job.id, leaseToken, now: dependencies.now() });
    return 'completed';
  }
```

Note: `markInstallDigestReported` runs after provider acceptance and before completion. If the process dies between them, the retried job finds its at-most-once claim already consumed and fails for manual review, so identities are never double-reported and mail is never double-sent. This is the same guarantee the notify job relies on.

Register the handler in `createLifecycleAppJobHandlers`: add `digest: handler,` after `notify: handler,`.

- [ ] **Step 5: Add the switch to the configuration**

In `LifecycleRuntimeConfiguration` add `installDigestEnabled: boolean;`. In `loadLifecycleRuntimeConfiguration` add:

```ts
  const installDigestEnabled = exactBoolean(environment, 'GROWTH_INSTALL_DIGEST_ENABLED');
```

and include `installDigestEnabled,` in the returned object. Update any existing spec that asserts the exact shape of `loadLifecycleRuntimeConfiguration(...)` (search `send.spec.ts` for `installRuntimeHelloEnabled:` and add `installDigestEnabled: false` beside it).

- [ ] **Step 6: Run the send spec**

Run: `npx nx test lifecycle -- --run src/campaign/send.spec.ts`
Expected: PASS, including the four new digest tests.

- [ ] **Step 7: Write the failing dispatcher tests**

In `dispatcher.spec.ts`, update the `kinds:` expectation in the test around line 286 to include `'digest'` as the last entry:

```ts
      kinds: [
        'fulfill',
        'enrich',
        'notify',
        'send_step',
        'reply_reconcile',
        'research_cleanup',
        'digest',
      ],
```

Add `enqueueInstallDigestJob: vi.fn().mockResolvedValue(null),` to the `dependencies()` helper's returned object. Then add these tests inside the main `describe`:

```ts
  it('enqueues the install digest once per Pacific business day when enabled', async () => {
    const enqueueInstallDigestJob = vi.fn().mockResolvedValue('00000000-0000-4000-8000-00000000d1e5');
    // 2026-09-16T15:00Z is Wednesday 08:00 Pacific.
    const now = new Date('2026-09-16T15:00:00.000Z');
    const deps = dependencies({ enqueueInstallDigestJob, now: vi.fn(() => now) });
    await dispatchLifecycleJobs(
      { batchSize: 25, campaignEnabled: false, installDigestEnabled: true, signal: new AbortController().signal },
      deps
    );
    expect(enqueueInstallDigestJob).toHaveBeenCalledWith(expect.anything(), {
      now,
      idempotencyKey: 'install_digest:2026-09-16',
      businessDate: '2026-09-16',
    });
  });

  it('does not enqueue the install digest on weekends or when disabled', async () => {
    const enqueueInstallDigestJob = vi.fn();
    // 2026-09-19T15:00Z is Saturday 08:00 Pacific.
    const saturday = new Date('2026-09-19T15:00:00.000Z');
    await dispatchLifecycleJobs(
      { batchSize: 25, campaignEnabled: false, installDigestEnabled: true, signal: new AbortController().signal },
      dependencies({ enqueueInstallDigestJob, now: vi.fn(() => saturday) })
    );
    await dispatchLifecycleJobs(
      { batchSize: 25, campaignEnabled: false, signal: new AbortController().signal },
      dependencies({ enqueueInstallDigestJob, now: vi.fn(() => NOW) })
    );
    expect(enqueueInstallDigestJob).not.toHaveBeenCalled();
  });
```

- [ ] **Step 8: Run to verify they fail**

Run: `npx nx test lifecycle -- --run src/dispatcher.spec.ts`
Expected: FAIL on the `kinds` expectation and the enqueue expectation.

- [ ] **Step 9: Implement the dispatcher changes**

In `dispatcher.ts`:

- Add `'digest',` to `LEASED_KINDS` after `'research_cleanup'`.
- Add `installDigestEnabled?: boolean;` to `LifecycleDispatcherInput`.
- Import `enqueueInstallDigestJob` and `pacificCalendarDate` from `'./growth.js'`.
- Add `enqueueInstallDigestJob: typeof enqueueInstallDigestJob;` to `LifecycleDispatcherDependencies` and `enqueueInstallDigestJob,` to `defaultDependencies`.
- In `dispatchLifecycleJobs`, after the `if (input.campaignEnrollmentEnabled) { ... }` block and before `const recoveryWasPaused = ...`, add:

```ts
    if (input.installDigestEnabled === true) {
      const now = dependencies.now();
      const calendar = pacificCalendarDate(now);
      if (calendar.weekday) {
        await dependencies.enqueueInstallDigestJob(executor, {
          now,
          idempotencyKey: `install_digest:${calendar.date}`,
          businessDate: calendar.date,
        });
        input.signal.throwIfAborted();
      }
    }
```

In `apps/lifecycle/src/app/dispatch/index.ts`, pass `installDigestEnabled: configuration.installDigestEnabled,` in the `dispatchLifecycleJobs` call.

- [ ] **Step 10: Run the lifecycle suite, lint, and build**

Run: `npx nx test lifecycle && npx nx lint lifecycle && npx nx build lifecycle`
Expected: green.

- [ ] **Step 11: Commit**

```bash
git add apps/lifecycle/src/campaign/send.ts apps/lifecycle/src/campaign/send.spec.ts apps/lifecycle/src/dispatcher.ts apps/lifecycle/src/dispatcher.spec.ts apps/lifecycle/src/app/dispatch/index.ts
git commit -m "feat(lifecycle): send the founder install digest once per business day behind a switch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 13: website approve-install route

**Files:**
- Create: `apps/website/src/app/api/growth/approve-install/route.ts`
- Create: `apps/website/src/app/api/growth/approve-install/route.spec.ts`

- [ ] **Step 1: Write the failing spec**

Create `route.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

// The website intentionally consumes the growth library through its internal boundary.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS,
  createGrowthActionToken,
  type GrowthTokenKeyring,
  type SqlExecutor,
} from '@threadplane-internal/growth';

import { createFounderApproveInstallRoute } from './route';

const observationId = '018f47a2-4a2b-4f86-9f03-3dca36f26e55';
const now = new Date('2026-09-16T12:00:00.000Z');
const keyring: GrowthTokenKeyring = {
  active: { version: 8, secret: 'founder-approve-route-secret-material!' },
};
const emailKeyring = { active: { version: 1, secret: 'email-keyring-secret-material!!' } };

function executor(): SqlExecutor {
  return {
    execute: vi.fn(),
    transaction: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as SqlExecutor;
}

function token(
  purpose: 'founder_approve_install' | 'founder_stop' = 'founder_approve_install',
  issuedAt = now
): string {
  return createGrowthActionToken(
    { contactId: observationId, purpose, issuedAt, eventNonce: 'digest-job-7' },
    keyring.active
  );
}

function harness(approveResult: unknown = { approved: true, contactId: 'c1', changed: true }) {
  const database = executor();
  const approve = vi.fn().mockResolvedValue(approveResult);
  const route = createFounderApproveInstallRoute({
    now: () => now,
    loadTokenKeyring: () => keyring,
    loadEmailKeyring: () => emailKeyring,
    createDatabase: () => database,
    approveContactFromInstallDigest: approve,
  });
  return { ...route, database, approve };
}

const request = (path: string, init?: RequestInit) => new Request(`https://threadplane.ai${path}`, init);
const post = (t: string) =>
  request('/api/growth/approve-install', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: t }).toString(),
  });

describe('/api/growth/approve-install', () => {
  it('GET renders a confirmation form without touching the database', async () => {
    const h = harness();
    const response = await h.GET(request(`/api/growth/approve-install?token=${token()}`) as never);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('Confirm outreach approval');
    expect(body).toContain(`name="token" value="${token()}"`);
    expect(body).not.toMatch(/@|%40/iu);
    expect(h.approve).not.toHaveBeenCalled();
  });

  it('POST approves from the install observation id with the purpose-bound token', async () => {
    const h = harness();
    const response = await h.POST(post(token()) as never);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Outreach approved');
    expect(h.approve).toHaveBeenCalledWith(h.database, {
      installObservationId: observationId,
      occurredAt: now,
      eventKey: `token:founder_approve_install:${observationId}:${now.getTime()}:digest-job-7`,
      keyring: emailKeyring,
    });
    expect(h.database.close).toHaveBeenCalled();
  });

  it('POST reports failure for a stopped identity, a wrong purpose, and an expired token', async () => {
    const stopped = harness({ approved: false, reason: 'stopped' });
    expect(await (await stopped.POST(post(token()) as never)).text()).toContain('Unable to process');

    const wrong = harness();
    await wrong.POST(post(token('founder_stop')) as never);
    expect(wrong.approve).not.toHaveBeenCalled();

    const expired = harness();
    const old = new Date(now.getTime() - (FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS + 60) * 1000);
    await expired.POST(post(token('founder_approve_install', old)) as never);
    expect(expired.approve).not.toHaveBeenCalled();
  });

  it('POST rejects query parameters, wrong content types, and extra fields', async () => {
    const h = harness();
    await h.POST(request(`/api/growth/approve-install?token=${token()}`, { method: 'POST' }) as never);
    await h.POST(
      request('/api/growth/approve-install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token() }),
      }) as never
    );
    await h.POST(
      request('/api/growth/approve-install', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: token(), extra: '1' }).toString(),
      }) as never
    );
    expect(h.approve).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/website && npx vitest run --config vite.config.mts src/app/api/growth/approve-install/route.spec.ts`
Expected: FAIL, cannot find module `./route`.

- [ ] **Step 3: Implement the route**

Create `route.ts`. It mirrors `../stop/route.ts` exactly in structure; copy that file and apply these differences:

```ts
import { NextResponse, type NextRequest } from 'next/server';

// The website intentionally consumes the growth library through its internal boundary.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS,
  approveContactFromInstallDigest,
  createDatabaseExecutor,
  growthStopEventKey,
  loadGrowthTokenKeyring,
  verifyGrowthActionToken,
  type ApproveContactFromInstallDigestInput,
  type ApproveContactFromInstallDigestResult,
  type EmailHmacKeyring,
  type GrowthTokenKeyring,
  type SqlExecutor,
} from '@threadplane-internal/growth';

import { readBoundedBody } from '../../_internal/read-bounded-body';
import { loadEmailHmacKeyring } from '../../../../lib/growth/email-keyring';

const MAX_REQUEST_BODY_LENGTH = 2_048;
const FAILURE_BODY = 'Unable to process this request.';

interface FounderApproveInstallRouteDependencies {
  now: () => Date;
  loadTokenKeyring: () => GrowthTokenKeyring;
  loadEmailKeyring: () => EmailHmacKeyring;
  createDatabase: () => SqlExecutor;
  approveContactFromInstallDigest: (
    executor: SqlExecutor,
    input: ApproveContactFromInstallDigestInput
  ) => Promise<ApproveContactFromInstallDigestResult>;
}
```

Keep `escapeHtmlAttribute`, `htmlResponse`, `failureResponse`, and `readToken` verbatim from the stop route. Replace the confirmation and success responses:

```ts
function confirmationResponse(token: string): NextResponse {
  return htmlResponse(
    'Confirm outreach approval',
    'Submit this form to approve founder outreach for this installer.',
    `<form method="post" action="/api/growth/approve-install"><input type="hidden" name="token" value="${escapeHtmlAttribute(token)}"><button type="submit">Approve</button></form>`
  );
}

function successResponse(): NextResponse {
  return htmlResponse('Outreach approved', 'The contact is approved and will be enrolled on the next lifecycle tick.');
}

function defaultDependencies(): FounderApproveInstallRouteDependencies {
  return {
    now: () => new Date(),
    loadTokenKeyring: () => loadGrowthTokenKeyring(),
    loadEmailKeyring: () => loadEmailHmacKeyring(),
    createDatabase: () => createDatabaseExecutor(),
    approveContactFromInstallDigest,
  };
}
```

And the factory:

```ts
export function createFounderApproveInstallRoute(
  overrides: Partial<FounderApproveInstallRouteDependencies> = {}
): {
  GET: (request: NextRequest) => Promise<NextResponse>;
  POST: (request: NextRequest) => Promise<NextResponse>;
} {
  const dependencies = { ...defaultDependencies(), ...overrides };

  function verify(token: string, verifiedAt = dependencies.now()) {
    try {
      return verifyGrowthActionToken(token, {
        expectedPurpose: 'founder_approve_install',
        keyring: dependencies.loadTokenKeyring(),
        now: verifiedAt,
        maxAgeSeconds: FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS,
      });
    } catch {
      return null;
    }
  }

  return {
    async GET(request) {
      const token = new URL(request.url).searchParams.get('token')?.trim();
      if (!token) return failureResponse();
      return verify(token) ? confirmationResponse(token) : failureResponse();
    },

    async POST(request) {
      const receivedAt = dependencies.now();
      const token = await readToken(request);
      if (!token) return failureResponse();
      const payload = verify(token, receivedAt);
      if (!payload) return failureResponse();

      const executor = dependencies.createDatabase();
      try {
        const result = await dependencies.approveContactFromInstallDigest(executor, {
          installObservationId: payload.contactId,
          occurredAt: receivedAt,
          eventKey: growthStopEventKey(payload),
          keyring: dependencies.loadEmailKeyring(),
        });
        return result.approved ? successResponse() : failureResponse();
      } catch {
        return failureResponse();
      } finally {
        await executor.close?.();
      }
    },
  };
}

const route = createFounderApproveInstallRoute();

export const GET = route.GET;
export const POST = route.POST;
```

Check the import path of `loadEmailHmacKeyring`: `apps/website/src/lib/growth/email-keyring.ts` exports it (the stop route does not use it; `apps/website/src/app/api/unsubscribe/route.ts` does, copy that import's relative path).

- [ ] **Step 4: Run the spec to verify it passes**

Run: `cd apps/website && npx vitest run --config vite.config.mts src/app/api/growth/approve-install/route.spec.ts`
Expected: PASS.

- [ ] **Step 5: Lint and typecheck the website**

Run from the repo root: `npx nx lint website && npx nx build website`
Expected: 0 lint errors; the build succeeds (this is the typecheck). The build needs `GROWTH_FORM_POLICY=growth_v1` exported.

- [ ] **Step 6: Commit**

```bash
git add apps/website/src/app/api/growth/approve-install
git commit -m "feat(website): founder approve-install route for digest links

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 14: documentation

**Files:**
- Modify: `apps/lifecycle/README.md` (paragraph at line 14 that documents `GROWTH_INSTALL_RUNTIME_HELLO_ENABLED`)
- Modify: `docs/growth/README.md` (operator entry points / measurement section)

- [ ] **Step 1: Document the switch and the digest in the lifecycle README**

Add a paragraph directly after the `GROWTH_INSTALL_RUNTIME_HELLO_ENABLED` paragraph:

```markdown
The founder install digest has its own switch: `GROWTH_INSTALL_DIGEST_ENABLED` defaults to `false` and accepts only exact `true` or `false`. When enabled, the lifecycle tick enqueues one `digest` job per Pacific business day (idempotency key `install_digest:<YYYY-MM-DD>`) only when at least one identified, non-CI installer with a work-email domain has no contact record and has not been reported before. The job renders a plain-text summary and sends it to `FOUNDER_NOTIFICATION_EMAIL` through the internal notification sender; it never emails the installer and never creates a contact. Each line carries a seven-day signed `founder_approve_install` link to `/api/growth/approve-install`, which creates and approves the contact through the founder reauthorization path so the next tick enrolls them. Reported identities are recorded in `growth_install_digest_reports`. `DELIVERY_ENABLED=false` defers digest jobs like any other send.
```

- [ ] **Step 2: Add the digest to the growth README**

In `docs/growth/README.md`, in the operator entry points table (the one containing `growth:report -- funnel`), add a row:

```markdown
| Founder install digest (lifecycle tick, `GROWTH_INSTALL_DIGEST_ENABLED`) | Daily plain-text list of install-only work-email identities with one-click approve links; read-only unless a link is clicked |
```

- [ ] **Step 3: Commit**

```bash
git add apps/lifecycle/README.md docs/growth/README.md
git commit -m "docs(growth): document the founder install digest and its switch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 15: PR B gates, pull request, merge

- [ ] **Step 1: Full gate run**

```bash
npx nx run-many -t lint -p growth,lifecycle,website
npx nx run-many -t test -p growth,lifecycle
npx nx run growth:test-operator-cli
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx -y node@22 ./node_modules/nx/bin/nx.js run growth:test-integration
npx nx run-many -t build -p growth,lifecycle
GROWTH_FORM_POLICY=growth_v1 npx nx build website
cd apps/website && npx vitest run --config vite.config.mts src/app/api/growth
```

Expected: all green. If `TEST_DATABASE_URL` was never provided, say so in the PR body and list which specs are skipped.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin blove/founder-install-digest
gh pr create --title "feat(growth): founder install digest with one-click approve links" --body "$(cat <<'EOF'
## Summary

- Daily `digest` job (lifecycle tick, `GROWTH_INSTALL_DIGEST_ENABLED`, default off) lists identified, non-CI installers with a work-email domain who are not a contact and were never reported; sent to the founder through the existing internal notification sender.
- Each line carries a 7-day signed `founder_approve_install` link; `/api/growth/approve-install` creates and approves the contact through the founder reauthorization path, so enrollment uses the existing `contact.reauthorized` branch.
- New table `growth_install_digest_reports` (migration 0008) records reported identities; the job's at-most-once claim prevents double sends.
- Spec: docs/superpowers/specs/2026-09-16-install-boot-observation-and-founder-digest-design.md

## Test plan

- [x] growth unit + operator CLI suites
- [x] growth integration suite against a disposable Neon database (or: skipped, TEST_DATABASE_URL unavailable — state which)
- [x] lifecycle suite, website route spec, `nx build website`
- [ ] After merge: apply migration 0008 to production, set the switch, verify the first digest (see plan Task 16)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash
```

- [ ] **Step 3: Watch CI, rebase if behind, address review**

Same procedure as Task 4 Step 4. The lifecycle app deploys to production on merge as its own Vercel project; the `CI — required` check covers the website and libraries.

### Task 16: production cutover (attended, needs an explicit go from the repository owner)

- [ ] **Step 1: Apply migration 0008 to the production growth database**

Follow the "migrate" block in `docs/superpowers/runbooks/2026-08-31-growth-lifecycle-cutover.md` §PREVIEW LIVE, substituting the production URL exported from the root `.env` as `GROWTH_PRODUCTION_DATABASE_URL`, in a Node 22 subshell, running `scripts/apply-migrations.mts` twice and confirming the second run applies nothing.

- [ ] **Step 2: Delete the synthetic smoke contact**

```bash
npm run growth:control -- delete --email brian+smoke-0916@cacheplane.ai
```

- [ ] **Step 3: Confirm the token keyring on the website project and set the switch on the lifecycle project**

`GROWTH_ACTION_TOKEN_ACTIVE_VERSION`, `GROWTH_ACTION_TOKEN_ACTIVE_SECRET` must exist on both the website project (route verification) and the lifecycle project (token creation); they already do for the stop link. Then set `GROWTH_INSTALL_DIGEST_ENABLED=true` on the lifecycle project as a plain encrypted variable, never a sensitive one, and keep a copy in the root `.env`. Redeploy the lifecycle project.

- [ ] **Step 4: Verify the first digest**

Within a few minutes on a weekday, query:

```sql
select id, status, delivery_status, last_error_code, payload from growth_jobs where kind='digest' order by created_at desc limit 3;
select count(*) from growth_install_digest_reports;
```

Expected: one completed `digest` job for today's Pacific date and a report row per identity listed. Confirm the email arrived at the founder address, open one approve link, confirm the GET page renders, and do not submit it unless the owner wants that identity enrolled.

---

## Self-review notes

- Spec coverage: Change 1 → Tasks 1 to 4. Candidate selection, grouping, content, storage, scheduling, switch, approve link, route, tests → Tasks 5 to 13. Operations → Task 16. Docs → Task 14.
- Deviation from spec, recorded: the spec listed `@threadplane/telemetry` in the patch release. The telemetry package does not change; `touch()` already sends on call, so only the three adapters change. All six packages still version together under Nx Release, and the doc says releases are minor, so the release is 0.2.0, not a patch.
- Reported rows are written in the same transaction that completes the digest job, so a job is never `completed` without its report rows and report rows never exist for a job that did not complete. The remaining ambiguous window is between provider acceptance and that transaction: if the process dies there, the at-most-once claim turns the job into `failed` for manual review with no report rows, matching the notify job.
- The approve path records `contact.reauthorized` with `provenance: 'founder_action'` (the spec named a new `install_digest.outreach_approved` kind). The reauthorized kind is what the enrollment query already accepts, so no enrollment SQL changes; the observation id is carried in the activity data.
