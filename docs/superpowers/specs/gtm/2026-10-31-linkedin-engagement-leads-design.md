# LinkedIn engagement leads — design

Date: 2026-10-31. Author: Brian Love with Claude. Status: reviewed 2026-11-01; all builder-check questions answered. Ready for a plan.

## Intent

People who comment on or react to Brian's LinkedIn posts are warm. Today nothing captures them. This workstream turns that engagement into a reviewed lead queue inside the growth control plane, drafts a LinkedIn reply or connection note in Brian's voice for each lead, and hands Brian the approved text to send himself. It never contacts anyone on its own, and it never contacts a competitor.

The trigger was this post: <https://lnkd.in/p/gDuRV_kV> (activity `urn:li:activity:7521697251291869186`, Brian's personal profile).

## Why it's shaped this way

- **The LinkedIn API cannot read engagement on a personal post.** The member read scope `r_member_social` is restricted and, per the current Social Metadata docs, closed to new requests. The adapter already hit this gate on first comments (403 `partnerApiSocialActions.CREATE`, see `marketing/channels/README.md`). Only organization-page posts are readable, and Brian posts from his personal profile, where the reach is. So the design does not call LinkedIn to read anything.
- **LinkedIn's own notification emails are the readable surface.** "X commented on your post" carries the actor's name, headline, profile URL, the comment text, and a link to the post. Reaction notifications are aggregated ("X and 4 others reacted") and carry fewer names. Threadplane already receives mail for `threadplane.ai` through Resend (`docs/growth/resend-receiving.md`), so a second address on that domain gets the same `email.received` webhook with no new provider setup.
- **Sending on LinkedIn is also partner-only** (messaging and invitation APIs), and UI automation against LinkedIn is against their terms and gets accounts restricted. Brian decided: he sends every message himself. The system stops at approved text.
- **The existing growth contact model is keyed on email** (`growth_contacts.email_lookup_hmac` is NOT NULL UNIQUE). A LinkedIn engager has no email. These leads therefore get their own tables and never become `growth_contacts` rows on their own.

## Goals

1. Every comment notification that lands at the ingestion address becomes a lead within one lifecycle tick, with no manual step.
2. A competitor never appears in the queue, and the system can prove it dropped them without storing who they were.
3. Brian hears about new leads once per business day and can reject or deny-forever from his phone; drafts in his voice are written and approved in the weekly session.
4. Nothing is ever sent on LinkedIn, by email, or anywhere else, by the system, to a lead.

## Non-goals

- Email outreach to these leads. No lead from this path enters the founder campaign.
- Any new LinkedIn write capability. The adapter keeps doing exactly what it does today (post, optional partner-gated first comment).
- Liker-level completeness. Reaction notifications are lossy; this design accepts that.
- A UI. The daily email, the CLI, and the `/week` session are the whole operator surface for v1.
- Server-side drafting. No model call runs in lifecycle or the growth library.

## Anti-goals (failure even if it works)

- A DM, connection request, or reply goes out without Brian having approved that exact text.
- A competitor employee gets drafted, emailed to Brian, or stored as a lead.
- Competitor names appear in the repository, in a PostHog event, or in any public surface.
- Raw comment text or lead identity leaves Neon (PostHog gets counts only, matching `docs/gtm/taxonomy.md`).
- A LinkedIn email template change silently stops ingestion.

## Constraints

- Node 24 lifecycle service, Neon Postgres, migrations under `migrations/` numbered after `0011`.
- The inbound webhook is `apps/website/src/app/api/webhooks/resend-inbound/route.ts`; admission lives in `libs/growth/src/lib/inbox-replies.ts` and today rejects mail whose `to` does not include the configured reply address. The new address must be routed before that check, not folded into the reply flow.
- Receiving is production-only (preview receiving stays disabled). Preview verification uses replayed fixture emails.
- Voice: `docs/gtm/voice.md`, social register section. Reply rules from `marketing/cowork/gtm/SKILL.md` lead triage: name what they said back to them, offer one concrete next step (code sketch, pattern, or a 15-minute call, never calendar-first), no hype.
- ICP: `docs/gtm/icp.md`.
- The repository is public. The deny list and its seed file never enter git.

## Decisions Brian made

| Decision | Brian's words / choice |
| --- | --- |
| Destination | "automated way to put them into our lead/lifecycle app" |
| Permanent deny list | "a list of permanent companies/people that are dnd - we never contact"; contents today: competitors |
| First touch | "LinkedIn connect and/or dm on LinkedIn using my voice" |
| Who sends | "I'll send it to start" |
| Ingestion source | LinkedIn notification emails to "a separate ingestion email for this"; delivered by changing the LinkedIn primary email to it (2026-11-01) |
| Permission | "never send a dm without my permission" (standing rule for every outbound) |

