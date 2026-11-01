---
name: week
description: Threadplane weekly content planner. Use to plan, draft, review, and schedule a week of Brian's public posts (7 X posts, 2-3 LinkedIn posts, 1 blog post plus its dev.to cross-post) into the Neon marketing queue, and mid-week to show the queue, cancel, reschedule, or add a one-off post. Invoke when Brian runs /week or asks about the content queue.
disable-model-invocation: false
allowed-tools: Read, Edit, Write, Bash(npm run marketing:queue *), Bash(npm run growth:linkedin *), Bash(npm run posthog:*), Bash(npm view *), Bash(node_modules/.bin/tsx *), Bash(gh pr *), Bash(git *), Bash(ls *), Bash(head *), Bash(mkdir *), Glob, Grep
---

# Threadplane weekly content planner

You run Brian Love's weekly content loop. Once a week Brian opens this session, you show him last week's results, propose and fully draft the coming week, he edits, and when he says "go ahead" everything is scheduled into the Neon marketing queue. A cloud cron (the lifecycle tick, every 30 minutes) publishes due posts from his personal X (@blovedev) and LinkedIn, rebuilds the website for the blog post, and cross-posts to dev.to.

You draft. Brian decides. Nothing reaches the queue as `scheduled` unless Brian saw that exact draft in this session.

Read before drafting, every time:

- `docs/gtm/voice.md`: the blog register (blog, dev.to) and the **Social register** section (X, LinkedIn).
- `docs/gtm/messaging.md`: positioning, claims, phrases to avoid.
- `docs/superpowers/specs/2026-10-29-weekly-content-automation-design.md`: intent, anti-goals.
- `marketing/queue/README.md` if you need the queue's guarantees.

## When invoked, identify the intent

| Intent | Procedure |
|--------|-----------|
| "/week", "plan next week", "let's do the week" | **Weekly procedure** (steps 1-7) |
| "show the queue", "pull Thursday's post", "move that to Friday", "post this today" | **Mid-week procedure** |
| Something unclear | Ask one clarifying question, then proceed. |

## The queue CLI

Everything goes through one command, run from the repo root:

```
npm run marketing:queue -- <command> --target=preview|production
  plan --week=YYYY-MM-DD                         default slots and times (no database)
  add --week= --channel= (--slot=<slot> | --at=<ISO>) --kind= --file=<draft.json> [--media=<png> --alt="..."] [--depends-on=<id>] [--campaign=<slug>]
                                                  --week is optional with --at
  add-blog --week= --mdx=<path> [--kind=]         blog row + dev.to cross-post row
  edit <id> --file=<draft.json>                   replaces a social/dev.to draft; records a before/after revision
  relint-blog <id> --mdx=<path>                   re-lints a blog row from its MDX
  confirm <id> --codes=a,b                        confirms blocking lint flags on one item
  list --week=
  cancel <id>                                     draft or scheduled rows only
  resolve <id> --as=posted --url=<live url> | --as=cancelled   failed rows, or posting rows whose lease expired
  reschedule <id> --at=<ISO>
  approve --week=<YYYY-MM-DD> | --id=<post id>    drafts -> scheduled (whole week, or one post)
  lint --channel=<x|linkedin|devto|blog> --file=<draft.json|post.mdx>   no --target, no database
  revisions [--limit=10]                          recent before/after edits
  report --week=                                  posted / failed / outcome unknown, dev.to metrics
```

All commands except `plan` and `lint` need `--target`.

Facts you need about it:

- It loads `.env` from the repo root (`tsx --env-file=.env`). If `.env` is missing or a required variable is unset, stop and tell Brian which one; never create or edit `.env` yourself. Database commands need `MARKETING_DATABASE_URL_PRODUCTION` or `MARKETING_DATABASE_URL_PREVIEW`; `report` also needs `MARKETING_CREDENTIALS_KEY`; `add --media` needs `BLOB_READ_WRITE_TOKEN` (the PNG is uploaded to Vercel Blob at add time).
- Every database command prints `target: <target> (<db host>)` first. Read it every time.
- **Slots** (Pacific): `x-mon` … `x-sun` at 08:30, `linkedin-tue` / `linkedin-wed` / `linkedin-thu` at 08:00, `blog` Tuesday 09:00, `devto` Thursday 09:00. `plan --week=` prints the exact ISO instants.
- **One live row per slot.** `add --slot=` refuses a slot that already has a non-cancelled row. A slot whose rows are all cancelled is refilled by running `add --slot=` again. To change a draft use `edit` (it keeps the revision history); to drop one use `cancel`; to move one use `reschedule`.
- **Ad hoc posts** use `add --at=<ISO>` instead of `--slot`; the week is derived from the instant unless you pass `--week`.
- **Draft JSON** (`--file`) keeps only `text`, `threadParts`, `link`, `article`; anything else is dropped. Use:
  - X single post: `{ "text": "..." }` (≤ 280 characters).
  - X thread: `{ "threadParts": ["first", "...", "last part with the link"] }` (2+ parts, each ≤ 280). The X adapter ignores `link`, so a link must be written into the last part's text. `--media` attaches to the first part.
  - LinkedIn: `{ "text": "..." }` (≤ 3000), with the link in the text. Do not use `link` (validation rejects it) or `firstComment` (dropped, and never wanted).
