# Marketing queue rollout and operations

Operator runbook for turning on the weekly content queue: the Neon post queue
(`marketing_*` tables), the lifecycle dispatcher that posts on its 30-minute
tick, and the `/week` skill that fills the queue. The code ships with posting
off. Nothing here is automatic; every step is performed by Brian.

Background: [queue package](../../marketing/queue/README.md),
[lifecycle switch](../../apps/lifecycle/README.md),
[channel guide](../../marketing/channels/README.md),
[`/week` skill](../../marketing/cowork/week/SKILL.md).

Preview and production use separate Neon resources. Do preview first, every time.

The marketing tables live in the lifecycle Growth database; there is no separate marketing database. The lifecycle dispatcher reads them through its own `DATABASE_URL`, so `MARKETING_DATABASE_URL_PREVIEW` must equal the preview lifecycle deployment's `DATABASE_URL` and `MARKETING_DATABASE_URL_PRODUCTION` must equal the production lifecycle deployment's `DATABASE_URL`. Do not create a new database.

## 1. Prerequisites

1. The lifecycle preview and production `DATABASE_URL` values (the Growth databases). They become `MARKETING_DATABASE_URL_PREVIEW` and `MARKETING_DATABASE_URL_PRODUCTION`.
2. A credentials key. It seals the X, LinkedIn, and dev.to credentials stored in Neon:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   Store it in your password manager. Lose it and every stored credential must be re-authorized. Use one key for preview and production, or two, but set the same key locally and on the matching lifecycle deployment.
3. A Vercel Blob read-write token (`BLOB_READ_WRITE_TOKEN`). The queue CLI uploads post media with it.
4. A website deploy hook, created in the website's Vercel project settings (Git, Deploy Hooks). The dispatcher calls it when a blog post's `publishAt` arrives so the page appears. Its URL is `MARKETING_WEBSITE_DEPLOY_HOOK_URL`.

### Local environment (your machine, `.env`)

| Variable | Used by |
| --- | --- |
| `MARKETING_DATABASE_URL_PREVIEW`, `MARKETING_DATABASE_URL_PRODUCTION` | Queue CLI and auth CLIs, selected by `--target`. Equal to the preview and production lifecycle `DATABASE_URL` |
| `MARKETING_CREDENTIALS_KEY` | Seals credentials written by the auth CLIs and `set-devto-key` |
| `BLOB_READ_WRITE_TOKEN` | Queue CLI media upload |
| `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_USER_HANDLE` | X auth |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | LinkedIn auth |

Both [`.env.example`](../../.env.example) and [`marketing/.env.example`](../../marketing/.env.example) list these names with empty values.

### Lifecycle environment (Vercel, preview and production)

| Variable | Purpose |
| --- | --- |
| `MARKETING_POSTING_ENABLED` | Rollout switch. Only the exact string `true` enables dispatch. Leave unset until step 5 |
| `MARKETING_CREDENTIALS_KEY` | Unseals stored credentials |
| `MARKETING_WEBSITE_DEPLOY_HOOK_URL` | Website rebuild when a blog post goes live |
| `MARKETING_ALERT_FROM` | From address for failure alerts |
| `FOUNDER_NOTIFICATION_EMAIL` | Alert recipient |
| `RESEND_API_KEY` | Sends the alerts (already set for lifecycle) |
| `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_USER_HANDLE` | X app config; the tokens themselves live in Neon |
| `DRY_RUN`, `MARKETING_DRY_RUN_DIR` | Preview only, during the step 4 dry run. Never set on production |

Set these for each environment in the lifecycle Vercel project. Redeploy lifecycle so they take effect.

## 2. Apply migration 0011

`npm run db:migrate` has preconditions (enforced by `scripts/growth-database-preflight.mts`):

- It runs under Node 22 and refuses any other major version.
- It reads `DATABASE_URL` and does not load `.env`, so the inline `DATABASE_URL=` below is required.
- It refuses to run when `TEST_DATABASE_URL` or `DAWN_DATABASE_URL` is present in the environment, even with an empty value. `env -u` removes them.

Point it at each lifecycle Growth database (the `MARKETING_DATABASE_URL_*` values), preview first:

```bash
env -u TEST_DATABASE_URL -u DAWN_DATABASE_URL DATABASE_URL="$MARKETING_DATABASE_URL_PREVIEW" npm run db:migrate
env -u TEST_DATABASE_URL -u DAWN_DATABASE_URL DATABASE_URL="$MARKETING_DATABASE_URL_PREVIEW" npm run db:migrate   # second run must apply nothing
```

Then the same two runs against `$MARKETING_DATABASE_URL_PRODUCTION`. The migration is [`0011_marketing_queue.sql`](../../migrations/0011_marketing_queue.sql). Apply it before deploying lifecycle code that reads the queue.

## 3. Authorize the channels

Run each against preview first, then production. The auth CLIs open a browser, you approve the app, and the sealed tokens are written to the target's Growth database.

```bash
npm run marketing:channels:x:auth -- --target=preview
npm run marketing:channels:linkedin:auth -- --target=preview
```

X tokens are never printed, and the X CLI refuses to run without `--target`. The CLI prints the `X_USER_HANDLE` to set on lifecycle if you have not already. Without `--target`, the LinkedIn CLI still prints its values for `.env`; use `--target` so Neon holds them.

dev.to: read the key from a file or a prompt so it does not land in shell history, for example:

```bash
npm run marketing:queue -- set-devto-key --target=preview --yes < ~/.config/threadplane/devto-key.txt
# or
read -rs KEY && printf '%s' "$KEY" | npm run marketing:queue -- set-devto-key --target=preview --yes
```

Repeat all three with `--target=production`.