## Design

### 1. Ingestion address and routing

- A dedicated address on the existing Resend domain, configured as `GROWTH_LINKEDIN_INGEST_ADDRESS` (suggested `linkedin@threadplane.ai`). Brian's decision (2026-11-01): he changes the primary email on his LinkedIn account to this address. LinkedIn sends notifications only to the primary, so this is the only way mail arrives directly, and it means every LinkedIn email lands here: engagement notifications, but also sign-in verification codes, security alerts, InMail and message notifications, invitations, and digests.
- Consequences the builder must honor:
  - **Everything that is not a parsed engagement notification is forwarded to `FOUNDER_NOTIFICATION_EMAIL` immediately**, in the webhook, using the same forwarding mechanism the reply flow uses (original sender as Reply-To, `original.eml` attached). A missed sign-in code locks Brian out of the account the whole channel depends on, so forwarding failure is reported to operators as `linkedin_forward_failed` and the receipt stays `pending` for retry; it is never dropped.
  - **Bodies of forwarded, non-notification mail are not retained.** The receipt keeps headers and the provider id only. The 30-day raw retention in "Privacy and data handling" applies to engagement notifications and `unparsed` LinkedIn mail only; a sign-in code never sits in Neon.
  - Engagement notifications are also forwarded for the first 30 days after enablement, so Brian can confirm nothing is being swallowed; a switch `GROWTH_LINKEDIN_FORWARD_NOTIFICATIONS` (exact `true`) controls this and defaults to `false` after that.
  - The address must be routed and the switch on before Brian changes the primary on LinkedIn, because LinkedIn sends a verification email to the new address as part of the change. Rollout order in section 9 reflects this.
- Sender trust is unchanged by this choice: mail arrives directly from LinkedIn, so the From-domain plus DKIM/SPF check in this section applies as written. Non-LinkedIn mail to the address is forwarded like any other non-notification mail and counted as `unparsed` with reason `untrusted_sender`.
- The `email.received` webhook, after signature verification, branches on recipient: the reply address goes to the existing reply flow unchanged; the ingest address goes to a new LinkedIn ingest path; any other recipient keeps today's rejection.
- Ingest path runs inline in the webhook request, the same way the reply flow admits, processes, and forwards inline today (there is no lifecycle hand-off for receipts to mirror). The webhook records a receipt (`growth_linkedin_receipts`: provider id, received at, raw headers and body, status), fetches the body with the website's `RESEND_RECEIVING_API_KEY`, runs the parser, applies the deny list, and writes leads and engagements in one transaction. Idempotency is on the provider message id. Drafting and the daily digest run in the lifecycle tick, which only reads the lead tables. Claude's call: this keeps the receiving credential website-only as documented, and ingest latency is the webhook, not the 30-minute tick.
- Sender check: the parser only treats mail as a LinkedIn notification when the From domain is `linkedin.com` and DKIM/SPF passed per Resend's event data. Anything else is `unparsed` with reason `untrusted_sender`.

### 2. Parser