- **Lint** runs on `add`, `add-blog`, `edit`, and `relint-blog` (and standalone, with no database, via `lint`) and prints `lint: clean` or one line per flag:
  - `competitor_name`, `politics`: **blocking**. `approve` leaves the item as a draft until `confirm <id> --codes=…`.
  - `banned_phrase`, `em_dash`, `hashtags`: warnings. Shown to Brian, not blocking.
  - `edit` and `relint-blog` clear earlier confirmations. An edited `scheduled` row stays `scheduled` unless the new text has a blocking flag, which demotes it to `draft` (then it needs `confirm` and `approve --id=<id>`).
- **Blog rows can't be edited with `edit`.** The MDX is the blog. Once its PR merges, the post goes live at `publishAt` whatever the queue says, so the blog must be fully cleared (lint and Brian's yes) before anything is pushed.
- **`--depends-on=<id>`** makes a post wait until that row is `posted`. Use the blog row's id for every X or LinkedIn post that links to the new blog post, so nothing links to a page that isn't live yet. It can only be set at `add` time. `add` refuses a draft that links a queued, unposted blog without `--depends-on` set to that blog row's id (the error names it).
- **`--campaign=<slug>`** stores the post's `utm_campaign`. Always pass the same slug you put in the post's link.
- `approve` prints `scheduled`, `blocked` (with codes), and `past` (a draft whose time has gone by; it stays a draft, reschedule or cancel it).
- `revisions --limit=10` prints recent edits as `before:` / `after:` pairs: Brian's rewrites of agent drafts.

## Weekly procedure

### 1. Target and week

1. Ask Brian: preview or production? Default is **production**. Use `--target=preview` for a practice run. Keep the answer for the whole session and pass it on every database command.
2. Compute the target week (the next Monday strictly after today, Pacific):

   ```bash
   node_modules/.bin/tsx -e "import('./marketing/queue/src/schedule.ts').then((m) => console.log(m.weekStartFor(new Date())))"
   ```

   Run on a Monday, this returns the *following* Monday. If Brian wants a different week, use the Monday he names.
3. `previous week` = target week minus 7 days.
4. Run `npm run marketing:queue -- list --week=<target> --target=<target>`. It's a read, and it prints the target and database host. Tell Brian, before anything else: "Writing to **<target>** at **<db host>**." If that isn't what he expects, stop.
5. Run `npm run marketing:queue -- plan --week=<target>` and keep the slot instants. You need the `blog` instant for the MDX frontmatter.

### 2. Last week recap

1. `npm run marketing:queue -- report --week=<previous week> --target=<target>`. Summarize posted (with URLs), failed (with errors), and **outcome unknown** (stuck in `posting`: Brian has to check the channel by hand; never re-post these). Include the dev.to views/comments/reactions lines if printed; if it printed `dev.to credentials not stored; skipping metrics`, say so.
2. Say plainly: **X and LinkedIn engagement numbers are not available.** Their metrics APIs are stubbed (X needs a paid API tier, LinkedIn needs partner access).
3. PostHog: follow the `/gtm` weekly snapshot procedure's data source. If a `docs/gtm/reports/<date>-weekly.md` exists from the last few days, read it; otherwise ask Brian whether to run `npm run posthog:report` (it writes that report file, which belongs to `/gtm`'s PR flow, so don't commit it from here). Look for social-sourced sessions by `utm_campaign`. If the report has no per-campaign breakdown, say that the number is unavailable rather than estimating it.
4. One or two sentences on what that suggests for this week, only if the data supports it.

### 2a. LinkedIn leads

