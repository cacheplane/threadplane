# Native React Computed Functions preview

Three authored local JSON samples use the installed `@threadplane/react/render` `RenderSpec.functions` API: Text Transforms, Data Display and Mixed Functions. Pure synchronous functions uppercase/reverse text, multiply numbers and format dates in the browser locale and time zone. The spec preserves native `$computed` expressions rather than replacing them with app-computed literals.

The bounded private projection admits Heading/Card/Value and the authored argument domain. It waits for complete expression nodes before calculating, owns the display data, and rejects executable fields. Playback starts paused; Play/Pause, Finish, Reset and seek control the source prefix. Sample changes and page exit revoke the previous animation generation. This static preview creates no agent executions.

```sh
npx nx test cockpit-render-computed-functions-react
npx nx build cockpit-render-computed-functions-react
npx nx e2e cockpit-render-computed-functions-react
```

The isolated build installs local core/content/React packages and root-locked presentation dependencies. Canonical docs stay at `/docs/render/api/provide-render`; Angular remains the default. Native React runs at `/render/computed-functions/react/` on development port 4619.
