---
name: week
description: Threadplane weekly content planner. Use to plan, draft, review, and schedule a week of Brian's public posts (7 X posts, 2-3 LinkedIn posts, 1 blog post plus its dev.to cross-post) into the Neon marketing queue, and mid-week to show the queue, cancel, reschedule, or add a one-off post. Invoke when Brian runs /week or asks about the content queue.
disable-model-invocation: false
allowed-tools: Read, Edit, Write, Bash(npm run marketing:queue *), Bash(npm run posthog:*), Bash(npm view *), Bash(node_modules/.bin/tsx *), Bash(gh pr *), Bash(git *), Bash(ls *), Bash(head *), Bash(mkdir *), Glob, Grep
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
  add --week= --channel= --slot= --kind= --file=<draft.json> [--media=<png> --alt="..."] [--depends-on=<id>] [--campaign=<slug>]
  add-blog --week= --mdx=<path> [--kind=]         blog row + dev.to cross-post row
  edit <id> --file=<draft.json>                   replaces the draft; records a before/after revision
  confirm <id> --codes=a,b                        confirms blocking lint flags on one item
  list --week=
  cancel <id>
  reschedule <id> --at=<ISO>
  approve --week=                                 drafts -> scheduled
  report --week=                                  posted / failed / outcome unknown, dev.to metrics
```

Facts you need about it:

- It loads `.env` from the repo root (`tsx --env-file=.env`). If `.env` is missing or a required variable is unset, stop and tell Brian which one; never create or edit `.env` yourself. Database commands need `MARKETING_DATABASE_URL_PRODUCTION` or `MARKETING_DATABASE_URL_PREVIEW`; `report` also needs `MARKETING_CREDENTIALS_KEY`; `add --media` needs `BLOB_READ_WRITE_TOKEN` (the PNG is uploaded to Vercel Blob at add time).
- Every database command prints `target: <target> (<db host>)` first. Read it every time.
- **Slots** (Pacific): `x-mon` … `x-sun` at 08:30, `linkedin-tue` / `linkedin-wed` / `linkedin-thu` at 08:00, `blog` Tuesday 09:00, `devto` Thursday 09:00. `plan --week=` prints the exact ISO instants.
- **One row per slot per week, forever.** The idempotency key is `<channel>:<week>:<slot>` and a cancelled row keeps it. So: to change a draft use `edit`, never cancel and re-add. To drop an item use `cancel` (that slot can't be refilled that week). To move an item use `reschedule`.
- **Draft JSON** (`--file`) keeps only `text`, `threadParts`, `link`, `article`; anything else is dropped. Use:
  - X single post: `{ "text": "..." }` (≤ 280 characters).
  - X thread: `{ "threadParts": ["first", "...", "last part with the link"] }` (2+ parts, each ≤ 280). The X adapter ignores `link`, so a link must be written into the last part's text. `--media` attaches to the first part.
  - LinkedIn: `{ "text": "..." }` (≤ 3000), with the link in the text. Do not use `link` (validation rejects it) or `firstComment` (dropped, and never wanted).
- **Lint** runs on `add`, `add-blog`, and `edit` and prints `lint: clean` or one line per flag:
  - `competitor_name`, `politics`: **blocking**. `approve` leaves the item as a draft until `confirm <id> --codes=…`.
  - `banned_phrase`, `em_dash`, `hashtags`: warnings. Shown to Brian, not blocking.
  - `edit` clears earlier confirmations; a scheduled item that picks up a blocking flag goes back to draft.
- **`--depends-on=<id>`** makes a post wait until that row is `posted`. Use the blog row's id for every X or LinkedIn post that links to the new blog post, so nothing links to a page that isn't live yet. It can only be set at `add` time.
- **`--campaign=<slug>`** stores the post's `utm_campaign`. Always pass the same slug you put in the post's link.
- `approve` prints `scheduled`, `blocked` (with codes), and `past` (a draft whose time has gone by; it stays a draft, reschedule or cancel it).
- There is **no command that reads revisions** (`marketing_post_revisions`) yet. Don't query the database directly to get them.

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
- Voice examples: there is no CLI command for recent revisions yet. Tell Brian once per session ("no revisions reader yet, drafting from voice.md and your edits in this session") and use any edits he makes during this session as examples for the rest of the drafts.
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
- At least two X or LinkedIn posts should point at the new blog post (they will depend on it).
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
- Blog register from `voice.md`, drafting checklist included. Roughly 1,000 words for an essay; a tutorial runs as long as its code needs.
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

**LinkedIn posts** (social register): hook in the first two lines, link in the body, plain text, short lines.

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
   If the MDX changes after `add-blog`, the dev.to row is stale. Regenerate its body with `convertMdxForDevto` from `marketing/queue/src/devto-convert.ts` (siteOrigin `https://threadplane.ai`, the post's slug) in a tmp script, write `{ "text": body, "article": { title, description, tags, "canonicalUrl": "https://threadplane.ai/blog/<slug>" } }`, and `edit <devto id> --file=…`. Blog rows themselves can't be edited with `edit`; the MDX is the blog.
