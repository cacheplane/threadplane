# Native React Render Spec preview

This local example streams three authored JSON samples through a partial parser
and the installed `@threadplane/react/render` RenderSpec component. Four registered
views display literal props and native children. No agent request or runtime
configuration is needed.

Play/Pause, seek, Finish and Reset share one local playback owner. Sample changes
and page exit revoke old callbacks. Copied, frozen partial trees leave parser
state private; Complete requires a finished parser matching the validated source.

From the repository root:

```sh
npx nx build cockpit-render-spec-rendering-react
npx nx e2e cockpit-render-spec-rendering-react
```

The closed static build installs local React/core/content package artifacts and
locked presentation dependencies. It contains native RenderSpec and parser
modules with no backend runtime. Browser checks exercise all samples, cancellation,
rewind and narrow screens while observing zero runtime writes.
