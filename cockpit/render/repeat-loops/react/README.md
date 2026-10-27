# Native React Repeat Loops preview

Three authored local JSON samples render through installed `@threadplane/react/render`.
The application entry owns immutable items through one `createRenderState` owner;
React borrows its actual snapshot through native `useAgent`. A repeated Card renders once and the native
renderer repeats its Text child for each item, keyed by its id. Add, remove and
reverse items without changing playback source. The list is bounded at 32;
reloading restores Alpha, Beta and Gamma. No agent requests are needed.

List edits survive playback, seek, Reset and sample selection. Partial repeat
metadata waits for the exact authored path and key. The private playback owner
revokes obsolete callbacks independently of host items.

Stable local commands read the latest owner snapshot on each event. Add publishes
the list and monotonic counter together in one atomic `update`; remove and reverse
each set only `/items`. Helper no-ops issue no owner commands. The observer uses
the closed application item shape and forwards the actual getter and subscription.
Unmount releases React subscriptions. Page exit disposes playback, unmounts React,
disposes the item owner, then disposes the runtime bridge, once.

```sh
npx nx test cockpit-render-repeat-loops-react --skip-nx-cache
npx nx lint cockpit-render-repeat-loops-react
npx nx build cockpit-render-repeat-loops-react
npx nx e2e cockpit-render-repeat-loops-react
```

The closed static build installs local React/core/content artifacts and locked
presentation dependencies. Browser checks cover actual row identity, capacity,
empty recovery, playback retention, page exit and narrow screens.
