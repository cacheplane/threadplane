# marketing/

Internal publishing tools and operator materials for Threadplane. Growth owns contacts, authorization, observations, and lifecycle outcomes; these tools render assets and publish operator-approved content. See the [Growth architecture and operations guide](../docs/growth/README.md) for ownership and commands.

## Structure

```
marketing/
├── assets/      # @threadplane-internal/marketing-assets    — branded image rendering
├── channels/    # @threadplane-internal/marketing-channels  — X, LinkedIn, and Dev.to adapters
├── queue/       # @threadplane-internal/marketing-queue     — Neon post queue, dispatcher, queue CLI
└── cowork/      # /gtm and /week operator skills, retained campaign drafts/assets
```

All packages are internal (`"private": true`) and are not published to npm.

## Operator workflow

Once a week Brian runs the [`/week` skill](cowork/week/SKILL.md) in Claude Code. It recaps last week, drafts the coming week (7 X posts, 2-3 LinkedIn posts, 1 blog post plus its dev.to cross-post), and after his review and "go ahead" writes everything to the [queue](queue/README.md) (`marketing_*` tables in Neon) as `scheduled`, and opens the blog post's PR with auto-merge. The queue CLI is `npm run marketing:queue -- <command> --target=preview|production`.

The lifecycle tick (website cron, every 30 minutes) dispatches due posts through the [channel adapters](channels/README.md) from Brian's personal X and LinkedIn, rebuilds the website when a blog post's `publishAt` arrives, and cross-posts to dev.to once the canonical URL is live. Posting is off unless `MARKETING_POSTING_ENABLED` is exactly `true`; see [lifecycle operations](../apps/lifecycle/README.md). Ad hoc posts go through the queue too.

Use [assets](assets/README.md) to render cards. Set `DRY_RUN=1` to write simulated adapter posts to `tmp/marketing/dry-runs/` relative to the working directory. Set `MARKETING_DRY_RUN_DIR` to choose a different relative or absolute directory. There is no autonomous drafting agent in this directory yet; Claude drafts in the `/week` session, and Reddit is out of scope.

The [GTM skill](cowork/README.md) documents reporting and triage. PostHog measurement lives in `tools/posthog/`; Growth lifecycle state remains in Growth. Historical marketing specs under `docs/superpowers/` describe earlier proposals, not current runtime components.

## Voice + messaging source-of-truth

- `docs/gtm/voice.md` — Brian's tone, phrasing, structural quirks; blog register and social register (X, LinkedIn)
- `docs/gtm/messaging.md` — positioning, claims, no-go phrases
- `docs/gtm/icp.md` — audience

All in this repo. No machine-local paths in checked-in code.
