# Maintaining the whitepapers

The four papers are authored in `apps/website/content/whitepapers`. Their HTML and PDF downloads are built deterministically; generating them does not perform research or refresh dates.

## Review evidence

`evidence.json` records the papers' existing **7 November 2026** research baseline and the publication revision that contains it. Adding this ledger did not re-verify external sources. Each record identifies the authored content hash, cited third-party sources, and the next manual review date. Package records distinguish the private native bindings from published Angular adapters and record installed dependency versions from the lockfile.

Run from the repository root:

```sh
npx nx run website:whitepaper-evidence
```

The offline report exits with status 1 when a review is due, authored content changed, recorded package facts changed, or the ledger is malformed. It never updates the ledger and cannot certify that an external claim is still true. Ordinary website tests check coverage and consistency without making the passage of time fail unrelated CI.

Review at least every three months, and before publishing a change to package availability, supported APIs, model tables, or protocol claims. Prioritize volatile model IDs, modalities, context limits, licenses, protocol editions and framework compatibility. Read primary provider/specification sources; distinguish upstream capability from versions actually tested here. Never infer support merely because a provider added it.

## Update a paper

1. Review its cited sources and current repository implementations. Preserve the distinction between documented, compiled, deployed and benchmarked evidence.
2. Update authored claims and relevant checked examples. Record the actual review date and repository revision; do not advance dates just to silence a warning.
3. Update the affected ledger record's source URLs, SHA-256 and next review date. Change package baselines only after assessing the affected claims. `shasum -a 256 apps/website/content/whitepapers/<paper>.md` prints the authored-content hash.
4. Run `npm run generate-whitepaper -- --paper <paper>` (`overview`, `angular`, `render`, or `chat`), then the website publication tests and production build. Keep the legacy download URLs stable.
5. Render and inspect every changed PDF page. Check code/diagram clipping, links, page counts, and mobile HTML previews. Update field-report page/chapter metadata if the overview changes.
6. After deployment, verify public PDF bytes before testing attachments. Provider acceptance, recipient-server delivery, and actual inbox appearance are separate evidence.

Changing just this ledger does not change PDFs. If a research date printed inside a paper changes, update its authored appendix and the renderer's shared edition text as appropriate, regenerate all affected outputs, and review them. There is no scheduled research job or automatic date advancement.