- Recognizes, from subject and body, these notification kinds: `comment`, `reply` (reply to Brian's comment), `reaction`, `repost`, `mention`. Each yields zero or more actors: display name, headline (may be empty), profile URL (normalized to `https://www.linkedin.com/in/<slug>` without query or trailing slash), and for comments the comment text. It also extracts the post reference: the activity or share URN or post URL, normalized to the URN when possible.
- HTML first, text/plain fallback. Parse rules live in one module with fixture-driven tests. Brian exports real notifications as `.eml` from his current inbox before the build starts (2026-11-01), at least one per kind he actually receives: comment, reply, reaction (single and aggregated), repost, mention. He drops them in a folder outside the repo and names the path to the builder. The builder redacts them (names, slugs, comment text, tracking parameters replaced with stable placeholders) into fixtures under the growth library tests, and the parser is written test-first against those. A kind with no sample is out of v1 and is listed as such in the parser module; mail of that kind lands `unparsed` with reason `unsupported_kind` and shows in the daily count.
- Any mail the parser cannot classify, or classifies but cannot extract at least one actor with a profile URL from, is stored raw in `growth_linkedin_receipts` with status `unparsed` and a reason. A daily count of unparsed receipts goes in the operator email (section 6), so a template change surfaces as a number, not silence.
- Reaction notifications are often aggregated. The parser extracts the named actors it can and records `aggregate_count` when the mail says "and N others". Nothing is invented for the unnamed remainder.

### 3. Post resolution

- Each post reference is matched against `marketing_posts` where `channel = 'linkedin'` and `result->>'url'` or a stored URN matches. If the queue row stores only a URL today, the builder adds the URN to `result` at post time in the adapter (the `x-restli-id` header is already captured) and backfills existing rows by URL match.
- Posts not in the queue (older, hand-posted) are recorded as `growth_linkedin_posts` rows with just the URN/URL and first-seen time, so engagement on them still becomes leads.

### 4. Deny list

Table `growth_linkedin_deny` with columns: `id`, `kind` (`profile_url | company_name | company_domain`), `value` (normalized: lowercased, profile URL as above, company name with punctuation and legal suffixes such as Inc, LLC, Ltd, GmbH stripped), `reason` text, `added_by` text, `added_at`, `removed_at` (soft removal, CLI only).

- Checked at ingest, before a lead row is written, and again at draft time and at approval time. A match at any point drops or cancels the lead.
- Matching: profile URL exact; company domain exact against any domain found in the actor's headline or profile URL slug; company name as a whole-word, case-insensitive match against the headline's current-company phrasing. Conservative on purpose: "ex-Acme", "formerly Acme", "Acme alumni", "previously at Acme" do not match. Brian denies those by hand from the email if he wants.
- A hit writes one row to `growth_linkedin_drops` with `receipt_id`, `deny_id`, `dropped_at` and nothing identifying the actor. Drop counts appear in the daily email.
- Seeding: `npm run growth:linkedin -- deny-import --file <path>` reads a local newline-delimited file (`kind value [reason]`) that lives outside the repo; the command refuses a path inside the git worktree. `deny-add`, `deny-remove`, `deny-list` are the other CLI verbs. The daily email's "deny forever" link adds a `profile_url` row and, when the lead has a resolved company name, a `company_name` row too.

### 5. Leads and scoring

Table `growth_linkedin_leads`: `id`, `profile_url` (unique), `display_name`, `headline`, `company_name` (parsed from headline, nullable), `first_seen_at`, `last_seen_at`, `status` (`new | approved | rejected | denied`), `score` int, `decided_at`, `decided_by`.

Table `growth_linkedin_engagements`: `id`, `lead_id`, `post_id` (marketing post or growth_linkedin_posts), `kind` (`comment | reply | reaction | repost | mention`), `comment_text` (nullable), `occurred_at` (mail received time; LinkedIn mail does not carry a reliable event time), `receipt_id`, unique on (`lead_id`, `post_id`, `kind`, `comment_text` hash) so a re-delivered notification does not double count.

Scoring, recomputed when an engagement is added:

- comment or reply: 30; mention: 25; repost: 15; reaction: 5
- each distinct post engaged beyond the first: +10
- headline matches an ICP keyword set (Angular, LangGraph, AG-UI, "frontend", "staff", "principal", "CTO", "VP Engineering", and others the builder takes from `docs/gtm/icp.md`): +20
- headline suggests recruiter, agency, or "growth hacker" style accounts: -20

Score orders the daily email and is shown; it does not gate anything.

### 6. Drafting and approval in the weekly session

Brian's decision (2026-10-31): no server-side model call. Nothing in lifecycle or the growth library calls a model today, and adding one for this is not worth a new secret and a new surface. Drafts are written by Claude in the `/week` Cowork session (`marketing/cowork/week/SKILL.md`), with Brian present, the same way the week's posts are.

- `/week` gains a "LinkedIn leads" step. It runs `growth:linkedin leads --status new` against production, and for each lead drafts one message in the voice guide's social register using the triage reply rules: name what the person said (comment text, or the post topic for reactions) and offer one concrete thing. Two variants when both could apply: a connection note (LinkedIn's 300-character limit for invitation notes applies) and a DM or public reply (600 characters max for v1).
- Brian reads each draft in the session and says approve, edit, reject, or deny forever. The skill records the decision with `growth:linkedin decide --lead <id> --approve --variant <connection|message> --text-file <path>` (or `--reject`, `--deny`). Approval stores the final text, `decided_at`, and the variant; the deny list check from section 4 runs again inside `decide` and refuses to approve a lead that now matches.
- The skill then prints, for each approved lead, the final text and the profile link. Brian sends it himself on LinkedIn. The system does not record whether he sent it; that is outside the system by design.
- The skill never calls anything that sends. The standing rule from the GTM skill applies verbatim: draft replies for human review and do not send them without authorization.

### 6a. The daily heads-up email

