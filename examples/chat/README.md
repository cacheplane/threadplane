# examples/chat — canonical demo for `@threadplane/chat`

Full-stack demo of `@threadplane/chat` against a tiny LangGraph backend. Three
chat compositions (embed, popup, sidebar), regenerate, model picker,
debug overlay — all in one page, switchable via a floating control
palette.

This example serves two audiences:

- **External users** learning the framework — clone, run, see the
  major surfaces work end-to-end in five minutes.
- **Internal release validators** — run the smoke generator after a
  publish to confirm the published packages still behave correctly in
  a clean consumer.

## Quick start (5 minutes)

```bash
# 1. Clone & install workspace deps
git clone https://github.com/cacheplane/threadplane.git
cd threadplane
npm ci

# 2. Configure the backend
cp examples/chat/python/.env.example examples/chat/python/.env
# Edit .env to add your OPENAI_API_KEY

# 3. Sync python deps
(cd examples/chat/python && uv sync)

# 4. Start everything (Angular on :4200, Python on :2024)
npx nx run examples-chat:serve
```

Open http://localhost:4200, click a welcome suggestion, watch a markdown
response stream in. Use the floating palette top-right to switch between
embed / popup / sidebar modes, change the model, or open the debug overlay.

## Architecture

```
examples/chat/
├── angular/   # Workspace-linked dev demo (Angular 21)
├── python/    # Tiny LangGraph backend (uv + langgraph dev)
└── smoke/     # Interactive CLI: scaffolds an npm-installed consumer
```

The Angular app (`angular/`) consumes `@threadplane/*` via workspace TS paths
(fast iteration: edit a lib, demo reloads). The Python graph (`python/`)
is a single-node `__start__ → generate → __end__` LangGraph; the demo
sets `state.model` on every submit so the model picker takes effect
without reconnecting. The smoke generator (`smoke/cli.mjs`) creates a
**second** consumer at `~/tmp/threadplane` (default) with `@threadplane/*` resolved
from npm — used to validate the published packages match the workspace
behavior.

## Working on the demo

```bash
npx nx run examples-chat:serve         # both backend + frontend
npx nx run examples-chat-angular:test  # vitest specs
npx nx run examples-chat-angular:lint
npx nx run examples-chat-python:test
```

Edit `examples/chat/angular/src/app/`. The Angular dev server reloads
on save. The Python graph reloads when `langgraph dev` notices file
changes.

To add a new welcome suggestion: edit
`examples/chat/angular/src/app/modes/welcome-suggestions.ts`. All three
modes pick it up.

## Release smoke

After publishing a new `@threadplane/*` version, validate it in a fresh
consumer:

```bash
npx nx run examples-chat-smoke:run
# Default target: ~/tmp/threadplane
# Then in another terminal:
cd examples/chat/python && uv run langgraph dev --port 2024 --no-browser
# In a third:
cd ~/tmp/threadplane && npm start
# Open http://localhost:4200, walk through CHECKLIST.md
```

The CLI captures `SMOKE_RUN.md` in the generated dir — versions, git
SHA, node/npm — so a failure can be reported with one paste.

## Roadmap

Phase 1 (this version) covers: three chat compositions, regenerate,
markdown surfaces, model picker, debug overlay.

Later phases layer in: reasoning blocks, tool calls, interrupts,
citations, generative UI (A2UI), subagents, time travel, multi-thread.
Each lands as its own spec → plan → PR cycle. See
`docs/superpowers/specs/2026-05-08-canonical-chat-demo-design.md` for
the roadmap table.
