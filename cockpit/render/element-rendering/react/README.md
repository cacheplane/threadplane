# Native React Element Rendering preview

Three authored local JSON samples render through installed `@threadplane/react/render`: ordered siblings, nested cards and conditional text. Native RenderSpec supplies rendered children to readonly Heading, Text and Card views and evaluates visibility from explicit caller-owned state.

The Show detail checkbox survives playback, seek, Reset and sample selection. It does not change JSON or parser position; reloading shows detail. The bounded projection withholds the conditional element until its exact visibility binding is available, preventing hidden text from flashing during partial playback. No agent requests are needed.

The application entrypoint owns one private `createRenderState({ showDetail: true })` instance beside playback, outside React. The view borrows only a stable `getSnapshot`/`subscribe` facade through `useAgent`, passes the owner's immutable snapshot to RenderSpec, and forwards checkbox booleans through an explicit application callback that writes `/showDetail`. Mounting, StrictMode cleanup and unmounting release observation without writing, resetting or disposing state; the same owner can be observed again. Page exit disposes playback, unmounts the view, then disposes the render-state owner and runtime bridge once. Reload creates a fresh owner with detail shown.

This is bounded dogfooding of the existing private render-state contract in this cockpit. It does not establish a public API or full render-state feature parity.

```sh
npx nx build cockpit-render-element-rendering-react
npx nx e2e cockpit-render-element-rendering-react
```

The closed static build installs local React/core/content artifacts and locked presentation dependencies. Browser checks cover native children and visibility, partial playback, retained host state, page exit and narrow screens.
