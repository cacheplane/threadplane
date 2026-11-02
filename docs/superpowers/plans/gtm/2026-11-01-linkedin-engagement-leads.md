# LinkedIn Engagement Leads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn LinkedIn notification emails delivered to a dedicated Resend address into a reviewed lead queue in Neon, with a deny list, a daily heads-up email with signed reject/deny links, an operator CLI, and a `/week` drafting step, without the system ever sending anything to a lead.

**Architecture:** The website's Resend inbound webhook branches on recipient: the existing reply address keeps today's flow, the new ingest address runs a LinkedIn ingest path inline (receipt, fetch, parse, deny check, lead/engagement writes, forwarding of non-notification mail). Lifecycle only reads the lead tables: it enqueues and sends a daily digest job and scrubs raw mail after 30 days. All LinkedIn code lives in `libs/growth/src/lib/linkedin/`. The parser is a typed stub until redacted `.eml` fixtures exist.

**Tech Stack:** TypeScript, Neon Postgres via `@neondatabase/serverless`, vitest (growth, lifecycle, website), Next.js route handlers, tsx CLI scripts, Nx.

**Spec:** `docs/superpowers/specs/gtm/2026-10-31-linkedin-engagement-leads-design.md`

## Global Constraints

- Migrations under `migrations/`, next number `0012`, file pattern `^\d{4,}_[a-z0-9]+(?:[-_][a-z0-9]+)*\.sql$`.
- Switches follow the exact-string convention: `GROWTH_LINKEDIN_INGEST_ENABLED` and `GROWTH_LINKEDIN_FORWARD_NOTIFICATIONS` accept only exact `true` or `false` (unset means `false`); any other value throws.
- `GROWTH_LINKEDIN_INGEST_ADDRESS` is required when ingest is enabled, lowercased, must be an address on `threadplane.ai`, and must differ from `INBOX_ADDRESS` (`brian@threadplane.ai`).
- Competitor names never enter the repository: no deny-list contents, seed files, or fixtures with real names. Tests use placeholder values such as `acme`.
- Comment text and lead identity stay in Neon. Nothing in this plan emits PostHog events; operator alerts carry codes only.
- Drop rows (`growth_linkedin_drops`) never store actor identity.
- The system never sends email, DMs, or anything else to a lead. The only outbound mail is to `INBOX_FORWARD_TO` / `FOUNDER_NOTIFICATION_EMAIL`.
- Lead ids are UUID v4 (`gen_random_uuid()`), so `createGrowthActionToken`'s `contactId` slot carries them unchanged.
- Growth SQL statements start with a `/* growth:<marker> */` comment so `executorWith` in `libs/growth/src/lib/inbox-test-support.ts` can route them in unit tests.
- Every imported growth module path inside `libs/growth` uses the `.ts` extension (existing convention).
- Do not open a PR or push in this work; commit per task.

## Review Focus

1. A Resend `email.received` event addressed to both the reply address and the ingest address: the reply flow must win and ingest must not double-admit. Pinned in Task 6 (`admitLinkedInReceipt` returns null when `to` includes `INBOX_ADDRESS`).
2. The same provider id delivered twice (Resend retry after a 503): no duplicate lead, engagement, or forward. Pinned in Task 6 (admit is `on conflict do nothing`; process returns early when status is not `pending`; forward reuses `forward_provider_id`).
3. A signed decide link clicked twice, or after the lead was already approved in the session: second click is a no-op that still renders success; an `approved` lead is never flipped to `rejected` by a link. Pinned in Task 5 (`decideLead` returns `already_decided`) and Task 8 (route treats it as success).
4. A deny row added after a lead exists: `decide --approve` refuses, and the next digest omits the lead. Pinned in Task 5 (`decideLead` re-checks deny) and Task 9 (digest query excludes leads matching active deny rows).
5. A LinkedIn sign-in code arriving while the Resend read key or sending key is broken: the receipt stays `pending` with `forward_required = true`, the webhook returns 503 so Resend retries, and the tick raises `linkedin_forward_failed` when such receipts are older than 15 minutes. Pinned in Task 6 and Task 10.

---

## File map

Create:

