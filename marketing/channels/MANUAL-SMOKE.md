# X adapter — manual smoke

Run after `npm run marketing:channels:x:auth -- --target=<preview|production>` has stored the X tokens in Neon. The smoke script reads `X_ACCESS_TOKEN` and `X_REFRESH_TOKEN` from `.env`, which auth no longer prints; for a live smoke, use the dispatcher dry run in the [rollout runbook](../../docs/growth/marketing-queue-rollout.md) or supply tokens another way. `DRY_RUN=1` needs no tokens.

> **Note:** Use the npm scripts below (or pass `--env-file=.env` to tsx directly). Plain `npx tsx ...` does NOT auto-load `.env`, so the adapter will throw "missing env vars".

## 1. Dry-run (no API calls)

```bash
DRY_RUN=1 npm run marketing:channels:x:smoke
```

Expect: a JSON `PostResult` printed with `postId` prefixed `dry-` and a file under `tmp/marketing/dry-runs/`.

## 2. Live single tweet

```bash
npm run marketing:channels:x:smoke
```

Expect: a real `https://x.com/<handle>/status/<id>` URL. Open it; confirm the post is on the timeline. **Then delete the post from the X UI.**

## 3. Live tweet with media

```bash
SMOKE_MEDIA=1 npm run marketing:channels:x:smoke
```

Expect: the post has a 1×1 transparent pixel attached with the alt text. Delete after verifying.

## 4. Live thread

```bash
SMOKE_THREAD=1 npm run marketing:channels:x:smoke
```

Expect: two tweets posted; the second is a reply to the first. Delete both.

## If anything fails

Capture the printed error message and any response body in the error. Note which step failed. File the result in the PR description so future maintainers see what shape of breakage they need to handle.

# Dev.to adapter — manual smoke

Run after `DEVTO_API_KEY` is in `.env`.

## 1. Dry-run (no API calls)

```bash
DRY_RUN=1 npm run marketing:channels:devto:smoke
```

Expect: a JSON `PostResult` with `postId` prefixed `dry-`, `channel: "devto"`, and a file under `tmp/marketing/dry-runs/`.

## 2. Live article

```bash
npm run marketing:channels:devto:smoke
```

Expect: a real `https://dev.to/<handle>/<slug>` URL. Open it; confirm the article is published. The script also fetches metrics after a 5-second pause — expect a `Metrics:` block with near-zero counts. **Then delete the article from Dev.to** (Dashboard → ⋯ → Delete).

## If anything fails

Capture the printed error and the part of the JSON response surfaced in the error message. File the result in the PR description.
