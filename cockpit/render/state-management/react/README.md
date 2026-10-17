# Native React State Management preview

Three local JSON samples render through installed `@threadplane/react/render`.
The application entrypoint creates one `createRenderState` owner from
`@threadplane/content/render-state`, outside React. The view borrows a stable
read-only observer through `useAgent`; native `RenderSpec` receives that owner's
actual immutable snapshot. The renderer resolves the three authored `$state`
paths; four read-only views display values
and native children. No agent request or runtime configuration is needed.

Application callbacks validate edits before issuing scalar `set` commands at
`/user/name`, `/user/age` or `/settings/theme`. Names may be empty and contain at
most 256 UTF-16 code units. Ages must be strings of one to three decimal digits,
with a value from 0 to 150; accepted age drafts normalize to numbers. Theme
accepts only `dark` or `light`. Rejected edits issue no owner commands. Equal
scalar writes use the owner's snapshot and notification no-op behavior.

State edits survive playback, seek, Reset and sample selection. React keeps only
the age input's draft and error. An accepted spelling such as `042` stays visible
while the owner's age is 42. A committed external change to 41 retires that
spelling, so returning to 42 displays `42`. An invalid draft and error remain
visible across valid external state changes while the rendered view displays the
latest owner value. Replacing the supplied observer resets the draft and error;
remounting starts from the owner's current age.

The observer's `DemoState` type is a closed application contract: the owner starts
with the known initial shape and application callbacks maintain it with validated
scalar commands. The local getter narrowing does not validate arbitrary owners.
Unmounting releases the view's subscription. On `pagehide`, the application
disposes playback, unmounts React, disposes the state owner, then disposes the
runtime bridge. Reloading restores Alice, age 30, and Dark. Playback owns its
parser and revokes obsolete callbacks independently of application state.

From the repository root:

```sh
npx nx test cockpit-render-state-management-react --skip-nx-cache
npx nx lint cockpit-render-state-management-react --skip-nx-cache
npx nx e2e cockpit-render-state-management-react --skip-nx-cache
```

The closed static build installs local React/core/content artifacts and locked
presentation dependencies. The e2e target first builds the installed consumer,
checks its types and asserts that the installed render-state owner contributes
nonempty emitted code. The streaming JSON parser remains required. Browser
checks cover bindings, invalid age recovery, partial playback, state retention,
page exit and narrow screens.
