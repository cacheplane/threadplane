# Threadplane GTM — Cowork skills

Two project-local Claude Code / Cowork skills:

- `/gtm` operates Threadplane's GTM motion: weekly PostHog snapshots, lead triage, workstream scaffolding, and "where are we?" status questions.
- `/week` plans, drafts, and schedules Brian's week of public posts (7 X, 2-3 LinkedIn, 1 blog post plus its dev.to cross-post) into the [marketing queue](../queue/README.md), and manages the queue mid-week.

The skills are **project-local**. It isn't published to a marketplace. Install steps are manual and one-time per machine.

## What's in this directory

```
marketing/cowork/
├── README.md           # This file.
├── gtm/
│   └── SKILL.md        # The GTM Cowork skill.
├── week/
│   └── SKILL.md        # The weekly content planner.
├── inbox/              # Retained drafts from the earlier manual workflow.
├── outbox/             # Retained approved + posted drafts.
└── archive/            # Retained rejected or expired drafts.
```

Social and blog drafts no longer go through `inbox/`/`outbox/`: `/week` writes them to the Neon queue (`marketing_*` tables), and the lifecycle cron publishes them.

## Install (one-time per machine)

The skill ships as `marketing/cowork/gtm/SKILL.md`. To make it loadable by Cowork / Claude Code on your machine, register it as a user-level skill:

```bash
mkdir -p ~/.claude/skills/gtm
cp marketing/cowork/gtm/SKILL.md ~/.claude/skills/gtm/SKILL.md
```

Or symlink it so edits in this repo flow through immediately:

```bash
mkdir -p ~/.claude/skills/gtm
ln -sf "$(pwd)/marketing/cowork/gtm/SKILL.md" ~/.claude/skills/gtm/SKILL.md
```

Install `/week` the same way:

```bash
mkdir -p ~/.claude/skills/week
ln -sf "$(pwd)/marketing/cowork/week/SKILL.md" ~/.claude/skills/week/SKILL.md
```

Verify: open a Claude Code session in this repo and type `/gtm` or `/week`. The skill should load and announce its responsibilities.

`/week` drives `npm run marketing:queue`, which reads `.env` at the repo root: `MARKETING_DATABASE_URL_PRODUCTION` / `MARKETING_DATABASE_URL_PREVIEW`, `MARKETING_CREDENTIALS_KEY`, and `BLOB_READ_WRITE_TOKEN` for card uploads (see `.env.example`). Use `--target=preview` for a practice run.

## Invoke

- `/gtm` — drops into the GTM operator. Examples of what to ask:
  - *"Run the weekly snapshot procedure."*
  - *"Triage these inbound leads against the qualified-lead definition."*
  - *"Scaffold a new workstream spec for `posthog-experiments`."*
  - *"Where are we on comparison pages?"*
- `/week` — the weekly content loop. Examples:
  - *"/week"* — last week's results, a plan for next week, every draft, then schedule on "go ahead".
  - *"Show me what's queued this week."*
  - *"Move Thursday's X post to Friday."* / *"Pull the LinkedIn post."* / *"Post this today."*

## Schedule (optional, one-time per machine)

Cowork has no in-repo scheduling primitive. To run the weekly snapshot automatically every Monday at 9am, create a routine once per machine:

```bash
/schedule create weekly-snapshot 'every Monday 9am' /gtm "run the weekly snapshot procedure"
```

The routine itself lives at the user/runtime layer; it is not committed to the repo. The instruction to create it lives here.

## Update

Edit `marketing/cowork/<skill>/SKILL.md` in this repo. If you symlinked, the change is live immediately. If you copied, re-run the `cp` command after committing.

## Why skills, not a plugin

- **One file per skill to grok** — anyone reading the repo can see what GTM operations and the weekly content loop look like.
- **No plugin packaging ceremony** until the motion proves out and we want to ship it as `@threadplane/gtm-plugin` for other Angular agent startups to adopt.
- **No per-workstream subagents** until context bleed proves to be a problem. Splitting later is a one-day refactor.

## See also

- [Growth architecture and operations](../../docs/growth/README.md) — contacts, authorization, publishing, and measurement ownership
- [gtm.md](../../gtm.md) — durable strategy
- [docs/gtm/](../../docs/gtm/) — operational docs (ICP, messaging, taxonomy, voice)
- [marketing/queue/README.md](../queue/README.md) — the Neon post queue `/week` writes to
- [docs/superpowers/specs/gtm/](../../docs/superpowers/specs/gtm/) — per-workstream design specs
- [tools/posthog/README.md](../../tools/posthog/README.md) — dashboards-as-code conventions
- [libs/telemetry/README.md](../../libs/telemetry/README.md) — telemetry trust contract
