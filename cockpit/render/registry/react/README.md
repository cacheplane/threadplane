# Native React Component Registry preview

Three authored local JSON samples render through installed `@threadplane/react/render`.
A host selector chooses a complete readonly component map, a map with Badge
omitted, or the reduced map with an authored fallback. Native RenderSpec supplies
resolved props, element key, loading and recursively rendered children.

Registry choice survives playback, seek, Reset and sample selection. It does not
change JSON or parser position; reloading restores Registered. The projection
admits only four authored literal types. No agent requests are needed.

```sh
npx nx build cockpit-render-registry-react
npx nx e2e cockpit-render-registry-react
```

The closed static build installs local React/core/content artifacts and locked
presentation dependencies. Browser checks cover registry modes, native fallback
props/loading, supplied children, playback retention, page exit and narrow screens.