Once per Pacific business day, following the install-digest pattern (`apps/lifecycle/src/notifications/install-digest.ts`, idempotency key `linkedin_digest:<YYYY-MM-DD>`), lifecycle sends Brian one email at `FOUNDER_NOTIFICATION_EMAIL` when there is at least one lead in `new`, or any unparsed receipts or drops since the last digest. Content per lead: name, headline, profile link, what they did and on which post, comment text, score, and two signed links: reject and deny forever. Footer: unparsed count, drop count, and the day's ingest count. There is no approve link; approval happens only in the session with a draft in front of Brian.

Signed links reuse the growth token mechanism (`libs/growth/src/lib/tokens.ts`) with a new purpose `founder_linkedin_decide` and a seven-day max age, landing on a website route under `/api/growth/`. Reject marks `rejected`; the lead stays out of future emails unless they engage again, in which case the line says "previously rejected". Deny forever is section 4. Lead ids are UUID v4 so the existing token payload shape holds.

### 7. Operator CLI

`npm run growth:linkedin -- <verb>` with `--target` semantics matching other growth commands: `deny-import`, `deny-add`, `deny-remove`, `deny-list`, `leads` (list with status filter), `replay --file <eml>` (run the parser on a saved email and print the result without writing), `ingest --file <eml>` (write it, for preview and backfill).

### 8. Backfill and the browser pane

Engagement that predates the ingest address, and likers that aggregated notifications omitted, are out of reach of email. The builder does not build anything for this. If Brian wants it for a particular post, it is a manual session: he is signed in, the post page is read in the browser pane while he watches, and the extracted actors are fed in through `ingest` with a synthetic receipt marked `source = 'manual'`. This is noted so the lead schema allows a `source` column (`email | manual`).

### 9. Switches and rollout

- `GROWTH_LINKEDIN_INGEST_ENABLED` defaults to `false`, exact `true` enables webhook routing and the lifecycle steps. Follows the exact-string convention of the other switches in `apps/lifecycle/README.md`.
- `GROWTH_LINKEDIN_INGEST_ADDRESS` required when enabled.
- Rollout: migrate, deploy with the switch off, seed the deny list in production, enable ingest with notification forwarding on, send a controlled non-LinkedIn email to the address and confirm it is forwarded with headers only retained, then change the LinkedIn primary email and confirm the verification email is forwarded and the change completes. Then trigger a controlled comment from a known account and verify the lead, the heads-up email, each link, one deny-forever drop, and a session draft and `decide` round-trip.
- Failure containment matches the other tick steps: a LinkedIn ingest or digest failure is reported to operators as `linkedin_ingest_failed` and never blocks job leasing.

## Privacy and data handling

- Comment text and lead identity stay in Neon. PostHog, if anything is emitted, gets counts: leads created, drops, unparsed, decisions by kind.
- Deletion: a `delete-lead --profile-url` CLI verb removes the lead, its engagements, and its drafts, and leaves drop rows (which carry no identity) untouched.
- Receipts for engagement notifications and unparsed LinkedIn mail keep raw mail for 30 days then are scrubbed to headers only; the builder adds this retention (reply receipts store no bodies, so there is nothing to mirror). Forwarded non-notification mail never stores a body (section 1).

## Left to the builder

- Exact migration numbering, table and column naming consistent with the existing growth tables.
- Where the parser module lives (suggested `libs/growth/src/lib/linkedin/`), fixture format, and how fixtures are redacted.
- The drafting prompt inside the `/week` skill.
- The headline company-name extraction heuristic and the ICP keyword list.
- The approve/edit page's markup; it only needs to work on a phone and have no styling dependencies on the marketing site.
- Whether the heads-up email and the install digest share a renderer.
- Test strategy, within the repo's existing conventions (vitest for growth and lifecycle, fixture replay for the parser, dogfood checklist entries for the production enable).

## Calls Claude made (for Brian to check while reading)

- Ingest parses inline in the Resend webhook; lifecycle only sends the heads-up email. Keeps the receiving credential website-only.
- The heads-up email has no approve link. Approval exists only in the session, where the draft is in front of Brian.
- Deny list matches current-company phrasing only; "ex-", "formerly", "alumni" never match.
- Drop rows carry no identity, so the deny list is auditable without reconstructing who was dropped.
- Non-notification LinkedIn mail is forwarded with no body stored; engagement notifications are forwarded too for the first 30 days behind a switch.
- Lead score is advisory, orders the email and the session list, and gates nothing.
- Manual browser-pane backfill is a documented procedure, not a build.
- Scoring weights and the ICP keyword list are starting values; the builder may tune them without coming back.

## Open items resolved during design

- API ingestion: rejected, scope closed (verified 2026-10-31 against Microsoft Learn LinkedIn docs).
- Browser automation for sending: rejected by Brian for v1; he sends.
- Company page posting to unlock the readable API: rejected, personal profile has the reach.