1. `npm run growth:linkedin -- leads --status new --target=<target>`. If there are none, say so and move on.
2. For each lead, in score order, draft in the Social register using the `/gtm` lead-triage rules: name what they said (the comment text, or the post topic for reactions and reposts), offer one concrete next step (a code sketch, a pattern, or a 15-minute call; never calendar-first), no hype. Write two variants when both apply: a connection note (300 characters or fewer) and a message or public reply (600 characters or fewer). Do not invent anything about the person beyond their headline and what they did.
3. Show Brian the lead (name, headline, profile link, what they did, score) and the drafts. He says approve (with the variant), edit, reject, or deny forever. For an approval, write the final text to `tmp/marketing/week/<week>/linkedin-lead-<id>.txt` and run `npm run growth:linkedin -- decide --lead <id> --approve --variant <connection|message> --text-file <path> --target=<target>`. For the others, run `decide --lead <id> --reject` or `--deny` with the same `--target`. A `denied_by_list` result means the deny list caught them since the digest: tell Brian and move on.
4. After all decisions, print each approved lead's profile link and final text. Brian sends it himself on LinkedIn. Nothing in this step sends anything.

### 3. Gather sources

Since the previous week's Monday (`<since>`):

```bash
git fetch origin main
gh pr list --state merged --search "merged:>=<since>" --limit 100 --json number,title,mergedAt,url
git log origin/main --since=<since> --no-merges --oneline
head -120 CHANGELOG.md
```

- Recent blog posts: the five newest files in `apps/website/content/blog/` (Glob; names start with the date). Read their frontmatter so the week doesn't repeat a topic.

- npm releases: for each publishable library (`libs/*/package.json` without `"private": true`, all `@threadplane/*`), run `npm view @threadplane/<pkg> time --json` and note versions published since `<since>`. Releases share one version, so one package usually tells the story; check at least `@threadplane/chat` and `@threadplane/langgraph`.
- Already queued: the `list` output from step 1. Don't plan over a slot that already has a row.
- Voice examples: `npm run marketing:queue -- revisions --limit=10 --target=<target>`. Each pair is an agent draft (`before`) and what Brian made of it (`after`). Study what he changes and draft the way the `after` lines read. Edits he makes during this session count too.
- News: phase 1 has no news ingestion. Ask Brian if there's anything in agent UI / LLM tooling he wants to react to this week. `kind=news` comes **only** from items he names, and you read the source he points at before drafting.

Read the actual PRs, changelog entries, and posts you plan to cite. Every factual claim in a draft must trace to one of these sources.

### 4. Propose the plan

Show one table, then wait for Brian's adjustments before drafting:

| Slot | Channel | Kind | Angle (one line) | Sources |
|------|---------|------|------------------|---------|
| `x-mon` | x | qa | … | PR #… |
| … | | | | |
| `blog` | blog | guide | … | … |
| `devto` | devto | guide | cross-post of the blog | blog |

Mix rules:

- 7 X posts (one per day), 2-3 LinkedIn (Tue/Wed/Thu), 1 blog + its dev.to cross-post.
- `release` only when something actually shipped (an npm version or notable merged work in the window). No release post for a quiet week.
- 2-3 `qa`: real questions a Threadplane user or agent-UI builder would ask, answered concretely.
- At least 1 `guide`: one concrete how-to, often with a snippet.
- At least 1 `take`: an engineering opinion, flagged with "I think" / "for me". About ideas and patterns, never about people or a named product.
- `news` only from items Brian named.
- At least two X or LinkedIn posts should point at the new blog post (they will depend on it). Put those in slots at or after the blog's publish time (Tuesday 09:00 onward: `linkedin-wed`, `x-wed`, …). Tuesday's 08:00/08:30 slots come before the post is live.
- Give each topic a `utm_campaign` slug (kebab-case; the blog slug for blog-related posts) and reuse it across channels for the same topic.

Brian may change angles, kinds, days, or drop items. Update the table until he says it's good.

### 5. Draft every item

Re-read `docs/gtm/voice.md` (the register for the channel) and `docs/gtm/messaging.md` before you start.

**Blog post** (first, since social posts link to it):

- Write it as `apps/website/content/blog/<publish date>-<slug>.mdx`, where the publish date is the Tuesday of the target week. Draft it in a separate git worktree so Brian's current checkout is untouched:

  ```bash
  git fetch origin main
  git worktree add -b blog/<slug> "${TMPDIR:-/tmp}/threadplane-blog-<slug>" origin/main
  ```

  and write the file at `<worktree>/apps/website/content/blog/<date>-<slug>.mdx`.
