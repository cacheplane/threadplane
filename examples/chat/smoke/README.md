# examples/chat/smoke

Interactive CLI that scaffolds a fresh, npm-installed Angular consumer
of the canonical `examples/chat` demo. Used to validate that the
published `@threadplane/*` packages still behave correctly in a clean
external consumer.

## Run

Installation requires Node >=22.22.3 and exactly npm 11.6.0. This tested npm
release fixes the detached-peer resolver failure affecting Angular 21/22.
Use the scoped command below to select it without changing global npm:

```bash
npm exec --yes --package=npm@11.6.0 -- node examples/chat/smoke/cli.mjs
```

`--no-install` can generate a consumer with another npm version. The CLI checks
npm after the installation choice and before packing or changing the target.
The following direct commands also work when npm 11.6.0 is already on PATH.

```bash
npx nx run examples-chat-smoke:run
# or, equivalently:
node examples/chat/smoke/cli.mjs
```

To build a generated consumer and run the backend-free browser compatibility
smoke, include `--runtime`. It requires installation and automatically runs the
production build before launching Chromium:

```bash
npm exec --yes --package=npm@11.6.0 -- node examples/chat/smoke/cli.mjs --non-interactive --install --runtime
```

`--runtime` launches Chromium through the root `@playwright/test` dependency.
Install its browser locally first when needed with `npx playwright install chromium`.

## Flow

1. Prompts for target directory (default: `~/tmp/threadplane`).
2. If the target exists, asks: refresh / update in place / cancel.
3. Resolves the latest `@threadplane/chat` version from npm; prompts to override.
4. Copies `template/` (Angular CLI scaffold sans `src/app/`) into the target.
5. Copies `examples/chat/angular/src/app/` into the target's `src/app/`.
6. Selects an exact Angular compatibility lane with `--angular-major 20|21|22` (default: `21`) and rewrites all Angular, Angular CLI, and TypeScript pins from the registry.
7. Pins `@threadplane/*` deps to the resolved version, then runs `npm install` with strict peer resolution (`legacy-peer-deps=false`).
8. Optionally runs the production build and, with `--runtime`, checks the
   generated `/embed` page in Chromium. The runtime smoke stubs only the
   cold-start thread search and telemetry ingest API calls, so no backend is
   required.
9. Optionally runs `npm start`.
10. Drops `CHECKLIST.md` and `SMOKE_RUN.md` (capture metadata, including the selected Angular lane) in the target.

## What's in `template/`

The Angular CLI bones — `package.json`, `angular.json`, `tsconfig`s,
`src/main.ts`, `src/styles.css`, `src/index.html`, `public/favicon.ico`.
The actual app code (`src/app/`) is **not** in the template — it's
copied from the live demo at generate-time. Result: the generator's
reviewable surface is just the scaffold; the app body never drifts.

The placeholder `"@threadplane/chat": "*"` in `template/package.json` is a
valid semver range ("any version"); the CLI replaces it with the
explicit `^X.Y.Z` it resolved before writing. The template supplies a
direct dependency closure for the default Angular 21 scaffold, while the
generator owns the exact Angular version pins for every generated consumer.

## Don't run `npm install` directly in `template/`

`template/` is a template, not a runnable consumer. Use the CLI from
the workspace root.
