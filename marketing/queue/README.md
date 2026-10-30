# @threadplane-internal/marketing-queue

Neon-backed queue for the weekly marketing content pipeline. All SQL for the `marketing_*` tables lives in `src/repository.ts`; every function takes a growth `SqlExecutor` first.

- `approveWeek` moves clean future drafts to `scheduled` in one transaction and returns blocked and past rows untouched.
- `leaseDuePosts` leases due rows with `for update skip locked`.
- A `posting` row whose lease expired is never returned to `scheduled` automatically (the outcome is ambiguous); `listPosts` surfaces it.