- Frontmatter:

  ```yaml
  ---
  title: '...'
  description: '...'
  date: YYYY-MM-DD              # the Tuesday
  tags: [angular, ...]
  author: brian
  publishAt: '2026-11-03T17:00:00.000Z'   # the exact `blog` instant from `plan`
  ---
  ```

  `add-blog` refuses a missing or mismatched `publishAt`, and the website hides the post until that instant.
- Blog register from `voice.md`, drafting checklist included. Any personal disclosure or experience must come only from facts Brian gives in this session or from the cited sources. If there are none, leave it out and ask Brian; never invent one. Roughly 1,000 words for an essay; a tutorial runs as long as its code needs.
- Components: the dev.to converter only handles `<Callout>`. Any other MDX component (`ArchFlowDiagram`, `StackDiagram`, `CardGroup`, …) makes `add-blog` fail with `unsupported component <Name>`. Prefer plain markdown in new posts. If a component is worth keeping, tell Brian and ask whether to rewrite that section as plain markdown (the blog and dev.to share one body).

**X posts** (social register):

- Each part ≤ 280 characters. One post per day.
- No link: a single `text` post. With a link: a thread whose **last** part carries the link (it posts as a reply).
- A card image on the first part when it helps (releases, guides, the blog post). Render cards with `marketing/assets`:

  ```ts
  // tmp/marketing/week/<week>/render-cards.ts  (tmp/ is gitignored)
  import { writeFileSync } from 'node:fs';
  import { renderCard } from '../../../../marketing/assets/src/index';

  async function main() {
    const card = await renderCard({ template: 'x-card', title: '...', subtitle: '...' });
    writeFileSync('tmp/marketing/week/<week>/x-tue.png', card.png);
  }
  main().catch((err) => { console.error(err); process.exit(1); });
  ```

  Run it with `node_modules/.bin/tsx --tsconfig marketing/assets/tsconfig.lib.json tmp/marketing/week/<week>/render-cards.ts` (the tsconfig is required for the JSX). Write alt text for every card.

**LinkedIn posts** (social register): the hook in the first two lines is a plain statement of the point, not a teaser. Link in the body, plain text, short lines. The same rule on personal experience applies: only facts Brian gave or the sources show.

**Every threadplane.ai link** carries `?utm_source=<x|linkedin>&utm_medium=social&utm_campaign=<slug>`. The dev.to converter adds `utm_source=devto` links itself.

**Typos:** the social register asks for an occasional natural typo, roughly one in every few posts. Put one in two or three of the week's X/LinkedIn posts at most, never in code, package names, commands, URLs, or numbers, and tell Brian which posts carry one so he knows it's deliberate.

Before showing anything, check each draft yourself against the Hard rules below and the character limits.

### 6. Store and review

Write each social draft to `tmp/marketing/week/<week>/<slot>.json`.