Afterwards, remove `X_ACCESS_TOKEN` and `X_REFRESH_TOKEN` from your local `.env`. Neon is the only holder: X rotates the refresh token on every refresh, so a stale local copy is dead and misleading.

### LinkedIn token every ~60 days

LinkedIn tokens last 60 days and self-serve apps get no refresh token. Put a recurring reminder on your calendar for about 55 days after each authorization, and re-run `npm run marketing:channels:linkedin:auth -- --target=production`. The dispatcher refuses to post to LinkedIn once the token has expired.

## 4. Preview dry run

1. On the preview lifecycle deployment set `MARKETING_POSTING_ENABLED=true`, `DRY_RUN=1`, and `MARKETING_DRY_RUN_DIR=/tmp/marketing-dry-runs`, then redeploy. With `DRY_RUN=1` the adapters return synthetic results and post nothing. The dry-run adapter writes a payload file, and the default directory (`tmp/marketing/dry-runs` under the working directory) is read-only on Vercel, so without `MARKETING_DRY_RUN_DIR` the write throws and the row is marked `failed` (`post_failed`). Never set `DRY_RUN` on production lifecycle.
2. Queue one X post about five minutes out and approve it:

   ```bash
   npm run marketing:queue -- add --target=preview --channel=x --at=<ISO time 5 minutes ahead> --kind=take --file=<draft.json>
   npm run marketing:queue -- approve --target=preview --id=<post id>
   ```

3. After the next 30-minute tick (UTC minutes 00 and 30) past that time, confirm:

   ```bash
   npm run marketing:queue -- list --target=preview --week=<YYYY-MM-DD, Monday of that week>
   ```

   The row should be `posted`, with a dry-run result (a `dry-` post id and a `dry-run.local` URL). The adapter also writes a payload file under `tmp/marketing/dry-runs/` (or `MARKETING_DRY_RUN_DIR`) on the lifecycle host; that filesystem is ephemeral, so the `list` result is the durable evidence.
4. A failed dry-run attempt leaves a `failed` row, and failures are never retried automatically. `cancel` refuses it (it only takes `draft` and `scheduled` rows); close it with `resolve <id> --as=cancelled --target=preview`, then add a fresh row before trying again.
5. If it is not posted after two ticks, check for a `marketing_dispatch_failed` operator report and an alert email before changing anything.

When the check passes, remove `DRY_RUN` and `MARKETING_DRY_RUN_DIR` from preview, or switch preview posting off.

## 5. Enable production

Do the dev.to backlog migration (section 6) before this step, so no backlog item's `publishAt` passes between enabling and migrating.

1. Confirm migration 0011, all lifecycle variables, and all three authorizations are in place for production.
2. Deploy the website before enabling posting: its operator-alert allow-list must know `marketing_dispatch_failed`, or the cron call answers 503 when that alert fires. The merge that ships this branch deploys both; a single merge covers it.
3. Queue one real X post you are happy to publish, `approve` it with `--target=production`, then set `MARKETING_POSTING_ENABLED=true` on the production lifecycle deployment and redeploy.
4. After the due tick, confirm with `list --target=production` that the row is `posted` exactly once and that the post is on X. Do not run `/week` for production until this works.

## 6. Migrate the dev.to backlog

Existing one-time dev.to posts live outside the repo in `~/.claude/scheduled-posts/devto-queue/*`, each with a local scheduled task. Do this section before section 5's enable.

First pick the planned enable time T (when you will set `MARKETING_POSTING_ENABLED=true` on production). Then compare each item's `publishAt` to T plus one hour:

- `publishAt` after T + 1 hour: add it as a `devto` row with its existing canonical URL, approve it, and delete its local one-time scheduled task in the same step, so it cannot post twice. Use `add --channel=devto` with `--at` and a draft file (`npm run marketing:queue -- --help` shows the flags), then `approve --id`. List the local tasks with the scheduled-tasks tool (`list_scheduled_tasks`) and remove the matching ones with `delete_scheduled_task`.
- `publishAt` at or before T + 1 hour: leave it on its local scheduled task and do not migrate it.

The dispatcher has no staleness cutoff. An approved row whose publish time has passed posts on the first tick after enable, however late. If enable slips past the `publishAt` of an approved item, run `reschedule <id> --at=<new ISO>` (or `cancel <id>`) on it before enabling.

## Rollback

Set `MARKETING_POSTING_ENABLED` to anything other than `true` (unset it, or set `false`) and redeploy lifecycle. The tick stops dispatching; queued rows stay queued and nothing is lost. To cancel individual posts use `cancel <id>`; to move one use `reschedule <id> --at=<ISO>`.

Rows stuck in `posting` (lease expired) and `failed` rows need human review. Either means the dispatcher started an attempt and the outcome is uncertain, so the post may or may not be live. Neither is ever retried automatically, and `cancel` refuses both. Check the channel by hand, then close the row with `resolve`:

```bash
# It went out: record the live URL (dependent posts, such as a blog's dev.to row, then proceed).
npm run marketing:queue -- resolve <id> --as=posted --url=<live url> --target=<preview|production>
# It did not go out: close the row, then re-add the post with add (a cancelled slot refills).
npm run marketing:queue -- resolve <id> --as=cancelled --target=<preview|production>
```

`resolve` only accepts `failed` rows and `posting` rows whose lease has expired, so it cannot race a tick that is still posting. Expired-lease rows are surfaced by `list` and by the alert email.

Turning posting back on after a pause does not dump the backlog. An X or LinkedIn row that reaches a tick more than 6 hours after its `publishAt` goes back to `draft` without sending, and a `missed_slot` alert explains it; `list` shows it as `HELD: missed its slot by N hours`. To send it anyway, `reschedule <id> --at=<ISO>` and `approve --id=<id>`; otherwise `cancel <id>`. dev.to and blog rows still go out late.
