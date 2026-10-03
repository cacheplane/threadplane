# Native React Repeat Loops preview

Three authored local JSON samples render through installed `@threadplane/react/render`.
The React host owns immutable items. A repeated Card renders once and the native
renderer repeats its Text child for each item, keyed by its id. Add, remove and
reverse items without changing playback source. The list is bounded at 32;
reloading restores Alpha, Beta and Gamma. No agent requests are needed.

List edits survive playback, seek, Reset and sample selection. Partial repeat
metadata waits for the exact authored path and key. The private playback owner
revokes obsolete callbacks independently of host items.

```sh
npx nx build cockpit-render-repeat-loops-react
npx nx e2e cockpit-render-repeat-loops-react
```

The closed static build installs local React/core/content artifacts and locked
presentation dependencies. Browser checks cover actual row identity, capacity,
empty recovery, playback retention, page exit and narrow screens.
