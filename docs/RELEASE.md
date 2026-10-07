# Release Process

The six publishable libraries (`@threadplane/chat`, `@threadplane/langgraph`, `@threadplane/ag-ui`, `@threadplane/render`, `@threadplane/a2ui`, `@threadplane/telemetry`) ship together at a synchronized version via Nx Release. Releases use **minor** bumps (`0.1.0` → `0.2.0` → …). **Never cut `1.0.0` without explicit approval from the repository owner, every time.**

Nx updates internal dependency and peer ranges with the synchronized release. `preserveMatchingDependencyRanges` is disabled so a prior `^0.0.x` peer range cannot block the next patch or leave companion packages on incompatible versions. External dependency ranges remain unchanged.

## Standard release (second release onward)

> First release? See **[First `@threadplane` release](#first-threadplane-release)** below — the flow is different because there's no prior package under the new npm org yet.

> [!WARNING]
> **Do not use `nx release patch` or `nx release minor`.** The one-shot `nx release` command does not
> work in this repo. `nx.json` configures git options under
> `release.changelog.git`, and Nx rejects the top-level command whenever
> granular git config is present:
>
> `NX  The "release" top level command cannot be used with granular git configuration.`
>
> Use the subcommands below instead.

`main` is protected and only accepts pull requests, so a release is two phases:
a release PR that changes versions and docs, then a tag on the merged commit that publishes.

### Phase 1: the release PR

```bash
git fetch origin
git checkout -b release/X.Y.Z origin/main

# 0. In a worktree, install from the lockfile first. The version step runs a
#    pre-build, and stale node_modules fails it with errors that look like
#    real type errors (for example a missing `@ag-ui/core/schemas`).
npm ci

# 1. Version bump. Runs preVersionCommand (builds all six projects), rewrites every
#    package.json and the internal peer ranges, updates package-lock.json, and stages the result.
npx nx release version --specifier=minor

# 2. Regenerate the public agent-context files. They embed the release
#    version, and the Website unit suite fails the release commit until
#    `apps/website/public/{AGENTS,CLAUDE}.md` say the new version.
npm run generate-agent-context

# 3. Bump the committed runtime version constants. The pre-build in step 1 runs
#    BEFORE the manifests change, so it cannot do this for you.
sed -i '' 's/"<old>"/"X.Y.Z"/' libs/{chat,langgraph,render,ag-ui}/src/lib/package-version.ts

# 4. Preview the changelog. Do NOT run it for real: a real run tries to create a
#    GitHub Release for a tag that does not exist yet. Pass the BARE version.
npx nx release changelog X.Y.Z --git-commit=false --git-tag=false --dry-run

node scripts/verify-release-versions.mjs --tag vX.Y.Z
```

Then, by hand, before committing:

- **CHANGELOG.md.** Paste the previewed section at the top. If a hand-written
  `## Unreleased` section exists, fold it into the new section as
  `### ⚠️  Breaking Changes` and `### ✨ Highlights` ahead of the Nx list, and delete the
  `Unreleased` heading. Nx turns hex colours in commit bodies into issue links
  (`#181818`, `#0`, `#16`); delete those.
- **Docs peer tables.** Update the `@threadplane/*` versions on the installation pages for
  chat, langgraph, ag-ui and render, the `@threadplane/chat@X.Y.Z` peer list, and the
  example range in `chat/guides/writing-an-adapter.mdx`:
  `rg -n '<old version>' apps/website/content/docs` should come back empty.
- **Docs changelog.** In `apps/website/content/docs/chat/getting-started/changelog.mdx`,
  rename `## Next` to the new version and update the "published package is at" line.
- **Website suite.** Run it from the app directory. `npx nx test website` can fail
  without printing a vitest summary, which hides the real failure:
  `cd apps/website && npx vitest run --config vite.config.mts`

Commit as `chore(release): X.Y.Z` and open a PR.

### Phase 2: publish

After the release PR merges:

1. Wait for the release commit's `CI` run on `main` to go green.
2. Dry-run the publish path: `gh workflow run publish.yml --ref main -f dry-run=true`, and watch it pass.
3. Tag the release commit itself, not a later one: `git tag -s vX.Y.Z -m vX.Y.Z <release-commit-sha>`.
4. `git push origin vX.Y.Z`. The tag push fires `publish.yml`, which publishes to npm with
   provenance via OIDC trusted publishing. This is the irreversible step.
5. `gh release create vX.Y.Z --title vX.Y.Z --notes-file <the CHANGELOG section>`.
   Creating the release fires `release-provenance.yml`, which attaches the signed SLSA
   attestation and tarballs that OpenSSF Scorecard checks.
6. Verify the registry, not the workflow. npm serves the old version for about two
   minutes and the packages appear one at a time, so poll:

   ```bash
   for p in a2ui telemetry render chat ag-ui langgraph; do
     curl -s -H 'Cache-Control: no-cache' "https://registry.npmjs.org/-/package/@threadplane%2F$p/dist-tags"; echo " $p"
   done
   ```

   Every package should report `"latest":"X.Y.Z"`.
7. Merge the announcement post, if there is one, only after step 6.

> [!WARNING]
> **Pass the bare version to `changelog`, not `vX.Y.Z`.** `releaseTagPattern` is
> `v{version}`, so Nx prepends the `v` itself. Passing `v0.0.57` produces a
> malformed **`vv0.0.57`** tag and a GitHub Release at
> `/releases/tag/vv0.0.57`. Pass `0.0.57`.

### What earlier releases forgot

Each of these shipped and had to be fixed afterwards. The steps above now cover them.

- **0.1.0 and 0.2.0:** the docs peer tables and the docs changelog stayed at `0.0.66`.
- **0.2.0:** the committed `package-version.ts` constants stayed at the old version (#1111),
  so source checkouts reported the wrong runtime version.
- **0.2.0:** a hand-written `## Unreleased` section was left below the new release heading,
  so its breaking changes never appeared under 0.2.0 in CHANGELOG.md.
- **0.1.0:** the Python `threadplane-middleware` needed its own publish and pinned images
  (#1068). Check `git log v<previous>..origin/main -- packages/threadplane-middleware`; if it
  changed, publish it with `publish-middleware-python.yml` (dry run first).

If publishing locally instead of from the tag, first rebuild all six packages
and Growth, then run `telemetry:test-install-pack` and
`telemetry:test-development-bundle` before `npx nx release publish --groups=publishable`.
The version command's pre-build embeds the old runtime version; a rebuild after
versioning is required to align collector payloads with the new package manifests.

### Check the lockfile before committing

Step 1 regenerates `package-lock.json`. On macOS that can drop the Linux
`@next/swc-*` bindings and break CI. The diff should be **only** the version
lines for the six libs:

```bash
git diff --cached package-lock.json | grep -E '^-' | grep -icE 'linux|darwin|musl|gnu'
# must print 0
```

If it prints anything else, revert the lockfile and re-apply the version lines by hand.

## First `@threadplane` release

The first publish under the `@threadplane` npm org is manual. The packages must exist on npm before trusted publishing can be configured package-by-package. Run this from a clean, merged `main` branch.

```bash
# 1. Install and build everything
npm ci
npx nx run-many -t lint,test,build --projects=chat,langgraph,ag-ui,render,a2ui,telemetry --skip-nx-cache

# 2. Verify release metadata
node scripts/verify-release-versions.mjs --tag v$(node -p "require('./libs/chat/package.json').version")
npx nx release publish --groups=publishable --dry-run

# 3. Publish manually.
npm publish dist/libs/telemetry --access public
npm publish dist/libs/a2ui --access public
npm publish dist/libs/render --access public
npm publish dist/libs/chat --access public
npm publish dist/libs/ag-ui --access public
npm publish dist/libs/langgraph --access public

# 5. Verify all package pages resolve.
npm view @threadplane/telemetry version
npm view @threadplane/a2ui version
npm view @threadplane/render version
npm view @threadplane/chat version
npm view @threadplane/ag-ui version
npm view @threadplane/langgraph version
```

After the first `@threadplane` release, configure npm trusted publishing for all six packages against `.github/workflows/publish.yml`. Subsequent patch bumps use the one-shot flow above.

## Dry run

Always sanity-check before a real release. Dry-run each subcommand — the
one-shot `nx release patch --dry-run` fails the same way the real command does:

```bash
npx nx release version --specifier=minor --dry-run
npx nx release changelog 0.0.57 --dry-run   # bare version; check the printed tag URL
```

These print what would happen without modifying anything.

## Is a release actually needed?

Version bumps on `main` do **not** publish — only a pushed `vX.Y.Z` tag does. Main
routinely drifts ahead of npm, and the version on disk can match the version on
npm while the code differs. Check before assuming:

```bash
git rev-list --count "v$(npm view @threadplane/chat version)"..origin/main
```

Anything above `0` means main has unpublished commits.

## Manual workflow trigger

`Publish` workflow accepts `workflow_dispatch` with a `dry-run` input (default `true`). Trigger from the GitHub Actions UI to verify CI's publish path without actually shipping.

## Versioning policy

Releases bump the **minor** component (`0.1.0` → `0.2.0` → …). Breaking changes can still land in any release while the major is `0`, so consumers should lock to an exact version; the changelog names the breaking entries.

`1.0.0` is a deliberate gate, not something to infer from scope or stability: **ask the repository owner and wait for an explicit yes before cutting it.**

Through `v0.0.66` the project used patch-only bumps. That ended on 2026-09-08, when a backlog of breaking changes made the patch counter actively misleading.

## Internal peer dependencies

Caret-prefixed ranges (`^0.0.1`) do not include subsequent `0.0.x` patches. Nx updates internal peers during each synchronized release so a newly installed package resolves compatible companion APIs. Do not preserve stale narrow ranges or manually restore wildcard peers after versioning.
