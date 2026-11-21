# examples/chat/python

Tiny LangGraph backend for the canonical `@threadplane/angular/chat` demo. Single-node
graph that streams from a `ChatOpenAI` model selected by the client.

## Setup

```bash
cp .env.example .env
# Edit .env to add your OPENAI_API_KEY

uv sync
```

## Run

```bash
uv run langgraph dev --port 2024 --no-browser
```

Or from the repo root: `npx nx run examples-chat-python:serve`.

## Test

```bash
uv run pytest -q          # all tests
uv run pytest -q -m smoke # smoke only
```
