# Render cockpit browser coverage

All six render capabilities (`spec-rendering`, `element-rendering`, `state-management`, `registry`, `repeat-loops`, `computed-functions`) have direct Playwright browser coverage in both Angular and React, configured by each frontend's Nx `e2e` target.

The UI uses a spec picker and local samples, with no chat prompt or LLM-driven assertions. Angular streams the selected spec through the shared [StreamingSimulator](./shared/streaming-simulator.ts); React uses local [playback](./repeat-loops/react/src/playback.ts). For example, the Repeat Loops samples live in [Angular specs](./repeat-loops/angular/src/app/specs.ts) and [React specs](./repeat-loops/react/src/specs.ts).

Local UI playback does not remove the existing Angular browser harness prerequisites: all six Angular global setups call the [shared setup factory](../../libs/e2e-harness/src/global-setup-factory.ts), which unconditionally starts aimock and the Python LangGraph dev service before the Angular dev server. See the Repeat Loops [Angular setup](./repeat-loops/angular/e2e/global-setup-impl.ts) and [Playwright config](./repeat-loops/angular/e2e/playwright.config.ts). React e2e instead serves the installed static build: its [Nx target](./repeat-loops/react/project.json) depends on `build`, and its [Playwright config](./repeat-loops/react/e2e/playwright.config.ts) starts the [local static server](../../scripts/react-cockpit/serve.mjs).

Coverage varies by suite. The [Angular Repeat Loops suite](./repeat-loops/angular/e2e/r-repeat-loops.spec.ts) checks the picker, timeline, JSON pane and row addition. The [React Repeat Loops suite](./repeat-loops/react/e2e/repeat-loops.spec.ts) checks row identity across list edits, source preservation, capacity and empty recovery, playback, narrow layout and cleanup. These establish bounded browser behavior, not equal test depth across frameworks or full render parity.

Existing unit and structural coverage complements the browser suites:

- [StreamingSimulator unit tests](./shared/streaming-simulator.spec.ts) cover local Angular streaming behavior.
- [React playback unit tests](./repeat-loops/react/src/playback.spec.ts) cover the local playback owner.
- [Render matrix](./matrix.spec.ts) and [footprint](./footprint.spec.ts) tests provide structural checks.

Run a configured suite from the repository root after installing the repository dependencies and Chromium, with the Angular harness tools available for Angular runs. The [Angular project](./repeat-loops/angular/project.json) and React target above define these exact commands and their prerequisites:

```sh
npx nx e2e cockpit-render-repeat-loops-react --skip-nx-cache
npx nx e2e cockpit-render-repeat-loops-angular --skip-nx-cache
```
