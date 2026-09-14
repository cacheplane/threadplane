# Contributing

Threadplane is MIT-licensed and developed in the open. Contributions are welcome.

## How to contribute

1. **Found a bug or have a feature idea?** Open an issue at
   <https://github.com/cacheplane/threadplane/issues> describing the
   problem or proposal. Please search existing issues first.
2. **Code changes:** fork the repository (or create a topic branch if you have
   access), make your change on a branch, and open a pull request against `main`.
   Keep pull requests focused on a single concern.
3. Every pull request runs CI (lint, test, build) and receives an automated code
   review; the maintainer reviews and merges.
4. **Security issues:** do not open a public issue — see [SECURITY.md](SECURITY.md)
   for the private vulnerability-reporting process.

## Working in a git worktree

A `git worktree` gets a fresh checkout but **not** a fresh `npm install`. Node
resolves modules by walking *up* the directory tree, so a worktree created inside
this repository silently inherits the main checkout's `node_modules` and mostly
works — which is why the gaps surface as unrelated-looking failures well into a
task rather than up front.

Run install once per worktree before building anything:

```bash
npm ci
```

`npm ci` installs strictly from `package-lock.json` and never rewrites it, so it
is safe on any platform (regenerating the lockfile is not — see the note below).
Three failure signatures come from skipping it. They look unrelated but share one
cause, and each is fixed by the install above:

| Symptom | Why inheritance doesn't cover it |
| --- | --- |
| `Cannot find module 'posthog-node'` when building `website` | Installed only into `apps/website/node_modules`, never hoisted. The walk up from the worktree's `apps/website/` never passes through the main checkout's. |
| `Could not resolve "node_modules/katex/dist/katex.min.css"` | Referenced by literal path from the workspace root, not by module resolution — so there is no upward walk to inherit through. |
| `Next.js inferred your workspace root, but it may not be correct` when building `website` | Turbopack resolves its own workspace root and will not compile outside it. |

Do not fix these by copying individual packages from the main checkout. The list
keeps growing, a partial copy pulls in a package without its transitive
dependencies, and a mistargeted `cp` can overwrite `node_modules` itself.

Do not run `npm install` in a worktree on macOS either: it rewrites
`package-lock.json` and drops the Linux `@next/swc-*` bindings, which breaks CI.
`npm ci` is the safe command.

One more worktree-only trap, after install: `nx build website` can die with a
Turbopack panic — `FileSystemPath(...).join(...) leaves the filesystem root` —
whenever a stale website `.next` cache exists anywhere in the workspace
(`apps/website/.next` from `next dev`/e2e, or `dist/apps/website` from a
previous build). Those caches contain a `node_modules` symlink whose relative
target resolves through the *main* checkout's root; the path is valid on
disk, but Turbopack's virtual filesystem refuses to traverse above its
project root and panics. Pinning `turbopack.root` does not help. Clear the
caches instead:

```bash
rm -rf apps/website/.next dist/apps/website && npx nx build website
```

CI never hits this — its jobs build from fresh checkouts that are not nested
inside another checkout.

## Testing

New functionality and bug fixes must include automated tests. Run a project's
suite with `npx nx test <project>` (for example, `npx nx test chat`). CI runs
`lint`, `test`, and `build` across the publishable libraries on every pull
request, so changes that break or skip tests are caught before merge.

## Signed commits

`main` requires signed commits. Configure SSH commit signing once:

```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
git config --global tag.gpgsign true
```

Then add the same public key as a **Signing Key** at
<https://github.com/settings/ssh/new>. Commits merged through the GitHub UI and
bot commits (Renovate, Dependabot) are signed automatically.

## The merge gate

`main` has exactly one required status check: **`CI — required`**. That is the
`required-pr-checks` job in `.github/workflows/ci.yml`, app-pinned to the
GitHub Actions app (id `15368`), with `strict: true` (a PR must be up to date
with `main` before it merges).

Nothing else is required. In particular:

- **`Vercel` is not required**, and that is a deliberate decision, reviewed on
  2026-09-01. The `website` job's last step is `npx nx build website`,
  byte-identical to `vercel.json`'s `buildCommand`, so a broken build still
  fails `CI — required`. The residual gap is real but narrow: a failure
  specific to Vercel's environment — an env var set there and not in CI, an
  install difference — is not caught pre-merge. It is caught post-merge by
  `Deploy → Vercel`, before production.

  Requiring the status back was considered and rejected. Vercel now posts a
  single consolidated `Vercel` context covering every project, where it used to
  post one per project. Gating on it would mean an unrelated project's failure
  blocks a pure-website PR — the opposite of the current behaviour, which is
  load-bearing: #931 merged on 2026-09-01 while `threadplane-minting-service`
  was failing on that same commit, deliberately not allowed to block website
  work. It would also re-introduce the vendor-string dependency described
  below.
- **`approve` is not a quality gate and must never become one.** It comes from
  `.github/workflows/auto-approve.yml` and exists only so OSSF Scorecard's
  Code-Review check has a review to read (see [Code review](#code-review)).

### Why the gate is a job we own, not a vendor status string

On 2026-09-01 Vercel consolidated its GitHub commit-status contexts. It had
been posting one per project — `Vercel – threadplane` and
`Vercel – threadplane-minting-service` — and from ~17:19 UTC it posted a single
`Vercel`. Branch protection required the literal string `Vercel – threadplane`,
so the required check simply stopped arriving and **every PR became
permanently unmergeable while showing all checks green**. Same publisher
(`vercel[bot]`, app id `8329`), so it was a platform-side rename, not a
misconfiguration on our end.

A required context is matched by name. Any vendor free to rename its context is
free to strand every PR in the repo, silently and indefinitely. `CI — required`
is a job in this repository, so its name can only change in a commit.

It is safe to gate on because it is not vacuous: it runs
`if: always() && github.event_name == 'pull_request'` (so it posts on every PR,
fork PRs included), it fails when any in-scope job is not `success`, and it
also fails when an out-of-scope job reports `failure` or `cancelled`. Read the
job before changing it.

### Diagnostic: a PR is green but will not merge

`mergeable: MERGEABLE` together with `mergeStateStatus: BLOCKED`, on a PR whose
checks are all green, means a **required context never arrived**. This looks
identical to a slow queue and it never resolves on its own. Do not wait it out,
and do not reach for `--admin`.

Compare what was actually posted on the head SHA against what protection
requires:

```bash
gh api repos/cacheplane/threadplane/commits/<head-sha>/status --jq '[.statuses[].context]'
```

```bash
gh api repos/cacheplane/threadplane/branches/main/protection --jq '.required_status_checks.checks'
```

Any required context missing from the posted list is the cause. Fix branch
protection (or the workflow that should post it) — forcing the merge only hides
the next one.

Note that check *runs* (GitHub Actions) and commit *statuses* (external apps
like Vercel) are different APIs. `CI — required` is a check run, so it appears
in `gh pr checks` but not in the `/status` output above; use
`gh api repos/cacheplane/threadplane/commits/<head-sha>/check-runs`
for those.

### Rollback reference

Branch protection is repo-wide, not version-controlled, and reachable only with
an admin-scoped token. The configuration in force before the 2026-09-01 change,
recorded here so it can be restored without guessing:

```jsonc
// required_status_checks, as of 2026-09-01 before the fix
{
  "strict": true,
  "contexts": ["Vercel – threadplane"],
  "checks": [{ "context": "Vercel – threadplane", "app_id": 8329 }]
}
```

Everything else was, and remains, unchanged: `required_signatures.enabled:
true`, `enforce_admins.enabled: false`, `required_approving_review_count: 0`,
`allow_force_pushes: false`, `allow_deletions: false`, no rulesets. Only
`required_status_checks` was edited, to
`{"strict": true, "checks": [{"context": "CI — required", "app_id": 15368}]}`.

There is deliberately **no CI assertion that protection matches this file**.
Reading branch protection needs the `administration: read` scope, which the
workflow `permissions:` key cannot grant — `GITHUB_TOKEN` has no such scope —
so a guard would require a long-lived admin PAT in Actions secrets. The
blast radius of that credential is worse than the drift it would catch, given
the drift is loud once you know the diagnostic above. The repo uses classic
branch protection and has no rulesets, so the unprivileged
`GET /repos/{owner}/{repo}/rules/branches/main` endpoint returns `[]` and is
not an alternative.

### PR-side deploy verification

One lane runs the deploy job's verification on pull requests against a real
Vercel preview, so deploy-only failures surface before merge:

- **Website — e2e (deployed preview)** builds and deploys the Website and
  the examples as previews under deterministic aliases
  (`threadplane-pr-<n>-cacheplane.vercel.app` and
  `threadplane-examples-pr-<n>-cacheplane.vercel.app`; `mq-<sha8>` for
  merge-queue candidates) and runs the ordinary suite against the Website
  alias. The runtime iframe loads because the examples are assembled with
  the Website alias in their parent-origin policy and Playwright seeds the
  examples origin's bypass cookie (`apps/website/e2e/runtime-bypass-setup.ts`).
  A later push re-points both aliases; the deployments behind them are kept.

It needs repository secrets and therefore skips on fork PRs; the required
gate only demands it when it was eligible to run. Each Vercel project has its
own Protection Bypass for Automation secret:
`VERCEL_AUTOMATION_BYPASS_SECRET` (Website) and
`VERCEL_EXAMPLES_AUTOMATION_BYPASS_SECRET`. A secret added while a run is in
flight does not reach that run; re-run after provisioning. Never pass
`--skip-domain` to a preview deploy; Vercel requires it to accompany `--prod`.

## Docs pages and example code

A docs page whose capability ships a runnable example (the page shows Run and
Code tabs) teaches through that example. Its code comes from the example
files, never from a hand-typed copy:

```mdx
<ExampleCode file="streaming.component.ts" />
<ExampleCode file="graph.py" region="stream-modes" title="Stream modes" />
```

- `file` is a basename or a repo-relative path among the capability's
  `codeAssetPaths` and `backendAssetPaths` in
  `libs/cockpit-registry/src/lib/content-descriptors.ts`. An unknown or
  ambiguous name fails the build.
- `region` names a marker pair in that file. Markers are `// #region name` …
  `// #endregion` in TypeScript, `# region name` … `# endregion` in Python,
  and `<!-- #region name -->` … `<!-- #endregion -->` in HTML. Regions may
  nest. The marker lines are stripped from the slice on the docs page and
  the slice is de-indented. The Code tab shows the whole file, markers
  included, and the region name surfaces in the build error when a region is
  missing or unterminated, so keep the names meaningful.
- Hand-written fences stay allowed for fragments the example does not cover,
  such as another runtime's variant.

`apps/website/src/lib/docs-example-code.spec.ts` fails when a mapped page
includes nothing, when an include does not resolve, or when a docs-only page
uses the tag. Its scan is textual, so the tag must not appear in prose,
fenced code, or MDX comments on any docs page. Pages not yet rewritten sit in
its `PENDING_PAGES` list; a page that gains its first include must leave the
list in the same change.

## Code review

Every PR gets a genuine advisory AI code review
(`.github/workflows/claude-review.yml`) that posts findings as comments — it is
not a required check and never blocks a merge. A second workflow
(`.github/workflows/auto-approve.yml`) then submits a formal approval as
`github-actions[bot]` — an identity distinct from the PR author — which OSSF
Scorecard's Code-Review check reads from the reviews API. The maintainer still
merges every PR.

Because the review is advisory, **handling its comments is a convention, not a
gate**: before arming auto-merge, the author reads each AI comment and either
addresses it in a follow-up commit or replies on the thread with the reason for
deferring/declining. Don't merge past unread review comments — the check going
green (or red) says nothing about whether the comments were considered.

This credits Code-Review via automation rather than peer review, because the
project is currently single-maintainer. OSSF documentation suggests
automated/AI reviews may not be intended to count toward this check; the current
setup does credit them, and a future Scorecard release could change that.
Removing `auto-approve.yml` cleanly reverts the check with no other impact.
