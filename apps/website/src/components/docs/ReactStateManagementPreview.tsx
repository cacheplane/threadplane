import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';

const source = `# React State Management preview

Update a rendered view by changing its data, without replacing the layout. State bindings let a specification refer to values such as the traveler’s name or selected preference.

The native React APIs on this page are experimental, private source-build packages. Run the repository example to use them; they are not an npm installation recipe.

## Let React own editable values

\`RenderSpec\` reads the \`state\` prop; it does not become the owner of your form. Update local React state in response to a control, then pass the next object to the renderer. A \`$state\` expression names the value to read. The local example below makes that relationship visible without a backend or persistence layer.

~~~tsx
import { useState } from 'react';
import { RenderSpec, type ReactRenderRegistry, type RenderSpecData } from '@threadplane/react/render';

const registry: ReactRenderRegistry = { Text: ({ props }) => <p>{String(props['text'] ?? '')}</p> };
const spec: RenderSpecData = {
  root: 'destination',
  elements: { destination: { type: 'Text', props: { text: { $state: '/destination' } } } },
};

export function DestinationPreview() {
  const [destination, setDestination] = useState('Portland');
  return <>
    <input aria-label="Destination" value={destination} onChange={(event) => setDestination(event.target.value)} />
    <RenderSpec spec={spec} registry={registry} state={{ destination }} />
  </>;
}
~~~

The [conversation walkthrough](/docs/langgraph/concepts/conversation-turns) connects this capability to requests, tools, UI state, and saved history.

## Edit local state

Choose **Run**, select **User Profile**, **Nested Paths** or **Form Display**, and press **Finish**. **Name**, **Age** and **Theme** sit outside the rendered tree and update its visible values. Age accepts whole numbers from 0 to 150; an invalid draft keeps the last valid value until you correct it. Theme changes the displayed preference. Reloading restores Alice, age 30, and Dark.

**Play** streams the JSON locally. **Pause** holds the position, **Playback position** seeks, **Finish** displays the full sample, and **Reset** clears playback. Your state edits survive these controls and sample changes. No agent requests or saved browser state are used.

<ExampleCode file="cockpit/render/state-management/react/src/specs.ts" />

## Own state in the React host

React useState holds copied, frozen user and settings data. The host passes it through RenderSpec's state prop. Text and Label props use a one-key expression such as \`{ $state: '/user/name' }\`; the native renderer resolves the value. The three authored paths are \`/user/name\`, \`/user/age\` and \`/settings/theme\`.

<ExampleCode file="cockpit/render/state-management/react/src/state.ts" />

<ExampleCode file="cockpit/render/state-management/react/src/app.tsx" />

Heading, Text, Label and Card are read-only registered views. Heading and Card display children supplied by RenderSpec in authored order. These views do not dispatch actions or write state.

<ExampleCode file="cockpit/render/state-management/react/src/views.tsx" />

## Keep partial bindings bounded

The caller admits a complete local sample before playback, then copies known partial data. A binding waits until its exact authored path is available. Unsupported paths, extra expression keys and executable fields are rejected. The renderer receives owned data; parser state stays private.

<ExampleCode file="cockpit/render/state-management/react/src/projection.ts" />

The private playback owner rebuilds its parser on seek and revokes obsolete callbacks on Pause, Reset, selection changes and page exit. Complete requires the finished parser output to match the admitted source. Playback never writes host state.

<ExampleCode file="cockpit/render/state-management/react/src/playback.ts" />

## Source build and verification

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-render-state-management-react
npx nx e2e cockpit-render-state-management-react
~~~

The isolated build installs local React, core and content artifacts with root-locked presentation dependencies. Browser coverage exercises live bindings, invalid age recovery, partial playback, state retention, cleanup and narrow screens. Select **Angular** to read and run its existing state-store implementation.
`;

export function ReactStateManagementPreview({
  exampleCode,
}: {
  readonly exampleCode: ExampleCodeContext | null;
}) {
  return (
    <div className="docs-workspace-article">
      <article className="docs-article-layout flex-1 py-8 px-4 sm:px-6 md:px-12 md:max-w-3xl">
        <MdxRenderer source={source} exampleCode={exampleCode} />
      </article>
    </div>
  );
}
