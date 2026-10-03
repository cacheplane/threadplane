# Native React Element Rendering preview

Three authored local JSON samples render through installed `@threadplane/react/render`: ordered siblings, nested cards and conditional text. Native RenderSpec supplies rendered children to readonly Heading, Text and Card views and evaluates visibility from explicit caller-owned state.

The Show detail checkbox survives playback, seek, Reset and sample selection. It does not change JSON or parser position; reloading shows detail. The bounded projection withholds the conditional element until its exact visibility binding is available, preventing hidden text from flashing during partial playback. No agent requests are needed.

```sh
npx nx build cockpit-render-element-rendering-react
npx nx e2e cockpit-render-element-rendering-react
```

The closed static build installs local React/core/content artifacts and locked presentation dependencies. Browser checks cover native children and visibility, partial playback, retained host state, page exit and narrow screens.