- `migrations/0012_growth_linkedin_leads.sql`
- `libs/growth/src/lib/linkedin/config.ts` (+ `.spec.ts`): switch loading.
- `libs/growth/src/lib/linkedin/normalize.ts` (+ `.spec.ts`): profile URL, company name, headline heuristics, ICP scoring inputs.
- `libs/growth/src/lib/linkedin/parser.ts` (+ `.spec.ts`): typed interface and stub.
- `libs/growth/src/lib/linkedin/deny.ts` (+ `.spec.ts`): deny list CRUD, matching, drops.
- `libs/growth/src/lib/linkedin/leads.ts` (+ `.spec.ts`): posts, leads, engagements, scoring, decisions, deletion, listing.
- `libs/growth/src/lib/linkedin/receipts.ts` (+ `.spec.ts`): admit, process, forward, scrub.
- `libs/growth/src/lib/linkedin/digest.ts` (+ `.spec.ts`): digest candidates, context, enqueue, mark sent, forward backlog.
- `libs/growth/src/lib/linkedin/index.ts`: barrel.
- `apps/lifecycle/src/notifications/linkedin-digest.ts` (+ `.spec.ts`): plain-text renderer.
- `apps/website/src/app/api/growth/linkedin-decide/route.ts` (+ `route.spec.ts`).
- `scripts/growth-linkedin.mts` (+ `scripts/growth-linkedin.spec.ts`).
- `libs/growth/test/linkedin.integration.spec.ts` (schema smoke, runs only with a database; not part of this plan's verification).

Modify:

- `libs/growth/src/index.ts`: `export * from './lib/linkedin/index.ts';`
- `libs/growth/src/lib/tokens.ts`: purpose `founder_linkedin_decide`, `FOUNDER_LINKEDIN_DECIDE_TOKEN_MAX_AGE_SECONDS`.
- `libs/growth/vite.operator-cli.config.mts`: include `scripts/growth-linkedin.spec.ts`.
- `apps/website/src/app/api/webhooks/resend-inbound/route.ts` (+ spec): recipient branch.
- `apps/lifecycle/src/campaign/send.ts`: `linkedInIngestEnabled` in runtime configuration; digest job branch on `payload.digest_kind`.
- `apps/lifecycle/src/dispatcher.ts` (+ spec): LinkedIn tick step and alerts.
- `apps/lifecycle/src/app/dispatch/index.ts`: pass the switch.
- `package.json`: `"growth:linkedin": "tsx --env-file=.env scripts/growth-linkedin.mts"`.
- `.env.example`: `GROWTH_DATABASE_URL_PREVIEW`, `GROWTH_DATABASE_URL_PRODUCTION`.
- `marketing/cowork/week/SKILL.md`: LinkedIn leads step and allowed tool.
- `apps/lifecycle/README.md`, `docs/growth/README.md`: switches, CLI, rollout.

---

### Task 1: Schema migration

**Files:**
- Create: `migrations/0012_growth_linkedin_leads.sql`
- Test: `libs/growth/test/linkedin.integration.spec.ts` (database-only; written, not run here)

**Interfaces:**
- Produces: the tables below; every later task's SQL targets these names.

- [x] **Step 1: Write the migration**

Tables, in this order (lowercase SQL like `0008`/`0009`):

```sql
create table growth_linkedin_posts (
  id uuid primary key default gen_random_uuid(),
  urn text unique,                       -- urn:li:activity:... or urn:li:share:...
  url text,
  marketing_post_id uuid references marketing_posts(id),
  first_seen_at timestamptz not null,
  check (urn is not null or url is not null)
);
create unique index growth_linkedin_posts_url on growth_linkedin_posts(url) where url is not null;

create table growth_linkedin_receipts (
  id text primary key,                   -- Resend email id
  recipient text not null,
  received_at timestamptz not null,
  source text not null default 'email' check (source in ('email','manual')),
  status text not null default 'pending' check (status in ('pending','parsed','unparsed')),
  kind text check (kind in ('comment','reply','reaction','repost','mention')),
  unparsed_reason text,
  sender text,
  headers jsonb,
  raw_subject text,
  raw_text text,
  raw_html text,
  forward_required boolean not null default false,
  forward_provider_id text,
  attempts integer not null default 0,
  last_error_code text,
  scrubbed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index growth_linkedin_receipts_forward_pending
  on growth_linkedin_receipts(received_at) where forward_required and forward_provider_id is null;
create index growth_linkedin_receipts_retention
  on growth_linkedin_receipts(received_at) where scrubbed_at is null and (raw_text is not null or raw_html is not null);

create table growth_linkedin_leads (
  id uuid primary key default gen_random_uuid(),
  profile_url text not null unique,
  display_name text not null,
  headline text not null default '',
  company_name text,
  source text not null default 'email' check (source in ('email','manual')),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  status text not null default 'new' check (status in ('new','approved','rejected','denied')),
  score integer not null default 0,
  decided_at timestamptz,
  decided_by text,
  approved_variant text check (approved_variant in ('connection','message')),
  approved_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index growth_linkedin_leads_status on growth_linkedin_leads(status, score desc, last_seen_at desc);

create table growth_linkedin_engagements (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references growth_linkedin_leads(id) on delete cascade,
  post_id uuid not null references growth_linkedin_posts(id),
  kind text not null check (kind in ('comment','reply','reaction','repost','mention')),
  comment_text text,
  comment_hash text not null default '',  -- sha256 hex of comment_text, '' when null
  occurred_at timestamptz not null,
  receipt_id text references growth_linkedin_receipts(id),
  created_at timestamptz not null default now(),
  unique (lead_id, post_id, kind, comment_hash)
);

create table growth_linkedin_deny (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('profile_url','company_name','company_domain')),
  value text not null,
  reason text,
  added_by text not null,
  added_at timestamptz not null default now(),
  removed_at timestamptz
);
create unique index growth_linkedin_deny_active on growth_linkedin_deny(kind, value) where removed_at is null;

-- Carries no actor identity by design.
create table growth_linkedin_drops (
  id uuid primary key default gen_random_uuid(),
  receipt_id text not null references growth_linkedin_receipts(id),
  deny_id uuid not null references growth_linkedin_deny(id),
  dropped_at timestamptz not null default now()
);

create table growth_linkedin_digests (
  business_date date primary key,
  job_id uuid not null references growth_jobs(id),
  sent_at timestamptz not null,
  lead_count integer not null,
  unparsed_count integer not null,
  drop_count integer not null,
  ingest_count integer not null
);
```

- [x] **Step 2: Write the integration smoke spec**

`libs/growth/test/linkedin.integration.spec.ts`, modeled on `libs/growth/test/migrations.integration.spec.ts`: after applying migrations, `select to_regclass(...)` for each of the seven tables is non-null, and inserting a drop row without `receipt_id` fails. Skip when `DATABASE_URL` is unset the way sibling integration specs do.

- [x] **Step 3: Verify discovery**

Run: `npx nx test growth -- scripts/apply-migrations.spec.ts`
Expected: PASS (the file-name pattern accepts `0012_growth_linkedin_leads.sql`).

- [x] **Step 4: Commit**

```bash
git add migrations/0012_growth_linkedin_leads.sql libs/growth/test/linkedin.integration.spec.ts
git commit -m "feat(growth): LinkedIn engagement lead tables"
```

---

### Task 2: Switches and normalization helpers

**Files:**
- Create: `libs/growth/src/lib/linkedin/config.ts`, `config.spec.ts`, `normalize.ts`, `normalize.spec.ts`, `index.ts`
- Modify: `libs/growth/src/index.ts`

**Interfaces:**
- Produces:
  - `type LinkedInIngestConfig = { enabled: false } | { enabled: true; address: string; forwardNotifications: boolean }`
  - `loadLinkedInIngestConfig(env: Record<string, string | undefined> = process.env): LinkedInIngestConfig`
  - `normalizeLinkedInProfileUrl(value: string): string | null` → `https://www.linkedin.com/in/<slug>` (lowercased slug, no query, no trailing slash; accepts `linkedin.com`, `www.linkedin.com`, any `<cc>.linkedin.com` host; null otherwise)
  - `normalizeCompanyName(value: string): string` → lowercased, punctuation collapsed to single spaces, legal suffixes `inc`, `llc`, `ltd`, `limited`, `gmbh`, `corp`, `corporation`, `co`, `plc`, `ag`, `sa`, `bv` stripped from the end, trimmed
  - `companyNameFromHeadline(headline: string): string | null` → the phrase after the first ` at ` or ` @ ` up to `|`, `,`, `•`, `·`, `-`, `—`, or end; null when that phrase is preceded by `ex-`, `ex `, `former`, `formerly`, `previously`, or `prev.`; null when no phrase
  - `domainsInText(value: string): string[]` → lowercased unique hostnames found by `/\b([a-z0-9-]+\.)+[a-z]{2,}\b/i`, excluding `linkedin.com` and `lnkd.in`
  - `LINKEDIN_ICP_KEYWORDS: readonly string[]` and `LINKEDIN_NEGATIVE_KEYWORDS: readonly string[]`
  - `headlineSignal(headline: string): 'icp' | 'negative' | 'neutral'` (negative wins over icp)

- [x] **Step 1: Write failing tests** in `config.spec.ts` and `normalize.spec.ts`

```ts
test('ingest is off when unset or false', () => {
  expect(loadLinkedInIngestConfig({})).toEqual({ enabled: false });
  expect(loadLinkedInIngestConfig({ GROWTH_LINKEDIN_INGEST_ENABLED: 'false' })).toEqual({ enabled: false });
});
test('enabled requires a threadplane.ai address distinct from the reply inbox', () => {
  expect(loadLinkedInIngestConfig({ GROWTH_LINKEDIN_INGEST_ENABLED: 'true', GROWTH_LINKEDIN_INGEST_ADDRESS: 'LinkedIn@threadplane.ai' }))
    .toEqual({ enabled: true, address: 'linkedin@threadplane.ai', forwardNotifications: false });
  expect(() => loadLinkedInIngestConfig({ GROWTH_LINKEDIN_INGEST_ENABLED: 'true' })).toThrow();
  expect(() => loadLinkedInIngestConfig({ GROWTH_LINKEDIN_INGEST_ENABLED: 'true', GROWTH_LINKEDIN_INGEST_ADDRESS: 'brian@threadplane.ai' })).toThrow();
  expect(() => loadLinkedInIngestConfig({ GROWTH_LINKEDIN_INGEST_ENABLED: 'yes', GROWTH_LINKEDIN_INGEST_ADDRESS: 'linkedin@threadplane.ai' })).toThrow();
  expect(() => loadLinkedInIngestConfig({ GROWTH_LINKEDIN_INGEST_ENABLED: 'true', GROWTH_LINKEDIN_INGEST_ADDRESS: 'linkedin@threadplane.ai', GROWTH_LINKEDIN_FORWARD_NOTIFICATIONS: '1' })).toThrow();
});
test('profile urls normalize to the canonical in/ form', () => {
  expect(normalizeLinkedInProfileUrl('https://www.linkedin.com/in/Jane-Doe-123/?trk=x')).toBe('https://www.linkedin.com/in/jane-doe-123');
  expect(normalizeLinkedInProfileUrl('http://uk.linkedin.com/in/jane')).toBe('https://www.linkedin.com/in/jane');
  expect(normalizeLinkedInProfileUrl('https://www.linkedin.com/company/acme')).toBeNull();
  expect(normalizeLinkedInProfileUrl('https://example.com/in/jane')).toBeNull();
});
test('company names strip punctuation and legal suffixes', () => {
  expect(normalizeCompanyName('Acme, Inc.')).toBe('acme');
  expect(normalizeCompanyName('Acme Widgets GmbH')).toBe('acme widgets');
});
test('current company comes from at/@ and never from ex- phrasing', () => {
  expect(companyNameFromHeadline('Staff Engineer at Acme | Angular')).toBe('Acme');
  expect(companyNameFromHeadline('CTO @ Acme Widgets, ex-Globex')).toBe('Acme Widgets');
  expect(companyNameFromHeadline('ex-Acme, building things')).toBeNull();
  expect(companyNameFromHeadline('Formerly at Acme')).toBeNull();
  expect(companyNameFromHeadline('Angular developer')).toBeNull();
});
test('headline signal', () => {
  expect(headlineSignal('Principal Angular Engineer')).toBe('icp');
  expect(headlineSignal('Technical Recruiter at Acme')).toBe('negative');
  expect(headlineSignal('Growth hacker | Angular fan')).toBe('negative');
  expect(headlineSignal('Photographer')).toBe('neutral');
});
test('domains in text exclude linkedin hosts', () => {
  expect(domainsInText('CTO at acme.example | linkedin.com/in/x')).toEqual(['acme.example']);
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx nx test growth -- libs/growth/src/lib/linkedin`
Expected: FAIL, modules not found.

- [x] **Step 3: Implement** `config.ts` and `normalize.ts` per the Interfaces block. ICP keywords: `angular`, `langgraph`, `ag-ui`, `a2ui`, `frontend`, `front-end`, `front end`, `staff`, `principal`, `cto`, `vp engineering`, `vp of engineering`, `head of engineering`, `engineering manager`, `architect`, `fintech`, `insurance`, `healthcare`. Negative: `recruiter`, `recruiting`, `talent acquisition`, `headhunter`, `staffing`, `sourcing`, `agency`, `growth hacker`, `lead generation`, `lead gen`, `appointment setting`. Matching is whole-word, case-insensitive. Create `linkedin/index.ts` exporting both modules and add `export * from './lib/linkedin/index.ts';` to `libs/growth/src/index.ts`.

- [x] **Step 4: Run to verify pass**

Run: `npx nx test growth -- libs/growth/src/lib/linkedin`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add libs/growth/src/lib/linkedin libs/growth/src/index.ts
git commit -m "feat(growth): LinkedIn ingest switches and normalization"
```

---

### Task 3: Parser interface and stub

**Files:**
- Create: `libs/growth/src/lib/linkedin/parser.ts`, `parser.spec.ts`
- Modify: `libs/growth/src/lib/linkedin/index.ts`

**Interfaces:**
- Produces:

```ts
export type LinkedInNotificationKind = 'comment' | 'reply' | 'reaction' | 'repost' | 'mention';
export type LinkedInUnparsedReason =
  | 'untrusted_sender' | 'unsupported_kind' | 'no_actor' | 'no_fixtures_yet';
export interface LinkedInActor {
  displayName: string;
  headline: string;            // '' when absent
  profileUrl: string;          // already normalized
  commentText: string | null;  // comments and replies only
}
export interface LinkedInPostReference { urn: string | null; url: string | null }
export interface LinkedInParserInput {
  from: string;                // raw From header value
  subject: string | null;
  text: string | null;
  html: string | null;
  headers: Record<string, string>; // lowercased keys
}
export type LinkedInParseResult =
  | { outcome: 'parsed'; kind: LinkedInNotificationKind; actors: LinkedInActor[];
      post: LinkedInPostReference; aggregateCount: number | null }
  | { outcome: 'unparsed'; reason: LinkedInUnparsedReason };
export type LinkedInParser = (input: LinkedInParserInput) => LinkedInParseResult;
/** Kinds with no redacted fixture yet. Mail of these kinds is `unsupported_kind`. */
export const LINKEDIN_UNSUPPORTED_KINDS: readonly LinkedInNotificationKind[];
export function isTrustedLinkedInSender(input: Pick<LinkedInParserInput, 'from' | 'headers'>): boolean;
export const parseLinkedInNotification: LinkedInParser;
```

- `isTrustedLinkedInSender`: From address (via `inboxSenderAddress`) ends with `@linkedin.com` or a subdomain of `linkedin.com`, **and** `headers['authentication-results']` contains both `spf=pass` and `dkim=pass` (case-insensitive). Anything else is untrusted.
- `parseLinkedInNotification` (stub): returns `{ outcome: 'unparsed', reason: 'untrusted_sender' }` when the sender is untrusted, otherwise `{ outcome: 'unparsed', reason: 'no_fixtures_yet' }`. A module-level comment states that the real parser is written test-first against redacted `.eml` fixtures under `libs/growth/src/lib/linkedin/fixtures/` once Brian supplies samples, lists the fixture redaction rules from the design (names, slugs, comment text, tracking parameters replaced with stable placeholders), and that `LINKEDIN_UNSUPPORTED_KINDS` is currently all five kinds.

- [x] **Step 1: Write failing tests**

```ts
const trusted = { from: 'LinkedIn <notifications-noreply@linkedin.com>', headers: { 'authentication-results': 'mx.example; spf=pass smtp.mailfrom=linkedin.com; dkim=pass header.d=linkedin.com' } };
test('sender trust needs a linkedin.com From and passing spf and dkim', () => {
  expect(isTrustedLinkedInSender(trusted)).toBe(true);
  expect(isTrustedLinkedInSender({ ...trusted, from: 'x@linkedin.com.evil.example' })).toBe(false);
  expect(isTrustedLinkedInSender({ ...trusted, headers: { 'authentication-results': 'spf=pass; dkim=fail' } })).toBe(false);
  expect(isTrustedLinkedInSender({ ...trusted, headers: {} })).toBe(false);
});
test('the stub classifies trusted mail as unparsed with no_fixtures_yet', () => {
  expect(parseLinkedInNotification({ ...trusted, subject: 'x', text: 'y', html: null })).toEqual({ outcome: 'unparsed', reason: 'no_fixtures_yet' });
  expect(parseLinkedInNotification({ from: 'a@example.com', headers: {}, subject: null, text: null, html: null })).toEqual({ outcome: 'unparsed', reason: 'untrusted_sender' });
});
```

- [x] **Step 2: Run to verify failure** (`npx nx test growth -- libs/growth/src/lib/linkedin/parser`). Expected: FAIL.
- [x] **Step 3: Implement** per Interfaces; export from `linkedin/index.ts`.
- [x] **Step 4: Run to verify pass.** Expected: PASS.
- [x] **Step 5: Commit** `feat(growth): LinkedIn notification parser interface and stub`

---

### Task 4: Deny list

**Files:**
- Create: `libs/growth/src/lib/linkedin/deny.ts`, `deny.spec.ts`
- Modify: `libs/growth/src/lib/linkedin/index.ts`

**Interfaces:**
- Consumes: `normalizeLinkedInProfileUrl`, `normalizeCompanyName`, `companyNameFromHeadline`, `domainsInText` (Task 2).
- Produces:

```ts
export type LinkedInDenyKind = 'profile_url' | 'company_name' | 'company_domain';
export interface LinkedInDenyEntry { id: string; kind: LinkedInDenyKind; value: string; reason: string | null; addedBy: string; addedAt: Date; removedAt: Date | null }
/** Normalizes by kind; throws on an unusable value (bad profile URL, empty name, non-hostname). */
export function normalizeDenyValue(kind: LinkedInDenyKind, value: string): string;
export async function addDenyEntry(ex: SqlExecutor, input: { kind: LinkedInDenyKind; value: string; reason?: string; addedBy: string }): Promise<{ id: string; created: boolean }>;  // marker growth:linkedin-deny-add; on conflict (active) do nothing, returns existing id with created:false
export async function removeDenyEntry(ex: SqlExecutor, input: { kind: LinkedInDenyKind; value: string }): Promise<boolean>; // marker growth:linkedin-deny-remove; sets removed_at on the active row
export async function listDenyEntries(ex: SqlExecutor, input?: { includeRemoved?: boolean }): Promise<LinkedInDenyEntry[]>; // marker growth:linkedin-deny-list
export interface DenyProbe { profileUrl: string; headline: string }
/** Returns the first matching active deny id, or null. One query, marker growth:linkedin-deny-match. */
export async function matchDeny(tx: SqlTransaction, probe: DenyProbe): Promise<string | null>;
export async function recordDrop(tx: SqlTransaction, input: { receiptId: string; denyId: string; droppedAt: Date }): Promise<void>; // marker growth:linkedin-drop
```

- `matchDeny` builds candidate values in TypeScript: the normalized profile URL; `domainsInText(headline)` plus the domains of the profile URL slug are not domains, so only headline domains; `normalizeCompanyName(companyNameFromHeadline(headline))` when non-null. It runs one query: `select id from growth_linkedin_deny where removed_at is null and ((kind='profile_url' and value = $1) or (kind='company_domain' and value = any($2::text[])) or (kind='company_name' and value = any($3::text[]))) order by added_at limit 1`. Company-name candidates are the full normalized phrase only (whole-phrase equality, which is the conservative whole-word match the design asks for; "ex-Acme" never produces a candidate because `companyNameFromHeadline` returns null).

- [x] **Step 1: Write failing tests** with `executorWith`:

```ts
test('normalizeDenyValue by kind', () => {
  expect(normalizeDenyValue('profile_url', 'https://linkedin.com/in/Jane/')).toBe('https://www.linkedin.com/in/jane');
  expect(normalizeDenyValue('company_name', 'Acme, Inc.')).toBe('acme');
  expect(normalizeDenyValue('company_domain', 'Acme.Example')).toBe('acme.example');
  expect(() => normalizeDenyValue('profile_url', 'https://example.com/x')).toThrow();
  expect(() => normalizeDenyValue('company_domain', 'not a host')).toThrow();
});
test('matchDeny probes profile url, headline domains and current company only', async () => {
  const { executor, calls } = executorWith({ 'linkedin-deny-match': () => ({ rows: [] }) });
  await executor.transaction((tx) => matchDeny(tx, { profileUrl: 'https://www.linkedin.com/in/jane', headline: 'CTO at Acme Widgets GmbH | acme.example' }));
  expect(calls[0].params).toEqual(['https://www.linkedin.com/in/jane', ['acme.example'], ['acme widgets']]);
});
test('matchDeny sends no company candidate for ex- phrasing', async () => {
  const { executor, calls } = executorWith({ 'linkedin-deny-match': () => ({ rows: [] }) });
  await executor.transaction((tx) => matchDeny(tx, { profileUrl: 'https://www.linkedin.com/in/jane', headline: 'ex-Acme, now independent' }));
  expect(calls[0].params[2]).toEqual([]);
});
test('addDenyEntry reports whether a row was created', async () => { /* rows:[{id}] → created true; rows:[] then select existing → created false */ });
test('recordDrop stores only receipt and deny ids', async () => { /* params equal [receiptId, denyId, droppedAt] */ });
```

- [x] **Step 2: Run to verify failure.** Expected: FAIL.
- [x] **Step 3: Implement** per Interfaces.
- [x] **Step 4: Run to verify pass.** Expected: PASS.
- [x] **Step 5: Commit** `feat(growth): LinkedIn deny list`

---

### Task 5: Leads, posts, engagements, scoring, decisions

**Files:**
- Create: `libs/growth/src/lib/linkedin/leads.ts`, `leads.spec.ts`
- Modify: `libs/growth/src/lib/linkedin/index.ts`

**Interfaces:**
- Consumes: Task 2 helpers, `LinkedInActor`, `LinkedInNotificationKind`, `LinkedInPostReference` (Task 3), `matchDeny` (Task 4).
- Produces:

```ts
export const LINKEDIN_SCORE = { comment: 30, reply: 30, mention: 25, repost: 15, reaction: 5, extraPost: 10, icpHeadline: 20, negativeHeadline: -20 } as const;
export function scoreLead(input: { engagements: { kind: LinkedInNotificationKind; postId: string }[]; headline: string }): number;
/** marker growth:linkedin-post-resolve then growth:linkedin-post-insert. Matches marketing_posts where channel='linkedin' and (result->>'postId' = urn or result->>'url' = url). */
export async function resolvePost(tx: SqlTransaction, ref: LinkedInPostReference, firstSeenAt: Date): Promise<string>; // throws when both urn and url are null
export interface RecordEngagementInput { actor: LinkedInActor; kind: LinkedInNotificationKind; postId: string; occurredAt: Date; receiptId: string | null; source?: 'email' | 'manual' }
export type RecordEngagementResult = { outcome: 'recorded'; leadId: string; created: boolean } | { outcome: 'duplicate'; leadId: string };
/** Upserts the lead (growth:linkedin-lead-upsert), inserts the engagement (growth:linkedin-engagement-insert, on conflict do nothing), recomputes score (growth:linkedin-lead-score). The deny check is the caller's job (receipts.ts). */
export async function recordEngagement(tx: SqlTransaction, input: RecordEngagementInput): Promise<RecordEngagementResult>;
export type LinkedInLeadStatus = 'new' | 'approved' | 'rejected' | 'denied';
export interface LinkedInLeadSummary { id: string; profileUrl: string; displayName: string; headline: string; companyName: string | null; status: LinkedInLeadStatus; score: number; firstSeenAt: Date; lastSeenAt: Date; decidedAt: Date | null; approvedVariant: 'connection' | 'message' | null; approvedText: string | null;
  engagements: { kind: LinkedInNotificationKind; commentText: string | null; occurredAt: Date; postUrn: string | null; postUrl: string | null }[] }
export async function listLeads(ex: SqlExecutor, input: { status?: LinkedInLeadStatus; limit?: number }): Promise<LinkedInLeadSummary[]>; // marker growth:linkedin-leads-list, score desc then last_seen_at desc, default limit 50, max 200
export type DecideLeadInput =
  | { leadId: string; decision: 'approve'; variant: 'connection' | 'message'; text: string; decidedBy: string; now: Date }
  | { leadId: string; decision: 'reject' | 'deny'; decidedBy: string; now: Date };
export type DecideLeadResult = 'applied' | 'already_decided' | 'not_found' | 'denied_by_list';
/** One transaction. approve: text length ≤ 300 for connection, ≤ 600 for message (throws otherwise); re-runs matchDeny and returns 'denied_by_list' (and sets status denied) on a hit. reject/deny from status new|rejected only; approve from status new only; anything else 'already_decided'. deny also inserts deny rows: profile_url, plus company_name when company_name is set (addedBy = decidedBy). */
export async function decideLead(ex: SqlExecutor, input: DecideLeadInput): Promise<DecideLeadResult>;
/** Deletes lead + engagements; drops untouched. marker growth:linkedin-lead-delete. */
export async function deleteLead(ex: SqlExecutor, input: { profileUrl: string }): Promise<boolean>;
```

- `scoreLead`: sum of the kind weights over engagements, plus `extraPost` for each distinct `postId` beyond the first, plus `icpHeadline` when `headlineSignal` is `icp`, plus `negativeHeadline` when it is `negative`.
- `recordEngagement` lead upsert: `insert ... on conflict (profile_url) do update set display_name = excluded.display_name, headline = case when excluded.headline <> '' then excluded.headline else growth_linkedin_leads.headline end, company_name = coalesce(excluded.company_name, growth_linkedin_leads.company_name), last_seen_at = greatest(...), updated_at = now() returning id, (xmax = 0) as created`. Status is not touched by re-engagement. `comment_hash` is `sha256(commentText)` hex, `''` when null.

- [x] **Step 1: Write failing tests**

```ts
test('scoreLead applies the design weights', () => {
  expect(scoreLead({ engagements: [{ kind: 'comment', postId: 'p1' }], headline: '' })).toBe(30);
  expect(scoreLead({ engagements: [{ kind: 'comment', postId: 'p1' }, { kind: 'reaction', postId: 'p2' }], headline: 'Staff Angular Engineer' })).toBe(30 + 5 + 10 + 20);
  expect(scoreLead({ engagements: [{ kind: 'repost', postId: 'p1' }], headline: 'Recruiter' })).toBe(15 - 20);
});
test('resolvePost prefers the marketing queue row and otherwise inserts a bare post', async () => { /* growth:linkedin-post-resolve rows:[{id:'post-1'}] → 'post-1' without insert; rows:[] → insert called with [urn, url, marketingPostId null, firstSeenAt] */ });
test('recordEngagement hashes comment text and reports duplicates', async () => { /* engagement insert returns rows:[] → outcome duplicate; params[3] equals sha256 hex of text; '' for null */ });
test('decideLead approve enforces variant limits and the deny re-check', async () => {
  await expect(decideLead(ex, { leadId, decision: 'approve', variant: 'connection', text: 'x'.repeat(301), decidedBy: 'brian', now })).rejects.toThrow();
  // matchDeny returns an id → result 'denied_by_list' and the lead update sets status denied
});
test('decideLead deny adds profile_url and company_name deny rows', async () => { /* two growth:linkedin-deny-add calls: ['profile_url', url], ['company_name', 'acme'] */ });
test('decideLead returns already_decided for approved leads on reject', async () => { /* lock row status approved → 'already_decided' and no update */ });
```

- [x] **Step 2: Run to verify failure.** Expected: FAIL.
- [x] **Step 3: Implement** per Interfaces (use `createHash('sha256')` from `node:crypto`; lead row lock with `for update` under marker `growth:linkedin-lead-lock`).
- [x] **Step 4: Run to verify pass.** Expected: PASS.
- [x] **Step 5: Commit** `feat(growth): LinkedIn leads, engagements, scoring and decisions`

---

### Task 6: Receipts: admit, process, forward, scrub

**Files:**
- Create: `libs/growth/src/lib/linkedin/receipts.ts`, `receipts.spec.ts`
- Modify: `libs/growth/src/lib/linkedin/index.ts`

**Interfaces:**
- Consumes: `LinkedInIngestConfig` (Task 2), parser types and `isTrustedLinkedInSender` (Task 3), `matchDeny`, `recordDrop` (Task 4), `resolvePost`, `recordEngagement` (Task 5); from existing code `inboxProviderId`, `inboxSenderAddress`, `INBOX_ADDRESS`, `InboxReceivedEmail` (`inbox-replies.ts`), `buildInboxForward`, `INBOX_FORWARD_TO` (`inbox-forward.ts`), `providerIdempotencyKey`, `reserveProviderAttempt`, `completeProviderAttempt` (`provider-attempts.ts`), `nestedExecutor`.
- Produces:

```ts
type EnabledConfig = Extract<LinkedInIngestConfig, { enabled: true }>;
/** Returns the provider id when the event is email.received addressed to config.address and NOT to INBOX_ADDRESS; otherwise null. Inserts a pending receipt (growth:linkedin-receipt-admit, on conflict do nothing). */
export async function admitLinkedInReceipt(ex: SqlExecutor, payload: unknown, config: EnabledConfig): Promise<string | null>;
export interface LinkedInIngestDependencies { getReceived: (id: string) => Promise<InboxReceivedEmail>; parse: LinkedInParser; now: () => Date }
export type LinkedInProcessOutcome = 'parsed' | 'unparsed' | 'already_processed';
export async function processLinkedInReceipt(ex: SqlExecutor, rawId: string, config: EnabledConfig, deps: LinkedInIngestDependencies): Promise<LinkedInProcessOutcome>;
export interface LinkedInForwardDependencies { environment: string; getReceived: (id: string) => Promise<InboxReceivedEmail>; getRaw: (url: string) => Promise<Uint8Array>; send: (payload: ReturnType<typeof buildLinkedInForward>, key: string) => Promise<string>; now?: () => Date }
export function buildLinkedInForward(email: InboxReceivedEmail, raw: Uint8Array, environment: string): ReturnType<typeof buildInboxForward>; // same shape; subject prefix 'Fwd: [LinkedIn] ', job_kind tag 'linkedin_forward', X-Threadplane-Forwarded header
/** Returns the provider id, or null when the receipt needs no forward. Throws when a required forward fails so the webhook returns 503. */
export async function forwardLinkedInReceipt(ex: SqlExecutor, rawId: string, deps: LinkedInForwardDependencies): Promise<string | null>;
export const LINKEDIN_RAW_RETENTION_DAYS = 30;
/** Nulls raw_subject/raw_text/raw_html and sets scrubbed_at for receipts older than 30 days. Returns the count. marker growth:linkedin-receipts-scrub. */
export async function scrubLinkedInReceipts(ex: SqlExecutor, input: { now: Date }): Promise<number>;
/** Builds a synthetic manual receipt + engagements without provider I/O (for CLI ingest with source=manual). */
export async function ingestManualEngagement(ex: SqlExecutor, input: { receiptId: string; receivedAt: Date; kind: LinkedInNotificationKind; actors: LinkedInActor[]; post: LinkedInPostReference }): Promise<{ recorded: number; dropped: number }>;
```

`processLinkedInReceipt` algorithm (the one piece the signature does not determine):

1. Fetch outside any transaction: `email = await deps.getReceived(id)`; verify `email.id === id` and `to` includes `config.address`. Lowercase header keys into `Record<string,string>` (string values only).
2. `result = deps.parse({ from, subject, text, html, headers })`.
3. One transaction (`growth:linkedin-receipt-lock` select ... for update; return `'already_processed'` when status is not `pending`):
   - `trusted = isTrustedLinkedInSender(...)`.
   - If `result.outcome === 'parsed'` and `result.actors.length > 0`: `postId = resolvePost(tx, result.post, receivedAt)`; for each actor: `denyId = matchDeny(tx, {profileUrl, headline})`; hit → `recordDrop`; else `recordEngagement`. Update receipt: `status='parsed', kind, sender, headers, raw_subject/raw_text/raw_html = email values, forward_required = config.forwardNotifications` (`growth:linkedin-receipt-parsed`).
   - Else (`unparsed`, or `parsed` with zero actors → reason `no_actor`): update `status='unparsed', unparsed_reason, sender, headers, forward_required = true`, and raw body columns **only when `trusted`**; untrusted mail stores headers and subject only, `raw_text`/`raw_html` null (`growth:linkedin-receipt-unparsed`).
4. Any failure before the transaction: `growth:linkedin-receipt-failed` increments `attempts`, sets `last_error_code='processing_failed'`, then throw `new Error('LinkedIn receipt processing failed')` (never the provider error).

`forwardLinkedInReceipt`: read receipt (`growth:linkedin-forward-receipt`); if `forward_required` is false → null; if `forward_provider_id` set → return it; check `growth_provider_attempts` for an accepted attempt under key `providerIdempotencyKey(env, 'linkedin-forward:'+id)` and finish with it; loop suppression when `x-threadplane-forwarded` header present or sender is `INBOX_FORWARD_TO` (set `last_error_code='forward_loop_suppressed'`, return null); otherwise fetch, build, `reserveProviderAttempt`, `send`, `completeProviderAttempt`, `update ... set forward_provider_id` (`growth:linkedin-forward-complete`). No erasure check is needed (senders are not contacts).

- [x] **Step 1: Write failing tests** with `executorWith`:

```ts
test('admit ignores events not addressed to the ingest address and defers to the reply inbox when both are listed', async () => {
  expect(await admitLinkedInReceipt(ex, { type: 'email.received', data: { email_id: 'e1', to: ['other@threadplane.ai'], created_at } }, cfg)).toBeNull();
  expect(await admitLinkedInReceipt(ex, { type: 'email.received', data: { email_id: 'e1', to: ['linkedin@threadplane.ai', 'brian@threadplane.ai'], created_at } }, cfg)).toBeNull();
  expect(await admitLinkedInReceipt(ex, { type: 'email.received', data: { email_id: 'e1', to: ['LinkedIn@threadplane.ai'], created_at } }, cfg)).toBe('e1');
});
test('an untrusted sender is stored headers-only and marked for forwarding', async () => { /* receipt-unparsed params: reason 'untrusted_sender', raw_text null, raw_html null, forward_required true */ });
test('a trusted unparsed notification keeps its raw body', async () => { /* parse stub → no_fixtures_yet; raw_text equals email.text; forward_required true */ });
test('a parsed notification writes drops for denied actors and engagements for the rest', async () => {
  // parse returns two actors; deny-match answers an id for the first only
  // expect one growth:linkedin-drop call with [receiptId, denyId, ...] and one growth:linkedin-lead-upsert call
  // receipt-parsed params carry forward_required === cfg.forwardNotifications
});
test('a second delivery of the same receipt is already_processed', async () => { /* lock returns status 'parsed' → 'already_processed', no further writes */ });
test('a provider fetch failure records processing_failed and throws a redacted error', async () => { /* getReceived rejects with 'secret body' → error message is 'LinkedIn receipt processing failed'; receipt-failed call made */ });
test('forward is skipped when not required and reused when already sent', async () => { /* forward_required false → null, send not called; forward_provider_id 'f1' → 'f1' */ });
test('a required forward that fails throws', async () => { /* send rejects → rejects */ });
test('scrub targets receipts older than 30 days', async () => { /* params[0] equals now - 30d */ });
```

- [x] **Step 2: Run to verify failure.** Expected: FAIL.
- [x] **Step 3: Implement** per Interfaces and algorithm.
- [x] **Step 4: Run to verify pass.** Expected: PASS.
- [x] **Step 5: Commit** `feat(growth): LinkedIn receipt admission, processing, forwarding and retention`

---

### Task 7: Webhook recipient branch

**Files:**
- Modify: `apps/website/src/app/api/webhooks/resend-inbound/route.ts`, `route.spec.ts`

**Interfaces:**
- Consumes: Task 6 functions, `loadLinkedInIngestConfig`, `parseLinkedInNotification`, `createInboxRuntime` (`getReceived`, `forwardReceipt` pattern), `downloadInboxRaw`.
- Produces: `InboundDependencies` gains
  ```ts
  loadLinkedInConfig: () => LinkedInIngestConfig;
  admitLinkedIn: typeof admitLinkedInReceipt;
  processLinkedIn: (db: SqlExecutor, id: string, config: EnabledConfig) => Promise<LinkedInProcessOutcome>;
  forwardLinkedIn: (db: SqlExecutor, id: string) => Promise<string | null>;
  ```

Behavior: after `admit` (reply flow) returns null and the LinkedIn config is enabled, call `admitLinkedIn`; when it returns an id, run `processLinkedIn` then `forwardLinkedIn`, each in its own try, and return 503 if either fails (same containment shape as the reply flow). The route still returns 503 before touching the database when the reply inbox config is disabled (receiving is production-only and the reply inbox is always on there). The default `forwardLinkedIn` builds `forwardLinkedInReceipt` with `createInboxRuntime()`'s `getReceived`, `downloadInboxRaw`, and the same `send` closure shape as `inbox-runtime.ts` (extract that closure into an exported `createResendForwardSender(sendingKey)` in `inbox-runtime.ts` so both paths share it).

- [x] **Step 1: Write failing tests** in `route.spec.ts`:

```ts
test('mail for the LinkedIn ingest address is admitted, processed and forwarded', async () => {
  const admitLinkedIn = vi.fn(async () => 'li-1'); const processLinkedIn = vi.fn(async () => 'unparsed'); const forwardLinkedIn = vi.fn(async () => 'fwd-1');
  const { route, admit } = setup({ admit: vi.fn(async () => null), loadLinkedInConfig: () => ({ enabled: true, address: 'linkedin@threadplane.ai', forwardNotifications: false }), admitLinkedIn, processLinkedIn, forwardLinkedIn });
  expect((await route.POST(req())).status).toBe(200);
  expect(admit).toHaveBeenCalled(); expect(admitLinkedIn).toHaveBeenCalled(); expect(processLinkedIn).toHaveBeenCalledWith(expect.anything(), 'li-1', expect.anything()); expect(forwardLinkedIn).toHaveBeenCalled();
});
test('a LinkedIn forward failure asks the provider to retry', async () => { /* forwardLinkedIn rejects → 503 */ });
test('the LinkedIn branch is skipped when ingest is disabled', async () => { /* loadLinkedInConfig → {enabled:false}; admitLinkedIn not called; 200 */ });
test('reply-inbox mail never reaches the LinkedIn branch', async () => { /* admit returns 'incoming-1' → admitLinkedIn not called */ });
```

Existing tests must keep passing with `loadLinkedInConfig` defaulting to `{ enabled: false }` in `setup`.

- [x] **Step 2: Run to verify failure.** Run from `apps/website`: `npx vitest run src/app/api/webhooks/resend-inbound`. Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run to verify pass**, plus `npx nx test growth -- libs/growth/src/lib/inbox` for the extracted sender.
- [x] **Step 5: Commit** `feat(website): route LinkedIn ingest mail in the Resend inbound webhook`

---

### Task 8: Decide tokens and the signed-link route

**Files:**
- Modify: `libs/growth/src/lib/tokens.ts`, `tokens.spec.ts`
- Create: `apps/website/src/app/api/growth/linkedin-decide/route.ts`, `route.spec.ts`

**Interfaces:**
- Consumes: `decideLead` (Task 5).
- Produces:
  - `GrowthTokenPurpose` gains `'founder_linkedin_decide'`; `export const FOUNDER_LINKEDIN_DECIDE_TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;` The token's `reason` field carries `'reject'` or `'deny'`; `contactId` carries the lead id.
  - `createFounderLinkedInDecideRoute(overrides)` → `{ GET, POST }` at `/api/growth/linkedin-decide`, mirroring `approve-install/route.ts`: GET with `?token=` renders a confirmation form whose heading is `Reject this lead` or `Deny forever` by the token's reason; POST (form-encoded, single `token` field) verifies with purpose `founder_linkedin_decide` and max age, then calls `decideLead(db, { leadId: payload.contactId, decision: payload.reason, decidedBy: 'founder_email_link', now })`. Results `applied` and `already_decided` both render a success page (`Lead rejected` / `Lead denied`); `not_found` and verification failures render the 400 failure response. Tokens without a `reason` of `reject` or `deny` are rejected.

- [x] **Step 1: Write failing tests**

tokens.spec.ts: round-trip a `founder_linkedin_decide` token with `reason: 'deny'` and verify `expectedPurpose: 'founder_linkedin_decide'`; verification with `expectedPurpose: 'founder_approve_install'` returns null.

route.spec.ts (copy the harness style of `approve-install/route.spec.ts`):
```ts
test('GET renders a confirmation form naming the action', ...); // 'Deny forever' for reason deny
test('POST applies the decision once and treats a repeat as success', ...); // decideLead mock returns 'applied' then 'already_decided'; both 200 html
test('POST rejects a token with the wrong purpose or no reason', ...); // 400
test('POST never approves', ...); // a forged reason 'approve' → 400, decideLead not called
```

- [x] **Step 2: Run to verify failure.** Expected: FAIL.
- [x] **Step 3: Implement.** Update `assertPurpose` and `parseWirePayload` purpose checks in `tokens.ts`.
- [x] **Step 4: Run to verify pass**: `npx nx test growth -- libs/growth/src/lib/tokens` and `npx vitest run src/app/api/growth/linkedin-decide` from `apps/website`.
- [x] **Step 5: Commit** `feat(growth): signed LinkedIn lead decide links`

---

### Task 9: Digest data layer

**Files:**
- Create: `libs/growth/src/lib/linkedin/digest.ts`, `digest.spec.ts`
- Modify: `libs/growth/src/lib/linkedin/index.ts`

**Interfaces:**
- Consumes: `LinkedInLeadSummary`, `listLeads` shape (Task 5).
- Produces:

```ts
export interface LinkedInDigestContext { since: Date; unparsedCount: number; dropCount: number; ingestCount: number; forwardBacklog: number }
/** since = sent_at of the latest growth_linkedin_digests row, else now - 24h. ingestCount = receipts received since; unparsedCount = status unparsed since; dropCount = drops since; forwardBacklog = receipts with forward_required and no forward_provider_id older than 15 minutes. marker growth:linkedin-digest-context */
export async function readLinkedInDigestContext(ex: SqlTransaction, input: { now: Date }): Promise<LinkedInDigestContext>;
export interface LinkedInDigestLead extends LinkedInLeadSummary { previouslyRejected: boolean }
/** status new, excluding leads whose profile_url or normalized company_name matches an active deny row (marker growth:linkedin-digest-leads), plus rejected leads with last_seen_at > decided_at flagged previouslyRejected. Ordered by score desc, last_seen_at desc, limit 100. */
export async function readLinkedInDigestLeads(ex: SqlTransaction): Promise<LinkedInDigestLead[]>;
/** Mirrors enqueueInstallDigestJob: key must start with 'linkedin_digest:'; skip when the job exists (growth:linkedin-digest-job-exists); enqueue only when leads.length > 0 or context.unparsedCount > 0 or context.dropCount > 0; kind 'digest', payload {digest_kind:'linkedin_leads', business_date}. marker growth:enqueue-linkedin-digest */
export async function enqueueLinkedInDigestJob(ex: SqlTransaction, input: { now: Date; idempotencyKey: string; businessDate: string }): Promise<string | null>;
/** insert into growth_linkedin_digests on conflict (business_date) do nothing. marker growth:linkedin-digest-sent */
export async function markLinkedInDigestSent(ex: SqlTransaction, input: { businessDate: string; jobId: string; sentAt: Date; leadCount: number; context: LinkedInDigestContext }): Promise<void>;
```

- [x] **Step 1: Write failing tests** with `executorWith`: enqueue skips on existing job; enqueue skips when no leads and zero counts; enqueue inserts with the payload above; key prefix validation throws; `markLinkedInDigestSent` params.
- [x] **Step 2: Run to verify failure.** Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run to verify pass.**
- [x] **Step 5: Commit** `feat(growth): LinkedIn digest reads and enqueue`

---

### Task 10: Lifecycle: tick step, digest job, renderer

**Files:**
- Create: `apps/lifecycle/src/notifications/linkedin-digest.ts`, `linkedin-digest.spec.ts`
- Modify: `apps/lifecycle/src/campaign/send.ts`, `apps/lifecycle/src/dispatcher.ts`, `apps/lifecycle/src/dispatcher.spec.ts`, `apps/lifecycle/src/app/dispatch/index.ts`

**Interfaces:**
- Consumes: Task 9 functions, `scrubLinkedInReceipts` (Task 6), `createGrowthActionToken`, `FOUNDER_LINKEDIN_DECIDE_TOKEN_MAX_AGE_SECONDS` (Task 8), `pacificCalendarDate`.
- Produces:
  - `LifecycleRuntimeConfiguration.linkedInIngestEnabled: boolean` from `exactBoolean(environment, 'GROWTH_LINKEDIN_INGEST_ENABLED')`.
  - `LifecycleDispatcherInput.linkedInIngestEnabled?: boolean`; `LifecycleOperatorAlert` gains `'linkedin_ingest_failed' | 'linkedin_forward_failed'`.
  - `LifecycleDispatcherDependencies` gains `enqueueLinkedInDigestJob`, `readLinkedInDigestContext`, `scrubLinkedInReceipts`.
  - `renderLinkedInDigest(input: unknown): string` with a zod schema like `install-digest.ts`: `{ businessDate, publicActionOrigin, leads: [{ displayName, headline, profileUrl (must be https://www.linkedin.com/in/...), companyName|null, score, previouslyRejected, engagements: [{ kind, commentText|null, postUrl|null, postUrn|null, occurredAt }], rejectUrl, denyUrl }], context: { unparsedCount, dropCount, ingestCount } }`. Both URLs must be `https`, on `publicActionOrigin`, path `/api/growth/linkedin-decide`, a single `token` param (same validator shape as `validApproveUrl`). Control characters anywhere throw. Comment text is truncated to 500 characters in the renderer.
  - `LifecycleJobDependencies` gains `readLinkedInDigestLeads`, `readLinkedInDigestContext`, `markLinkedInDigestSent`.
  - `dispatchLifecycleAppOwnedJob`: `if (job.kind === 'digest')` → `payload.digest_kind === 'linkedin_leads'` ? `dispatchLinkedInDigestJob` : install digest (unchanged default).

Tick step (in `dispatchLifecycleJobs`, after the install digest block, contained like marketing):

```ts
if (input.linkedInIngestEnabled === true) {
  try {
    const now = dependencies.now();
    await dependencies.scrubLinkedInReceipts(executor, { now });
    const context = await dependencies.readLinkedInDigestContext(executor, { now });
    if (context.forwardBacklog > 0) operatorAlerts.push('linkedin_forward_failed');
    const calendar = pacificCalendarDate(now);
    if (calendar.weekday) await dependencies.enqueueLinkedInDigestJob(executor, { now, idempotencyKey: `linkedin_digest:${calendar.date}`, businessDate: calendar.date });
  } catch { operatorAlerts.push('linkedin_ingest_failed'); }
  tickSignal.throwIfAborted();
}
```

`dispatchLinkedInDigestJob` follows `dispatchInstallDigestJob` step for step: defer when delivery is disabled; business date from payload; read leads and context; when `leads.length === 0 && context.unparsedCount === 0 && context.dropCount === 0` complete the job; otherwise render (tokens: `contactId: lead.id, purpose: 'founder_linkedin_decide', reason: 'reject' | 'deny', eventNonce: job.id`), claim, send to `founderNotificationEmail` with subject `Threadplane LinkedIn leads for <date>: <n> new`, unknown → `linkedin_digest_outcome_unknown`, rejected → `linkedin_digest_rejected`, accepted → `markLinkedInDigestSent` + `completeJob` in one transaction.

- [x] **Step 1: Write failing tests**
  - `linkedin-digest.spec.ts`: renders header, one block per lead with name, headline, company, score, each engagement line (`commented: "<text>"` / `reacted` / `reposted` / `mentioned you` / `replied: "<text>"`), the two links labeled `Reject (valid 7 days):` and `Deny forever (valid 7 days):`, `previously rejected` marker, footer `Since last digest: <ingest> received, <unparsed> unparsed, <drops> dropped by the deny list.`, the line `No approve link: approvals happen in the /week session.`; rejects a `http://` link, a non-origin link, and `\r\n` in a headline.
  - `dispatcher.spec.ts`: enqueues `linkedin_digest:<date>` on a weekday when enabled; raises `linkedin_forward_failed` when context backlog > 0; a throwing `readLinkedInDigestContext` yields `linkedin_ingest_failed` and leasing still runs; disabled → none of the three dependencies called.
  - `send.spec.ts` (or a new `linkedin-digest-job.spec.ts` beside `send.spec.ts`): a `digest` job with `digest_kind: 'linkedin_leads'` and no leads/counts completes without sending; with one lead sends once and records `markLinkedInDigestSent` with `jobId`; install digest jobs still route to the install handler.
- [x] **Step 2: Run to verify failure**: `npx nx test lifecycle`. Expected: FAIL on the new specs.
- [x] **Step 3: Implement.** Pass `linkedInIngestEnabled` through `apps/lifecycle/src/app/dispatch/index.ts`.
- [x] **Step 4: Run to verify pass**: `npx nx test lifecycle`. Expected: PASS.
- [x] **Step 5: Commit** `feat(lifecycle): daily LinkedIn leads heads-up email`

---

### Task 11: Operator CLI `growth:linkedin`

**Files:**
- Create: `scripts/growth-linkedin.mts`, `scripts/growth-linkedin.spec.ts`
- Modify: `package.json` (script), `libs/growth/vite.operator-cli.config.mts` (include), `.env.example`

**Interfaces:**
- Consumes: Tasks 4, 5, 6 functions; `parseLinkedInNotification`; `createDatabaseExecutor`.
- Produces:

```ts
export interface GrowthLinkedInOperations {
  denyImport(lines: string[], addedBy: string): Promise<{ added: number; existing: number; invalid: number }>;
  denyAdd(kind, value, reason?): Promise<{ id: string; created: boolean }>;
  denyRemove(kind, value): Promise<boolean>;
  denyList(includeRemoved: boolean): Promise<LinkedInDenyEntry[]>;
  leads(status?: LinkedInLeadStatus, limit?: number): Promise<LinkedInLeadSummary[]>;
  decide(input: DecideLeadInput): Promise<DecideLeadResult>;
  deleteLead(profileUrl: string): Promise<boolean>;
  ingestManual(input: Parameters<typeof ingestManualEngagement>[1]): Promise<{ recorded: number; dropped: number }>;
}
export interface GrowthLinkedInRunnerDependencies {
  operations: GrowthLinkedInOperations;
  readFile(path: string): Promise<string>;
  isInsideGitWorktree(path: string): Promise<boolean>;   // repo root containment OR `git -C <dir> rev-parse --is-inside-work-tree` === 'true'
  parseEml(raw: string): LinkedInParserInput;            // minimal RFC 5322 header split + text/html pick; see note
  now(): Date; writeOutput(line: string): void; writeError(line: string): void;
}
export function parseArguments(argv: readonly string[]): ParsedCommand; // exported for tests
export async function runGrowthLinkedIn(argv: readonly string[], deps: GrowthLinkedInRunnerDependencies): Promise<number>; // 0 ok, 1 failure, 2 usage
export async function mainGrowthLinkedIn(argv?: readonly string[]): Promise<number>;
```

Usage (all verbs except `replay` need `--target=preview|production`, resolved like `marketing/queue/src/target.ts` but from `GROWTH_DATABASE_URL_PREVIEW` / `GROWTH_DATABASE_URL_PRODUCTION`; the host-only `target: <target> (<host>)` line prints first):

```
npm run growth:linkedin -- <verb> --target=preview|production
  deny-import --file <path>              newline-delimited `kind value [reason]`; the path must be outside any git worktree
  deny-add --kind <k> --value <v> [--reason <text>]
  deny-remove --kind <k> --value <v>
  deny-list [--include-removed]
  leads [--status new|approved|rejected|denied] [--limit 50]
  decide --lead <id> (--approve --variant connection|message --text-file <path> | --reject | --deny)
  delete-lead --profile-url <url>
  replay --file <eml>                    parse only, prints the LinkedInParseResult as JSON, no --target
  ingest --file <eml> [--source manual]  admits and processes a saved email through the parser (no provider fetch)
```

Output lines are JSON objects (like `growth-control.mts`). `leads` prints one JSON object per lead with engagements. `decide --approve` reads the text file and passes `decidedBy: 'founder_cli'`. `parseEml` is a small in-script helper: split at the first blank line, unfold headers, lowercase keys, take `text` from a `text/plain` body (or the whole body when not multipart) and `html` from a `text/html` part when the boundary is simple; anything it cannot read becomes `null`. `ingest --file` runs the parser on the `.eml` and writes through `ingestManualEngagement` when parsed (source `manual` by default; this is the backfill path from design section 8) or records an `unparsed` manual receipt otherwise.

- [x] **Step 1: Write failing tests** in `scripts/growth-linkedin.spec.ts` (same injected-dependency style as `growth-control.spec.ts`):

```ts
test('deny-import refuses a path inside a git worktree', async () => { /* isInsideGitWorktree → true; exit 2; operations.denyImport not called; error mentions worktree */ });
test('deny-import parses kind value reason lines and skips blanks/comments', async () => { /* file: "profile_url https://www.linkedin.com/in/x competitor\n# c\n\ncompany_name Acme Inc" → denyImport called with two lines */ });
test('decide --approve requires a variant and text file', async () => { /* exit 2 without --variant */ });
test('decide --reject prints the result', async () => { /* {"command":"decide","result":"applied"} */ });
test('replay prints the parser result without a target', async () => { /* parseEml + parse stub → {"outcome":"unparsed","reason":"untrusted_sender"} */ });
test('a database verb without --target is a usage error', async () => { /* exit 2 */ });
```

- [x] **Step 2: Run to verify failure**: `npx nx test-operator-cli growth`. Expected: FAIL.
- [x] **Step 3: Implement**; add to `package.json` scripts `"growth:linkedin": "tsx --env-file=.env scripts/growth-linkedin.mts"`; add the spec to `vite.operator-cli.config.mts`; add to `.env.example` under the growth section:
  ```
  # growth:linkedin CLI --target=preview|production (lifecycle Growth DATABASE_URL values)
  GROWTH_DATABASE_URL_PREVIEW=
  GROWTH_DATABASE_URL_PRODUCTION=
  ```
- [x] **Step 4: Run to verify pass**: `npx nx test-operator-cli growth`, then `npm run growth:linkedin -- deny-list` with no `--target` to see the usage error, exit 2.
- [x] **Step 5: Commit** `feat(growth): growth:linkedin operator CLI`

---

### Task 12: `/week` skill step and docs

**Files:**
- Modify: `marketing/cowork/week/SKILL.md`, `apps/lifecycle/README.md`, `docs/growth/README.md`

- [x] **Step 1: `/week` skill.** Add `Bash(npm run growth:linkedin *)` to `allowed-tools`. Add a step **"2a. LinkedIn leads"** between "Last week recap" and "Gather sources":
  1. `npm run growth:linkedin -- leads --status new --target=<target>`; if none, say so and move on.
  2. For each lead, in score order, draft in the Social register using the `/gtm` lead-triage rules: name what they said (comment text, or the post topic for reactions/reposts), offer one concrete next step (a code sketch, a pattern, or a 15-minute call; never calendar-first), no hype. Two variants when both apply: a connection note (≤ 300 characters) and a message or public reply (≤ 600 characters). Do not invent anything about the person beyond their headline and what they did.
  3. Show Brian the lead (name, headline, profile link, what they did, score) and the drafts. He says approve (with the variant), edit, reject, or deny forever. Write the final text to `tmp/marketing/week/<week>/linkedin-lead-<id>.txt` and run `decide --lead <id> --approve --variant <v> --text-file <path>`, or `--reject`, or `--deny`. A `denied_by_list` result means the deny list caught them since the digest: tell Brian and move on.
  4. After all decisions, print each approved lead's profile link and final text. Brian sends it himself on LinkedIn. Nothing in this step sends anything.
  Add to **Hard rules**: "LinkedIn leads: never message, connect with, or reply to anyone; the skill produces text Brian sends. Never approve a lead without showing the exact text in this session. Never write a competitor's name into the repo; deny-list changes go through `growth:linkedin`."
  Add to **Reference**: the design doc path.
- [x] **Step 2: `apps/lifecycle/README.md`.** Add a paragraph after the install digest paragraph: the three switches with the exact-string rule, `GROWTH_LINKEDIN_INGEST_ADDRESS` requirements, that the website webhook and the lifecycle tick both read `GROWTH_LINKEDIN_INGEST_ENABLED`, the daily digest (idempotency key `linkedin_digest:<YYYY-MM-DD>`, Pacific business days, sent to `FOUNDER_NOTIFICATION_EMAIL` when there is a new lead or any unparsed receipts or drops), the 30-day raw retention, and the operator alerts `linkedin_ingest_failed` and `linkedin_forward_failed`.
- [x] **Step 3: `docs/growth/README.md`.** Add a CLI row for `npm run growth:linkedin -- leads --status new --target=production` to the entry-point table and a short "LinkedIn engagement leads" subsection with the rollout order from design section 9 verbatim (migrate; deploy switch off; seed deny list with `deny-import`; enable ingest with `GROWTH_LINKEDIN_FORWARD_NOTIFICATIONS=true`; send a controlled non-LinkedIn email and confirm it is forwarded with headers only retained; change the LinkedIn primary email and confirm the verification mail is forwarded; trigger a controlled comment and verify lead, digest, links, one deny-forever drop, and a `decide` round-trip), plus a note that the parser is a stub until redacted fixtures exist, so every receipt is `unparsed` with reason `no_fixtures_yet` and forwarded.
- [x] **Step 4: Verify** `rg -n "GROWTH_LINKEDIN_INGEST_ENABLED" apps/lifecycle/README.md docs/growth/README.md` lists both files.
- [x] **Step 5: Commit** `docs(growth): LinkedIn leads switches, CLI and /week step`

---

### Task 13: Full verification

- [x] `npx nx test growth` → all pass.
- [x] `npx nx test-operator-cli growth` → all pass.
- [x] `npx nx test lifecycle` → all pass.
- [x] From `apps/website`: `npx vitest run src/app/api/webhooks/resend-inbound src/app/api/growth/linkedin-decide` → all pass.
- [x] `npx nx lint growth && npx nx lint lifecycle && npx nx lint website` → no errors (warnings are acceptable per repo convention).
- [x] `npx nx run lifecycle:check` → typecheck passes (uses Node 24 via npx).
- [x] Record each command's summary line in the final report.

---

### Deferred: Task 14: Real parser from fixtures (not in this build)

Starts only once Brian supplies `.eml` samples (at least one per kind he receives). Redact into `libs/growth/src/lib/linkedin/fixtures/<kind>-<n>.eml` per the design rules; write `parser.spec.ts` cases per fixture asserting kind, actors (name, headline, normalized profile URL, comment text), post reference, `aggregateCount`; implement HTML-first, text fallback; shrink `LINKEDIN_UNSUPPORTED_KINDS` to the kinds with no fixture; `replay --file` on each fixture prints the expected result. The same task also covers: sender-trust alignment (require `dkim=pass` with `header.d=linkedin.com`, or `dmarc=pass`, parsed per result rather than by substring, and handle array-valued `Authentication-Results` headers); classifying trusted non-engagement mail (sign-in codes, verification, digests) as `not_notification`; re-normalizing profile URLs on write instead of trusting the parser; and settling whether share or activity URNs link to `marketing_posts.result->>'postId'`.