2. Add each social post:

   ```bash
   npm run marketing:queue -- add --week=<week> --channel=x --slot=x-tue --kind=guide \
     --file=tmp/marketing/week/<week>/x-tue.json \
     --media=tmp/marketing/week/<week>/x-tue.png --alt="..." \
     --depends-on=<blog id> --campaign=<slug> --target=<target>
   ```

   (`--media`/`--alt` only with a card; `--depends-on` only when it links to the new blog post.)
3. Show every draft to Brian with its slot, publish time (Pacific), kind, sources, and the **lint lines exactly as printed**. Call out blocking flags clearly and list warnings.
4. When Brian rewrites or tweaks a draft, write his version to the JSON file and run `edit <id> --file=…`. Use his exact words; don't "improve" them. Re-show the lint output. His edits are voice examples for the remaining drafts.
5. "Regenerate" means draft again and `edit`. "Drop" means `cancel`. "Move to Friday" means `reschedule <id> --at=<ISO>` (use `plan`'s times as the pattern).
6. When the week looks done, summarize exactly what "go ahead" will do:
   - push branch `blog/<slug>` to origin and open a PR titled `feat(blog): <title>` with auto-merge (squash) on,
   - approve week `<week>` on **<target>** (`<db host>`),
   - the items with blocking flags that still need his individual yes (go ahead does not cover them).

### 7. On "go ahead"

"Go ahead" approves every draft Brian saw in this session, the blog push, and the PR. It does **not** approve blocking lint flags. Run the steps in order; if one fails, stop and tell Brian what happened before running the next.

1. **Blog PR** (outward-facing; this is the step Brian's go ahead approved):

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
2. **Blocking flags:** for each item with an unconfirmed `competitor_name` or `politics` flag, show the item and the matched text and ask Brian "post this as written?" one item at a time. Only on an explicit yes for that item: `confirm <id> --codes=<codes>`. On anything else, edit the draft to remove it or cancel the item.
3. `npm run marketing:queue -- approve --week=<week> --target=<target>`.
4. Print the final schedule: `list --week=<week>`, converted to Pacific day and time, with channel and a few words of each post. Then list anything `blocked` or `past` from `approve` and what Brian can do about each (confirm, reschedule, cancel).
5. Remind Brian that posting only happens when `MARKETING_POSTING_ENABLED` is exactly `true` in the lifecycle deployment, if he hasn't turned it on yet.

## Mid-week procedure

The current week's Monday is `weekStartFor(today)` minus 7 days.

- **Show the queue:** `list --week=<current monday>` (and the next week if asked). Translate times to Pacific. Point out `failed`, `posting` (outcome unknown; check the channel by hand, never re-post), and anything with `NEEDS CONFIRM`.
- **Pull a post:** `cancel <id>`, after Brian names which one. Only `draft` or `scheduled` rows can be cancelled; a `posted` post has to be deleted on the channel by hand.
- **Move a post:** `reschedule <id> --at=<ISO>`.
- **Change a post:** `edit <id> --file=…` (works on `draft` and `scheduled` rows; re-check the lint lines).
- **One-off post** ("post this today", "add a post Friday"): ad hoc posting goes through the queue too; there is no posting outside it. Draft it, show it, get Brian's yes, then:
  1. `list --week=<current monday>` to find a slot for that channel with no row yet. If every slot for that channel is taken, tell Brian the CLI can't add a second post to a taken slot yet (the idempotency key is per week and slot) and stop. Don't work around it.
  2. `add --week=<current monday> --channel=… --slot=<free slot> --kind=… --file=…` (plus `--campaign`, and `--media`/`--alt` if needed).
  3. `reschedule <id> --at=<ISO>` for the time he wants ("now" is fine: the next 30-minute tick picks it up).
  4. Check `list` for other drafts in that week first, because `approve --week=<current monday>` schedules every clean future draft in the week. Then run it.

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
- [../../../apps/lifecycle/README.md](../../../apps/lifecycle/README.md): the dispatcher and `MARKETING_POSTING_ENABLED`
