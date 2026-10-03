# Native React State Management preview

Three local JSON samples render through installed `@threadplane/react/render`.
The React host owns immutable name, age and theme state. Native `RenderSpec`
resolves the three authored `$state` paths; four read-only views display values
and native children. No agent request or runtime configuration is needed.

State edits survive playback, seek, Reset and sample selection. An invalid age
draft preserves the last valid value; reloading restores Alice, age 30, and Dark.
Theme changes its displayed preference. Playback owns its parser and revokes
obsolete callbacks independently of host state.

From the repository root:

```sh
npx nx build cockpit-render-state-management-react
npx nx e2e cockpit-render-state-management-react
```

The closed static build installs local React/core/content artifacts and locked
presentation dependencies. Browser checks cover bindings, invalid age recovery,
partial playback, state retention, page exit and narrow screens.
