# Weekly content automation — design

Status: approved by Brian, 2026-10-29.

## Intent

Threadplane needs a steady public presence without Brian hand-writing every post. Once a week Brian sits down in a Claude Code session with an agent, reviews a fully drafted plan for the coming week, edits what he wants, says "go ahead", and everything is scheduled. Posts then go out from the cloud on their own.

Cadence target:

- **X**: 1 post a day (7 a week), Brian's personal account (@blovedev).
- **LinkedIn**: 2–3 posts a week, Brian's personal profile.
- **Blog**: 1 post a week on threadplane.ai, cross-posted to dev.to with `canonical_url` pointing at threadplane.ai.

Content mix across the week:

- releases (npm / GitHub releases, notable merged work)
- 2–3 questions and answers (real questions a Threadplane user or agent-UI builder would ask)
- topical and newsworthy (reacting to what's happening in agent UI / LLM tooling)
- small guides (one concrete how-to, often with a snippet)
- mildly controversial statements (engineering opinions)

Success, in Brian's words: increased social engagement and web analytics metrics. Concretely that's impressions/replies/reposts on X and LinkedIn, and social-sourced sessions on threadplane.ai (UTM + PostHog).

## Goals

1. A weekly review loop in Claude Code where the whole week is drafted before Brian starts, and one "go ahead" schedules all of it.
2. Brian reviews every draft before it posts. Nothing posts without his approval of that specific draft (a blanket "go ahead" on the reviewed week counts as approval of every draft shown in that session).
3. Posting runs in the cloud and does not depend on Brian's Mac being awake.
4. Drafts are grounded in real activity: repo activity (merged PRs, commits), npm releases, recent blog posts, and eventually outside news and social search.
5. Every public word sounds like Brian (see Voice).
6. Each week's review starts with last week's results so the plan can learn what lands.

## Non-goals

- Posting from a Threadplane company account. All social goes out as Brian.
- Reddit, HN, Discord, newsletters. The adapter registry has a `reddit` id, but it is out of scope.
- Replying to comments or DMs, or any engagement automation (auto-likes, follows).
- Paid promotion.
- A web UI for the queue. The Claude Code session is the UI.

## Anti-goals (would make this a failure even if it works)

- **Anything political or offensive.** Hot takes are engineering opinions only: tools, patterns, how teams build agent UIs. Never punch at people.
- **Invented anecdotes.** Never put a first-person story in Brian's mouth that didn't happen. Real, verifiable facts only. Warmth and opinion are fine; fabricated events are not.
- **Naming competitors.** Standing rule: don't name other agent-UI libraries (in particular CopilotKit) in public content without Brian approving that specific instance. Hot takes stay about ideas, not products.
- **Anything posting that Brian didn't see.** No auto-generated post skips the review.
- **Double posts.** A retry must never publish the same post twice (the adapters already refuse to retry creates on 5xx; the queue must keep that guarantee).
- **Content that reads like marketing copy.** Hype words, growth-hacker CTAs, "in this article we'll explore", stagey structural fragments ("Now the honest part.").

## Voice

Brian's instruction: everything public-facing uses his voice, drawn from his 2024-and-older posts in `~/repos/brianflove/src/content/posts/`. It must feel natural, organic, plain text, minimal punctuation, with occasional misspellings and typos.

- **Blog and dev.to** follow `docs/gtm/voice.md` (the pre-2024 register: contractions, "Let's", one sentence per line, H2s as questions, opinions flagged with "I think" / "For me", `## Conclusion`, a closing invitation, ~1,000 words, 0–2 emoji from its list). That doc and its drafting checklist are the source of truth.
- **X and LinkedIn** use a looser social register: plain text, lowercase-ish and casual is fine, minimal punctuation, no em dashes, no bullet glyphs or emoji stacks, no hashtag spam (0–1), no "🧵". Occasional natural typos (a dropped letter, "awhile", a missing apostrophe) are welcome, roughly one in every few posts, never in code, package names, commands, URLs, or numbers. This register does not exist in `voice.md` yet; adding a "social register" section there is part of phase 1.
- There is no real corpus of Brian's tweets or LinkedIn posts on disk; only three agent-written posts from 2026-10-28/29 exist, and they are not voice samples. *Builder's call:* if Brian provides a Twitter/LinkedIn archive export later, use his real posts as few-shot examples. Until then, derive the social register from the blog corpus and Brian's edits during weekly reviews.
- Brian's edits in each review are signal. *My call:* when Brian rewrites a draft, store the before/after pair so later drafting can use it as examples (see data model).

## What exists today (build on it)

- `marketing/channels/` — `ChannelAdapter` interface and `getAdapter(channel)` registry with working **X** (threads, ≤4 images with alt text, OAuth 2.0 PKCE with refresh), **dev.to** (articles with `canonicalUrl`, ≤4 tags, publishes immediately), and **LinkedIn** (personal profile, one image, 3000 chars, LinkedIn "little" escaping, 60-day non-refreshable token with expiry warning) adapters. `DRY_RUN=1` writes payloads to disk. `validation.ts` checks drafts before network calls.
  - Gap: X refresh tokens are only held in memory, so a restart needs re-auth.
  - Gap: LinkedIn first comments need partner access (PR #1388); **links go in the post body on LinkedIn.** On X, the link goes in a reply to the first post (X down-ranks external links).
  - Gap: `metrics()` is stubbed for X (needs Basic tier) and LinkedIn (needs partner access). dev.to metrics work.
- `marketing/assets/` — `renderCard()` (satori + resvg) for X cards (1200×675) and OG cards (1200×630).
- `marketing/cowork/` — manual JSON draft inbox/outbox/archive and the `/gtm` skill (PostHog snapshots, lead triage). The new weekly flow replaces the inbox/outbox for social and blog; `/gtm` stays.
- Blog: `apps/website/content/blog/YYYY-MM-DD-slug.mdx`, published by merging to main. 19 posts. Canonical URL comes from `createPageMetadata`. RSS at `/blog/rss.xml`.
- Releases: Nx Release, shared version across six libraries, `vX.Y.Z` tag triggers publish; notes live in root `CHANGELOG.md` and GitHub Releases.
- `apps/lifecycle` — Dawn service on Vercel with a Growth job queue in Neon (`DATABASE_URL`), leasing, idempotency keys, and a `DELIVERY_ENABLED`-style rollout switch pattern. Ticked by `apps/website/src/app/api/cron/lifecycle` every 30 minutes.
- `migrations/` — numbered SQL migrations applied by `npm run db:migrate`.
- Out-of-repo ad-hoc pipeline: `~/.claude/scheduled-posts/` (one-off campaign `post.ts` scripts, and a `devto-queue/` of 6 older blog cross-posts scheduled 2026-11-03 through 2026-11-19 via local one-time scheduled tasks). This gets migrated into the new queue and then retired.

## Decisions Brian made

- The weekly review happens in a **Claude Code session**.
- Brian reviews all drafts; a verbal "go ahead" schedules the whole reviewed batch.
- All social posts go from **Brian's personal X and LinkedIn**.
- **The agent drafts everything**, including the full weekly blog post.
- Drafting is grounded in recent repo activity, blog posts, npm releases, and Google / social search for relevant content and recent events. Brian will work with us to tailor the "relevant content" ingestion.
- The research/drafting agent is built on **b4run** (the TypeScript Dawn framework, `~/repos/b4run`, b4.run, `@dawn-ai/*`), not the Rust `~/repos/b4`.
- The post queue lives in the **existing Neon database**, a **cron job** dispatches it, and posting **runs in the cloud**.
- Hot-take boundary: nothing political or offensive.
- Blog publish: merge at approval through normal CI, hide future-dated posts, rebuild via deploy hook at publish time.

## Architecture

```
Claude Code session  ──/week──►  week plan + drafts  ──►  Neon: marketing tables (status=draft)
   (Brian reviews/edits)                                        │  "go ahead" → status=scheduled
                                                                ▼
apps/website cron ──► apps/lifecycle tick ──► lease due posts ──► marketing/channels adapters ──► X / LinkedIn / dev.to
                                                                │
                                                                └─► blog: merge PR at publishAt ──► site deploy ──► dev.to cross-post once live
```

### Phase 1 — queue, cloud posting, `/week` (Claude drafts)

Ship a working weekly loop end to end. Claude in the session does the research and drafting directly from local sources.

1. **Data model** (new migration, `marketing_*` tables in the Growth `DATABASE_URL`). *My call on shape; builder refines:*
   - `marketing_weeks` — one row per planned week (`week_start` date, Pacific), status `drafting | approved`, approved_at, notes.
   - `marketing_posts` — one row per publishable unit: `channel` (`x | linkedin | devto | blog`), `kind` (`release | qa | news | guide | take`), `status` (`draft | scheduled | posting | posted | failed | cancelled`), `publish_at` (timestamptz), the adapter `Draft` payload as jsonb, media references, `source_refs` jsonb (PR numbers, release tags, URLs the draft is based on), `utm_campaign`, idempotency key, `result` (post id/url), attempt/lease fields, `error`.
   - `marketing_post_revisions` — original agent draft vs. Brian's final text, for voice learning.
   - `marketing_channel_credentials` — encrypted X refresh/access tokens (rotated on every refresh) and LinkedIn token + `expires_at`. *Builder's call* on encryption (envelope with a server-only key in Vercel env is fine).
   - `marketing_post_metrics` — periodic snapshots per posted item.
   - Images: store rendered PNGs in Vercel Blob (the repo already uses Blob for demo media) and reference by URL. *My call.*
2. **Dispatcher** in `apps/lifecycle`: on each tick, lease `scheduled` posts with `publish_at <= now`, post via `getAdapter()`, record result, follow the existing lease/idempotency patterns. Behind a switch (`MARKETING_POSTING_ENABLED`, exact `true`), defaulting off, like the other lifecycle switches.
   - 30-minute cron granularity is acceptable. *My call:* posts may go out up to ~30 minutes after `publish_at`; don't add a new per-minute cron for this.
   - Never retry a create after an ambiguous failure (timeout/5xx after send). Mark `failed` with the error and surface it; a human decides.
   - X threads: the reply with the link is part of the same post unit.
   - Persist rotated X tokens back to `marketing_channel_credentials`. Alert (founder notification email, existing sender) on: failed post, LinkedIn token inside 7 days of expiry, X auth failure.
3. **Blog publishing** (Brian chose this approach: merge at approval, hide until the date):
   - On "go ahead" the session opens a PR adding the MDX post with frontmatter `date` = the publish date, and it merges through the normal CI path (auto-merge). `main` is `strict` (must be up to date), so a merge-on-publish-day approach was rejected.
   - The website hides future-dated posts: `getAllPosts()` in `apps/website/src/lib/blog.ts` (today it only filters `draft`), the post route, sitemap, RSS, and anything else that lists posts must treat `date > now` like a draft in production.
   - Pages are statically generated, so at the blog row's `publish_at` the dispatcher calls a Vercel deploy hook (server-only secret) to rebuild the website. The cloud gets no GitHub write access.
   - The blog row is `posted` only once its canonical URL returns 200. Any X / LinkedIn / dev.to row that links to a blog post waits (stays `scheduled`, re-checked each tick) until that URL is live, and alerts if it's still not live a few hours after its `publish_at`.
   - If the PR hasn't merged by `publish_at`, the dispatcher alerts and holds dependent posts.
4. **dev.to cross-post**: an MDX → dev.to markdown converter (strip/translate site components like `<Callout>`, absolutize links and images, blank line between sentences per dev.to rendering) living in `marketing/`. The cross-post row's `publish_at` defaults to the blog's publish time + 2 days (matching past practice), and the dispatcher only posts once the canonical URL returns 200 and dev.to has no article with that `canonical_url` (port the checks from `~/.claude/scheduled-posts/devto-queue/post.ts`).
5. **`/week` command**: a project skill (alongside `marketing/cowork/gtm`, installed the same way) that:
   - shows last week: what posted, failures, metrics available (PostHog social-sourced sessions by `utm_campaign`, dev.to stats).
   - gathers sources for the coming week: merged PRs and commits since last week (`gh`), npm versions of the published `@threadplane/*` packages and `CHANGELOG.md`, recent blog posts, anything already queued.
   - proposes a plan: 7 X posts (one per day), 2–3 LinkedIn, 1 blog + its dev.to cross-post, tagged by `kind`, honoring the mix (releases when something shipped; 2–3 Q&A; 1+ guide; 1+ take; news when phase 3 is live).
   - drafts every item, renders cards when useful, writes rows as `draft`.
   - walks Brian through them; supports edit/regenerate/drop/move-day; records revisions.
   - on "go ahead": dry-runs every item through `validation.ts`, flips the week's drafts to `scheduled`, opens the blog PR. Prints the final schedule.
   - can also be asked mid-week to show the queue, pull or reschedule an item.
   - Default posting times (Pacific): X 8:30am daily, LinkedIn Tue/Wed/Thu 8:00am, blog Tuesday 9:00am. *My calls,* adjustable per week.
6. **Migrate and retire** the `~/.claude/scheduled-posts/devto-queue` items into `marketing_posts` and delete the local one-time scheduled tasks, after confirming nothing double-posts.
7. **Voice**: add the social register section to `docs/gtm/voice.md`; add a lint step in `/week` that flags banned words (from `docs/gtm/messaging.md` and `public-copy-contract.ts`), competitor names, em dashes, and politics keywords before scheduling. Flags are shown to Brian, not auto-fixed. (This is a check in the drafting flow, not a CI gate.) *My call on severity:* competitor-name and politics flags **block** scheduling for that item until Brian confirms that specific item in the session (the blanket "go ahead" does not cover them, matching the standing "approve each instance" rule). Banned words and em dashes are warnings only.

**Credentials (my call).** Once phase 1 ships, Neon (`marketing_channel_credentials`) is the only holder of X and LinkedIn tokens. X rotates its refresh token on every refresh, so two holders break each other. `marketing:channels:x:auth` and `marketing:channels:linkedin:auth` write the new tokens to Neon (target environment chosen explicitly) instead of printing them for `.env`; local dry runs and smoke tests read from Neon or run payload-only with no auth. Local posting outside the queue ends; anything ad hoc goes into the queue with `publish_at = now`.

**Migration timing (my call).** Items in `~/.claude/scheduled-posts/devto-queue` dated before phase 1 is live in production stay on their local scheduled tasks. Only items dated after go-live move into `marketing_posts`, and their local tasks are deleted in the same step. No dev.to-only early milestone.

### Phase 2 — content agent on b4run

Move research and drafting out of the session prompt into a b4run (`@dawn-ai/*`) agent, following `apps/growth-research`'s structure and LangSmith deployment. `/week` calls the agent to produce the week's plan and drafts, then the session remains the review surface. The agent gets tools for each source (GitHub, npm, blog, queue history, metrics, revisions as voice examples) and a skill per content kind. Evals (`@dawn-ai/evals`) for voice rules and anti-goals.

### Phase 3 — news and relevant-content ingestion

Designed together with Brian before it's built. Open questions for that design: which sources (search APIs, RSS of specific blogs, X/HN/Reddit search, release feeds of adjacent projects), how relevance is scored, how often it runs, and how items reach the plan. Until then `kind = news` is drafted only from things Brian points at in the session.

### Phase 4 — metrics loop

Collect metrics per post (X once API tier allows, LinkedIn if partner access arrives, dev.to now, PostHog sessions by UTM always) into `marketing_post_metrics`, and feed a "what worked" summary into each week's plan.

## Constraints

- Every link to threadplane.ai carries `utm_source=<channel>&utm_medium=social&utm_campaign=<slug>`.
- X: link in a reply, card image on the first post. LinkedIn: link in the post body (no first comment without partner access).
- LinkedIn tokens can't refresh; Brian re-runs `marketing:channels:linkedin:auth` every ~60 days, and the stored token must be updatable without a redeploy.
- Lifecycle conventions: server-only secrets, switches that accept only exact `true`, preview and production on separate Neon resources, migrations applied before deploy.
- Release versioning, lockfile, and CI conventions per the repo's existing rules.

## Left to the builder

- Exact table/column names, indexes, and whether posting reuses the Growth job lease machinery or has its own.
- Where the dispatcher code lives (a new module in `apps/lifecycle/src/` vs. a small `libs/marketing` shared with `/week`).
- How `/week` writes to Neon (direct `DATABASE_URL` from Brian's machine with a script, or an authenticated lifecycle endpoint).
- Converter details for MDX components.
- Test strategy, with the adapters' existing dry-run mode used for end-to-end checks.