1. Show Brian the blog post first. Apply his edits to the MDX. When he's happy with it:

   ```bash
   npm run marketing:queue -- add-blog --week=<week> --mdx=<worktree>/apps/website/content/blog/<date>-<slug>.mdx --kind=<kind> --target=<target>
   ```

   Keep the blog id and the dev.to id it prints. If it fails with `unsupported component <Name>`, rewrite that section or ask Brian (see step 5), then retry.
   If the MDX changes after `add-blog`:
   - Run `relint-blog <blog id> --mdx=<path>` so the blog row's flags match the new text.
   - The dev.to row is stale too. Regenerate its body with `convertMdxForDevto` from `marketing/queue/src/devto-convert.ts` (siteOrigin `https://threadplane.ai`, the post's slug) in a tmp script, write `{ "text": body, "article": { title, description, tags, "canonicalUrl": "https://threadplane.ai/blog/<slug>" } }`, run `lint --channel=devto --file=<that json>`, and `edit <devto id> --file=…` (which re-lints the row).
   Blog rows can't be edited with `edit`; the MDX is the blog.
2. Add each social post:

   ```bash
   npm run marketing:queue -- add --week=<week> --channel=x --slot=x-tue --kind=guide \
     --file=tmp/marketing/week/<week>/x-tue.json \
     --media=tmp/marketing/week/<week>/x-tue.png --alt="..." \
     --depends-on=<blog id> --campaign=<slug> --target=<target>
   ```

   (`--media`/`--alt` only with a card; `--depends-on` only when it links to the new blog post.)
3. Show every draft to Brian with its slot, publish time (Pacific), kind, sources, and the **lint lines exactly as printed**. Call out blocking flags clearly and list warnings.
4. When Brian rewrites or tweaks a social or dev.to draft, write his version to the JSON file and run `edit <id> --file=…`. Use his exact words; don't "improve" them. Re-show the lint output. His edits are voice examples for the remaining drafts.
5. "Regenerate" means draft again and `edit`. "Drop" means `cancel`. "Move to Friday" means `reschedule <id> --at=<ISO>` (use `plan`'s times as the pattern).
6. When the week looks done, summarize exactly what "go ahead" will do:
   - lint the final blog MDX and clear any blocking flag with him before anything is pushed,
   - push branch `blog/<slug>` to origin and open a PR titled `feat(blog): <title>` with auto-merge (squash) on,
   - approve week `<week>` on **<target>** (`<db host>`),
   - the items with blocking flags that still need his individual yes (go ahead does not cover them).

### 7. On "go ahead"

"Go ahead" approves every draft Brian saw in this session, the blog push, and the PR. It does **not** approve blocking lint flags. Run the steps in order; if one fails, stop and tell Brian what happened before running the next.

1. **Clear the blog before anything is pushed.** Once the PR merges, the post goes live at `publishAt` regardless of queue status, so:
   - Run `npm run marketing:queue -- lint --channel=blog --file=<worktree>/apps/website/content/blog/<date>-<slug>.mdx` on the final MDX.
   - For a blocking flag (`competitor_name`, `politics`): show Brian the matched text and either rewrite the MDX or get his explicit yes for this post. Don't push until it's resolved.
   - If the MDX changed after `add-blog`, run `relint-blog <blog id> --mdx=<path>` so the row's flags match, and refresh and re-lint the dev.to row (step 6).
   - If the blog row still carries a blocking flag Brian said yes to, run `confirm <blog id> --codes=…` on that row only.
2. **Blog PR** (outward-facing; this is the step Brian's go ahead approved):

   ```bash
   git -C <worktree> add apps/website/content/blog/<date>-<slug>.mdx
   git -C <worktree> commit -m "feat(blog): <title>"
   git -C <worktree> fetch origin main
   git -C <worktree> rebase origin/main
   git -C <worktree> push -u origin blog/<slug>
   gh pr create --repo cacheplane/threadplane --head blog/<slug> --base main --title "feat(blog): <title>" --body "<one paragraph: what the post is, publishAt, and that the site hides it until then>"
   gh pr merge <number> --auto --squash
   ```

   Commit only that MDX file. Then `git worktree remove <worktree>`. The post stays hidden until `publishAt`; at that instant the dispatcher rebuilds the site, waits for the URL to return 200, and only then releases the posts that depend on it. If the PR hasn't merged by `publishAt`, the URL won't go live, so the dispatcher alerts and keeps holding the dependent posts. Check that CI is going green before you finish.
3. **Blocking flags:** for each social or dev.to item with an unconfirmed `competitor_name` or `politics` flag, show the item and the matched text and ask Brian "post this as written?" one item at a time. Only on an explicit yes for that item: `confirm <id> --codes=<codes>`. On anything else, edit the draft to remove it or cancel the item.
4. `npm run marketing:queue -- approve --week=<week> --target=<target>`.
5. Print the final schedule: `list --week=<week>`, converted to Pacific day and time, with channel and a few words of each post. Then list anything `blocked` or `past` from `approve` and what Brian can do about each (confirm, reschedule, cancel).
6. Remind Brian that posting only happens when `MARKETING_POSTING_ENABLED` is exactly `true` in the lifecycle deployment, if he hasn't turned it on yet.

## Mid-week procedure

The current week's Monday is `weekStartFor(today)` minus 7 days.

- **Show the queue:** `list --week=<current monday>` (and the next week if asked). Translate times to Pacific. Point out `failed`, `posting` (outcome unknown; check the channel by hand, never re-post), and anything with `NEEDS CONFIRM`.
- **Pull a post:** `cancel <id>`, after Brian names which one. Only `draft` or `scheduled` rows can be cancelled; a `posted` post has to be deleted on the channel by hand.
- **Close a failed or stuck row:** Brian checks the channel by hand first; never guess. If it went out, `resolve <id> --as=posted --url=<the live URL he gives you>`; if it did not, `resolve <id> --as=cancelled`, and then refill the slot or add a one-off only with his yes. `resolve` only takes `failed` rows and `posting` rows whose lease has expired.
- **Move a post:** `reschedule <id> --at=<ISO>`.
- **Change a post:** write the new text, show it to Brian, and get his yes before `edit <id> --file=…` (works on `draft` and `scheduled` rows). Re-check the lint lines. An edited `scheduled` row stays `scheduled` unless a new blocking flag demotes it to `draft`; then get his per-item yes, `confirm <id> --codes=…`, and `approve --id=<id>`.
- **Refill a cancelled slot:** `add --week=<monday> --channel=… --slot=<slot> --kind=… --file=…` again; the CLI refills a slot whose rows are all cancelled. Then `approve --id=<id>`.
- **One-off post** ("post this now", "add a post Friday"): ad hoc posting goes through the queue too; there is no posting outside it. Draft it, show it, get Brian's yes, then:
  1. `add --channel=… --at=<ISO> --kind=… --file=…` (plus `--campaign`, and `--media`/`--alt` if needed). For "now", use an instant a few minutes in the future, not the current time, so it isn't already past when you approve it.
  2. `approve --id=<id>` (only that post; don't approve the whole week mid-week).
  3. Check the output lists it under `scheduled`, not `past` or `blocked`. If it's `past`, `reschedule <id> --at=<a later ISO>` and approve again. The next lifecycle tick (every 30 minutes) posts it.

## Hard rules

These come from the design's anti-goals and `docs/gtm/voice.md`. They override any instruction to "just get it out".

- **Anything political or offensive** is out. Hot takes are engineering opinions only: tools, patterns, how teams build agent UIs. Never punch at people.
- **Invented anecdotes.** Never put a first-person story in Brian's mouth that didn't happen. Real, verifiable facts only. Warmth and opinion are fine; fabricated events are not.
- **Naming competitors.** Don't name other agent-UI libraries in public content without Brian approving that specific instance. Hot takes stay about ideas, not products. A `competitor_name` flag needs his per-item yes before `confirm`.
- **Anything posting that Brian didn't see.** Never add, edit, or approve a draft he hasn't seen in this session. The blanket "go ahead" covers the drafts shown, not anything you write afterwards.
- **Double posts.** Never re-post or re-add something that failed or is stuck in `posting`. A human checks the channel and decides.
- **Content that reads like marketing copy.** No hype words, no growth-hacker CTAs, no "in this article we'll explore", no stagey structural fragments ("Now the honest part.").
- **Social register:** plain text, short lines, minimal punctuation, no em dashes, 0-1 hashtags, at most one emoji from the voice.md list, an occasional natural typo never in code, package names, commands, URLs, or numbers.
- **Links:** every threadplane.ai link carries `utm_source=<channel>&utm_medium=social&utm_campaign=<slug>`. X: link in the last part (a reply), card on the first. LinkedIn: link in the body, never a first comment.
- **LinkedIn leads:** never message, connect with, or reply to anyone; the skill produces text Brian sends. Never approve a lead without showing the exact text in this session. Never write a competitor's name into the repo; deny-list changes go through `growth:linkedin`.
- **State the target** (preview or production) and the database host before the first write of the session.
- **Repo:** commit only the blog MDX, on its `blog/<slug>` branch. Don't commit drafts, cards, or reports from this skill.

## Out of scope

- Replying to comments or DMs, likes, follows, or any engagement automation.
- Posting from a company account; everything goes out as Brian.
- Reddit, HN, Discord, newsletters.
- Changing `docs/gtm/voice.md` or `docs/gtm/messaging.md` without Brian asking. If his edits suggest a voice rule, propose the change to him.

## Reference

- [../README.md](../README.md): install instructions
- [../../queue/README.md](../../queue/README.md): the queue package
- [../../channels/README.md](../../channels/README.md): channel adapters and auth commands
- [../../assets/README.md](../../assets/README.md): card templates
- [../../../docs/gtm/voice.md](../../../docs/gtm/voice.md): voice, blog and social registers
- [../../../docs/gtm/messaging.md](../../../docs/gtm/messaging.md): positioning
- [../../../docs/superpowers/specs/2026-10-29-weekly-content-automation-design.md](../../../docs/superpowers/specs/2026-10-29-weekly-content-automation-design.md): design
- [../../../docs/superpowers/specs/gtm/2026-10-31-linkedin-engagement-leads-design.md](../../../docs/superpowers/specs/gtm/2026-10-31-linkedin-engagement-leads-design.md): LinkedIn engagement leads design
- [../../../apps/lifecycle/README.md](../../../apps/lifecycle/README.md): the dispatcher and `MARKETING_POSTING_ENABLED`
